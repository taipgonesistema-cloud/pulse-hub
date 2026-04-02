package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	waProto "google.golang.org/protobuf/encoding/protojson"

	appauth "pulsehub/wa-core/internal/auth"
	"pulsehub/wa-core/internal/models"
	appstore "pulsehub/wa-core/internal/store"
	"pulsehub/wa-core/internal/whatsapp"
	"pulsehub/wa-core/internal/ws"
)

type AuthConfig struct {
	Email    string
	Password string
	Name     string
	Role     string
}

type API struct {
	logger  *slog.Logger
	manager *whatsapp.Manager
	hub     *ws.Hub
	store   *appstore.Store
	auth    AuthConfig
}

func NewRouter(logger *slog.Logger, manager *whatsapp.Manager, hub *ws.Hub, store *appstore.Store, auth AuthConfig) http.Handler {
	api := &API{
		logger:  logger,
		manager: manager,
		hub:     hub,
		store:   store,
		auth:    auth,
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(api.cors)

	r.Get("/health", api.handleHealth)
	r.Post("/auth/sign-in", api.handleSignIn)

	r.Group(func(r chi.Router) {
		r.Use(api.requireAuth)

		r.Get("/auth/me", api.handleMe)
		r.Post("/auth/sign-out", api.handleSignOut)
		r.Get("/auth/users", api.handleListUsers)
		r.Get("/auth/users/{id}/sessions", api.handleListUserSessions)
		r.Post("/auth/users/{id}/sessions/{sessionId}/revoke", api.handleRevokeUserSession)
		r.Post("/auth/users", api.handleCreateUser)
		r.Put("/auth/users/{id}", api.handleUpdateUser)

		r.Post("/session/init", api.handleSessionInit)
		r.Get("/session/qr", api.handleSessionQR)
		r.Get("/session/status", api.handleSessionStatus)
		r.Get("/contacts", api.handleContacts)
		r.Get("/contacts/{jid}/photo", api.handleContactPhoto)
		r.Get("/chats", api.handleChats)
		r.Get("/chats/{jid}/messages", api.handleChatMessages)
		r.Post("/messages/text", api.handleSendText)
		r.Post("/messages/media", api.handleSendMedia)
		r.Get("/messages/{id}/media", api.handleMessageMedia)
		r.Get("/ws", api.handleWebSocket)
		r.Get("/dashboard/overview", api.handleDashboardOverview)
		r.Route("/whatsapp", func(r chi.Router) {
			r.Get("/contacts/boards", api.handleListContactKanbanBoards)
			r.Post("/contacts/boards", api.handleCreateContactKanbanBoard)
			r.Delete("/contacts/boards/{id}", api.handleDeleteContactKanbanBoard)
			r.Get("/quick-replies", api.handleListQuickReplies)
			r.Get("/quick-replies/autocomplete", api.handleQuickReplyAutocomplete)
			r.Post("/quick-replies", api.handleCreateQuickReply)
			r.Put("/quick-replies/{id}", api.handleUpdateQuickReply)
			r.Delete("/quick-replies/{id}", api.handleDeleteQuickReply)
			r.Get("/contacts/crm", api.handleListContactCRMProfiles)
			r.Put("/contacts/crm", api.handleUpdateContactCRMProfile)
			r.Get("/contacts/kanban", api.handleListContactKanbanStages)
			r.Post("/contacts/manual", api.handleCreateManualContact)
			r.Put("/contacts/kanban", api.handleUpdateContactKanbanStage)
			r.Get("/sessions", api.handleListSessions)
			r.Post("/sessions", api.handleCreateSession)
			r.Post("/sessions/{id}/connect", api.handleConnectSession)
			r.Post("/sessions/{id}/disconnect", api.handleDisconnectSession)
			r.Get("/sessions/{id}/qr", api.handleSessionQRCompat)
			r.Get("/sessions/{id}/conversations", api.handleConversations)
			r.Get("/sessions/{id}/conversations/{jid}/messages", api.handleConversationMessages)
			r.Post("/sessions/{id}/conversations/{jid}/messages", api.handleConversationSend)
			r.Post("/sessions/{id}/conversations/{jid}/media", api.handleConversationSendMedia)
			r.Post("/sessions/{id}/conversations/{jid}/reactions", api.handleConversationReaction)
			r.Post("/sessions/{id}/conversations/{jid}/read", api.handleConversationRead)
			r.Get("/sessions/{id}/stream", api.handleSessionStream)
		})
	})

	return r
}

func (a *API) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *API) handleHealth(w http.ResponseWriter, _ *http.Request) {
	respondJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"service": "wa-core",
		"time":    models.NowString(),
	})
}

func (a *API) handleSessionInit(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	var request models.SessionInitRequest
	if err := decodeJSON(r, &request); err != nil && !errors.Is(err, errEmptyBody) {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	session, err := a.manager.InitSession(r.Context(), request)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, session)
}

func (a *API) handleSessionQR(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	qr, err := a.manager.GetQR(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, qr)
}

func (a *API) handleSessionStatus(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	status, err := a.manager.GetStatus(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, status)
}

func (a *API) handleContacts(w http.ResponseWriter, r *http.Request) {
	contacts, err := a.manager.ListContacts(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, contacts)
}

func (a *API) handleContactPhoto(w http.ResponseWriter, r *http.Request) {
	jid, err := pathJID(chi.URLParam(r, "jid"))
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	photo, err := a.manager.GetProfilePhoto(r.Context(), jid, shouldRedirectPhoto(r))
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	photo.ProxyURL = avatarProxyPath(photo.CanonicalJID, photo.PhotoID)

	if shouldRedirectPhoto(r) {
		if photo.PhotoURL == "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "private, max-age=300")
		http.Redirect(w, r, photo.PhotoURL, http.StatusTemporaryRedirect)
		return
	}

	respondJSON(w, http.StatusOK, photo)
}

func (a *API) handleChats(w http.ResponseWriter, r *http.Request) {
	chats, err := a.manager.ListChats(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, chats)
}

func (a *API) handleChatMessages(w http.ResponseWriter, r *http.Request) {
	jid, err := pathJID(chi.URLParam(r, "jid"))
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	messages, err := a.manager.ListMessages(r.Context(), jid)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, messages)
}

func (a *API) handleSendText(w http.ResponseWriter, r *http.Request) {
	var request models.SendTextRequest
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	message, err := a.manager.SendText(r.Context(), request)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusCreated, message)
}

func (a *API) handleSendMedia(w http.ResponseWriter, r *http.Request) {
	req, err := parseMediaUpload(r, "")
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	message, err := a.manager.SendMedia(r.Context(), req)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	record, err := a.buildMessageRecord(r.Context(), *message, message.ChatJID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusCreated, record)
}

func (a *API) handleMessageMedia(w http.ResponseWriter, r *http.Request) {
	messageID := strings.TrimSpace(chi.URLParam(r, "id"))
	if messageID == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "message id is required"})
		return
	}

	data, mimeType, fileName, err := a.manager.GetMessageMedia(r.Context(), messageID)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	if mimeType != "" {
		w.Header().Set("Content-Type", mimeType)
	}
	if strings.TrimSpace(r.URL.Query().Get("download")) != "" {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", fileName))
	}
	w.Header().Set("Cache-Control", "private, max-age=300")
	_, _ = w.Write(data)
}

func (a *API) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	a.hub.ServeHTTP(w, r)
}

func (a *API) handleSignIn(w http.ResponseWriter, r *http.Request) {
	var request models.SignInRequest
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	user, passwordHash, err := a.store.GetAuthUserByEmail(r.Context(), request.Email)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	if user == nil || !user.IsActive || appauth.ComparePassword(passwordHash, request.Password) != nil {
		respondJSON(w, http.StatusUnauthorized, map[string]any{"message": "Credenciais invalidas."})
		return
	}

	now := models.NowString()
	if err := a.store.SetAuthUserLastLogin(r.Context(), user.ID, now); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	user.LastLoginAt = now
	user.UpdatedAt = now

	token, err := appauth.GenerateToken()
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	if err := a.store.SaveAuthSession(r.Context(), models.AuthSession{
		UserID:     user.ID,
		TokenHash:  appauth.HashToken(token),
		CreatedAt:  now,
		LastSeenAt: now,
		UpdatedAt:  now,
		ExpiresAt:  time.Now().UTC().Add(authSessionDuration).Format(time.RFC3339),
		UserAgent:  strings.TrimSpace(r.UserAgent()),
		RemoteAddr: strings.TrimSpace(r.RemoteAddr),
	}); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	response := models.SignInResponse{
		User:  *user,
		Token: token,
	}

	respondJSON(w, http.StatusOK, response)
}

func (a *API) handleDashboardOverview(w http.ResponseWriter, r *http.Request) {
	overview, err := a.buildDashboardOverview(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, overview)
}

func (a *API) handleListSessions(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	sessions, err := a.buildSessionRecords(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, sessions)
}

func (a *API) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	var request models.SessionInitRequest
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	session, err := a.manager.CreateOrUpdateSession(r.Context(), request)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	compat, err := a.sessionToCompat(r.Context(), session)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusCreated, compat)
}

func (a *API) handleConnectSession(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	if !a.isDefaultSession(chi.URLParam(r, "id")) {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Sessao nao encontrada."})
		return
	}

	session, err := a.manager.InitSession(r.Context(), models.SessionInitRequest{})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	compat, err := a.sessionToCompat(r.Context(), session)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, compat)
}

func (a *API) handleDisconnectSession(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	if !a.isDefaultSession(chi.URLParam(r, "id")) {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Sessao nao encontrada."})
		return
	}

	session, err := a.manager.Disconnect(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	compat, err := a.sessionToCompat(r.Context(), session)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, compat)
}

