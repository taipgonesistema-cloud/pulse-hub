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
const authCookieConfigContextKey authContextKey = "pulsehub.auth.cookie-name"
const csrfCookieConfigContextKey authContextKey = "pulsehub.auth.csrf-cookie-name"

func (a *API) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r = r.WithContext(context.WithValue(r.Context(), authCookieConfigContextKey, cookieNameOrDefault(a.auth.CookieName)))
		r = r.WithContext(context.WithValue(r.Context(), csrfCookieConfigContextKey, csrfCookieNameOrDefault(a.auth.CSRFCookieName)))
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
			a.clearSessionCookie(w)
			a.clearCSRFCookie(w)
			respondJSON(w, http.StatusUnauthorized, map[string]any{"message": "Sessao invalida ou expirada."})
			return
		}
		if requestUsesCookieAuth(r) && requiresCSRFMitigation(r.Method) && !validateCSRFTokens(r) {
			respondJSON(w, http.StatusForbidden, map[string]any{"message": "Falha na validacao CSRF."})
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
	if cookie, err := r.Cookie(authCookieNameFromRequest(r)); err == nil {
		if token := strings.TrimSpace(cookie.Value); token != "" {
			return token
		}
	}

	if authorization := strings.TrimSpace(r.Header.Get("Authorization")); strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
		return strings.TrimSpace(authorization[len("Bearer "):])
	}

	return ""
}

func authCookieNameFromRequest(r *http.Request) string {
	if value, ok := r.Context().Value(authCookieConfigContextKey).(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return "pulse_hub_session"
}

func csrfCookieNameFromRequest(r *http.Request) string {
	if value, ok := r.Context().Value(csrfCookieConfigContextKey).(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return "pulse_hub_csrf"
}

func (a *API) setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieNameOrDefault(a.auth.CookieName),
		Value:    token,
		Path:     "/",
		Domain:   strings.TrimSpace(a.auth.CookieDomain),
		HttpOnly: true,
		Secure:   a.auth.CookieSecure,
		SameSite: a.auth.CookieSameSite,
		MaxAge:   int(authSessionDuration.Seconds()),
		Expires:  time.Now().UTC().Add(authSessionDuration),
	})
}

func (a *API) setCSRFCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     csrfCookieNameOrDefault(a.auth.CSRFCookieName),
		Value:    token,
		Path:     "/",
		Domain:   strings.TrimSpace(a.auth.CookieDomain),
		HttpOnly: false,
		Secure:   a.auth.CookieSecure,
		SameSite: a.auth.CookieSameSite,
		MaxAge:   int(authSessionDuration.Seconds()),
		Expires:  time.Now().UTC().Add(authSessionDuration),
	})
}

func (a *API) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieNameOrDefault(a.auth.CookieName),
		Value:    "",
		Path:     "/",
		Domain:   strings.TrimSpace(a.auth.CookieDomain),
		HttpOnly: true,
		Secure:   a.auth.CookieSecure,
		SameSite: a.auth.CookieSameSite,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0).UTC(),
	})
}

func (a *API) clearCSRFCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     csrfCookieNameOrDefault(a.auth.CSRFCookieName),
		Value:    "",
		Path:     "/",
		Domain:   strings.TrimSpace(a.auth.CookieDomain),
		HttpOnly: false,
		Secure:   a.auth.CookieSecure,
		SameSite: a.auth.CookieSameSite,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0).UTC(),
	})
}

func cookieNameOrDefault(value string) string {
	if strings.TrimSpace(value) == "" {
		return "pulse_hub_session"
	}
	return strings.TrimSpace(value)
}

func csrfCookieNameOrDefault(value string) string {
	if strings.TrimSpace(value) == "" {
		return "pulse_hub_csrf"
	}
	return strings.TrimSpace(value)
}

func requestUsesCookieAuth(r *http.Request) bool {
	if authorization := strings.TrimSpace(r.Header.Get("Authorization")); strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
		return false
	}
	_, err := r.Cookie(authCookieNameFromRequest(r))
	return err == nil
}

func requiresCSRFMitigation(method string) bool {
	switch strings.ToUpper(strings.TrimSpace(method)) {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	default:
		return true
	}
}

func validateCSRFTokens(r *http.Request) bool {
	cookie, err := r.Cookie(csrfCookieNameFromRequest(r))
	if err != nil {
		return false
	}
	headerToken := strings.TrimSpace(r.Header.Get("X-CSRF-Token"))
	cookieToken := strings.TrimSpace(cookie.Value)
	return headerToken != "" && cookieToken != "" && headerToken == cookieToken
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
	csrfToken := ""
	if cookie, err := r.Cookie(csrfCookieNameFromRequest(r)); err == nil {
		csrfToken = strings.TrimSpace(cookie.Value)
	}
	if csrfToken == "" {
		generated, err := appauth.GenerateToken()
		if err != nil {
			respondError(w, http.StatusInternalServerError, err)
			return
		}
		csrfToken = generated
		a.setCSRFCookie(w, csrfToken)
	}
	respondJSON(w, http.StatusOK, models.CurrentUserResponse{User: auth.user, CSRFToken: csrfToken})
}

func (a *API) handleSignOut(w http.ResponseWriter, r *http.Request) {
	auth := currentAuth(r)
	if auth == nil {
		a.clearSessionCookie(w)
		a.clearCSRFCookie(w)
		respondJSON(w, http.StatusUnauthorized, map[string]any{"message": "Autenticacao obrigatoria."})
		return
	}
	if err := a.store.DeleteAuthSessionByTokenHash(r.Context(), auth.tokenHash); err != nil {
		respondError(w, http.StatusInternalServerError, err)
		return
	}
	a.clearSessionCookie(w)
	a.clearCSRFCookie(w)
	a.recordAuditLog(r, models.AuditLogRecord{
		Action:       "auth.session.sign_out",
		ResourceType: "auth_session",
		ResourceID:   auth.session.ID,
		Summary:      "Encerrou a propria sessao no workspace.",
	})
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
	if auth != nil && item.ActorUserID == "" {
		item.ActorUserID = auth.user.ID
	}
	if auth != nil && item.ActorName == "" {
		item.ActorName = auth.user.Name
	}
	if auth != nil && item.ActorRole == "" {
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
	if item.ActorUserID == "" && item.ActorName == "" && item.ActorRole == "" {
		return
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
