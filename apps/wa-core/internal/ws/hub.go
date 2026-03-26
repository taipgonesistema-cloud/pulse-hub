package ws

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	redis "github.com/redis/go-redis/v9"

	"pulsehub/wa-core/internal/models"
)

const redisChannel = "pulsehub:events"

type subscriber chan []byte

type redisEnvelope struct {
	Source  string          `json:"source"`
	Payload json.RawMessage `json:"payload"`
}

type Hub struct {
	mu          sync.RWMutex
	logger      *slog.Logger
	instanceID  string
	clients     map[*websocket.Conn]struct{}
	subscribers map[subscriber]struct{}
	upgrader    websocket.Upgrader
	redisClient *redis.Client
	pubsub      *redis.PubSub
}

func NewHub(ctx context.Context, logger *slog.Logger, redisURL string) (*Hub, error) {
	hub := &Hub{
		logger:      logger,
		instanceID:  uuid.NewString(),
		clients:     make(map[*websocket.Conn]struct{}),
		subscribers: make(map[subscriber]struct{}),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(_ *http.Request) bool {
				return true
			},
		},
	}

	if strings.TrimSpace(redisURL) == "" {
		return hub, nil
	}

	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}

	client := redis.NewClient(options)
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		return nil, err
	}

	pubsub := client.Subscribe(ctx, redisChannel)
	if _, err := pubsub.Receive(ctx); err != nil {
		_ = pubsub.Close()
		_ = client.Close()
		return nil, err
	}

	hub.redisClient = client
	hub.pubsub = pubsub

	go hub.consumeRedis(ctx, pubsub.Channel())

	return hub, nil
}

func (h *Hub) Close() error {
	if h.pubsub != nil {
		_ = h.pubsub.Close()
	}
	if h.redisClient != nil {
		return h.redisClient.Close()
	}
	return nil
}

func (h *Hub) Broadcast(event models.RealtimeEvent) {
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}

	h.emitLocal(payload)

	if h.redisClient == nil {
		return
	}

	envelopePayload, err := json.Marshal(redisEnvelope{Source: h.instanceID, Payload: payload})
	if err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := h.redisClient.Publish(ctx, redisChannel, envelopePayload).Err(); err != nil && h.logger != nil {
		h.logger.Warn("redis publish failed", "error", err)
	}
}

func (h *Hub) Subscribe() (<-chan []byte, func()) {
	ch := make(subscriber, 32)
	h.mu.Lock()
	h.subscribers[ch] = struct{}{}
	h.mu.Unlock()

	return ch, func() {
		h.mu.Lock()
		delete(h.subscribers, ch)
		h.mu.Unlock()
	}
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	h.mu.Lock()
	h.clients[conn] = struct{}{}
	h.mu.Unlock()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			h.removeClient(conn)
			_ = conn.Close()
			return
		}
	}
}

func (h *Hub) emitLocal(payload []byte) {
	h.mu.RLock()
	clients := make([]*websocket.Conn, 0, len(h.clients))
	for conn := range h.clients {
		clients = append(clients, conn)
	}
	subscribers := make([]subscriber, 0, len(h.subscribers))
	for ch := range h.subscribers {
		subscribers = append(subscribers, ch)
	}
	h.mu.RUnlock()

	for _, ch := range subscribers {
		select {
		case ch <- payload:
		default:
		}
	}

	for _, conn := range clients {
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
			h.removeClient(conn)
			_ = conn.Close()
		}
	}
}

func (h *Hub) consumeRedis(ctx context.Context, messages <-chan *redis.Message) {
	for {
		select {
		case <-ctx.Done():
			return
		case message, ok := <-messages:
			if !ok || message == nil {
				return
			}

			var envelope redisEnvelope
			if err := json.Unmarshal([]byte(message.Payload), &envelope); err != nil {
				if h.logger != nil {
					h.logger.Warn("invalid redis envelope", "error", err)
				}
				continue
			}
			if envelope.Source == h.instanceID || len(envelope.Payload) == 0 {
				continue
			}

			h.emitLocal(envelope.Payload)
		}
	}
}

func (h *Hub) removeClient(conn *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, conn)
	h.mu.Unlock()
}