func (a *API) handleSessionQRCompat(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	if !a.isDefaultSession(chi.URLParam(r, "id")) {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Sessao nao encontrada."})
		return
	}

	session, err := a.manager.GetSession(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	if session == nil {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Sessao nao encontrada."})
		return
	}
	compat, err := a.sessionToCompat(r.Context(), session)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	qr, err := a.manager.GetQR(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"session": compat,
		"qr": map[string]any{
			"code":             qr.Code,
			"imageDataUrl":     qr.ImageDataURL,
			"expiresInSeconds": qr.ExpiresInSeconds,
		},
	})
}

func (a *API) handleConversations(w http.ResponseWriter, r *http.Request) {
	if !a.isDefaultSession(chi.URLParam(r, "id")) {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Sessao nao encontrada."})
		return
	}

	conversations, err := a.buildConversationRecords(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, conversations)
}

func (a *API) handleConversationMessages(w http.ResponseWriter, r *http.Request) {
	if !a.isDefaultSession(chi.URLParam(r, "id")) {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Sessao nao encontrada."})
		return
	}

	jid, err := pathJID(chi.URLParam(r, "jid"))
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	messages, err := a.manager.ListMessages(r.Context(), jid)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	records, err := a.toMessageRecords(r.Context(), messages, jid)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, records)
}

func (a *API) handleConversationSend(w http.ResponseWriter, r *http.Request) {
	if !a.isDefaultSession(chi.URLParam(r, "id")) {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Sessao nao encontrada."})
		return
	}

	jid, err := pathJID(chi.URLParam(r, "jid"))
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	var request struct {
		Body             string `json:"body"`
		Author           string `json:"author"`
		ReplyToMessageID string `json:"replyToMessageId"`
	}
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	message, err := a.manager.SendText(r.Context(), models.SendTextRequest{
		JID:              jid,
		Text:             request.Body,
		ReplyToMessageID: request.ReplyToMessageID,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	record, err := a.buildMessageRecord(r.Context(), *message, jid)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, record)
}

func (a *API) handleConversationSendMedia(w http.ResponseWriter, r *http.Request) {
	if !a.isDefaultSession(chi.URLParam(r, "id")) {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Sessao nao encontrada."})
		return
	}

	jid, err := pathJID(chi.URLParam(r, "jid"))
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	req, err := parseMediaUpload(r, jid)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	message, err := a.manager.SendMedia(r.Context(), req)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	record, err := a.buildMessageRecord(r.Context(), *message, jid)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, record)
}

func (a *API) handleConversationReaction(w http.ResponseWriter, r *http.Request) {
	if !a.isDefaultSession(chi.URLParam(r, "id")) {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Sessao nao encontrada."})
		return
	}

	jid, err := pathJID(chi.URLParam(r, "jid"))
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	var request models.SendReactionRequest
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	request.JID = jid

	message, err := a.manager.SendReaction(r.Context(), request)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	record, err := a.buildMessageRecord(r.Context(), *message, jid)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, record)
}

func (a *API) handleConversationRead(w http.ResponseWriter, r *http.Request) {
	if !a.isDefaultSession(chi.URLParam(r, "id")) {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Sessao nao encontrada."})
		return
	}

	jid, err := pathJID(chi.URLParam(r, "jid"))
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	if err := a.manager.MarkChatRead(r.Context(), jid); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) handleListContactKanbanBoards(w http.ResponseWriter, r *http.Request) {
	items, err := a.store.ListContactKanbanBoards(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, items)
}

func (a *API) handleCreateContactKanbanBoard(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	var request models.CreateContactKanbanBoardRequest
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	request.ID = strings.TrimSpace(request.ID)
	request.Label = strings.TrimSpace(request.Label)
	request.Description = strings.TrimSpace(request.Description)
	request.ContactsFilter = strings.TrimSpace(strings.ToLower(request.ContactsFilter))
	request.ContactsAudienceFilter = strings.TrimSpace(strings.ToLower(request.ContactsAudienceFilter))
	request.ContactsChannelFilter = strings.TrimSpace(strings.ToLower(request.ContactsChannelFilter))
	request.CreatedBy = strings.TrimSpace(request.CreatedBy)
	request.UpdatedBy = strings.TrimSpace(request.UpdatedBy)

	if request.ID == "" || request.Label == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "id e label sao obrigatorios."})
		return
	}

	if !isValidConversationFilter(request.ContactsFilter) {
		request.ContactsFilter = "all"
	}
	if !isValidContactsAudienceFilter(request.ContactsAudienceFilter) {
		request.ContactsAudienceFilter = "all"
	}
	if !isValidContactsChannelFilter(request.ContactsChannelFilter) {
		request.ContactsChannelFilter = "all"
	}

	now := models.NowString()
	record := models.ContactKanbanBoardRecord{
		ID:                     request.ID,
		Label:                  request.Label,
		Description:            request.Description,
		ContactsFilter:         request.ContactsFilter,
		ContactsAudienceFilter: request.ContactsAudienceFilter,
		ContactsChannelFilter:  request.ContactsChannelFilter,
		CreatedBy:              request.CreatedBy,
		UpdatedBy:              request.UpdatedBy,
		CreatedAt:              now,
		UpdatedAt:              now,
	}

	if err := a.store.SaveContactKanbanBoard(r.Context(), record); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	a.hub.Broadcast(models.RealtimeEvent{
		Kind:       "kanban.board.updated",
		Text:       record.ID,
		OccurredAt: now,
	})

	respondJSON(w, http.StatusCreated, record)
}

func (a *API) handleDeleteContactKanbanBoard(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	boardID := strings.TrimSpace(chi.URLParam(r, "id"))
	if boardID == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "id do board obrigatorio."})
		return
	}

	if err := a.store.DeleteContactKanbanBoard(r.Context(), boardID); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	a.hub.Broadcast(models.RealtimeEvent{
		Kind:       "kanban.board.updated",
		Text:       boardID,
		OccurredAt: models.NowString(),
	})

	respondJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) handleListQuickReplies(w http.ResponseWriter, r *http.Request) {
	auth := currentAuth(r)
	if auth == nil {
		respondJSON(w, http.StatusUnauthorized, map[string]any{"message": "Autenticacao obrigatoria."})
		return
	}

	search := strings.TrimSpace(r.URL.Query().Get("q"))
	var (
		items []models.QuickReplyRecord
		err   error
	)
	if auth.user.Role == models.AuthRoleAdmin || auth.user.Role == models.AuthRoleSupervisor {
		items, err = a.store.ListQuickReplies(r.Context(), search)
	} else {
		items, err = a.store.ListVisibleQuickReplies(r.Context(), auth.user.ID, search, true)
	}
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, items)
}

func (a *API) handleQuickReplyAutocomplete(w http.ResponseWriter, r *http.Request) {
	auth := currentAuth(r)
	if auth == nil {
		respondJSON(w, http.StatusUnauthorized, map[string]any{"message": "Autenticacao obrigatoria."})
		return
	}

	items, err := a.store.ListVisibleQuickReplies(r.Context(), auth.user.ID, strings.TrimSpace(r.URL.Query().Get("q")), true)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	if len(items) > 12 {
		items = items[:12]
	}

	respondJSON(w, http.StatusOK, items)
}

func (a *API) handleCreateQuickReply(w http.ResponseWriter, r *http.Request) {
	auth, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor)
	if !ok {
		return
	}

	var request models.SaveQuickReplyRequest
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	record, err := a.buildQuickReplyRecord(r.Context(), request, "", auth.user)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	record.ID = uuid.NewString()
	if err := a.store.SaveQuickReply(r.Context(), record); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	a.hub.Broadcast(models.RealtimeEvent{Kind: "quick_reply.updated", Text: record.ID, OccurredAt: record.UpdatedAt})
	respondJSON(w, http.StatusCreated, record)
}

func (a *API) handleUpdateQuickReply(w http.ResponseWriter, r *http.Request) {
	auth, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor)
	if !ok {
		return
	}

	quickReplyID := strings.TrimSpace(chi.URLParam(r, "id"))
	if quickReplyID == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "Resposta rapida invalida."})
		return
	}

	var request models.SaveQuickReplyRequest
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	record, err := a.buildQuickReplyRecord(r.Context(), request, quickReplyID, auth.user)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	if err := a.store.SaveQuickReply(r.Context(), record); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	a.hub.Broadcast(models.RealtimeEvent{Kind: "quick_reply.updated", Text: record.ID, OccurredAt: record.UpdatedAt})
	respondJSON(w, http.StatusOK, record)
}

