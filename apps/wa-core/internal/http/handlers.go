package httpapi

import (
	"context"
	"encoding/base64"
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
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	waProto "google.golang.org/protobuf/encoding/protojson"

	appauth "pulsehub/wa-core/internal/auth"
	appinstagram "pulsehub/wa-core/internal/instagram"
	"pulsehub/wa-core/internal/models"
	appstore "pulsehub/wa-core/internal/store"
	"pulsehub/wa-core/internal/whatsapp"
	"pulsehub/wa-core/internal/ws"
)

type AuthConfig struct {
	Email          string
	Password       string
	Name           string
	Role           string
	CookieName     string
	CSRFCookieName string
	CookieDomain   string
	CookieSecure   bool
	CookieSameSite http.SameSite
}

type conversationCursor struct {
	SortAt string
	Name   string
	JID    string
}

type conversationPageResponse struct {
	Conversations []models.ConversationRecord `json:"conversations"`
	NextCursor    string                      `json:"nextCursor"`
	HasMore       bool                        `json:"hasMore"`
}

const dashboardOverviewCacheTTL = 3 * time.Second

type API struct {
	logger                 *slog.Logger
	instagram              *appinstagram.Client
	manager                *whatsapp.Manager
	hub                    *ws.Hub
	store                  *appstore.Store
	auth                   AuthConfig
	security               SecurityConfig
	rateLimiter            *rateLimiter
	overviewCacheMu        sync.Mutex
	overviewCache          *models.DashboardOverview
	overviewCacheExpiresAt time.Time
	webSocketAuthTokenMu   sync.Mutex
	webSocketAuthTokens    map[string]webSocketAuthToken
}

