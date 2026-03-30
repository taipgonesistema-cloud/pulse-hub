package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

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

	r.Post("/auth/sign-in", api.handleSignIn)
	r.Get("/dashboard/overview", api.handleDashboardOverview)
	r.Route("/whatsapp", func(r chi.Router) {
		r.Get("/contacts/boards", api.handleListContactKanbanBoards)
		r.Post("/contacts/boards", api.handleCreateContactKanbanBoard)
		r.Delete("/contacts/boards/{id}", api.handleDeleteContactKanbanBoard)
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
		r.Post("/sessions/{id}/conversations/{jid}/read", api.handleConversationRead)
		r.Get("/sessions/{id}/stream", api.handleSessionStream)
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
	qr, err := a.manager.GetQR(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, qr)
}

func (a *API) handleSessionStatus(w http.ResponseWriter, r *http.Request) {
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
	respondJSON(w, http.StatusCreated, toMessageRecord(*message, message.ChatJID))
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

	if strings.TrimSpace(request.Email) != a.auth.Email || request.Password != a.auth.Password {
		respondJSON(w, http.StatusUnauthorized, map[string]any{"message": "Credenciais invalidas."})
		return
	}

	now := models.NowString()
	response := models.SignInResponse{
		User: models.AuthUser{
			ID:          "local-admin",
			Email:       a.auth.Email,
			Name:        a.auth.Name,
			Role:        a.auth.Role,
			IsActive:    true,
			LastLoginAt: now,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		Token: "wa-core-local-token",
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
	sessions, err := a.buildSessionRecords(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, sessions)
}

func (a *API) handleCreateSession(w http.ResponseWriter, r *http.Request) {
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
	respondJSON(w, http.StatusOK, toMessageRecords(messages, jid))
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
		Body   string `json:"body"`
		Author string `json:"author"`
	}
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	message, err := a.manager.SendText(r.Context(), models.SendTextRequest{JID: jid, Text: request.Body})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	respondJSON(w, http.StatusOK, toMessageRecord(*message, jid))
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

	respondJSON(w, http.StatusOK, toMessageRecord(*message, jid))
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

	overview := &models.DashboardOverview{
		Product:       "Pulse Hub",
		Phase:         "whatsmeow-core",
		Sessions:      sessions,
		Conversations: conversations,
	}

	connectedNumbers := 0
	activeSessions := 0
	onlineUsers := 0
	waitingConversations := 0
	for _, session := range sessions {
		connectedNumbers++
		if session.Status == models.SessionStatusActive {
			activeSessions++
		}
		onlineUsers += session.Attendants
		waitingConversations += session.Waiting
	}

	overview.Metrics.ConnectedNumbers = connectedNumbers
	overview.Metrics.ActiveSessions = activeSessions
	overview.Metrics.OnlineUsers = onlineUsers
	overview.Metrics.WaitingConversations = waitingConversations

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
		attendants = 1
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
		if contact.DisplayName != "" {
			name = contact.DisplayName
		}
		if name == "" {
			name = chat.JID
		}

		candidate := models.ConversationRecord{
			ID:            canonicalJID,
			SessionID:     session.ID,
			SessionName:   session.Name,
			Contact:       name,
			AvatarURL:     avatarProxyPath(canonicalJID, contact.PhotoID),
			ParticipantID: canonicalJID,
			Owner:         "Livre",
			Status:        "Fila geral",
			ChannelName:   session.ChannelName,
			WaitingTime:   waitingLabel(chat.LastMessageAt),
			Unread:        chat.UnreadCount,
			Preview:       fallbackText(chat.LastMessageText, "Conversa sincronizada."),
			LastMessageAt: fallbackText(chat.LastMessageAt, session.UpdatedAt),
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

func toMessageRecords(messages []models.Message, conversationID string) []models.MessageRecord {
	items := make([]models.MessageRecord, 0, len(messages))
	for _, message := range messages {
		items = append(items, toMessageRecord(message, conversationID))
	}
	return items
}

func toMessageRecord(message models.Message, conversationID string) models.MessageRecord {
	direction := "incoming"
	if message.FromMe {
		direction = "outgoing"
	}
	mediaURL := ""
	if message.Kind != "" && message.Kind != "text" && message.Kind != "media" {
		mediaURL = "/messages/" + url.PathEscape(message.ID) + "/media"
	}
	return models.MessageRecord{
		ID:             message.ID,
		ConversationID: conversationID,
		Direction:      direction,
		Kind:           message.Kind,
		Body:           message.Text,
		MediaURL:       mediaURL,
		MimeType:       message.MimeType,
		FileName:       message.FileName,
		Timestamp:      message.Timestamp,
		Author:         fallbackText(message.Author, "Contato"),
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
		JID:      jid,
		Caption:  strings.TrimSpace(r.FormValue("caption")),
		FileName: header.Filename,
		MimeType: mimeType,
		Data:     data,
		Sticker:  sticker,
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