func (a *API) handleDeleteQuickReply(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	quickReplyID := strings.TrimSpace(chi.URLParam(r, "id"))
	if quickReplyID == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "Resposta rapida invalida."})
		return
	}

	if err := a.store.DeleteQuickReply(r.Context(), quickReplyID); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	a.hub.Broadcast(models.RealtimeEvent{Kind: "quick_reply.updated", Text: quickReplyID, OccurredAt: models.NowString()})
	respondJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) buildQuickReplyRecord(ctx context.Context, request models.SaveQuickReplyRequest, quickReplyID string, authUser models.AuthUser) (models.QuickReplyRecord, error) {
	request.Name = strings.TrimSpace(request.Name)
	request.Shortcut = normalizeQuickReplyShortcut(request.Shortcut)
	request.Content = strings.TrimSpace(request.Content)
	request.Category = strings.TrimSpace(request.Category)
	request.VisibilityUserID = strings.TrimSpace(request.VisibilityUserID)
	request.VisibilityScope = normalizeQuickReplyVisibilityScope(request.VisibilityScope)
	request.Status = normalizeQuickReplyStatus(request.Status)

	if request.Name == "" || request.Shortcut == "" || request.Content == "" {
		return models.QuickReplyRecord{}, errors.New("nome, atalho e conteudo sao obrigatorios")
	}
	if request.VisibilityScope == models.QuickReplyVisibilityUser {
		if request.VisibilityUserID == "" {
			return models.QuickReplyRecord{}, errors.New("selecione o usuario visivel para este atalho")
		}
		user, err := a.store.GetAuthUserByID(ctx, request.VisibilityUserID)
		if err != nil {
			return models.QuickReplyRecord{}, err
		}
		if user == nil {
			return models.QuickReplyRecord{}, errors.New("usuario de visibilidade nao encontrado")
		}
	}

	exists, err := a.store.QuickReplyShortcutExists(ctx, request.Shortcut, request.VisibilityScope, request.VisibilityUserID, quickReplyID)
	if err != nil {
		return models.QuickReplyRecord{}, err
	}
	if exists {
		return models.QuickReplyRecord{}, errors.New("ja existe uma resposta rapida com este atalho neste escopo")
	}

	now := models.NowString()
	record := models.QuickReplyRecord{
		ID:               quickReplyID,
		Name:             request.Name,
		Shortcut:         request.Shortcut,
		Content:          request.Content,
		Category:         request.Category,
		VisibilityScope:  request.VisibilityScope,
		VisibilityUserID: request.VisibilityUserID,
		Status:           request.Status,
		UpdatedByUserID:  authUser.ID,
		UpdatedBy:        authUser.Name,
		UpdatedAt:        now,
	}

	if quickReplyID != "" {
		existing, err := a.store.GetQuickReply(ctx, quickReplyID)
		if err != nil {
			return models.QuickReplyRecord{}, err
		}
		if existing == nil {
			return models.QuickReplyRecord{}, errors.New("resposta rapida nao encontrada")
		}
		record.CreatedAt = existing.CreatedAt
		record.CreatedBy = existing.CreatedBy
		record.CreatedByUserID = existing.CreatedByUserID
	} else {
		record.CreatedAt = now
		record.CreatedBy = authUser.Name
		record.CreatedByUserID = authUser.ID
	}

	return record, nil
}

func normalizeQuickReplyShortcut(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	value = strings.TrimPrefix(value, "/")
	return value
}

func normalizeQuickReplyVisibilityScope(scope models.QuickReplyVisibilityScope) models.QuickReplyVisibilityScope {
	if scope == models.QuickReplyVisibilityUser {
		return scope
	}
	return models.QuickReplyVisibilityAll
}

func normalizeQuickReplyStatus(status models.QuickReplyStatus) models.QuickReplyStatus {
	if status == models.QuickReplyStatusInactive {
		return status
	}
	return models.QuickReplyStatusActive
}

func (a *API) handleListContactCRMProfiles(w http.ResponseWriter, r *http.Request) {
	items, err := a.store.ListContactCRMProfiles(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, items)
}

func (a *API) handleUpdateContactCRMProfile(w http.ResponseWriter, r *http.Request) {
	var request models.UpdateContactCRMProfileRequest
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	request.SessionID = strings.TrimSpace(request.SessionID)
	request.ConversationID = strings.TrimSpace(request.ConversationID)
	request.Assignee = strings.TrimSpace(request.Assignee)
	request.Priority = strings.TrimSpace(strings.ToLower(request.Priority))
	request.Notes = strings.TrimSpace(request.Notes)
	request.UpdatedBy = strings.TrimSpace(request.UpdatedBy)
	request.Tags = normalizeTags(request.Tags)

	if request.SessionID == "" || request.ConversationID == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "sessionId e conversationId sao obrigatorios."})
		return
	}
	if !isValidContactPriority(request.Priority) {
		request.Priority = ""
	}

	record := models.ContactCRMProfileRecord{
		SessionID:      request.SessionID,
		ConversationID: request.ConversationID,
		Assignee:       request.Assignee,
		Priority:       request.Priority,
		Notes:          request.Notes,
		Tags:           request.Tags,
		UpdatedBy:      request.UpdatedBy,
		UpdatedAt:      models.NowString(),
	}

	if err := a.store.SaveContactCRMProfile(r.Context(), record); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	payload, _ := json.Marshal(record)
	a.hub.Broadcast(models.RealtimeEvent{
		Kind:       "kanban.contact.updated",
		SessionID:  record.SessionID,
		ChatJID:    record.ConversationID,
		Payload:    string(payload),
		OccurredAt: record.UpdatedAt,
	})

	respondJSON(w, http.StatusOK, record)
}

func (a *API) handleListContactKanbanStages(w http.ResponseWriter, r *http.Request) {
	items, err := a.store.ListContactKanbanStages(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, items)
}

func (a *API) handleUpdateContactKanbanStage(w http.ResponseWriter, r *http.Request) {
	var request models.UpdateContactKanbanStageRequest
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	request.SessionID = strings.TrimSpace(request.SessionID)
	request.ConversationID = strings.TrimSpace(request.ConversationID)
	request.Stage = strings.TrimSpace(strings.ToLower(request.Stage))
	request.UpdatedBy = strings.TrimSpace(request.UpdatedBy)

	if request.SessionID == "" || request.ConversationID == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "sessionId e conversationId sao obrigatorios."})
		return
	}

	if !isValidContactKanbanStage(request.Stage) {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "Etapa do kanban invalida."})
		return
	}

	record := models.ContactKanbanStageRecord{
		SessionID:      request.SessionID,
		ConversationID: request.ConversationID,
		Stage:          request.Stage,
		UpdatedBy:      request.UpdatedBy,
		UpdatedAt:      models.NowString(),
	}

	if err := a.store.SaveContactKanbanStage(r.Context(), record); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	a.hub.Broadcast(models.RealtimeEvent{
		Kind:       "kanban.stage.updated",
		SessionID:  record.SessionID,
		ChatJID:    record.ConversationID,
		Text:       record.Stage,
		OccurredAt: record.UpdatedAt,
	})

	respondJSON(w, http.StatusOK, record)
}

func (a *API) handleCreateManualContact(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	var request models.CreateManualContactRequest
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	request.SessionID = strings.TrimSpace(request.SessionID)
	request.Name = strings.TrimSpace(request.Name)
	request.Phone = strings.TrimSpace(request.Phone)
	request.Stage = strings.TrimSpace(strings.ToLower(request.Stage))
	request.UpdatedBy = strings.TrimSpace(request.UpdatedBy)

	if request.SessionID == "" {
		request.SessionID = models.DefaultSessionID
	}

	if request.Name == "" || request.Phone == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "name e phone sao obrigatorios."})
		return
	}

	if request.Stage != "" && !isValidContactKanbanStage(request.Stage) {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "Etapa do kanban invalida."})
		return
	}

	jid, phone, err := normalizeManualContactPhone(request.Phone)
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": err.Error()})
		return
	}

	now := models.NowString()
	contact := models.Contact{
		JID:         jid,
		Phone:       phone,
		FirstName:   firstToken(request.Name),
		FullName:    request.Name,
		PushName:    request.Name,
		DisplayName: request.Name,
		UpdatedAt:   now,
	}
	if err := a.store.UpsertContact(r.Context(), contact); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	if _, err := a.store.UpsertChat(r.Context(), models.Chat{
		JID:             jid,
		Name:            request.Name,
		ContactJID:      jid,
		IsGroup:         false,
		UnreadCount:     0,
		LastMessageText: "Contato criado manualmente.",
		LastMessageAt:   now,
		UpdatedAt:       now,
	}); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	if request.Stage != "" {
		if err := a.store.SaveContactKanbanStage(r.Context(), models.ContactKanbanStageRecord{
			SessionID:      request.SessionID,
			ConversationID: jid,
			Stage:          request.Stage,
			UpdatedBy:      request.UpdatedBy,
			UpdatedAt:      now,
		}); err != nil {
			respondError(w, http.StatusInternalServerError, err)
			return
		}
	}

	a.hub.Broadcast(models.RealtimeEvent{
		Kind:       "chat.new",
		SessionID:  request.SessionID,
		ChatJID:    jid,
		OccurredAt: now,
	})
	if request.Stage != "" {
		a.hub.Broadcast(models.RealtimeEvent{
			Kind:       "kanban.stage.updated",
			SessionID:  request.SessionID,
			ChatJID:    jid,
			Text:       request.Stage,
			OccurredAt: now,
		})
	}

	respondJSON(w, http.StatusCreated, map[string]any{
		"jid":   jid,
		"phone": phone,
		"name":  request.Name,
	})
}

func (a *API) handleSessionStream(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	if !a.isDefaultSession(chi.URLParam(r, "id")) {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Sessao nao encontrada."})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"message": "Streaming nao suportado."})
		return
	}

	ch, unsubscribe := a.hub.Subscribe()
	defer unsubscribe()

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, _ = fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case payload := <-ch:
			compat, ok := toCompatStreamEvent(payload)
			if !ok {
				continue
			}
			encoded, err := json.Marshal(compat)
			if err != nil {
				continue
			}
			_, _ = fmt.Fprintf(w, "data: %s\n\n", encoded)
			flusher.Flush()
		}
	}
}