func NewRouter(logger *slog.Logger, manager *whatsapp.Manager, hub *ws.Hub, store *appstore.Store, instagram *appinstagram.Client, auth AuthConfig, security SecurityConfig) http.Handler {
	api := &API{
		logger:              logger,
		instagram:           instagram,
		manager:             manager,
		hub:                 hub,
		store:               store,
		auth:                auth,
		security:            security,
		rateLimiter:         newRateLimiter(),
		webSocketAuthTokens: make(map[string]webSocketAuthToken),
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(api.securityHeaders)
	r.Use(api.cors)
	r.Use(api.rateLimit)

	r.Get("/health", api.handleHealth)
	r.Post("/auth/sign-in", api.handleSignIn)
	r.Get("/ws", api.handleWebSocket)

	r.Group(func(r chi.Router) {
		r.Use(api.requireAuth)

		r.Get("/auth/me", api.handleMe)
		r.Get("/auth/ws-token", api.handleWebSocketToken)
		r.Post("/auth/sign-out", api.handleSignOut)
		r.Get("/auth/users", api.handleListUsers)
		r.Get("/auth/audit-logs", api.handleListAuditLogs)
		r.Get("/auth/users/{id}/sessions", api.handleListUserSessions)
		r.Post("/auth/users/{id}/sessions/{sessionId}/revoke", api.handleRevokeUserSession)
		r.Post("/auth/users", api.handleCreateUser)
		r.Put("/auth/users/{id}", api.handleUpdateUser)
		r.Get("/instagram/status", api.handleInstagramStatus)
		r.Post("/instagram/feed", api.handleInstagramFeedPublish)
		r.Post("/instagram/story", api.handleInstagramStoryPublish)

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
			r.Get("/contacts/labels", api.handleListContactLabels)
			r.Post("/contacts/labels", api.handleCreateContactLabel)
			r.Put("/contacts/labels/{id}", api.handleUpdateContactLabel)
			r.Delete("/contacts/labels/{id}", api.handleDeleteContactLabel)
			r.Get("/contacts/crm", api.handleListContactCRMProfiles)
			r.Put("/contacts/crm", api.handleUpdateContactCRMProfile)
			r.Get("/contacts/kanban", api.handleListContactKanbanStages)
			r.Post("/contacts/manual", api.handleCreateManualContact)
			r.Put("/contacts/kanban", api.handleUpdateContactKanbanStage)
			r.Get("/conversations", api.handleConversationPage)
			r.Get("/sessions", api.handleListSessions)
			r.Post("/sessions", api.handleCreateSession)
			r.Delete("/sessions/{id}", api.handleDeleteSession)
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
		origin := normalizeOrigin(r.Header.Get("Origin"))
		if origin != "" {
			w.Header().Add("Vary", "Origin")
			if !a.isAllowedOrigin(origin) {
				if r.Method == http.MethodOptions {
					respondJSON(w, http.StatusForbidden, map[string]any{"message": "Origem nao permitida."})
					return
				}
				respondJSON(w, http.StatusForbidden, map[string]any{"message": "Origem nao permitida."})
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Max-Age", "600")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *API) isAllowedOrigin(origin string) bool {
	if origin == "" {
		return true
	}
	for _, candidate := range a.security.AllowedOrigins {
		if normalizeOrigin(candidate) == origin {
			return true
		}
	}
	return false
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
	a.invalidateDashboardOverviewCache()
	respondJSON(w, http.StatusOK, session)
}

func (a *API) handleSessionQR(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	qr, err := a.manager.GetQRByID(r.Context(), models.DefaultSessionID)
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

	status, err := a.manager.GetStatusByID(r.Context(), models.DefaultSessionID)
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
	sessionID := strings.TrimSpace(r.URL.Query().Get("sessionId"))
	jid, err := pathJID(chi.URLParam(r, "jid"))
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	photo, err := a.manager.GetProfilePhotoBySession(r.Context(), sessionID, jid, shouldRedirectPhoto(r))
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	photo.ProxyURL = avatarProxyPath(sessionID, photo.CanonicalJID, photo.PhotoID)

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
	a.invalidateDashboardOverviewCache()
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
	a.invalidateDashboardOverviewCache()

	respondJSON(w, http.StatusCreated, record)
}

func (a *API) handleMessageMedia(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimSpace(r.URL.Query().Get("sessionId"))
	messageID := strings.TrimSpace(chi.URLParam(r, "id"))
	if messageID == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "message id is required"})
		return
	}

	data, mimeType, fileName, err := a.manager.GetMessageMediaBySession(r.Context(), sessionID, messageID)
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
	csrfToken, err := appauth.GenerateToken()
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	a.setSessionCookie(w, token)
	a.setCSRFCookie(w, csrfToken)

	response := models.SignInResponse{
		User:      *user,
		CSRFToken: csrfToken,
	}
	a.recordAuditLog(r, models.AuditLogRecord{
		ActorUserID:  user.ID,
		ActorName:    user.Name,
		ActorRole:    user.Role,
		Action:       "auth.session.sign_in",
		ResourceType: "auth_session",
		Summary:      "Iniciou uma nova sessao no workspace.",
		Details: map[string]any{
			"sessionExpiresAt": time.Now().UTC().Add(authSessionDuration).Format(time.RFC3339),
		},
	})

	respondJSON(w, http.StatusOK, response)
}

func (a *API) handleDashboardOverview(w http.ResponseWriter, r *http.Request) {
	if overview, ok := a.cachedDashboardOverview(); ok {
		respondJSON(w, http.StatusOK, overview)
		return
	}

	overview, err := a.buildDashboardOverview(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	a.cacheDashboardOverview(overview)
	respondJSON(w, http.StatusOK, overview)
}

func (a *API) cachedDashboardOverview() (*models.DashboardOverview, bool) {
	a.overviewCacheMu.Lock()
	defer a.overviewCacheMu.Unlock()

	if a.overviewCache == nil || time.Now().After(a.overviewCacheExpiresAt) {
		return nil, false
	}

	return a.overviewCache, true
}

func (a *API) cacheDashboardOverview(overview *models.DashboardOverview) {
	a.overviewCacheMu.Lock()
	defer a.overviewCacheMu.Unlock()

	a.overviewCache = overview
	a.overviewCacheExpiresAt = time.Now().Add(dashboardOverviewCacheTTL)
}

func (a *API) invalidateDashboardOverviewCache() {
	a.overviewCacheMu.Lock()
	defer a.overviewCacheMu.Unlock()

	a.overviewCache = nil
	a.overviewCacheExpiresAt = time.Time{}
}

func (a *API) handleInstagramStatus(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	respondJSON(w, http.StatusOK, a.instagram.Status(r.Context()))
}

func (a *API) handleInstagramFeedPublish(w http.ResponseWriter, r *http.Request) {
	a.handleInstagramPublish(w, r, false)
}

func (a *API) handleInstagramStoryPublish(w http.ResponseWriter, r *http.Request) {
	a.handleInstagramPublish(w, r, true)
}

func (a *API) handleInstagramPublish(w http.ResponseWriter, r *http.Request, story bool) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	request, err := parseInstagramPublishRequest(r)
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": err.Error()})
		return
	}
	request.Story = story

	result, err := a.instagram.Publish(r.Context(), request)
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": err.Error()})
		return
	}

	mode := "feed"
	if story {
		mode = "story"
	}
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "instagram.publish." + mode,
		ResourceType: "instagram_media",
		ResourceID:   result.PublishedID,
		Summary:      "Publicou conteudo no Instagram pelo dashboard.",
		Details: map[string]any{
			"mode":       mode,
			"creationId": result.CreationID,
			"imageUrl":   result.ImageURL,
		},
	})

	respondJSON(w, http.StatusOK, result)
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
	auth, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor)
	if !ok {
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
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "session.create",
		ResourceType: "whatsapp_session",
		ResourceID:   compat.ID,
		Summary:      "Criou ou atualizou uma sessao operacional.",
		Details: map[string]any{
			"name":        compat.Name,
			"phoneNumber": compat.PhoneNumber,
			"channelName": compat.ChannelName,
			"actorId":     auth.user.ID,
		},
	})
	a.invalidateDashboardOverviewCache()

	respondJSON(w, http.StatusCreated, compat)
}

