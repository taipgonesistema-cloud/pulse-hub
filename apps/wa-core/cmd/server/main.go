package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	appauth "pulsehub/wa-core/internal/auth"
	httpapi "pulsehub/wa-core/internal/http"
	"pulsehub/wa-core/internal/models"
	appstore "pulsehub/wa-core/internal/store"
	"pulsehub/wa-core/internal/whatsapp"
	"pulsehub/wa-core/internal/ws"
)

type config struct {
	Port            string
	DatabaseURL     string
	RedisURL        string
	WhatsmeowDSN    string
	AuthEmail       string
	AuthPassword    string
	AuthName        string
	AuthRole        string
	ShutdownTimeout time.Duration
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

	if err := manager.Start(ctx); err != nil {
		logger.Error("start whatsapp manager failed", "error", err)
		os.Exit(1)
	}

	router := httpapi.NewRouter(logger, manager, hub, store, httpapi.AuthConfig{
		Email:    cfg.AuthEmail,
		Password: cfg.AuthPassword,
		Name:     cfg.AuthName,
		Role:     cfg.AuthRole,
	})

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
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
		Port:            envOrDefault("PORT", envOrDefault("SERVER_PORT", "3333")),
		DatabaseURL:     envOrDefault("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/pulse_hub?sslmode=disable"),
		RedisURL:        envOrDefault("REDIS_URL", "redis://localhost:6379/0"),
		WhatsmeowDSN:    envOrDefault("WHATSMEOW_DATABASE_URL", envOrDefault("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/pulse_hub?sslmode=disable")),
		AuthEmail:       envOrDefault("AUTH_SEED_EMAIL", "admin@pulsehub.local"),
		AuthPassword:    envOrDefault("AUTH_SEED_PASSWORD", "PulseHub123!"),
		AuthName:        envOrDefault("AUTH_SEED_NAME", "Pulse Hub Admin"),
		AuthRole:        envOrDefault("AUTH_SEED_ROLE", "admin"),
		ShutdownTimeout: 12 * time.Second,
	}
}

func envOrDefault(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok && value != "" {
		return value
	}
	return fallback
}