func (a *API) buildDashboardOverview(ctx context.Context) (*models.DashboardOverview, error) {
	sessions, err := a.buildSessionRecords(ctx)
	if err != nil {
		return nil, err
	}
	conversations, err := a.buildConversationRecords(ctx)
	if err != nil {
		return nil, err
	}
	responseVelocity, err := a.buildResponseVelocityAnalytics(ctx)
	if err != nil {
		return nil, err
	}
	crmProfiles, err := a.store.ListContactCRMProfiles(ctx)
	if err != nil {
		return nil, err
	}
	kanbanStages, err := a.store.ListContactKanbanStages(ctx)
	if err != nil {
		return nil, err
	}
	users, err := a.store.ListAuthUsers(ctx)
	if err != nil {
		return nil, err
	}

	overview := &models.DashboardOverview{
		Product:       "Pulse Hub",
		Phase:         "whatsmeow-core",
		Sessions:      sessions,
		Conversations: conversations,
	}
	overview.Analytics.ResponseVelocity = responseVelocity
	crmProfileMap := buildCRMProfileMap(crmProfiles)
	kanbanStageMap := buildKanbanStageMap(kanbanStages)

	connectedNumbers := 0
	activeSessions := 0
	onlineUsers, err := a.store.CountActiveAuthSessions(ctx)
	if err != nil {
		return nil, err
	}
	waitingConversations := 0
	for _, session := range sessions {
		connectedNumbers++
		if session.Status == models.SessionStatusActive {
			activeSessions++
		}
		waitingConversations += session.Waiting
	}

	overview.Metrics.ConnectedNumbers = connectedNumbers
	overview.Metrics.ActiveSessions = activeSessions
	overview.Metrics.OnlineUsers = onlineUsers
	overview.Metrics.WaitingConversations = waitingConversations
	totalConversations := len(conversations)
	unreadVolume := sumConversationUnread(conversations)
	resolvedCount := countResolvedConversations(conversations, kanbanStageMap)
	overview.Dashboard.Leaderboard = buildDashboardLeaderboardRows(conversations, crmProfileMap, kanbanStageMap, users)
	overview.Dashboard.Snapshot = models.DashboardSnapshot{
		ActiveSessions:      activeSessions,
		OnlineUsers:         onlineUsers,
		RecentConversations: countRecentConversations(conversations, 24*time.Hour),
		TeamCount:           len(overview.Dashboard.Leaderboard),
	}
	activityAnalytics := buildDashboardActivityAnalytics(conversations)
	resolvedTickets := buildResolvedConversationRows(conversations, crmProfileMap, kanbanStageMap)
	resolvedRate := 0.0
	if totalConversations > 0 {
		resolvedRate = math.Round((float64(resolvedCount)/float64(totalConversations)*100)*10) / 10
	}
	overview.Analytics.HealthScore = calculateDashboardHealthScore(responseVelocity, totalConversations, unreadVolume, resolvedCount)
	overview.Analytics.ResolvedRate = resolvedRate
	overview.Analytics.TotalConversations = totalConversations
	overview.Analytics.UnreadVolume = unreadVolume
	overview.Analytics.WaitingVolume = waitingConversations
	overview.Analytics.ChannelTotals = activityAnalytics.ChannelTotals
	overview.Analytics.WeeklySeries = activityAnalytics.WeeklySeries
	overview.Analytics.HeatmapRows = activityAnalytics.HeatmapRows
	overview.Analytics.ResolvedTickets = resolvedTickets

	if len(sessions) > 0 {
		overview.Channels = []models.ChannelRecord{{
			ID:               sessions[0].ChannelID,
			Name:             sessions[0].ChannelName,
			Color:            channelColor(sessions[0].ChannelName),
			ConnectedNumbers: 1,
		}}
	} else {
		overview.Channels = []models.ChannelRecord{}
	}

	return overview, nil
}

type dashboardActivityAnalytics struct {
	ChannelTotals models.DashboardChannelTotals
	WeeklySeries  []models.DashboardWeeklyChannelSeriesPoint
	HeatmapRows   []models.DashboardHeatmapRow
}

type dashboardLeaderboardStat struct {
	ID          string
	Label       string
	AvatarURL   string
	Assigned    int
	Resolved    int
	Unread      int
	WaitMinutes int
}

type dashboardDailyBucket struct {
	Key       string
	Day       string
	Total     int
	WhatsApp  int
	Instagram int
	Facebook  int
}

func buildCRMProfileMap(items []models.ContactCRMProfileRecord) map[string]models.ContactCRMProfileRecord {
	result := make(map[string]models.ContactCRMProfileRecord, len(items))
	for _, item := range items {
		result[dashboardConversationKey(item.SessionID, item.ConversationID)] = item
	}
	return result
}

func buildKanbanStageMap(items []models.ContactKanbanStageRecord) map[string]models.ContactKanbanStageRecord {
	result := make(map[string]models.ContactKanbanStageRecord, len(items))
	for _, item := range items {
		result[dashboardConversationKey(item.SessionID, item.ConversationID)] = item
	}
	return result
}

func dashboardConversationKey(sessionID, conversationID string) string {
	return sessionID + ":" + conversationID
}

func countRecentConversations(conversations []models.ConversationRecord, window time.Duration) int {
	threshold := time.Now().Add(-window)
	count := 0
	for _, conversation := range conversations {
		timestamp, err := time.Parse(time.RFC3339, conversation.LastMessageAt)
		if err != nil {
			continue
		}
		if !timestamp.Before(threshold) {
			count++
		}
	}
	return count
}

func sumConversationUnread(conversations []models.ConversationRecord) int {
	total := 0
	for _, conversation := range conversations {
		total += conversation.Unread
	}
	return total
}

func countResolvedConversations(
	conversations []models.ConversationRecord,
	kanbanStages map[string]models.ContactKanbanStageRecord,
) int {
	total := 0
	for _, conversation := range conversations {
		if isResolvedConversation(conversation, kanbanStages) {
			total++
		}
	}
	return total
}

func buildDashboardLeaderboardRows(
	conversations []models.ConversationRecord,
	crmProfiles map[string]models.ContactCRMProfileRecord,
	kanbanStages map[string]models.ContactKanbanStageRecord,
	users []models.AuthUser,
) []models.DashboardLeaderboardRow {
	stats := make(map[string]*dashboardLeaderboardStat)

	for _, conversation := range conversations {
		profile := crmProfiles[dashboardConversationKey(conversation.SessionID, conversation.ID)]
		operatorName := resolveConversationOperatorName(conversation, profile)
		if operatorName == "" {
			continue
		}

		current, ok := stats[operatorName]
		if !ok {
			current = &dashboardLeaderboardStat{
				ID:    normalizeLeaderboardID(operatorName),
				Label: operatorName,
			}
			stats[operatorName] = current
		}

		current.Assigned++
		if conversation.Unread > 0 {
			current.Unread++
		}
		current.WaitMinutes += estimateWaitingMinutes(conversation.WaitingTime)
		if current.AvatarURL == "" {
			current.AvatarURL = conversation.AvatarURL
		}
		if isResolvedConversation(conversation, kanbanStages) {
			current.Resolved++
		}
	}

	if len(stats) == 0 {
		rows := make([]models.DashboardLeaderboardRow, 0, 3)
		for _, user := range users {
			if !user.IsActive {
				continue
			}
			rows = append(rows, models.DashboardLeaderboardRow{
				ID:          user.ID,
				Label:       user.Name,
				Score:       0,
				Volume:      0,
				VolumeLabel: "assigned",
				Rank:        len(rows) + 1,
			})
			if len(rows) == 3 {
				break
			}
		}
		return rows
	}

	rows := make([]models.DashboardLeaderboardRow, 0, len(stats))
	for _, item := range stats {
		assigned := max(item.Assigned, 1)
		resolvedRatio := float64(item.Resolved) / float64(assigned)
		unreadRatio := float64(item.Unread) / float64(assigned)
		averageWaitMinutes := float64(item.WaitMinutes) / float64(assigned)
		waitPenalty := math.Min(averageWaitMinutes/240, 1)
		score := int(math.Round(math.Max(0, math.Min(100, 45+resolvedRatio*35+(1-unreadRatio)*15+(1-waitPenalty)*5))))
		volume := item.Assigned
		volumeLabel := "assigned"
		if item.Resolved > 0 {
			volume = item.Resolved
			volumeLabel = "won"
		}

		rows = append(rows, models.DashboardLeaderboardRow{
			ID:          item.ID,
			Label:       item.Label,
			AvatarURL:   item.AvatarURL,
			Score:       score,
			Volume:      volume,
			VolumeLabel: volumeLabel,
		})
	}

	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Score != rows[j].Score {
			return rows[i].Score > rows[j].Score
		}
		if rows[i].Volume != rows[j].Volume {
			return rows[i].Volume > rows[j].Volume
		}
		return rows[i].Label < rows[j].Label
	})
	for index := range rows {
		rows[index].Rank = index + 1
	}

	return rows
}

func buildResolvedConversationRows(
	conversations []models.ConversationRecord,
	crmProfiles map[string]models.ContactCRMProfileRecord,
	kanbanStages map[string]models.ContactKanbanStageRecord,
) []models.DashboardResolvedConversation {
	rows := make([]models.DashboardResolvedConversation, 0)
	for _, conversation := range conversations {
		if !isResolvedConversation(conversation, kanbanStages) {
			continue
		}
		profile := crmProfiles[dashboardConversationKey(conversation.SessionID, conversation.ID)]
		rows = append(rows, models.DashboardResolvedConversation{
			ID:             buildAnalyticsConversationID(conversation.ID),
			Customer:       conversation.Contact,
			CustomerAvatar: conversation.AvatarURL,
			Channel:        conversationChannelKey(conversation),
			Agent:          fallbackText(resolveConversationOperatorName(conversation, profile), "Operador"),
			LastActivityAt: conversation.LastMessageAt,
			StatusLabel:    resolveConversationOutcomeLabel(conversation, kanbanStages),
		})
	}

	sort.Slice(rows, func(i, j int) bool {
		return rows[i].LastActivityAt > rows[j].LastActivityAt
	})
	if len(rows) > 5 {
		rows = rows[:5]
	}

	return rows
}