func (a *API) handleDeleteSession(w http.ResponseWriter, r *http.Request) {
	auth, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor)
	if !ok {
		return
	}

	sessionID := strings.TrimSpace(chi.URLParam(r, "id"))
	session, err := a.manager.DeleteSessionByID(r.Context(), sessionID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	if session == nil {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Sessao nao encontrada."})
		return
	}

	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "session.delete",
		ResourceType: "whatsapp_session",
		ResourceID:   session.ID,
		Summary:      "Removeu uma sessao operacional.",
		Details: map[string]any{
			"name":        session.Name,
			"phoneNumber": session.PhoneNumber,
			"channelName": session.ChannelName,
			"actorId":     auth.user.ID,
		},
	})
	a.invalidateDashboardOverviewCache()

	respondJSON(w, http.StatusOK, map[string]any{
		"id":      session.ID,
		"deleted": true,
	})
}

func (a *API) handleConnectSession(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	sessionID := strings.TrimSpace(chi.URLParam(r, "id"))
	session, err := a.manager.InitSession(r.Context(), models.SessionInitRequest{ID: sessionID})
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	compat, err := a.sessionToCompat(r.Context(), session)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "session.connect",
		ResourceType: "whatsapp_session",
		ResourceID:   compat.ID,
		Summary:      "Solicitou conexao ou geracao de QR da sessao.",
		Details: map[string]any{
			"status": compat.Status,
		},
	})
	a.invalidateDashboardOverviewCache()

	respondJSON(w, http.StatusOK, compat)
}

func (a *API) handleDisconnectSession(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	sessionID := strings.TrimSpace(chi.URLParam(r, "id"))
	session, err := a.manager.DisconnectByID(r.Context(), sessionID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	compat, err := a.sessionToCompat(r.Context(), session)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "session.disconnect",
		ResourceType: "whatsapp_session",
		ResourceID:   compat.ID,
		Summary:      "Desconectou uma sessao operacional.",
		Details: map[string]any{
			"status": compat.Status,
		},
	})
	a.invalidateDashboardOverviewCache()
	respondJSON(w, http.StatusOK, compat)
}

func (a *API) handleSessionQRCompat(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	sessionID := strings.TrimSpace(chi.URLParam(r, "id"))
	session, err := a.manager.GetSessionByID(r.Context(), sessionID)
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
	qr := &models.SessionQRResponse{
		Status:       session.Status,
		Code:         session.QRCode,
		ImageDataURL: session.QRCodeDataURL,
	}
	if session.ID == models.DefaultSessionID {
		qr, err = a.manager.GetQR(r.Context())
		if err != nil {
			respondError(w, http.StatusInternalServerError, err)
			return
		}
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
	sessionID := strings.TrimSpace(chi.URLParam(r, "id"))
	session, err := a.manager.GetSessionByID(r.Context(), sessionID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	if session == nil {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Sessao nao encontrada."})
		return
	}

	if strings.TrimSpace(r.URL.Query().Get("limit")) != "" || strings.TrimSpace(r.URL.Query().Get("cursor")) != "" {
		page, err := a.buildConversationRecordsForSessionPage(r.Context(), session, conversationPageLimit(r), strings.TrimSpace(r.URL.Query().Get("cursor")))
		if err != nil {
			respondError(w, http.StatusBadRequest, err)
			return
		}
		respondJSON(w, http.StatusOK, page)
		return
	}

	conversations, err := a.buildConversationRecordsForSession(r.Context(), session)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, conversations)
}

func (a *API) handleConversationPage(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimSpace(r.URL.Query().Get("sessionId"))
	if sessionID == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "sessionId e obrigatorio."})
		return
	}

	session, err := a.manager.GetSessionByID(r.Context(), sessionID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	if session == nil {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Sessao nao encontrada."})
		return
	}

	page, err := a.buildConversationRecordsForSessionPage(r.Context(), session, conversationPageLimit(r), strings.TrimSpace(r.URL.Query().Get("cursor")))
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	respondJSON(w, http.StatusOK, page)
}

