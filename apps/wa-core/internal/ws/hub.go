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

const (
	redisChannel          = "pulsehub:events"
	clientQueueSize       = 128
	websocketWriteTimeout = 5 * time.Second
	websocketPongTimeout  = 60 * time.Second
	websocketPingInterval = (websocketPongTimeout * 9) / 10
)

type subscriber chan []byte

type client struct {
	conn   *websocket.Conn
	send   chan []byte
	mu     sync.Mutex
	closed bool
}

func (c *client) enqueue(payload []byte) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return false
	}

	select {
	case c.send <- payload:
		return true
	default:
		return false
	}
}

func (c *client) close() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return
	}
	c.closed = true
	close(c.send)
}

type redisEnvelope struct {
	Source  string          `json:"source"`
	Payload json.RawMessage `json:"payload"`
}

type Hub struct {
	mu          sync.RWMutex
	logger      *slog.Logger
	instanceID  string
	clients     map[*client]struct{}
	subscribers map[subscriber]struct{}
	upgrader    websocket.Upgrader
	redisClient *redis.Client
	pubsub      *redis.PubSub
}

func NewHub(ctx context.Context, logger *slog.Logger, redisURL string) (*Hub, error) {
	hub := &Hub{
		logger:      logger,
		instanceID:  uuid.NewString(),
		clients:     make(map[*client]struct{}),
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
	h.closeClients()
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

	client := &client{
		conn: conn,
		send: make(chan []byte, clientQueueSize),
	}
	h.addClient(client)

	go h.writePump(client)
	h.readPump(client)
}

func (h *Hub) addClient(client *client) {
	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) readPump(client *client) {
	defer h.removeClient(client)

	client.conn.SetReadLimit(1024)
	_ = client.conn.SetReadDeadline(time.Now().Add(websocketPongTimeout))
	client.conn.SetPongHandler(func(string) error {
		return client.conn.SetReadDeadline(time.Now().Add(websocketPongTimeout))
	})

	for {
		if _, _, err := client.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (h *Hub) writePump(client *client) {
	ticker := time.NewTicker(websocketPingInterval)
	defer func() {
		ticker.Stop()
		_ = client.conn.Close()
	}()

	for {
		select {
		case payload, ok := <-client.send:
			_ = client.conn.SetWriteDeadline(time.Now().Add(websocketWriteTimeout))
			if !ok {
				_ = client.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := client.conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				h.removeClient(client)
				return
			}
		case <-ticker.C:
			_ = client.conn.SetWriteDeadline(time.Now().Add(websocketWriteTimeout))
			if err := client.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				h.removeClient(client)
				return
			}
		}
	}
}

func (h *Hub) emitLocal(payload []byte) {
	h.mu.RLock()
	clients := make([]*client, 0, len(h.clients))
	for client := range h.clients {
		clients = append(clients, client)
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

	for _, client := range clients {
		if !client.enqueue(payload) {
			if h.logger != nil {
				h.logger.Warn("dropping slow websocket client")
			}
			h.removeClient(client)
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

func (h *Hub) removeClient(client *client) {
	h.mu.Lock()
	if _, ok := h.clients[client]; ok {
		delete(h.clients, client)
		client.close()
	}
	h.mu.Unlock()
}

func (h *Hub) closeClients() {
	h.mu.Lock()
	clients := make([]*client, 0, len(h.clients))
	for client := range h.clients {
		clients = append(clients, client)
		delete(h.clients, client)
	}
	h.mu.Unlock()

	for _, client := range clients {
		client.close()
	}
}