func calculateDashboardHealthScore(
	responseVelocity models.DashboardResponseVelocityAnalytics,
	totalConversations int,
	unreadVolume int,
	resolvedCount int,
) float64 {
	if totalConversations == 0 {
		return 0
	}

	targetSeconds := responseVelocity.TargetSeconds
	if targetSeconds <= 0 {
		targetSeconds = 120
	}
	resolvedRate := float64(resolvedCount) / float64(totalConversations) * 100
	responseComponent := math.Max(0, math.Min(100, 100-(float64(responseVelocity.AverageSeconds)/float64(targetSeconds))*55))
	backlogComponent := math.Max(0, math.Min(100, 100-(float64(unreadVolume)/float64(totalConversations))*100))
	composite := responseComponent*0.45 + backlogComponent*0.20 + resolvedRate*0.35

	return math.Round((composite/20)*10) / 10
}

func buildDashboardActivityAnalytics(conversations []models.ConversationRecord) dashboardActivityAnalytics {
	analytics := dashboardActivityAnalytics{}
	dailyBuckets := make([]dashboardDailyBucket, 0, 7)
	dailyBucketMap := make(map[string]*dashboardDailyBucket, 7)
	now := time.Now()
	for index := 0; index < 7; index++ {
		date := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -(6 - index))
		bucket := dashboardDailyBucket{
			Key: buildLocalDateKey(date),
			Day: strings.ToUpper(date.Format("Mon")),
		}
		dailyBuckets = append(dailyBuckets, bucket)
		dailyBucketMap[bucket.Key] = &dailyBuckets[len(dailyBuckets)-1]
	}

	heatmapDayLabels := []string{"MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"}
	heatmapCounts := make([][]int, len(heatmapDayLabels))
	for index := range heatmapCounts {
		heatmapCounts[index] = make([]int, 12)
	}

	for _, conversation := range conversations {
		channelKey := conversationChannelKey(conversation)
		switch channelKey {
		case "instagram":
			analytics.ChannelTotals.Instagram++
		case "facebook":
			analytics.ChannelTotals.Facebook++
		default:
			analytics.ChannelTotals.WhatsApp++
		}

		timestamp, err := time.Parse(time.RFC3339, conversation.LastMessageAt)
		if err != nil {
			continue
		}
		localTimestamp := timestamp.In(time.Local)
		if bucket := dailyBucketMap[buildLocalDateKey(localTimestamp)]; bucket != nil {
			bucket.Total++
			switch channelKey {
			case "instagram":
				bucket.Instagram++
			case "facebook":
				bucket.Facebook++
			default:
				bucket.WhatsApp++
			}
		}

		dayIndex := mondayFirstIndex(localTimestamp.Weekday())
		slotIndex := localTimestamp.Hour() / 2
		heatmapCounts[dayIndex][slotIndex]++
	}

	maxDailyTotal := 0
	for _, bucket := range dailyBuckets {
		if bucket.Total > maxDailyTotal {
			maxDailyTotal = bucket.Total
		}
	}
	maxHeatValue := 0
	for _, row := range heatmapCounts {
		for _, value := range row {
			if value > maxHeatValue {
				maxHeatValue = value
			}
		}
	}

	analytics.WeeklySeries = make([]models.DashboardWeeklyChannelSeriesPoint, 0, len(dailyBuckets))
	for _, bucket := range dailyBuckets {
		value := 0
		if maxDailyTotal > 0 {
			value = int(math.Round(float64(bucket.Total) / float64(maxDailyTotal) * 100))
		}
		analytics.WeeklySeries = append(analytics.WeeklySeries, models.DashboardWeeklyChannelSeriesPoint{
			Day:     bucket.Day,
			Channel: dominantBucketChannel(bucket),
			Value:   value,
		})
	}

	analytics.HeatmapRows = make([]models.DashboardHeatmapRow, 0, len(heatmapDayLabels))
	for dayIndex, day := range heatmapDayLabels {
		values := make([]int, 0, len(heatmapCounts[dayIndex]))
		for _, rawValue := range heatmapCounts[dayIndex] {
			value := 0
			if maxHeatValue > 0 {
				value = int(math.Round(float64(rawValue) / float64(maxHeatValue) * 100))
			}
			values = append(values, value)
		}
		analytics.HeatmapRows = append(analytics.HeatmapRows, models.DashboardHeatmapRow{
			Day:    day,
			Values: values,
		})
	}

	return analytics
}

func normalizeLeaderboardID(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "operator"
	}
	var builder strings.Builder
	lastDash := false
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteRune('-')
			lastDash = true
		}
	}
	result := strings.Trim(builder.String(), "-")
	if result == "" {
		return "operator"
	}
	return result
}

func resolveConversationOperatorName(
	conversation models.ConversationRecord,
	profile models.ContactCRMProfileRecord,
) string {
	for _, candidate := range []string{profile.Assignee, conversation.Owner} {
		candidate = normalizeOperatorLabel(candidate)
		if candidate != "" {
			return candidate
		}
	}
	return ""
}

func normalizeOperatorLabel(value string) string {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return ""
	}
	lowered := strings.ToLower(normalized)
	switch lowered {
	case "unknown", "unassigned", "sem responsavel", "n/a", "-", "livre":
		return ""
	default:
		return normalized
	}
}

func estimateWaitingMinutes(value string) int {
	normalized := strings.TrimSpace(strings.ToLower(value))
	if normalized == "" {
		return 0
	}
	if strings.Contains(normalized, "agora") || strings.Contains(normalized, "now") {
		return 0
	}
	if strings.Contains(normalized, "ontem") {
		return 24 * 60
	}

	match := digitsOnly(normalized)
	numericValue := 0
	if match != "" {
		numericValue, _ = strconv.Atoi(match)
	}
	if strings.Contains(normalized, "dia") {
		return numericValue * 24 * 60
	}
	if strings.Contains(normalized, "hora") || strings.Contains(normalized, "hr") || strings.Contains(normalized, "h") {
		return numericValue * 60
	}
	if strings.Contains(normalized, "min") || strings.HasSuffix(normalized, "m") {
		return numericValue
	}
	return numericValue
}

func resolveContactKanbanStage(
	conversation models.ConversationRecord,
	kanbanStages map[string]models.ContactKanbanStageRecord,
) string {
	if record, ok := kanbanStages[dashboardConversationKey(conversation.SessionID, conversation.ID)]; ok && isValidContactKanbanStage(record.Stage) {
		return record.Stage
	}

	normalizedStatus := strings.ToLower(conversation.Status)
	waiting := strings.ToLower(conversation.WaitingTime)
	if strings.Contains(normalizedStatus, "closed") || strings.Contains(normalizedStatus, "resolved") {
		return "won"
	}
	if conversation.Unread >= 3 {
		return "new"
	}
	if conversation.Unread > 0 || strings.Contains(waiting, "novo") {
		return "qualified"
	}
	if strings.Contains(normalizedStatus, "follow") || strings.Contains(waiting, "ontem") {
		return "followup"
	}
	return "active"
}

func isResolvedConversation(
	conversation models.ConversationRecord,
	kanbanStages map[string]models.ContactKanbanStageRecord,
) bool {
	stage := resolveContactKanbanStage(conversation, kanbanStages)
	normalizedStatus := strings.ToLower(conversation.Status)
	return stage == "won" || strings.Contains(normalizedStatus, "closed") || strings.Contains(normalizedStatus, "resolved")
}

func resolveConversationOutcomeLabel(
	conversation models.ConversationRecord,
	kanbanStages map[string]models.ContactKanbanStageRecord,
) string {
	if resolveContactKanbanStage(conversation, kanbanStages) == "won" {
		return "Won"
	}
	return "Resolved"
}

func buildAnalyticsConversationID(value string) string {
	var builder strings.Builder
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
		}
	}
	cleaned := builder.String()
	if len(cleaned) > 6 {
		cleaned = cleaned[len(cleaned)-6:]
	}
	if cleaned == "" {
		cleaned = "CONV"
	}
	return "#" + strings.ToUpper(cleaned)
}

func conversationChannelKey(conversation models.ConversationRecord) string {
	value := strings.ToLower(conversation.ChannelName + " " + conversation.Status + " " + conversation.Contact)
	if strings.Contains(value, "insta") {
		return "instagram"
	}
	if strings.Contains(value, "face") || strings.Contains(value, "messenger") {
		return "facebook"
	}
	return "whatsapp"
}

func dominantBucketChannel(bucket dashboardDailyBucket) string {
	if bucket.Instagram > bucket.WhatsApp && bucket.Instagram >= bucket.Facebook {
		return "instagram"
	}
	if bucket.Facebook > bucket.WhatsApp && bucket.Facebook > bucket.Instagram {
		return "facebook"
	}
	return "whatsapp"
}

func buildLocalDateKey(date time.Time) string {
	return fmt.Sprintf("%04d-%02d-%02d", date.Year(), date.Month(), date.Day())
}

func mondayFirstIndex(day time.Weekday) int {
	if day == time.Sunday {
		return 6
	}
	return int(day) - 1
}

