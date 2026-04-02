package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	appauth "pulsehub/wa-core/internal/auth"
	"pulsehub/wa-core/internal/models"
)

const authSessionDuration = 30 * 24 * time.Hour

type authContextValue struct {
	user      models.AuthUser
	session   models.AuthSession
	tokenHash string
}

type authContextKey string

const currentAuthContextKey authContextKey = "pulsehub.auth"

func (a *API) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := authTokenFromRequest(r)
		if token == "" {
			respondJSON(w, http.StatusUnauthorized, map[string]any{"message": "Autenticacao obrigatoria."})
			return
		}

		tokenHash := appauth.HashToken(token)
		user, session, err := a.store.GetAuthUserBySessionTokenHash(r.Context(), tokenHash)
		if err != nil {
			respondError(w, http.StatusInternalServerError, err)
			return
		}
		if user == nil || session == nil || !user.IsActive || authSessionExpired(*session) {
			respondJSON(w, http.StatusUnauthorized, map[string]any{"message": "Sessao invalida ou expirada."})
			return
		}

		now := models.NowString()
		_ = a.store.TouchAuthSession(r.Context(), session.ID, now)

		ctx := context.WithValue(r.Context(), currentAuthContextKey, authContextValue{
			user:      *user,
			session:   *session,
			tokenHash: tokenHash,
		})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func authTokenFromRequest(r *http.Request) string {
	if authorization := strings.TrimSpace(r.Header.Get("Authorization")); strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
		return strings.TrimSpace(authorization[len("Bearer "):])
	}

	return strings.TrimSpace(r.URL.Query().Get("token"))
}

func authSessionExpired(session models.AuthSession) bool {
	if strings.TrimSpace(session.RevokedAt) != "" {
		return true
	}
	expiresAt, err := time.Parse(time.RFC3339, session.ExpiresAt)
	if err != nil {
		return true
	}
	return time.Now().UTC().After(expiresAt)
}

func currentAuth(r *http.Request) *authContextValue {
	value, _ := r.Context().Value(currentAuthContextKey).(authContextValue)
	if value.user.ID == "" {
		return nil
	}
	return &value
}

func (a *API) requireAdmin(w http.ResponseWriter, r *http.Request) (*authContextValue, bool) {
	return a.requireRoles(w, r, models.AuthRoleAdmin)
}

func (a *API) requireRoles(w http.ResponseWriter, r *http.Request, roles ...models.AuthRole) (*authContextValue, bool) {
	auth := currentAuth(r)
	if auth == nil {
		respondJSON(w, http.StatusUnauthorized, map[string]any{"message": "Autenticacao obrigatoria."})
		return nil, false
	}
	if !hasAnyRole(auth.user.Role, roles...) {
		respondJSON(w, http.StatusForbidden, map[string]any{"message": "Voce nao tem permissao para esta acao."})
		return nil, false
	}
	return auth, true
}

func hasAnyRole(role models.AuthRole, allowed ...models.AuthRole) bool {
	for _, candidate := range allowed {
		if role == candidate {
			return true
		}
	}
	return false
}

func (a *API) handleMe(w http.ResponseWriter, r *http.Request) {
	auth := currentAuth(r)
	if auth == nil {
		respondJSON(w, http.StatusUnauthorized, map[string]any{"message": "Autenticacao obrigatoria."})
		return
	}
	respondJSON(w, http.StatusOK, auth.user)
}

func (a *API) handleSignOut(w http.ResponseWriter, r *http.Request) {
	auth := currentAuth(r)
	if auth == nil {
		respondJSON(w, http.StatusUnauthorized, map[string]any{"message": "Autenticacao obrigatoria."})
		return
	}
	if err := a.store.DeleteAuthSessionByTokenHash(r.Context(), auth.tokenHash); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) handleListUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	users, err := a.store.ListAuthUsers(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, http.StatusOK, users)
}

func (a *API) handleListAuditLogs(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin, models.AuthRoleSupervisor); !ok {
		return
	}

	limit := 50
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		if parsed, err := strconv.Atoi(rawLimit); err == nil {
			limit = parsed
		}
	}

	items, err := a.store.ListAuditLogs(r.Context(), limit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, items)
}

func (a *API) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	auth, ok := a.requireRoles(w, r, models.AuthRoleAdmin)
	if !ok {
		return
	}

	var request models.CreateUserRequest
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	if strings.TrimSpace(request.Email) == "" || strings.TrimSpace(request.Name) == "" || strings.TrimSpace(request.Password) == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "Nome, email e senha sao obrigatorios."})
		return
	}
	if !isAllowedRole(request.Role) {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "Role invalida."})
		return
	}

	existing, _, err := a.store.GetAuthUserByEmail(r.Context(), request.Email)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	if existing != nil {
		respondJSON(w, http.StatusConflict, map[string]any{"message": "Ja existe um usuario com este email."})
		return
	}

	passwordHash, err := appauth.HashPassword(request.Password)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}

	isActive := true
	if request.IsActive != nil {
		isActive = *request.IsActive
	}

	user, err := a.store.CreateAuthUser(r.Context(), models.AuthUser{
		Email:     request.Email,
		Name:      strings.TrimSpace(request.Name),
		Role:      request.Role,
		IsActive:  isActive,
		CreatedAt: models.NowString(),
		UpdatedAt: models.NowString(),
	}, passwordHash)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "auth.user.create",
		ResourceType: "auth_user",
		ResourceID:   user.ID,
		Summary:      "Criou um usuario do workspace.",
		Details: map[string]any{
			"email":    user.Email,
			"name":     user.Name,
			"role":     user.Role,
			"isActive": user.IsActive,
			"actorId":  auth.user.ID,
		},
	})

	respondJSON(w, http.StatusCreated, user)
}