func (a *API) handleConversationMessages(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimSpace(chi.URLParam(r, "id"))

	jid, err := pathJID(chi.URLParam(r, "jid"))
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	limit := 0
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		limit, _ = strconv.Atoi(rawLimit)
	}
	before := strings.TrimSpace(r.URL.Query().Get("before"))

	var messages []models.Message
	if limit > 0 || before != "" {
		messages, err = a.manager.ListMessagesPageBySession(r.Context(), sessionID, jid, limit, before)
	} else {
		messages, err = a.manager.ListMessagesBySession(r.Context(), sessionID, jid)
	}
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
	sessionID := strings.TrimSpace(chi.URLParam(r, "id"))

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

	message, err := a.manager.SendTextBySession(r.Context(), sessionID, models.SendTextRequest{
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
	a.invalidateDashboardOverviewCache()

	respondJSON(w, http.StatusOK, record)
}

func (a *API) handleConversationSendMedia(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimSpace(chi.URLParam(r, "id"))

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

	message, err := a.manager.SendMediaBySession(r.Context(), sessionID, req)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	record, err := a.buildMessageRecord(r.Context(), *message, jid)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	a.invalidateDashboardOverviewCache()

	respondJSON(w, http.StatusOK, record)
}

func (a *API) handleConversationReaction(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimSpace(chi.URLParam(r, "id"))

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

	message, err := a.manager.SendReactionBySession(r.Context(), sessionID, request)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	record, err := a.buildMessageRecord(r.Context(), *message, jid)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	a.invalidateDashboardOverviewCache()

	respondJSON(w, http.StatusOK, record)
}

func (a *API) handleConversationRead(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimSpace(chi.URLParam(r, "id"))

	jid, err := pathJID(chi.URLParam(r, "jid"))
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	if err := a.manager.MarkChatReadBySession(r.Context(), sessionID, jid); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	a.invalidateDashboardOverviewCache()

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
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "kanban.board.create",
		ResourceType: "kanban_board",
		ResourceID:   record.ID,
		Summary:      "Criou um board personalizado do CRM.",
		Details: map[string]any{
			"label":                  record.Label,
			"contactsFilter":         record.ContactsFilter,
			"contactsAudienceFilter": record.ContactsAudienceFilter,
			"contactsChannelFilter":  record.ContactsChannelFilter,
		},
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
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "kanban.board.delete",
		ResourceType: "kanban_board",
		ResourceID:   boardID,
		Summary:      "Removeu um board personalizado do CRM.",
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

func (a *API) handleListContactLabels(w http.ResponseWriter, r *http.Request) {
	if currentAuth(r) == nil {
		respondJSON(w, http.StatusUnauthorized, map[string]any{"message": "Autenticacao obrigatoria."})
		return
	}

	items, err := a.store.ListContactLabels(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, items)
}

func (a *API) handleCreateContactLabel(w http.ResponseWriter, r *http.Request) {
	auth, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor)
	if !ok {
		return
	}

	var request models.UpsertContactLabelRequest
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	label, err := buildContactLabelRecord(request, "", auth.user.Name)
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": err.Error()})
		return
	}

	saved, err := a.store.SaveContactLabel(r.Context(), label)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	a.hub.Broadcast(models.RealtimeEvent{Kind: "contact_label.updated", Text: saved.ID, OccurredAt: saved.UpdatedAt})
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "contact_label.create",
		ResourceType: "contact_label",
		ResourceID:   saved.ID,
		Summary:      "Criou uma etiqueta para contatos.",
		Details: map[string]any{
			"name":            saved.Name,
			"emoji":           saved.Emoji,
			"color":           saved.Color,
			"performedByRole": auth.user.Role,
		},
	})

	respondJSON(w, http.StatusCreated, saved)
}

func (a *API) handleUpdateContactLabel(w http.ResponseWriter, r *http.Request) {
	auth, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor)
	if !ok {
		return
	}

	var request models.UpsertContactLabelRequest
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	labelID := strings.TrimSpace(chi.URLParam(r, "id"))
	label, err := buildContactLabelRecord(request, labelID, auth.user.Name)
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": err.Error()})
		return
	}

	saved, err := a.store.SaveContactLabel(r.Context(), label)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	a.hub.Broadcast(models.RealtimeEvent{Kind: "contact_label.updated", Text: saved.ID, OccurredAt: saved.UpdatedAt})
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "contact_label.update",
		ResourceType: "contact_label",
		ResourceID:   saved.ID,
		Summary:      "Atualizou uma etiqueta de contatos.",
		Details: map[string]any{
			"name":            saved.Name,
			"emoji":           saved.Emoji,
			"color":           saved.Color,
			"performedByRole": auth.user.Role,
		},
	})

	respondJSON(w, http.StatusOK, saved)
}