func (a *API) buildResponseVelocityAnalytics(ctx context.Context) (models.DashboardResponseVelocityAnalytics, error) {
	analytics := models.DashboardResponseVelocityAnalytics{
		AverageSeconds: 102,
		DeltaSeconds:   0,
		TargetSeconds:  120,
		PeakLabel:      "Sem dados",
		Points: []models.DashboardResponseVelocityPoint{
			{Label: "08:00 AM", AverageSeconds: 102},
			{Label: "10:00 AM", AverageSeconds: 102},
			{Label: "12:00 PM", AverageSeconds: 102},
			{Label: "02:00 PM", AverageSeconds: 102},
			{Label: "04:00 PM", AverageSeconds: 102},
			{Label: "06:00 PM", AverageSeconds: 102},
		},
	}

	chats, err := a.manager.ListChats(ctx)
	if err != nil {
		return analytics, err
	}

	now := time.Now().UTC()
	currentCutoff := now.Add(-7 * 24 * time.Hour)
	previousCutoff := now.Add(-14 * 24 * time.Hour)
	currentSamples := make([]int, 0)
	previousSamples := make([]int, 0)
	bucketLabels := []string{"08:00 AM", "10:00 AM", "12:00 PM", "02:00 PM", "04:00 PM", "06:00 PM"}
	bucketValues := make(map[string][]int, len(bucketLabels))
	fastestAt := time.Time{}
	fastestSeconds := math.MaxInt

	for _, chat := range chats {
		canonicalJID, err := a.manager.CanonicalConversationJID(ctx, chat.JID)
		if err != nil {
			canonicalJID = chat.JID
		}
		if !isVisibleConversationJID(canonicalJID) {
			continue
		}

		messages, err := a.manager.ListMessages(ctx, chat.JID)
		if err != nil {
			return analytics, err
		}

		for _, sample := range collectResponseSamples(messages) {
			if sample.When.Before(previousCutoff) {
				continue
			}

			if !sample.When.Before(currentCutoff) {
				currentSamples = append(currentSamples, sample.Seconds)
				bucketLabel := responseBucketLabel(sample.When)
				bucketValues[bucketLabel] = append(bucketValues[bucketLabel], sample.Seconds)
				if sample.Seconds < fastestSeconds {
					fastestSeconds = sample.Seconds
					fastestAt = sample.When
				}
				continue
			}

			previousSamples = append(previousSamples, sample.Seconds)
		}
	}

	if len(currentSamples) > 0 {
		analytics.AverageSeconds = averageInt(currentSamples)
	}
	if len(previousSamples) > 0 {
		analytics.DeltaSeconds = averageInt(previousSamples) - analytics.AverageSeconds
	}
	if !fastestAt.IsZero() {
		analytics.PeakLabel = fastestAt.Local().Format("3:04 PM")
	}

	points := make([]models.DashboardResponseVelocityPoint, 0, len(bucketLabels))
	for _, label := range bucketLabels {
		averageSeconds := analytics.AverageSeconds
		if samples := bucketValues[label]; len(samples) > 0 {
			averageSeconds = averageInt(samples)
		}
		points = append(points, models.DashboardResponseVelocityPoint{
			Label:          label,
			AverageSeconds: averageSeconds,
		})
	}
	analytics.Points = points

	return analytics, nil
}

type responseSample struct {
	When    time.Time
	Seconds int
}

func collectResponseSamples(messages []models.Message) []responseSample {
	samples := make([]responseSample, 0)
	for index, message := range messages {
		if message.Kind == "reaction" {
			continue
		}
		if message.FromMe {
			continue
		}

		incomingAt, err := time.Parse(time.RFC3339, message.Timestamp)
		if err != nil {
			continue
		}

		for nextIndex := index + 1; nextIndex < len(messages); nextIndex++ {
			next := messages[nextIndex]
			if next.Kind == "reaction" {
				continue
			}
			if !next.FromMe {
				continue
			}

			outgoingAt, err := time.Parse(time.RFC3339, next.Timestamp)
			if err != nil {
				continue
			}

			if !isBusinessHoursResponseWindow(incomingAt, outgoingAt) {
				break
			}

			delta := outgoingAt.Sub(incomingAt)
			if delta <= 0 {
				break
			}
			if delta > 2*time.Hour {
				break
			}

			samples = append(samples, responseSample{
				When:    outgoingAt.UTC(),
				Seconds: int(delta.Seconds()),
			})
			break
		}
	}
	return samples
}

func latestPreviewMessage(messages []models.Message) models.Message {
	for index := len(messages) - 1; index >= 0; index-- {
		if messages[index].Kind == "reaction" {
			continue
		}
		return messages[index]
	}

	return models.Message{}
}

func isMeaningfulConversationName(name, jid string) bool {
	name = strings.TrimSpace(name)
	if name == "" || name == strings.TrimSpace(jid) {
		return false
	}

	parsed, err := types.ParseJID(strings.TrimSpace(jid))
	if err == nil && parsed.User != "" && name == parsed.User {
		return false
	}

	return true
}

func isBusinessHoursResponseWindow(incomingAt, outgoingAt time.Time) bool {
	incomingLocal := incomingAt.Local()
	outgoingLocal := outgoingAt.Local()

	if incomingLocal.Weekday() == time.Saturday || incomingLocal.Weekday() == time.Sunday {
		return false
	}
	if outgoingLocal.Weekday() == time.Saturday || outgoingLocal.Weekday() == time.Sunday {
		return false
	}
	if incomingLocal.YearDay() != outgoingLocal.YearDay() || incomingLocal.Year() != outgoingLocal.Year() {
		return false
	}

	incomingMinutes := incomingLocal.Hour()*60 + incomingLocal.Minute()
	outgoingMinutes := outgoingLocal.Hour()*60 + outgoingLocal.Minute()

	const businessStartMinutes = 8 * 60
	const businessEndMinutes = 18 * 60

	if incomingMinutes < businessStartMinutes || incomingMinutes >= businessEndMinutes {
		return false
	}
	if outgoingMinutes < businessStartMinutes || outgoingMinutes >= businessEndMinutes {
		return false
	}

	return true
}

func responseBucketLabel(value time.Time) string {
	hour := value.Local().Hour()
	switch {
	case hour < 10:
		return "08:00 AM"
	case hour < 12:
		return "10:00 AM"
	case hour < 14:
		return "12:00 PM"
	case hour < 16:
		return "02:00 PM"
	case hour < 18:
		return "04:00 PM"
	default:
		return "06:00 PM"
	}
}

func averageInt(values []int) int {
	if len(values) == 0 {
		return 0
	}
	total := 0
	for _, value := range values {
		total += value
	}
	return int(math.Round(float64(total) / float64(len(values))))
}

func (a *API) buildSessionRecords(ctx context.Context) ([]models.SessionRecord, error) {
	session, err := a.manager.GetSession(ctx)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return []models.SessionRecord{}, nil
	}

	compat, err := a.sessionToCompat(ctx, session)
	if err != nil {
		return nil, err
	}
	return []models.SessionRecord{compat}, nil
}

func (a *API) sessionToCompat(ctx context.Context, session *models.Session) (models.SessionRecord, error) {
	chats, err := a.manager.ListChats(ctx)
	if err != nil {
		return models.SessionRecord{}, err
	}

	waiting := 0
	unread := 0
	seen := make(map[string]struct{}, len(chats))
	for _, chat := range chats {
		canonicalJID, err := a.manager.CanonicalConversationJID(ctx, chat.JID)
		if err != nil {
			canonicalJID = chat.JID
		}
		if _, ok := seen[canonicalJID]; ok {
			continue
		}
		seen[canonicalJID] = struct{}{}
		if chat.UnreadCount > 0 {
			waiting++
		}
		unread += chat.UnreadCount
	}

	attendants := 0
	if session.Status == models.SessionStatusActive {
		count, err := a.store.CountActiveAuthSessions(ctx)
		if err != nil {
			return models.SessionRecord{}, err
		}
		attendants = count
	}

	return models.SessionRecord{
		ID:            session.ID,
		Name:          session.Name,
		PhoneNumber:   session.PhoneNumber,
		ChannelID:     session.ChannelID,
		ChannelName:   session.ChannelName,
		Status:        session.Status,
		Attendants:    attendants,
		Waiting:       waiting,
		Unread:        unread,
		LastHeartbeat: session.UpdatedAt,
		IsDemo:        false,
		QRCode:        session.QRCode,
		QRCodeDataURL: session.QRCodeDataURL,
		LastError:     session.LastError,
	}, nil
}

func (a *API) buildConversationRecords(ctx context.Context) ([]models.ConversationRecord, error) {
	chats, err := a.manager.ListChats(ctx)
	if err != nil {
		return nil, err
	}
	session, err := a.manager.GetSession(ctx)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return []models.ConversationRecord{}, nil
	}

	contacts, err := a.manager.ListContacts(ctx)
	if err != nil {
		return nil, err
	}
	contactMap := make(map[string]models.Contact, len(contacts))
	for _, contact := range contacts {
		contactMap[contact.JID] = contact
	}

	conversationsByID := make(map[string]models.ConversationRecord, len(chats))
	latestMessageByConversation := make(map[string]models.Message, len(chats))
	for _, chat := range chats {
		canonicalJID, err := a.manager.CanonicalConversationJID(ctx, chat.JID)
		if err != nil {
			canonicalJID = chat.JID
		}
		if !isVisibleConversationJID(canonicalJID) {
			continue
		}

		contact := contactMap[canonicalJID]
		if contact.JID == "" {
			contact = contactMap[chat.JID]
		}
		name := chat.Name
		if !chat.IsGroup && contact.DisplayName != "" {
			name = contact.DisplayName
		} else if chat.IsGroup && !isMeaningfulConversationName(name, chat.JID) && contact.DisplayName != "" {
			name = contact.DisplayName
		}
		if name == "" {
			name = chat.JID
		}

		latestMessage, ok := latestMessageByConversation[canonicalJID]
		if !ok {
			messages, err := a.manager.ListMessages(ctx, chat.JID)
			if err == nil && len(messages) > 0 {
				latestMessage = latestPreviewMessage(messages)
				latestMessageByConversation[canonicalJID] = latestMessage
			}
		}

		preview := fallbackText(chat.LastMessageText, "Sem mensagem recente.")
		lastMessageAt := fallbackText(chat.LastMessageAt, session.UpdatedAt)
		if latestMessage.ID != "" {
			preview = fallbackText(latestMessage.Text, preview)
			lastMessageAt = fallbackText(latestMessage.Timestamp, lastMessageAt)
		}

		candidate := models.ConversationRecord{
			ID:            canonicalJID,
			SessionID:     session.ID,
			SessionName:   session.Name,
			Contact:       name,
			AvatarURL:     avatarProxyPath(canonicalJID, contact.PhotoID),
			ParticipantID: canonicalJID,
			Owner:         "Sem responsavel",
			Status:        "Atendimento geral",
			ChannelName:   session.ChannelName,
			WaitingTime:   waitingLabel(chat.LastMessageAt),
			Unread:        chat.UnreadCount,
			Preview:       preview,
			LastMessageAt: lastMessageAt,
			Messages:      []models.MessageRecord{},
		}

		existing, ok := conversationsByID[canonicalJID]
		if !ok {
			conversationsByID[canonicalJID] = candidate
			continue
		}

		merged := mergeConversationRecords(existing, candidate)
		conversationsByID[canonicalJID] = merged
	}

	conversations := make([]models.ConversationRecord, 0, len(conversationsByID))
	for _, conversation := range conversationsByID {
		conversations = append(conversations, conversation)
	}
	sort.Slice(conversations, func(i, j int) bool {
		if conversations[i].LastMessageAt == conversations[j].LastMessageAt {
			return conversations[i].Contact < conversations[j].Contact
		}
		return conversations[i].LastMessageAt > conversations[j].LastMessageAt
	})

	return conversations, nil
}

