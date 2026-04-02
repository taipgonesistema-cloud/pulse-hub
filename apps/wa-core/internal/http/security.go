package httpapi

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type SecurityConfig struct {
	AllowedOrigins []string
}

type rateLimitRule struct {
	Limit  int
	Window time.Duration
}

type rateLimitEntry struct {
	Count   int
	ResetAt time.Time
}

type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]rateLimitEntry
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{buckets: make(map[string]rateLimitEntry)}
}

func (l *rateLimiter) allow(key string, rule rateLimitRule, now time.Time) (bool, int, time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()

	for candidate, entry := range l.buckets {
		if !entry.ResetAt.After(now) {
			delete(l.buckets, candidate)
		}
	}

	entry, ok := l.buckets[key]
	if !ok || !entry.ResetAt.After(now) {
		entry = rateLimitEntry{Count: 0, ResetAt: now.Add(rule.Window)}
	}
	if entry.Count >= rule.Limit {
		remaining := entry.ResetAt.Sub(now)
		if remaining < 0 {
			remaining = 0
		}
		return false, 0, entry.ResetAt
	}

	entry.Count++
	l.buckets[key] = entry
	remaining := rule.Limit - entry.Count
	if remaining < 0 {
		remaining = 0
	}

	return true, remaining, entry.ResetAt
}

func (a *API) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		if isSecureRequest(r) {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

func (a *API) rateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rule, scope := classifyRateLimitRule(r)
		if rule.Limit <= 0 || rule.Window <= 0 {
			next.ServeHTTP(w, r)
			return
		}

		now := time.Now().UTC()
		key := scope + ":" + requestClientIP(r)
		allowed, remaining, resetAt := a.rateLimiter.allow(key, rule, now)
		w.Header().Set("X-RateLimit-Limit", strconv.Itoa(rule.Limit))
		w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
		w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(resetAt.Unix(), 10))
		if !allowed {
			retryAfter := int(resetAt.Sub(now).Seconds())
			if retryAfter < 1 {
				retryAfter = 1
			}
			w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
			respondJSON(w, http.StatusTooManyRequests, map[string]any{"message": "Muitas requisicoes. Aguarde e tente novamente."})
			return
		}

		next.ServeHTTP(w, r)
	})
}

func classifyRateLimitRule(r *http.Request) (rateLimitRule, string) {
	path := r.URL.Path
	method := strings.ToUpper(strings.TrimSpace(r.Method))

	if method == http.MethodOptions {
		return rateLimitRule{}, "options"
	}
	if path == "/health" {
		return rateLimitRule{Limit: 120, Window: time.Minute}, "health"
	}
	if path == "/auth/sign-in" {
		return rateLimitRule{Limit: 5, Window: 10 * time.Minute}, "auth-sign-in"
	}
	if path == "/ws" || isProtectedAssetPath(path) {
		return rateLimitRule{Limit: 120, Window: time.Minute}, "protected-assets"
	}
	if method == http.MethodGet {
		return rateLimitRule{Limit: 240, Window: time.Minute}, "read"
	}
	if strings.Contains(path, "/messages") || strings.Contains(path, "/media") {
		return rateLimitRule{Limit: 30, Window: time.Minute}, "messaging-write"
	}
	return rateLimitRule{Limit: 45, Window: time.Minute}, "write"
}

func requestClientIP(r *http.Request) string {
	remoteAddr := strings.TrimSpace(r.RemoteAddr)
	if remoteAddr == "" {
		return "unknown"
	}
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil && host != "" {
		return host
	}
	return remoteAddr
}

func isSecureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

func normalizeOrigin(value string) string {
	return strings.TrimRight(strings.TrimSpace(value), "/")
}

func isProtectedAssetPath(path string) bool {
	return strings.HasPrefix(path, "/contacts/") && strings.HasSuffix(path, "/photo") ||
		strings.HasPrefix(path, "/messages/") && strings.HasSuffix(path, "/media") ||
		strings.HasPrefix(path, "/whatsapp/sessions/") && strings.HasSuffix(path, "/stream")
}