func (a *API) handleDeleteContactLabel(w http.ResponseWriter, r *http.Request) {
	auth, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor)
	if !ok {
		return
	}

	labelID := strings.TrimSpace(chi.URLParam(r, "id"))
	if labelID == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "id da etiqueta obrigatorio."})
		return
	}

	if err := a.store.DeleteContactLabel(r.Context(), labelID); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	a.hub.Broadcast(models.RealtimeEvent{Kind: "contact_label.updated", Text: labelID, OccurredAt: models.NowString()})
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "contact_label.delete",
		ResourceType: "contact_label",
		ResourceID:   labelID,
		Summary:      "Removeu uma etiqueta de contatos.",
		Details: map[string]any{
			"performedByRole": auth.user.Role,
		},
	})

	respondJSON(w, http.StatusOK, map[string]any{"ok": true})
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
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "quick_reply.create",
		ResourceType: "quick_reply",
		ResourceID:   record.ID,
		Summary:      "Criou uma resposta rapida.",
		Details: map[string]any{
			"name":            record.Name,
			"shortcut":        record.Shortcut,
			"visibilityScope": record.VisibilityScope,
			"status":          record.Status,
		},
	})
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
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "quick_reply.update",
		ResourceType: "quick_reply",
		ResourceID:   record.ID,
		Summary:      "Atualizou uma resposta rapida.",
		Details: map[string]any{
			"name":            record.Name,
			"shortcut":        record.Shortcut,
			"visibilityScope": record.VisibilityScope,
			"status":          record.Status,
		},
	})
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
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "quick_reply.delete",
		ResourceType: "quick_reply",
		ResourceID:   quickReplyID,
		Summary:      "Removeu uma resposta rapida.",
	})
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
	auth := currentAuth(r)
	if auth == nil {
		respondJSON(w, http.StatusUnauthorized, map[string]any{"message": "Autenticacao obrigatoria."})
		return
	}

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
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "crm.profile.update",
		ResourceType: "crm_profile",
		ResourceID:   dashboardConversationKey(record.SessionID, record.ConversationID),
		Summary:      "Atualizou o perfil CRM de um contato.",
		Details: map[string]any{
			"sessionId":       record.SessionID,
			"conversationId":  record.ConversationID,
			"assignee":        record.Assignee,
			"priority":        record.Priority,
			"tagsCount":       len(record.Tags),
			"performedByRole": auth.user.Role,
		},
	})
	a.invalidateDashboardOverviewCache()

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
	auth := currentAuth(r)
	if auth == nil {
		respondJSON(w, http.StatusUnauthorized, map[string]any{"message": "Autenticacao obrigatoria."})
		return
	}

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
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "kanban.stage.update",
		ResourceType: "kanban_stage",
		ResourceID:   dashboardConversationKey(record.SessionID, record.ConversationID),
		Summary:      "Moveu um contato no kanban.",
		Details: map[string]any{
			"sessionId":       record.SessionID,
			"conversationId":  record.ConversationID,
			"stage":           record.Stage,
			"performedByRole": auth.user.Role,
		},
	})
	a.invalidateDashboardOverviewCache()

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
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "contact.manual.create",
		ResourceType: "contact",
		ResourceID:   jid,
		Summary:      "Criou um contato manualmente.",
		Details: map[string]any{
			"name":      request.Name,
			"phone":     phone,
			"sessionId": request.SessionID,
			"stage":     request.Stage,
		},
	})
	a.invalidateDashboardOverviewCache()

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
	onlineUsers, err := a.store.CountActiveAuthSessions(ctx)
	if err != nil {
		return nil, err
	}
	sessions, err := a.buildSessionRecordsWithActiveCount(ctx, onlineUsers)
	if err != nil {
		return nil, err
	}
	conversations, err := a.buildAllConversationRecords(ctx)
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
	enrichConversationWorkspaceFields(conversations, crmProfileMap, kanbanStageMap)

	connectedNumbers := 0
	activeSessions := 0
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

	overview.Channels = buildDashboardChannels(sessions)

	return overview, nil
}

func (a *API) buildAllConversationRecords(ctx context.Context) ([]models.ConversationRecord, error) {
	sessions, err := a.manager.ListSessions(ctx)
	if err != nil {
		return nil, err
	}
	if len(sessions) == 0 {
		return []models.ConversationRecord{}, nil
	}

	all := make([]models.ConversationRecord, 0)
	for index := range sessions {
		items, err := a.buildConversationRecordsForSession(ctx, &sessions[index])
		if err != nil {
			return nil, err
		}
		all = append(all, items...)
	}

	sort.Slice(all, func(i, j int) bool {
		return all[i].LastMessageAt > all[j].LastMessageAt
	})

	return all, nil
}