func (a *API) toMessageRecords(ctx context.Context, messages []models.Message, conversationID string) ([]models.MessageRecord, error) {
	reactionsByMessageID := buildMessageReactions(messages)
	items := make([]models.MessageRecord, 0, len(messages))
	for _, message := range messages {
		if message.Kind == "reaction" {
			continue
		}

		record, err := a.buildMessageRecord(ctx, message, conversationID)
		if err != nil {
			return nil, err
		}
		record.ReplyTo = buildMessageReplyRecord(message)
		record.Reactions = reactionsByMessageID[message.ID]
		items = append(items, record)
	}
	return items, nil
}

func (a *API) buildMessageRecord(ctx context.Context, message models.Message, conversationID string) (models.MessageRecord, error) {
	direction := "incoming"
	if message.FromMe {
		direction = "outgoing"
	}
	mediaURL := ""
	if message.Kind != "" && message.Kind != "text" && message.Kind != "media" {
		mediaURL = "/messages/" + url.PathEscape(message.ID) + "/media"
	}
	body, err := a.resolveMessageBody(ctx, message)
	if err != nil {
		return models.MessageRecord{}, err
	}
	return models.MessageRecord{
		ID:             message.ID,
		ConversationID: conversationID,
		Direction:      direction,
		Kind:           message.Kind,
		Body:           body,
		MediaURL:       mediaURL,
		MimeType:       message.MimeType,
		FileName:       message.FileName,
		Timestamp:      message.Timestamp,
		Author:         fallbackText(message.Author, "Contato"),
	}, nil
}

func (a *API) resolveMessageBody(ctx context.Context, message models.Message) (string, error) {
	body := message.Text
	parsed := parseStoredMessageProto(message.RawJSON)
	if parsed == nil {
		return body, nil
	}

	contextInfo := messageContextInfo(parsed)
	if contextInfo == nil || len(contextInfo.GetMentionedJID()) == 0 {
		return body, nil
	}

	resolvedBody := body
	for _, mentionedJID := range contextInfo.GetMentionedJID() {
		replacement, handles, err := a.resolveMentionReplacement(ctx, mentionedJID)
		if err != nil {
			return "", err
		}
		if replacement == "" || len(handles) == 0 {
			continue
		}
		for _, handle := range handles {
			resolvedBody = strings.ReplaceAll(resolvedBody, handle, replacement)
		}
	}

	return resolvedBody, nil
}

func (a *API) resolveMentionReplacement(ctx context.Context, jidText string) (string, []string, error) {
	parsed, err := types.ParseJID(strings.TrimSpace(jidText))
	if err != nil {
		return "", nil, nil
	}
	parsed = parsed.ToNonAD()

	candidates := []string{parsed.String()}
	if canonical, err := a.manager.CanonicalConversationJID(ctx, parsed.String()); err == nil && canonical != "" && canonical != parsed.String() {
		candidates = append(candidates, canonical)
	}
	if resolved, err := a.manager.ResolveConversationJID(ctx, parsed.String()); err == nil && resolved != "" && resolved != parsed.String() {
		candidates = append(candidates, resolved)
	}

	name := ""
	handlesSet := make(map[string]struct{})
	handles := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}

		candidateJID, err := types.ParseJID(candidate)
		if err == nil && candidateJID.User != "" {
			handle := "@" + candidateJID.User
			if _, exists := handlesSet[handle]; !exists {
				handlesSet[handle] = struct{}{}
				handles = append(handles, handle)
			}
		}

		contact, err := a.store.GetContact(ctx, candidate)
		if err != nil {
			return "", nil, err
		}
		if contact != nil && isUsableMentionDisplayName(contact.DisplayName, candidate) {
			name = contact.DisplayName
			break
		}
	}

	if name == "" {
		name = parsed.User
	}
	if name == "" {
		return "", handles, nil
	}

	return "@" + name, handles, nil
}

func isUsableMentionDisplayName(name, jid string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	if name == jid {
		return false
	}
	parsed, err := types.ParseJID(strings.TrimSpace(jid))
	if err == nil && parsed.User != "" && name == parsed.User {
		return false
	}
	return true
}

func buildMessageReplyRecord(message models.Message) *models.MessageReplyRecord {
	parsed := parseStoredMessageProto(message.RawJSON)
	if parsed == nil {
		return nil
	}

	contextInfo := messageContextInfo(parsed)
	if contextInfo == nil || strings.TrimSpace(contextInfo.GetStanzaID()) == "" {
		return nil
	}

	body, kind, ok := extractQuotedMessagePreview(contextInfo.GetQuotedMessage())
	if !ok {
		body = "[mensagem]"
	}

	reply := &models.MessageReplyRecord{
		MessageID: strings.TrimSpace(contextInfo.GetStanzaID()),
		Body:      body,
		Kind:      kind,
	}

	if participant := strings.TrimSpace(contextInfo.GetParticipant()); participant != "" {
		reply.Author = participant
	}

	return reply
}

func buildMessageReactions(messages []models.Message) map[string][]models.MessageReaction {
	actorReactionsByTarget := make(map[string]map[string]string)

	for _, message := range messages {
		if message.Kind != "reaction" {
			continue
		}

		targetMessageID, ok := reactionTargetMessageID(message)
		if !ok {
			continue
		}

		reactionsByActor, exists := actorReactionsByTarget[targetMessageID]
		if !exists {
			reactionsByActor = make(map[string]string)
			actorReactionsByTarget[targetMessageID] = reactionsByActor
		}

		actorKey := reactionActorKey(message)
		emoji := strings.TrimSpace(message.Text)
		if emoji == "" {
			delete(reactionsByActor, actorKey)
			continue
		}

		reactionsByActor[actorKey] = emoji
	}

	reactionsByTarget := make(map[string][]models.MessageReaction, len(actorReactionsByTarget))
	for targetMessageID, reactionsByActor := range actorReactionsByTarget {
		counts := make(map[string]int)
		fromMe := make(map[string]bool)

		for actorKey, emoji := range reactionsByActor {
			counts[emoji]++
			if strings.HasPrefix(actorKey, "me:") {
				fromMe[emoji] = true
			}
		}

		reactions := make([]models.MessageReaction, 0, len(counts))
		for emoji, count := range counts {
			reactions = append(reactions, models.MessageReaction{
				Emoji:  emoji,
				Count:  count,
				FromMe: fromMe[emoji],
			})
		}

		sort.Slice(reactions, func(i, j int) bool {
			if reactions[i].FromMe != reactions[j].FromMe {
				return reactions[i].FromMe
			}
			if reactions[i].Count != reactions[j].Count {
				return reactions[i].Count > reactions[j].Count
			}
			return reactions[i].Emoji < reactions[j].Emoji
		})

		reactionsByTarget[targetMessageID] = reactions
	}

	return reactionsByTarget
}

func reactionTargetMessageID(message models.Message) (string, bool) {
	parsed := parseStoredMessageProto(message.RawJSON)
	if parsed == nil || parsed.GetReactionMessage() == nil || parsed.GetReactionMessage().GetKey() == nil {
		return "", false
	}

	targetMessageID := strings.TrimSpace(parsed.GetReactionMessage().GetKey().GetID())
	if targetMessageID == "" {
		return "", false
	}

	return targetMessageID, true
}

func reactionActorKey(message models.Message) string {
	if message.FromMe {
		return "me:" + fallbackText(message.SenderJID, fallbackText(message.Author, message.ID))
	}
	if sender := strings.TrimSpace(message.SenderJID); sender != "" {
		return "sender:" + sender
	}
	return "author:" + fallbackText(message.Author, message.ID)
}

func parseStoredMessageProto(raw string) *waE2E.Message {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}

	var message waE2E.Message
	if err := waProto.Unmarshal([]byte(raw), &message); err != nil {
		return nil
	}

	return unwrapStoredMessageProto(&message)
}

func unwrapStoredMessageProto(message *waE2E.Message) *waE2E.Message {
	if message == nil {
		return nil
	}

	for {
		switch {
		case message.GetDeviceSentMessage().GetMessage() != nil:
			message = message.GetDeviceSentMessage().GetMessage()
		case message.GetEphemeralMessage().GetMessage() != nil:
			message = message.GetEphemeralMessage().GetMessage()
		case message.GetViewOnceMessage().GetMessage() != nil:
			message = message.GetViewOnceMessage().GetMessage()
		case message.GetViewOnceMessageV2().GetMessage() != nil:
			message = message.GetViewOnceMessageV2().GetMessage()
		case message.GetViewOnceMessageV2Extension().GetMessage() != nil:
			message = message.GetViewOnceMessageV2Extension().GetMessage()
		case message.GetEditedMessage().GetMessage() != nil:
			message = message.GetEditedMessage().GetMessage()
		default:
			return message
		}
	}
}