func (a *API) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	auth, ok := a.requireRoles(w, r, models.AuthRoleAdmin)
	if !ok {
		return
	}

	userID := strings.TrimSpace(chi.URLParam(r, "id"))
	if userID == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "Usuario invalido."})
		return
	}

	var request models.UpdateUserRequest
	if err := decodeJSON(r, &request); err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(request.Name) == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "Nome obrigatorio."})
		return
	}
	if !isAllowedRole(request.Role) {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "Role invalida."})
		return
	}

	user, err := a.store.GetAuthUserByID(r.Context(), userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	if user == nil {
		respondJSON(w, http.StatusNotFound, map[string]any{"message": "Usuario nao encontrado."})
		return
	}

	if user.ID == auth.user.ID && request.IsActive != nil && !*request.IsActive {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "Voce nao pode desativar a propria conta."})
		return
	}

	user.Name = strings.TrimSpace(request.Name)
	user.Role = request.Role
	if request.IsActive != nil {
		user.IsActive = *request.IsActive
	}

	var passwordHash *string
	if strings.TrimSpace(request.Password) != "" {
		hash, err := appauth.HashPassword(request.Password)
		if err != nil {
			respondError(w, http.StatusBadRequest, err)
			return
		}
		passwordHash = &hash
	}

	updated, err := a.store.UpdateAuthUser(r.Context(), *user, passwordHash)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "auth.user.update",
		ResourceType: "auth_user",
		ResourceID:   updated.ID,
		Summary:      "Atualizou um usuario do workspace.",
		Details: map[string]any{
			"name":            updated.Name,
			"role":            updated.Role,
			"isActive":        updated.IsActive,
			"passwordUpdated": passwordHash != nil,
		},
	})

	respondJSON(w, http.StatusOK, updated)
}

func (a *API) handleListUserSessions(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireRoles(w, r, models.AuthRoleAdmin); !ok {
		return
	}

	userID := strings.TrimSpace(chi.URLParam(r, "id"))
	if userID == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "Usuario invalido."})
		return
	}

	sessions, err := a.store.ListActiveAuthSessionsByUser(r.Context(), userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, http.StatusOK, sessions)
}

func (a *API) handleRevokeUserSession(w http.ResponseWriter, r *http.Request) {
	auth, ok := a.requireRoles(w, r, models.AuthRoleAdmin)
	if !ok {
		return
	}

	userID := strings.TrimSpace(chi.URLParam(r, "id"))
	sessionID := strings.TrimSpace(chi.URLParam(r, "sessionId"))
	if userID == "" || sessionID == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "Sessao invalida."})
		return
	}
	if auth.session.ID == sessionID {
		respondJSON(w, http.StatusBadRequest, map[string]any{"message": "Nao e permitido revogar sua sessao atual por esta tela."})
		return
	}

	if err := a.store.RevokeAuthSessionByID(r.Context(), userID, sessionID); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "auth.session.revoke",
		ResourceType: "auth_session",
		ResourceID:   sessionID,
		Summary:      "Revogou uma sessao ativa de usuario.",
		Details: map[string]any{
			"userId": userID,
		},
	})

	respondJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) recordAuditLog(r *http.Request, item models.AuditLogRecord) {
	auth := currentAuth(r)
	if auth == nil {
		return
	}
	if item.ActorUserID == "" {
		item.ActorUserID = auth.user.ID
	}
	if item.ActorName == "" {
		item.ActorName = auth.user.Name
	}
	if item.ActorRole == "" {
		item.ActorRole = auth.user.Role
	}
	if item.RemoteAddr == "" {
		item.RemoteAddr = strings.TrimSpace(r.RemoteAddr)
	}
	if item.UserAgent == "" {
		item.UserAgent = strings.TrimSpace(r.UserAgent())
	}
	if item.CreatedAt == "" {
		item.CreatedAt = models.NowString()
	}
	if item.Details == nil {
		item.Details = map[string]any{}
	}

	if err := a.store.SaveAuditLog(r.Context(), item); err != nil {
		a.logger.Warn("failed to write audit log", "action", item.Action, "resourceType", item.ResourceType, "resourceID", item.ResourceID, "error", err)
	}
}

func isAllowedRole(role models.AuthRole) bool {
	switch role {
	case models.AuthRoleAdmin, models.AuthRoleSupervisor, models.AuthRoleAttendant:
		return true
	default:
		return false
	}
}