func buildDashboardChannels(sessions []models.SessionRecord) []models.ChannelRecord {
	if len(sessions) == 0 {
		return []models.ChannelRecord{}
	}

	channelMap := make(map[string]*models.ChannelRecord)
	orderedKeys := make([]string, 0)
	for _, session := range sessions {
		key := strings.TrimSpace(session.ChannelID)
		if key == "" {
			key = strings.TrimSpace(session.ChannelName)
		}
		if key == "" {
			key = "whatsapp"
		}
		if _, ok := channelMap[key]; !ok {
			channelMap[key] = &models.ChannelRecord{
				ID:               key,
				Name:             fallbackText(session.ChannelName, "WhatsApp"),
				Color:            channelColor(session.ChannelName),
				ConnectedNumbers: 0,
			}
			orderedKeys = append(orderedKeys, key)
		}
		channelMap[key].ConnectedNumbers++
	}

	items := make([]models.ChannelRecord, 0, len(orderedKeys))
	for _, key := range orderedKeys {
		items = append(items, *channelMap[key])
	}
	return items
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

func enrichConversationWorkspaceFields(
	conversations []models.ConversationRecord,
	crmProfiles map[string]models.ContactCRMProfileRecord,
	kanbanStages map[string]models.ContactKanbanStageRecord,
) {
	for index := range conversations {
		conversation := &conversations[index]
		storageKey := dashboardConversationKey(conversation.SessionID, conversation.ID)
		profile := crmProfiles[storageKey]
		stage := resolveContactKanbanStage(*conversation, kanbanStages)
		conversation.KanbanStage = stage
		conversation.Owner = fallbackText(normalizeOperatorLabel(profile.Assignee), fallbackText(conversation.Owner, "Sem responsavel"))
		conversation.Status = kanbanStageLabel(stage)
	}
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

func kanbanStageLabel(stage string) string {
	switch strings.TrimSpace(strings.ToLower(stage)) {
	case "new":
		return "Novo"
	case "qualified":
		return "Qualificado"
	case "followup":
		return "Follow-up"
	case "won":
		return "Ganho"
	default:
		return "Ativo"
	}
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
		AverageSeconds:      0,
		DeltaSeconds:        0,
		SampleCount:         0,
		PreviousSampleCount: 0,
		TargetSeconds:       120,
		PeakLabel:           "Sem dados",
		Points:              []models.DashboardResponseVelocityPoint{},
	}

	sessions, err := a.manager.ListSessions(ctx)
	if err != nil {
		return analytics, err
	}

	now := time.Now().UTC()
	currentCutoff := now.Add(-7 * 24 * time.Hour)
	previousCutoff := now.Add(-14 * 24 * time.Hour)
	currentSamples := make([]int, 0)
	previousSamples := make([]int, 0)
	type trendBucket struct {
		start   time.Time
		samples []int
	}
	bucketValues := make(map[time.Time][]int)
	fastestAt := time.Time{}
	fastestSeconds := math.MaxInt

	for _, session := range sessions {
		chats, err := a.manager.ListChatsBySession(ctx, session.ID)
		if err != nil {
			return analytics, err
		}

		for _, chat := range chats {
			canonicalJID, err := a.manager.CanonicalConversationJIDBySession(ctx, session.ID, chat.JID)
			if err != nil {
				canonicalJID = chat.JID
			}
			if !isVisibleConversationJID(canonicalJID) {
				continue
			}

			messages, err := a.manager.ListRecentMessagesBySession(ctx, session.ID, chat.JID, previousCutoff.Format(time.RFC3339), 1000)
			if err != nil {
				return analytics, err
			}

			for _, sample := range collectResponseSamples(messages) {
				if sample.When.Before(previousCutoff) {
					continue
				}

				if !sample.When.Before(currentCutoff) {
					currentSamples = append(currentSamples, sample.Seconds)
					bucketStart := responseTrendBucketStart(sample.When)
					bucketValues[bucketStart] = append(bucketValues[bucketStart], sample.Seconds)
					if sample.Seconds < fastestSeconds {
						fastestSeconds = sample.Seconds
						fastestAt = sample.When
					}
					continue
				}

				previousSamples = append(previousSamples, sample.Seconds)
			}
		}
	}

	if len(currentSamples) > 0 {
		analytics.SampleCount = len(currentSamples)
		analytics.AverageSeconds = averageInt(currentSamples)
	}
	if len(previousSamples) > 0 {
		analytics.PreviousSampleCount = len(previousSamples)
		analytics.DeltaSeconds = averageInt(previousSamples) - analytics.AverageSeconds
	}
	if !fastestAt.IsZero() {
		analytics.PeakLabel = fastestAt.Local().Format("3:04 PM")
	}

	trendBuckets := make([]trendBucket, 0, len(bucketValues))
	for start, samples := range bucketValues {
		if len(samples) == 0 {
			continue
		}
		trendBuckets = append(trendBuckets, trendBucket{start: start, samples: samples})
	}
	sort.Slice(trendBuckets, func(i, j int) bool {
		return trendBuckets[i].start.Before(trendBuckets[j].start)
	})
	if len(trendBuckets) > 6 {
		trendBuckets = trendBuckets[len(trendBuckets)-6:]
	}

	points := make([]models.DashboardResponseVelocityPoint, 0, len(trendBuckets))
	for _, bucket := range trendBuckets {
		points = append(points, models.DashboardResponseVelocityPoint{
			Label:          formatResponseTrendLabel(bucket.start, now),
			AverageSeconds: averageInt(bucket.samples),
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

func responseTrendBucketStart(value time.Time) time.Time {
	local := value.Local()
	bucketHour := local.Hour() - (local.Hour() % 2)
	return time.Date(local.Year(), local.Month(), local.Day(), bucketHour, 0, 0, 0, local.Location())
}

func formatResponseTrendLabel(value, reference time.Time) string {
	localValue := value.Local()
	localReference := reference.Local()
	if localValue.Year() == localReference.Year() && localValue.YearDay() == localReference.YearDay() {
		return localValue.Format("03:04 PM")
	}
	return localValue.Format("Mon 03PM")
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
	activeAuthSessions, err := a.store.CountActiveAuthSessions(ctx)
	if err != nil {
		return nil, err
	}
	return a.buildSessionRecordsWithActiveCount(ctx, activeAuthSessions)
}

func (a *API) buildSessionRecordsWithActiveCount(ctx context.Context, activeAuthSessions int) ([]models.SessionRecord, error) {
	sessions, err := a.manager.ListSessions(ctx)
	if err != nil {
		return nil, err
	}
	if len(sessions) == 0 {
		return []models.SessionRecord{}, nil
	}

	items := make([]models.SessionRecord, 0, len(sessions))
	for index := range sessions {
		compat, err := a.sessionToCompatWithActiveCount(ctx, &sessions[index], activeAuthSessions)
		if err != nil {
			return nil, err
		}
		items = append(items, compat)
	}

	return items, nil
}

func (a *API) sessionToCompat(ctx context.Context, session *models.Session) (models.SessionRecord, error) {
	activeAuthSessions, err := a.store.CountActiveAuthSessions(ctx)
	if err != nil {
		return models.SessionRecord{}, err
	}
	return a.sessionToCompatWithActiveCount(ctx, session, activeAuthSessions)
}

func (a *API) sessionToCompatWithActiveCount(ctx context.Context, session *models.Session, activeAuthSessions int) (models.SessionRecord, error) {
	waiting, unread, err := a.store.GetChatStatsBySession(ctx, session.ID)
	if err != nil {
		return models.SessionRecord{}, err
	}

	attendants := 0
	if session.Status == models.SessionStatusActive {
		attendants = activeAuthSessions
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
	session, err := a.manager.GetSession(ctx)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return []models.ConversationRecord{}, nil
	}
	return a.buildConversationRecordsForSession(ctx, session)
}

func (a *API) buildConversationRecordsForSession(ctx context.Context, session *models.Session) ([]models.ConversationRecord, error) {
	chats, err := a.manager.ListChatsBySession(ctx, session.ID)
	if err != nil {
		return nil, err
	}
	return a.buildConversationRecordsFromChats(ctx, session, chats)
}

func (a *API) buildConversationRecordsForSessionPage(ctx context.Context, session *models.Session, limit int, rawCursor string) (conversationPageResponse, error) {
	cursor, err := decodeConversationCursor(rawCursor)
	if err != nil {
		return conversationPageResponse{}, err
	}

	chats, err := a.manager.ListChatsPageBySession(ctx, session.ID, limit+1, cursor.SortAt, cursor.Name, cursor.JID)
	if err != nil {
		return conversationPageResponse{}, err
	}

	hasMore := len(chats) > limit
	pageChats := chats
	if hasMore {
		pageChats = chats[:limit]
	}

	conversations, err := a.buildConversationRecordsFromChats(ctx, session, pageChats)
	if err != nil {
		return conversationPageResponse{}, err
	}

	nextCursor := ""
	if hasMore && len(pageChats) > 0 {
		nextCursor = encodeConversationCursor(pageChats[len(pageChats)-1])
	}

	return conversationPageResponse{
		Conversations: conversations,
		NextCursor:    nextCursor,
		HasMore:       hasMore,
	}, nil
}

func (a *API) buildConversationRecordsFromChats(ctx context.Context, session *models.Session, chats []models.Chat) ([]models.ConversationRecord, error) {
	if len(chats) == 0 {
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
		canonicalJID, err := a.manager.CanonicalConversationJIDBySession(ctx, session.ID, chat.JID)
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

		preview := fallbackText(chat.LastMessageText, "Sem mensagem recente.")
		lastMessageAt := fallbackText(chat.LastMessageAt, session.UpdatedAt)

		candidate := models.ConversationRecord{
			ID:            canonicalJID,
			SessionID:     session.ID,
			SessionName:   session.Name,
			Contact:       name,
			AvatarURL:     avatarProxyPath(session.ID, canonicalJID, contact.PhotoID),
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

func conversationPageLimit(r *http.Request) int {
	limit := 80
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		if parsedLimit, err := strconv.Atoi(rawLimit); err == nil && parsedLimit > 0 {
			limit = parsedLimit
		}
	}
	if limit > 200 {
		return 200
	}
	return limit
}

func decodeConversationCursor(raw string) (conversationCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return conversationCursor{}, nil
	}

	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return conversationCursor{}, errors.New("cursor de conversas invalido")
	}

	parts := strings.SplitN(string(decoded), "\x00", 3)
	if len(parts) != 3 || parts[0] == "" || parts[2] == "" {
		return conversationCursor{}, errors.New("cursor de conversas invalido")
	}

	return conversationCursor{
		SortAt: parts[0],
		Name:   parts[1],
		JID:    parts[2],
	}, nil
}

func encodeConversationCursor(chat models.Chat) string {
	parts := []string{
		conversationSortTime(chat),
		chat.Name,
		chat.JID,
	}
	return base64.RawURLEncoding.EncodeToString([]byte(strings.Join(parts, "\x00")))
}

func conversationSortTime(chat models.Chat) string {
	if strings.TrimSpace(chat.LastMessageAt) != "" {
		return strings.TrimSpace(chat.LastMessageAt)
	}
	return strings.TrimSpace(chat.UpdatedAt)
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
		if strings.TrimSpace(message.SessionID) != "" {
			mediaURL += "?sessionId=" + url.QueryEscape(message.SessionID)
		}
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

func avatarProxyPath(sessionID, jid, photoID string) string {
	if strings.TrimSpace(jid) == "" {
		return ""
	}
	path := "/contacts/" + url.PathEscape(jid) + "/photo?redirect=1"
	if strings.TrimSpace(sessionID) != "" {
		path += "&sessionId=" + url.QueryEscape(sessionID)
	}
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

func buildContactLabelRecord(request models.UpsertContactLabelRequest, labelID, actorName string) (models.ContactLabelRecord, error) {
	name := strings.TrimSpace(request.Name)
	if name == "" {
		return models.ContactLabelRecord{}, errors.New("nome da etiqueta obrigatorio")
	}

	color, ok := normalizeContactLabelColor(request.Color)
	if !ok {
		return models.ContactLabelRecord{}, errors.New("cor da etiqueta invalida")
	}

	updatedBy := strings.TrimSpace(request.UpdatedBy)
	if updatedBy == "" {
		updatedBy = strings.TrimSpace(actorName)
	}

	now := models.NowString()
	return models.ContactLabelRecord{
		ID:        strings.TrimSpace(labelID),
		Name:      name,
		Emoji:     strings.TrimSpace(request.Emoji),
		Color:     color,
		CreatedBy: updatedBy,
		UpdatedBy: updatedBy,
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

func normalizeContactLabelColor(value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) != 7 || trimmed[0] != '#' {
		return "", false
	}

	for _, char := range trimmed[1:] {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') && (char < 'A' || char > 'F') {
			return "", false
		}
	}

	return strings.ToUpper(trimmed), true
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

func parseInstagramPublishRequest(r *http.Request) (appinstagram.PublishRequest, error) {
	if err := r.ParseMultipartForm(128 << 20); err != nil {
		return appinstagram.PublishRequest{}, fmt.Errorf("parse multipart form: %w", err)
	}

	request := appinstagram.PublishRequest{
		ImageURL: strings.TrimSpace(r.FormValue("imageUrl")),
		Caption:  strings.TrimSpace(r.FormValue("caption")),
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		if request.ImageURL == "" {
			return appinstagram.PublishRequest{}, errors.New("envie uma midia ou informe uma URL publica")
		}
		return request, nil
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return appinstagram.PublishRequest{}, fmt.Errorf("read upload: %w", err)
	}
	mimeType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if mimeType == "" && len(data) > 0 {
		mimeType = http.DetectContentType(data)
	}

	request.FileName = header.Filename
	request.MimeType = mimeType
	request.Data = data

	return request, nil
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