func messageContextInfo(message *waE2E.Message) *waE2E.ContextInfo {
	message = unwrapStoredMessageProto(message)
	if message == nil {
		return nil
	}

	switch {
	case message.GetExtendedTextMessage() != nil:
		return message.GetExtendedTextMessage().GetContextInfo()
	case message.GetImageMessage() != nil:
		return message.GetImageMessage().GetContextInfo()
	case message.GetVideoMessage() != nil:
		return message.GetVideoMessage().GetContextInfo()
	case message.GetDocumentMessage() != nil:
		return message.GetDocumentMessage().GetContextInfo()
	case message.GetAudioMessage() != nil:
		return message.GetAudioMessage().GetContextInfo()
	case message.GetStickerMessage() != nil:
		return message.GetStickerMessage().GetContextInfo()
	default:
		return nil
	}
}

func extractQuotedMessagePreview(message *waE2E.Message) (string, string, bool) {
	message = unwrapStoredMessageProto(message)
	if message == nil {
		return "", "", false
	}

	switch {
	case strings.TrimSpace(message.GetConversation()) != "":
		return strings.TrimSpace(message.GetConversation()), "text", true
	case strings.TrimSpace(message.GetExtendedTextMessage().GetText()) != "":
		return strings.TrimSpace(message.GetExtendedTextMessage().GetText()), "text", true
	case message.GetImageMessage() != nil:
		caption := strings.TrimSpace(message.GetImageMessage().GetCaption())
		if caption == "" {
			caption = "[imagem]"
		}
		return caption, "image", true
	case message.GetVideoMessage() != nil:
		caption := strings.TrimSpace(message.GetVideoMessage().GetCaption())
		if caption == "" {
			caption = "[video]"
		}
		return caption, "video", true
	case message.GetDocumentMessage() != nil:
		caption := strings.TrimSpace(message.GetDocumentMessage().GetCaption())
		if caption == "" {
			caption = strings.TrimSpace(message.GetDocumentMessage().GetFileName())
		}
		if caption == "" {
			caption = "[documento]"
		}
		return caption, "document", true
	case message.GetAudioMessage() != nil:
		if message.GetAudioMessage().GetPTT() {
			return "[voice note]", "audio", true
		}
		return "[audio]", "audio", true
	case message.GetStickerMessage() != nil:
		return "[figurinha]", "sticker", true
	default:
		return "", "", false
	}
}

func toCompatStreamEvent(payload []byte) (map[string]any, bool) {
	var event models.RealtimeEvent
	if err := json.Unmarshal(payload, &event); err != nil {
		return nil, false
	}

	switch event.Kind {
	case "connection":
		return map[string]any{
			"sessionId": event.SessionID,
			"type":      "session.updated",
			"emittedAt": event.OccurredAt,
		}, true
	case "chat.new":
		return map[string]any{
			"sessionId":      event.SessionID,
			"conversationId": event.ChatJID,
			"type":           "conversation.synced",
			"emittedAt":      event.OccurredAt,
		}, true
	case "message.new":
		return map[string]any{
			"sessionId":      event.SessionID,
			"conversationId": event.ChatJID,
			"type":           "message.created",
			"direction":      event.Direction,
			"emittedAt":      event.OccurredAt,
		}, true
	default:
		return nil, false
	}
}

func channelColor(value string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	palette := []string{"#7fafff", "#5dfd8a", "#ffb84d", "#ff7d7d", "#66d9ef", "#f6bd60"}
	return palette[int(h.Sum32())%len(palette)]
}

func waitingLabel(timestamp string) string {
	if timestamp == "" {
		return "agora"
	}
	parsed, err := time.Parse(time.RFC3339, timestamp)
	if err != nil {
		return "agora"
	}
	delta := time.Since(parsed)
	switch {
	case delta < time.Minute:
		return "agora"
	case delta < time.Hour:
		return fmt.Sprintf("%dm", int(delta.Minutes()))
	default:
		return fmt.Sprintf("%dh", int(delta.Hours()))
	}
}

func shouldRedirectPhoto(r *http.Request) bool {
	value := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("redirect")))
	return value == "1" || value == "true" || value == "yes"
}

func avatarProxyPath(jid, photoID string) string {
	if strings.TrimSpace(jid) == "" {
		return ""
	}
	path := "/contacts/" + url.PathEscape(jid) + "/photo?redirect=1"
	if strings.TrimSpace(photoID) != "" {
		path += "&v=" + url.QueryEscape(photoID)
	}
	return path
}

func mergeConversationRecords(current, incoming models.ConversationRecord) models.ConversationRecord {
	keep := current
	replace := incoming
	if incoming.LastMessageAt < current.LastMessageAt {
		keep = incoming
		replace = current
	}

	keep.Unread = max(current.Unread, incoming.Unread)
	if keep.AvatarURL == "" {
		keep.AvatarURL = replace.AvatarURL
	}
	if strings.TrimSpace(keep.Preview) == "" {
		keep.Preview = replace.Preview
	}
	if strings.TrimSpace(keep.Contact) == "" {
		keep.Contact = replace.Contact
	}
	return keep
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func fallbackText(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func isValidContactKanbanStage(value string) bool {
	switch value {
	case "new", "qualified", "active", "followup", "won":
		return true
	default:
		return false
	}
}

func isValidConversationFilter(value string) bool {
	switch value {
	case "all", "direct", "groups", "unread":
		return true
	default:
		return false
	}
}

func isValidContactsAudienceFilter(value string) bool {
	switch value {
	case "all", "verified":
		return true
	default:
		return false
	}
}

func isValidContactsChannelFilter(value string) bool {
	switch value {
	case "all", "whatsapp", "instagram", "facebook":
		return true
	default:
		return false
	}
}

func isValidContactPriority(value string) bool {
	switch value {
	case "", "low", "medium", "high", "urgent":
		return true
	default:
		return false
	}
}

func normalizeTags(tags []string) []string {
	items := make([]string, 0, len(tags))
	seen := make(map[string]struct{}, len(tags))
	for _, tag := range tags {
		normalized := strings.TrimSpace(tag)
		if normalized == "" {
			continue
		}
		key := strings.ToLower(normalized)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		items = append(items, normalized)
	}
	return items
}

func normalizeManualContactPhone(value string) (string, string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", "", errors.New("telefone obrigatorio")
	}

	if strings.Contains(trimmed, "@") {
		jid := trimmed
		phone := strings.TrimSuffix(strings.TrimSuffix(jid, "@s.whatsapp.net"), "@c.us")
		phone = digitsOnly(phone)
		if phone == "" {
			phone = jid
		}
		return jid, phone, nil
	}

	phone := digitsOnly(trimmed)
	if len(phone) < 8 {
		return "", "", errors.New("telefone invalido")
	}

	return phone + "@s.whatsapp.net", phone, nil
}

func digitsOnly(value string) string {
	var builder strings.Builder
	for _, char := range value {
		if char >= '0' && char <= '9' {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func firstToken(value string) string {
	parts := strings.Fields(strings.TrimSpace(value))
	if len(parts) == 0 {
		return ""
	}
	return parts[0]
}

func isVisibleConversationJID(jid string) bool {
	jid = strings.TrimSpace(jid)
	if jid == "" {
		return false
	}
	if jid == "status@broadcast" || strings.Contains(jid, "@newsletter") {
		return false
	}
	if jid == "0@s.whatsapp.net" {
		return false
	}
	return true
}

func decodeJSON(r *http.Request, target any) error {
	if r.Body == nil {
		return errEmptyBody
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		if errors.Is(err, context.Canceled) {
			return err
		}
		if strings.Contains(err.Error(), "EOF") {
			return errEmptyBody
		}
		return err
	}
	return nil
}

func parseMediaUpload(r *http.Request, fallbackJID string) (models.SendMediaRequest, error) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		return models.SendMediaRequest{}, fmt.Errorf("parse multipart form: %w", err)
	}

	jid := strings.TrimSpace(r.FormValue("jid"))
	if jid == "" {
		jid = strings.TrimSpace(fallbackJID)
	}
	if jid == "" {
		return models.SendMediaRequest{}, errors.New("jid is required")
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		return models.SendMediaRequest{}, errors.New("file is required")
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return models.SendMediaRequest{}, fmt.Errorf("read upload: %w", err)
	}

	mimeType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if mimeType == "" && len(data) > 0 {
		mimeType = http.DetectContentType(data)
	}

	sticker := strings.EqualFold(strings.TrimSpace(r.FormValue("sticker")), "true") || strings.TrimSpace(r.FormValue("kind")) == "sticker"

	return models.SendMediaRequest{
		JID:              jid,
		Caption:          strings.TrimSpace(r.FormValue("caption")),
		FileName:         header.Filename,
		MimeType:         mimeType,
		Data:             data,
		Sticker:          sticker,
		ReplyToMessageID: strings.TrimSpace(r.FormValue("replyToMessageId")),
	}, nil
}

func respondJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func respondError(w http.ResponseWriter, status int, err error) {
	respondJSON(w, status, map[string]any{"message": err.Error()})
}

func pathJID(value string) (string, error) {
	decoded, err := url.PathUnescape(value)
	if err != nil {
		return "", fmt.Errorf("invalid jid path: %w", err)
	}
	decoded = strings.TrimSpace(decoded)
	if decoded == "" {
		return "", errors.New("jid is required")
	}
	return decoded, nil
}

func (a *API) isDefaultSession(id string) bool {
	return id == models.DefaultSessionID || id == ""
}

var errEmptyBody = errors.New("request body is required")
