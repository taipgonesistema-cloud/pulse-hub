package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	appauth "pulsehub/wa-core/internal/auth"
	httpapi "pulsehub/wa-core/internal/http"
	appinstagram "pulsehub/wa-core/internal/instagram"
	"pulsehub/wa-core/internal/models"
	appstore "pulsehub/wa-core/internal/store"
	"pulsehub/wa-core/internal/whatsapp"
	"pulsehub/wa-core/internal/ws"
)

type config struct {
	Port                     string
	DatabaseURL              string
	RedisURL                 string
	WhatsmeowDSN             string
	AuthEmail                string
	AuthPassword             string
	AuthName                 string
	AuthRole                 string
	AuthCookieName           string
	AuthCSRFCookieName       string
	AuthCookieDomain         string
	AuthCookieSecure         bool
	AuthCookieSameSite       http.SameSite
	InstagramAppID           string
	InstagramAppSecret       string
	InstagramAccessToken     string
	InstagramUserID          string
	CloudinaryCloudName      string
	CloudinaryAPIKey         string
	CloudinaryAPISecret      string
	CloudinaryFolder         string
	InstagramImageHostAPIKey string
	AllowedOrigins           []string
	ShutdownTimeout          time.Duration
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg := loadConfig()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store, err := appstore.OpenPostgres(cfg.DatabaseURL)
	if err != nil {
		logger.Error("open app postgres failed", "error", err)
		os.Exit(1)
	}
	defer func() {
		_ = store.Close()
	}()

	seedPasswordHash, err := appauth.HashPassword(cfg.AuthPassword)
	if err != nil {
		logger.Error("hash seed password failed", "error", err)
		os.Exit(1)
	}
	if _, err := store.EnsureSeedUser(ctx, cfg.AuthEmail, cfg.AuthName, seedPasswordHash, models.AuthRole(cfg.AuthRole)); err != nil {
		logger.Error("ensure seed user failed", "error", err)
		os.Exit(1)
	}

	hub, err := ws.NewHub(ctx, logger, cfg.RedisURL)
	if err != nil {
		logger.Error("create realtime hub failed", "error", err)
		os.Exit(1)
	}
	defer func() {
		_ = hub.Close()
	}()

	manager, err := whatsapp.NewManager(ctx, cfg.WhatsmeowDSN, store, hub, logger)
	if err != nil {
		logger.Error("create whatsapp manager failed", "error", err)
		os.Exit(1)
	}

	instagramClient := appinstagram.NewClient(appinstagram.Config{
		AppID:           cfg.InstagramAppID,
		AppSecret:       cfg.InstagramAppSecret,
		AccessToken:     cfg.InstagramAccessToken,
		UserID:          cfg.InstagramUserID,
		CloudName:       cfg.CloudinaryCloudName,
		CloudAPIKey:     cfg.CloudinaryAPIKey,
		CloudAPISecret:  cfg.CloudinaryAPISecret,
		CloudFolder:     cfg.CloudinaryFolder,
		ImageHostAPIKey: cfg.InstagramImageHostAPIKey,
	})

	if err := manager.Start(ctx); err != nil {
		logger.Error("start whatsapp manager failed", "error", err)
		os.Exit(1)
	}

	router := httpapi.NewRouter(logger, manager, hub, store, instagramClient, httpapi.AuthConfig{
		Email:          cfg.AuthEmail,
		Password:       cfg.AuthPassword,
		Name:           cfg.AuthName,
		Role:           cfg.AuthRole,
		CookieName:     cfg.AuthCookieName,
		CSRFCookieName: cfg.AuthCSRFCookieName,
		CookieDomain:   cfg.AuthCookieDomain,
		CookieSecure:   cfg.AuthCookieSecure,
		CookieSameSite: cfg.AuthCookieSameSite,
	}, httpapi.SecurityConfig{
		AllowedOrigins: cfg.AllowedOrigins,
	})

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		logger.Info(
			"wa-core server listening",
			"addr", server.Addr,
			"postgres_enabled", cfg.DatabaseURL != "",
			"redis_enabled", cfg.RedisURL != "",
		)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("http server failed", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	logger.Info("shutting down wa-core")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}

func loadConfig() config {
	return config{
		Port:                     envOrDefault("PORT", envOrDefault("SERVER_PORT", "3333")),
		DatabaseURL:              envOrDefault("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/pulse_hub?sslmode=disable"),
		RedisURL:                 envOrDefault("REDIS_URL", "redis://localhost:6379/0"),
		WhatsmeowDSN:             envOrDefault("WHATSMEOW_DATABASE_URL", envOrDefault("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/pulse_hub?sslmode=disable")),
		AuthEmail:                envOrDefault("AUTH_SEED_EMAIL", "admin@pulsehub.local"),
		AuthPassword:             envOrDefault("AUTH_SEED_PASSWORD", "PulseHub123!"),
		AuthName:                 envOrDefault("AUTH_SEED_NAME", "Pulse Hub Admin"),
		AuthRole:                 envOrDefault("AUTH_SEED_ROLE", "admin"),
		AuthCookieName:           envOrDefault("AUTH_COOKIE_NAME", "pulse_hub_session"),
		AuthCSRFCookieName:       envOrDefault("AUTH_CSRF_COOKIE_NAME", "pulse_hub_csrf"),
		AuthCookieDomain:         strings.TrimSpace(os.Getenv("AUTH_COOKIE_DOMAIN")),
		AuthCookieSecure:         parseEnvBool("AUTH_COOKIE_SECURE", false),
		AuthCookieSameSite:       parseSameSite(os.Getenv("AUTH_COOKIE_SAME_SITE")),
		InstagramAppID:           envOrDefault("INSTAGRAM_APP_ID", ""),
		InstagramAppSecret:       envOrDefault("INSTAGRAM_APP_SECRET", ""),
		InstagramAccessToken:     envOrDefault("INSTAGRAM_ACCESS_TOKEN", envOrDefault("INSTAGRAM_GRAPH_ACCESS_TOKEN", "")),
		InstagramUserID:          envOrDefault("INSTAGRAM_USER_ID", envOrDefault("INSTAGRAM_GRAPH_USER_ID", "")),
		CloudinaryCloudName:      envOrDefault("CLOUDINARY_CLOUD_NAME", ""),
		CloudinaryAPIKey:         envOrDefault("CLOUDINARY_API_KEY", ""),
		CloudinaryAPISecret:      envOrDefault("CLOUDINARY_API_SECRET", ""),
		CloudinaryFolder:         envOrDefault("CLOUDINARY_FOLDER", "ether-command"),
		InstagramImageHostAPIKey: envOrDefault("INSTAGRAM_IMAGE_HOST_API_KEY", envOrDefault("FREEIMAGE_HOST_API_KEY", "")),
		AllowedOrigins:           loadAllowedOrigins(),
		ShutdownTimeout:          12 * time.Second,
	}
}

func loadAllowedOrigins() []string {
	configured := envOrDefault(
		"CORS_ALLOWED_ORIGINS",
		envOrDefault(
			"APP_ORIGIN",
			envOrDefault(
				"FRONTEND_URL",
				envOrDefault("NEXT_PUBLIC_APP_URL", ""),
			),
		),
	)
	if configured == "" {
		return []string{
			"http://localhost:3000",
			"http://127.0.0.1:3000",
			"http://localhost:3001",
			"http://127.0.0.1:3001",
			"http://localhost:3002",
			"http://127.0.0.1:3002",
		}
	}

	parts := strings.Split(configured, ",")
	origins := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		origin := strings.TrimRight(strings.TrimSpace(part), "/")
		if origin == "" {
			continue
		}
		if _, ok := seen[origin]; ok {
			continue
		}
		seen[origin] = struct{}{}
		origins = append(origins, origin)
	}
	return origins
}

func envOrDefault(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok && value != "" {
		return value
	}
	return fallback
}

func parseEnvBool(key string, fallback bool) bool {
	value, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func parseSameSite(value string) http.SameSite {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "strict":
		return http.SameSiteStrictMode
	case "none":
		return http.SameSiteNoneMode
	default:
		return http.SameSiteLaxMode
	}
}
