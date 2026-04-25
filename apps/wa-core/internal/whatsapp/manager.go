package whatsapp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/lib/pq"
	qrcode "github.com/skip2/go-qrcode"
	waProto "google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"go.mau.fi/whatsmeow"
	waCommon "go.mau.fi/whatsmeow/proto/waCommon"
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	waHistorySync "go.mau.fi/whatsmeow/proto/waHistorySync"
	wmstore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	appstateevents "go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"

	"pulsehub/wa-core/internal/models"
	appstore "pulsehub/wa-core/internal/store"
	"pulsehub/wa-core/internal/ws"
)

type Manager struct {
	mu                sync.RWMutex
	logger            *slog.Logger
	store             *appstore.Store
	hub               *ws.Hub
	container         *sqlstore.Container
	client            *whatsmeow.Client
	connecting        bool
	runtimes          map[string]*sessionRuntime
	lastGroupNameSync time.Time
}

type sessionRuntime struct {
	client     *whatsmeow.Client
	connecting bool
}

func NewManager(
	ctx context.Context,
	whatsmeowDSN string,
	store *appstore.Store,
	hub *ws.Hub,
	logger *slog.Logger,
) (*Manager, error) {
	sqlstore.PostgresArrayWrapper = pq.Array
	container, err := sqlstore.New(ctx, "postgres", whatsmeowDSN, waLog.Stdout("Database", "INFO", true))
	if err != nil {
		return nil, fmt.Errorf("create whatsmeow sqlstore: %w", err)
	}

	manager := &Manager{
		logger:    logger,
		store:     store,
		hub:       hub,
		container: container,
		runtimes:  make(map[string]*sessionRuntime),
	}

	return manager, nil
}

func normalizeSessionID(sessionID string) string {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return models.DefaultSessionID
	}
	return sessionID
}

func (m *Manager) runtimeForSession(sessionID string) *sessionRuntime {
	sessionID = normalizeSessionID(sessionID)
	runtime, ok := m.runtimes[sessionID]
	if !ok {
		runtime = &sessionRuntime{}
		m.runtimes[sessionID] = runtime
	}
	return runtime
}

func (m *Manager) clientForSession(sessionID string) *whatsmeow.Client {
	m.mu.RLock()
	defer m.mu.RUnlock()
	runtime := m.runtimes[normalizeSessionID(sessionID)]
	if runtime == nil {
		return nil
	}
	return runtime.client
}

func (m *Manager) isSessionConnecting(sessionID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	runtime := m.runtimes[normalizeSessionID(sessionID)]
	return runtime != nil && runtime.connecting
}

func (m *Manager) setConnectingForSession(sessionID string, value bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runtimeForSession(sessionID).connecting = value
}

func (m *Manager) Start(ctx context.Context) error {
	sessions, err := m.store.ListSessions(ctx)
	if err != nil {
		return err
	}
	for _, session := range sessions {
		if strings.TrimSpace(session.DeviceJID) != "" {
			if _, err := m.ensureClientForSession(ctx, session.ID); err != nil {
				return err
			}
			client := m.clientForSession(session.ID)
			if client != nil && client.Store != nil && client.Store.ID != nil {
				go func(sessionID string) {
					if _, err := m.InitSession(context.Background(), models.SessionInitRequest{ID: sessionID}); err != nil {
						m.logger.Error("auto reconnect failed", "session_id", sessionID, "error", err)
					}
				}(session.ID)
				continue
			}
		}

		if session.Status == models.SessionStatusActive || session.Status == models.SessionStatusSyncing || session.Status == models.SessionStatusInitializing {
			_ = m.updateSessionByID(ctx, session.ID, func(current *models.Session) {
				current.Status = models.SessionStatusDisconnected
				current.LastError = "Sessao aguardando nova conexao."
				current.QRCode = ""
				current.QRCodeDataURL = ""
			})
		}
	}

	return nil
}

func (m *Manager) CreateOrUpdateSession(ctx context.Context, req models.SessionInitRequest) (*models.Session, error) {
	sessionID := strings.TrimSpace(req.ID)
	name := strings.TrimSpace(req.Name)
	phone := strings.TrimSpace(req.PhoneNumber)
	channel := strings.TrimSpace(req.ChannelName)

	now := models.NowString()
	session, err := m.store.GetSessionByID(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	if session == nil {
		if name == "" {
			name = "WhatsApp principal"
		}
		if phone == "" {
			phone = "Aguardando conexao"
		}
		if channel == "" {
			channel = "WhatsApp"
		}
		session = &models.Session{
			ID:          normalizeSessionID(sessionID),
			Name:        name,
			PhoneNumber: phone,
			ChannelID:   slugID("channel", channel),
			ChannelName: channel,
			Status:      models.SessionStatusIdle,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
	} else {
		if name != "" {
			session.Name = name
		} else if strings.TrimSpace(session.Name) == "" {
			session.Name = "WhatsApp principal"
		}
		if phone != "" {
			session.PhoneNumber = phone
		} else if strings.TrimSpace(session.PhoneNumber) == "" {
			session.PhoneNumber = "Aguardando conexao"
		}
		if channel != "" {
			session.ChannelName = channel
			session.ChannelID = slugID("channel", channel)
		} else if strings.TrimSpace(session.ChannelName) == "" {
			session.ChannelName = "WhatsApp"
			session.ChannelID = slugID("channel", session.ChannelName)
		}
		session.UpdatedAt = now
		if session.Status == "" {
			session.Status = models.SessionStatusIdle
		}
	}

	if err := m.store.SaveSession(ctx, *session); err != nil {
		return nil, err
	}

	updated, err := m.store.GetSessionByID(ctx, session.ID)
	if err != nil {
		return nil, err
	}

	m.broadcast(models.RealtimeEvent{
		SessionID:  session.ID,
		Kind:       "connection",
		Status:     string(updated.Status),
		OccurredAt: models.NowString(),
	})

	return updated, nil
}

func (m *Manager) InitSession(ctx context.Context, req models.SessionInitRequest) (*models.Session, error) {
	sessionID := normalizeSessionID(req.ID)
	req.ID = sessionID
	_, err := m.CreateOrUpdateSession(ctx, req)
	if err != nil {
		return nil, err
	}

	if _, err := m.ensureClientForSession(ctx, sessionID); err != nil {
		return nil, err
	}

	client := m.clientForSession(sessionID)
	if client == nil {
		return nil, errors.New("session client is not initialized")
	}
	if client.IsConnected() {
		_ = m.updateSessionByID(ctx, sessionID, func(current *models.Session) {
			current.Status = models.SessionStatusActive
			current.LastError = ""
			current.ConnectedAt = models.NowString()
		})
		return m.store.GetSessionByID(ctx, sessionID)
	}
	if m.isSessionConnecting(sessionID) {
		return m.store.GetSessionByID(ctx, sessionID)
	}
	m.setConnectingForSession(sessionID, true)

	if client.Store != nil && client.Store.ID == nil {
		qrChan, err := client.GetQRChannel(context.Background())
		if err != nil {
			m.setConnectingForSession(sessionID, false)
			_ = m.failSessionByID(ctx, sessionID, fmt.Sprintf("falha ao abrir QR channel: %v", err))
			return nil, err
		}
		go m.consumeQRChannel(sessionID, qrChan)
	}

	_ = m.updateSessionByID(ctx, sessionID, func(current *models.Session) {
		current.Status = models.SessionStatusInitializing
		current.LastError = ""
	})

	go func() {
		defer m.setConnectingForSession(sessionID, false)
		if err := client.Connect(); err != nil {
			m.logger.Error("whatsmeow connect failed", "session_id", sessionID, "error", err)
			_ = m.failSessionByID(context.Background(), sessionID, err.Error())
		}
	}()

	return m.store.GetSessionByID(ctx, sessionID)
}

func (m *Manager) Disconnect(ctx context.Context) (*models.Session, error) {
	return m.DisconnectByID(ctx, models.DefaultSessionID)
}

func (m *Manager) DisconnectByID(ctx context.Context, sessionID string) (*models.Session, error) {
	client := m.clientForSession(sessionID)

	if client != nil && client.IsConnected() {
		client.Disconnect()
	}

	if err := m.updateSessionByID(ctx, sessionID, func(current *models.Session) {
		current.Status = models.SessionStatusDisconnected
		current.QRCode = ""
		current.QRCodeDataURL = ""
		current.LastError = ""
	}); err != nil {
		return nil, err
	}

	m.broadcast(models.RealtimeEvent{
		SessionID:  sessionID,
		Kind:       "connection",
		Status:     string(models.SessionStatusDisconnected),
		OccurredAt: models.NowString(),
	})

	return m.store.GetSessionByID(ctx, sessionID)
}

func (m *Manager) DeleteSessionByID(ctx context.Context, sessionID string) (*models.Session, error) {
	sessionID = normalizeSessionID(sessionID)
	session, err := m.store.GetSessionByID(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, nil
	}

	client := m.clientForSession(sessionID)
	if client != nil && client.IsConnected() {
		client.Disconnect()
	}

	if strings.TrimSpace(session.DeviceJID) != "" {
		jid, err := types.ParseJID(session.DeviceJID)
		if err == nil {
			deviceStore, err := m.container.GetDevice(ctx, jid)
			if err != nil {
				return nil, fmt.Errorf("get device for session %s: %w", sessionID, err)
			}
			if deviceStore != nil {
				if err := deviceStore.Delete(ctx); err != nil {
					return nil, fmt.Errorf("delete device for session %s: %w", sessionID, err)
				}
			}
		}
	}

	if err := m.store.DeleteSessionByID(ctx, sessionID); err != nil {
		return nil, err
	}

	m.mu.Lock()
	delete(m.runtimes, sessionID)
	if sessionID == models.DefaultSessionID {
		m.client = nil
		m.connecting = false
	}
	m.mu.Unlock()

	m.broadcast(models.RealtimeEvent{
		SessionID:  sessionID,
		Kind:       "connection",
		Status:     string(models.SessionStatusDisconnected),
		OccurredAt: models.NowString(),
	})

	return session, nil
}

func (m *Manager) GetSession(ctx context.Context) (*models.Session, error) {
	return m.store.GetSession(ctx)
}

func (m *Manager) GetSessionByID(ctx context.Context, sessionID string) (*models.Session, error) {
	return m.store.GetSessionByID(ctx, sessionID)
}

func (m *Manager) ListSessions(ctx context.Context) ([]models.Session, error) {
	return m.store.ListSessions(ctx)
}

func (m *Manager) GetQR(ctx context.Context) (*models.SessionQRResponse, error) {
	return m.GetQRByID(ctx, models.DefaultSessionID)
}

func (m *Manager) GetQRByID(ctx context.Context, sessionID string) (*models.SessionQRResponse, error) {
	session, err := m.store.GetSessionByID(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return &models.SessionQRResponse{Status: models.SessionStatusIdle}, nil
	}

	response := &models.SessionQRResponse{
		Status:       session.Status,
		Code:         session.QRCode,
		ImageDataURL: session.QRCodeDataURL,
	}
	if session.Status == models.SessionStatusQRReady && session.QRCode != "" {
		response.ExpiresInSeconds = 30
	}
	return response, nil
}

func (m *Manager) GetStatus(ctx context.Context) (*models.SessionStatusResponse, error) {
	return m.GetStatusByID(ctx, models.DefaultSessionID)
}

func (m *Manager) GetStatusByID(ctx context.Context, sessionID string) (*models.SessionStatusResponse, error) {
	session, err := m.store.GetSessionByID(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return &models.SessionStatusResponse{Status: models.SessionStatusIdle}, nil
	}

	client := m.clientForSession(sessionID)
	connected := client != nil && client.IsConnected()
	authenticated := client != nil && client.IsLoggedIn()

	return &models.SessionStatusResponse{
		Status:        session.Status,
		Connected:     connected,
		Authenticated: authenticated,
		HasQR:         session.QRCodeDataURL != "" || session.QRCode != "",
		DeviceJID:     session.DeviceJID,
		BusinessName:  session.BusinessName,
		Platform:      session.Platform,
		LastError:     session.LastError,
	}, nil
}

func (m *Manager) SyncContacts(ctx context.Context) error {
	return m.SyncContactsBySession(ctx, models.DefaultSessionID)
}

func (m *Manager) SyncContactsBySession(ctx context.Context, sessionID string) error {
	client := m.clientForSession(sessionID)
	if client == nil || client.Store == nil || client.Store.Contacts == nil {
		return nil
	}

	contacts, err := client.Store.Contacts.GetAllContacts(ctx)
	if err != nil {
		return fmt.Errorf("get contacts from sqlstore: %w", err)
	}

	items := make([]models.Contact, 0, len(contacts))
	for jid, info := range contacts {
		jidText := jid.String()
		if jidText == "" || shouldIgnoreJID(jidText) {
			continue
		}

		existing, err := m.store.GetContact(ctx, jidText)
		if err != nil {
			return err
		}

		contact := models.Contact{
			JID:          jidText,
			Phone:        fallbackPhone(jidText, info.RedactedPhone),
			FirstName:    info.FirstName,
			FullName:     info.FullName,
			PushName:     info.PushName,
			BusinessName: info.BusinessName,
			DisplayName:  contactDisplayName(jidText, info.FirstName, info.FullName, info.PushName, info.BusinessName, info.RedactedPhone),
			UpdatedAt:    models.NowString(),
		}
		if existing != nil {
			contact.PhotoID = existing.PhotoID
			contact.PhotoURL = existing.PhotoURL
		}
		items = append(items, contact)
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].DisplayName < items[j].DisplayName
	})

	for _, contact := range items {
		if err := m.store.UpsertContact(ctx, contact); err != nil {
			return err
		}
	}

	return nil
}

func (m *Manager) SyncGroupNames(ctx context.Context) error {
	return m.SyncGroupNamesBySession(ctx, models.DefaultSessionID)
}

func (m *Manager) SyncGroupNamesBySession(ctx context.Context, sessionID string) error {
	client := m.clientForSession(sessionID)
	connected := client != nil && client.IsConnected()
	if !connected {
		return nil
	}

	groups, err := client.GetJoinedGroups(ctx)
	if err != nil {
		return fmt.Errorf("get joined groups: %w", err)
	}

	for _, group := range groups {
		if group == nil || group.JID.IsEmpty() {
			continue
		}

		name := normalizePreferredName(group.Name)
		if name == "" || !isMeaningfulDisplayName(name, group.JID.String()) {
			continue
		}

		if err := m.upsertConversationIdentityBySession(ctx, sessionID, group.JID.String(), name, true); err != nil {
			m.logger.Warn("sync joined group name failed", "jid", group.JID.String(), "error", err)
		}
	}

	m.mu.Lock()
	m.lastGroupNameSync = time.Now()
	m.mu.Unlock()

	return nil
}

func (m *Manager) ListContacts(ctx context.Context) ([]models.Contact, error) {
	if err := m.SyncContacts(ctx); err != nil {
		m.logger.Warn("sync contacts failed", "error", err)
	}
	return m.store.ListContacts(ctx)
}

func (m *Manager) GetProfilePhoto(ctx context.Context, jid string, forceRefresh bool) (*models.PhotoResponse, error) {
	return m.GetProfilePhotoBySession(ctx, models.DefaultSessionID, jid, forceRefresh)
}

func (m *Manager) GetProfilePhotoBySession(ctx context.Context, sessionID, jid string, forceRefresh bool) (*models.PhotoResponse, error) {
	canonicalJID, err := m.ResolvePhotoJIDBySession(ctx, sessionID, jid)
	if err != nil {
		return nil, err
	}

	if err := m.refreshProfilePhotoBySession(ctx, sessionID, canonicalJID, "", forceRefresh); err != nil {
		var unauthorized bool
		if errors.Is(err, whatsmeow.ErrProfilePictureUnauthorized) || errors.Is(err, whatsmeow.ErrProfilePictureNotSet) {
			unauthorized = true
		}
		if !unauthorized {
			return nil, err
		}
	}

	contact, err := m.store.GetContact(ctx, canonicalJID)
	if err != nil {
		return nil, err
	}
	if contact == nil {
		contact = &models.Contact{JID: canonicalJID}
	}

	return &models.PhotoResponse{
		JID:          jid,
		CanonicalJID: canonicalJID,
		PhotoID:      contact.PhotoID,
		PhotoURL:     contact.PhotoURL,
		Cached:       contact.PhotoURL != "",
	}, nil
}

func (m *Manager) ListChats(ctx context.Context) ([]models.Chat, error) {
	return m.ListChatsBySession(ctx, models.DefaultSessionID)
}

func (m *Manager) ListChatsBySession(ctx context.Context, sessionID string) ([]models.Chat, error) {
	chats, err := m.store.ListChatsBySession(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	if m.shouldRefreshGroupNamesForSession(sessionID, chats) {
		if err := m.SyncGroupNamesBySession(ctx, sessionID); err != nil {
			m.logger.Warn("sync group names before list chats failed", "error", err)
		} else {
			refreshedChats, refreshErr := m.store.ListChatsBySession(ctx, sessionID)
			if refreshErr == nil {
				chats = refreshedChats
			}
		}
	}

	return chats, nil
}

func (m *Manager) ListChatsPageBySession(ctx context.Context, sessionID string, limit int, cursorSortAt, cursorName, cursorJID string) ([]models.Chat, error) {
	chats, err := m.store.ListChatsBySessionPage(ctx, sessionID, limit, cursorSortAt, cursorName, cursorJID)
	if err != nil {
		return nil, err
	}

	if m.shouldRefreshGroupNamesForSession(sessionID, chats) {
		if err := m.SyncGroupNamesBySession(ctx, sessionID); err != nil {
			m.logger.Warn("sync group names before list chat page failed", "error", err)
		} else {
			refreshedChats, refreshErr := m.store.ListChatsBySessionPage(ctx, sessionID, limit, cursorSortAt, cursorName, cursorJID)
			if refreshErr == nil {
				chats = refreshedChats
			}
		}
	}

	return chats, nil
}

func (m *Manager) shouldRefreshGroupNames(chats []models.Chat) bool {
	return m.shouldRefreshGroupNamesForSession(models.DefaultSessionID, chats)
}

func (m *Manager) shouldRefreshGroupNamesForSession(sessionID string, chats []models.Chat) bool {
	m.mu.RLock()
	lastSync := m.lastGroupNameSync
	m.mu.RUnlock()
	client := m.clientForSession(sessionID)
	connected := client != nil && client.IsConnected()

	if !connected || time.Since(lastSync) < 5*time.Minute {
		return false
	}

	for _, chat := range chats {
		if !strings.HasSuffix(chat.JID, "@g.us") {
			continue
		}
		if !isMeaningfulDisplayName(chat.Name, chat.JID) {
			return true
		}
	}

	return false
}

func (m *Manager) ListMessages(ctx context.Context, chatJID string) ([]models.Message, error) {
	return m.ListMessagesBySession(ctx, models.DefaultSessionID, chatJID)
}

func (m *Manager) ListMessagesBySession(ctx context.Context, sessionID, chatJID string) ([]models.Message, error) {
	resolved, err := m.ResolveConversationJIDBySession(ctx, sessionID, chatJID)
	if err != nil {
		return nil, err
	}
	if resolved == chatJID {
		messages, err := m.store.ListMessagesByChatForSession(ctx, sessionID, chatJID)
		if err != nil {
			return nil, err
		}
		return filterRenderableMessages(messages), nil
	}

	primary, err := m.store.ListMessagesByChatForSession(ctx, sessionID, resolved)
	if err != nil {
		return nil, err
	}
	secondary, err := m.store.ListMessagesByChatForSession(ctx, sessionID, chatJID)
	if err != nil {
		return nil, err
	}
	return filterRenderableMessages(mergeMessages(primary, secondary)), nil
}

func (m *Manager) ListMessagesPageBySession(ctx context.Context, sessionID, chatJID string, limit int, before string) ([]models.Message, error) {
	resolved, err := m.ResolveConversationJIDBySession(ctx, sessionID, chatJID)
	if err != nil {
		return nil, err
	}
	if resolved == chatJID {
		messages, err := m.store.ListMessagesByChatForSessionPage(ctx, sessionID, chatJID, limit, before)
		if err != nil {
			return nil, err
		}
		return filterRenderableMessages(messages), nil
	}

	primary, err := m.store.ListMessagesByChatForSessionPage(ctx, sessionID, resolved, limit, before)
	if err != nil {
		return nil, err
	}
	secondary, err := m.store.ListMessagesByChatForSessionPage(ctx, sessionID, chatJID, limit, before)
	if err != nil {
		return nil, err
	}
	return limitLatestMessages(filterRenderableMessages(mergeMessages(primary, secondary)), limit), nil
}

func (m *Manager) ListRecentMessagesBySession(ctx context.Context, sessionID, chatJID string, since string, limit int) ([]models.Message, error) {
	resolved, err := m.ResolveConversationJIDBySession(ctx, sessionID, chatJID)
	if err != nil {
		return nil, err
	}
	if resolved == chatJID {
		messages, err := m.store.ListMessagesByChatForSessionSince(ctx, sessionID, chatJID, since, limit)
		if err != nil {
			return nil, err
		}
		return filterRenderableMessages(messages), nil
	}

	primary, err := m.store.ListMessagesByChatForSessionSince(ctx, sessionID, resolved, since, limit)
	if err != nil {
		return nil, err
	}
	secondary, err := m.store.ListMessagesByChatForSessionSince(ctx, sessionID, chatJID, since, limit)
	if err != nil {
		return nil, err
	}
	return limitLatestMessages(filterRenderableMessages(mergeMessages(primary, secondary)), limit), nil
}

func (m *Manager) ResolveConversationJID(ctx context.Context, chatJID string) (string, error) {
	return m.ResolveConversationJIDBySession(ctx, models.DefaultSessionID, chatJID)
}

func (m *Manager) ResolveConversationJIDBySession(ctx context.Context, sessionID, chatJID string) (string, error) {
	parsed, err := types.ParseJID(strings.TrimSpace(chatJID))
	if err != nil {
		return "", fmt.Errorf("invalid jid: %w", err)
	}
	parsed = parsed.ToNonAD()

	client := m.clientForSession(sessionID)
	if client == nil || client.Store == nil {
		return parsed.String(), nil
	}

	alt, err := client.Store.GetAltJID(ctx, parsed)
	if err != nil {
		return "", fmt.Errorf("resolve chat jid: %w", err)
	}
	if !alt.IsEmpty() {
		return alt.ToNonAD().String(), nil
	}
	return parsed.String(), nil
}

func (m *Manager) CanonicalConversationJID(ctx context.Context, chatJID string) (string, error) {
	return m.CanonicalConversationJIDBySession(ctx, models.DefaultSessionID, chatJID)
}

func (m *Manager) CanonicalConversationJIDBySession(ctx context.Context, sessionID, chatJID string) (string, error) {
	parsed, err := types.ParseJID(strings.TrimSpace(chatJID))
	if err != nil {
		return "", fmt.Errorf("invalid jid: %w", err)
	}
	parsed = parsed.ToNonAD()

	if parsed.Server != types.HiddenUserServer {
		return parsed.String(), nil
	}

	client := m.clientForSession(sessionID)
	if client == nil || client.Store == nil || client.Store.LIDs == nil {
		return parsed.String(), nil
	}

	pn, err := client.Store.LIDs.GetPNForLID(ctx, parsed)
	if err != nil {
		return "", fmt.Errorf("resolve canonical jid: %w", err)
	}
	if !pn.IsEmpty() {
		return pn.ToNonAD().String(), nil
	}

	return parsed.String(), nil
}

func (m *Manager) ResolvePhotoJID(ctx context.Context, jid string) (string, error) {
	return m.ResolvePhotoJIDBySession(ctx, models.DefaultSessionID, jid)
}

func (m *Manager) ResolvePhotoJIDBySession(ctx context.Context, sessionID, jid string) (string, error) {
	canonical, err := m.CanonicalConversationJIDBySession(ctx, sessionID, jid)
	if err == nil && canonical != "" {
		return canonical, nil
	}
	resolved, resolveErr := m.ResolveConversationJIDBySession(ctx, sessionID, jid)
	if resolveErr == nil && resolved != "" {
		return resolved, nil
	}
	parsed, parseErr := types.ParseJID(strings.TrimSpace(jid))
	if parseErr != nil {
		if err != nil {
			return "", err
		}
		return "", resolveErr
	}
	return parsed.ToNonAD().String(), nil
}

func (m *Manager) SendText(ctx context.Context, req models.SendTextRequest) (*models.Message, error) {
	return m.SendTextBySession(ctx, models.DefaultSessionID, req)
}

func (m *Manager) SendTextBySession(ctx context.Context, sessionID string, req models.SendTextRequest) (*models.Message, error) {
	text := strings.TrimSpace(req.Text)
	if text == "" {
		return nil, errors.New("message text is required")
	}

	parsedJID, err := types.ParseJID(strings.TrimSpace(req.JID))
	if err != nil {
		return nil, fmt.Errorf("invalid jid: %w", err)
	}
	parsedJID = parsedJID.ToNonAD()
	if err := validateSendableJID(parsedJID); err != nil {
		return nil, err
	}

	client := m.clientForSession(sessionID)
	connected := client != nil && client.IsConnected()
	if !connected {
		return nil, errors.New("session is not connected")
	}

	normalizedJID, err := normalizeSendJID(ctx, client, parsedJID)
	if err != nil {
		return nil, err
	}

	contextInfo, err := m.buildReplyContextBySession(ctx, sessionID, normalizedJID.String(), req.ReplyToMessageID)
	if err != nil {
		return nil, err
	}

	messageProto := buildTextMessageProto(text, contextInfo)

	messageID := types.MessageID(client.GenerateMessageID())
	resp, err := client.SendMessage(
		ctx,
		normalizedJID,
		messageProto,
		whatsmeow.SendRequestExtra{ID: messageID},
	)
	if err != nil {
		return nil, fmt.Errorf("send message: %w", err)
	}

	author := "Operador"
	message := models.Message{
		SessionID: normalizeSessionID(sessionID),
		ID:        string(resp.ID),
		ChatJID:   normalizedJID.String(),
		SenderJID: ownDeviceJID(client),
		Author:    author,
		FromMe:    true,
		AckStatus: "sent",
		Kind:      "text",
		Text:      text,
		RawJSON:   marshalProto(messageProto),
		Timestamp: resp.Timestamp.UTC().Format(time.RFC3339),
	}

	if err := m.ensureChatRecord(ctx, sessionID, normalizedJID.String(), text, resp.Timestamp, true); err != nil {
		return nil, err
	}
	created, err := m.store.SaveMessageBySession(ctx, sessionID, message)
	if err != nil {
		return nil, err
	}

	if created {
		m.broadcast(models.RealtimeEvent{
			SessionID:  normalizeSessionID(sessionID),
			Kind:       "message.new",
			ChatJID:    message.ChatJID,
			MessageID:  message.ID,
			Direction:  "outgoing",
			Text:       message.Text,
			Payload:    messageRealtimePayload(message),
			OccurredAt: message.Timestamp,
		})
	}

	return &message, nil
}

func (m *Manager) SendMedia(ctx context.Context, req models.SendMediaRequest) (*models.Message, error) {
	return m.SendMediaBySession(ctx, models.DefaultSessionID, req)
}

func (m *Manager) SendMediaBySession(ctx context.Context, sessionID string, req models.SendMediaRequest) (*models.Message, error) {
	if len(req.Data) == 0 {
		return nil, errors.New("media file is required")
	}

	parsedJID, err := types.ParseJID(strings.TrimSpace(req.JID))
	if err != nil {
		return nil, fmt.Errorf("invalid jid: %w", err)
	}
	parsedJID = parsedJID.ToNonAD()
	if err := validateSendableJID(parsedJID); err != nil {
		return nil, err
	}

	client := m.clientForSession(sessionID)
	connected := client != nil && client.IsConnected()
	if !connected {
		return nil, errors.New("session is not connected")
	}

	normalizedJID, err := normalizeSendJID(ctx, client, parsedJID)
	if err != nil {
		return nil, err
	}

	messageProto, kind, mimeType, fileName, displayText, err := buildUploadMessage(client, req)
	if err != nil {
		return nil, err
	}

	contextInfo, err := m.buildReplyContextBySession(ctx, sessionID, normalizedJID.String(), req.ReplyToMessageID)
	if err != nil {
		return nil, err
	}
	applyContextInfoToMessage(messageProto, contextInfo)

	messageID := types.MessageID(client.GenerateMessageID())
	resp, err := client.SendMessage(
		ctx,
		normalizedJID,
		messageProto,
		whatsmeow.SendRequestExtra{ID: messageID},
	)
	if err != nil {
		return nil, fmt.Errorf("send media: %w", err)
	}

	message := models.Message{
		SessionID: normalizeSessionID(sessionID),
		ID:        string(resp.ID),
		ChatJID:   normalizedJID.String(),
		SenderJID: ownDeviceJID(client),
		Author:    "Operador",
		FromMe:    true,
		AckStatus: "sent",
		Kind:      kind,
		MimeType:  mimeType,
		FileName:  fileName,
		Text:      displayText,
		RawJSON:   marshalProto(messageProto),
		Timestamp: resp.Timestamp.UTC().Format(time.RFC3339),
	}

	if err := m.ensureChatRecord(ctx, sessionID, normalizedJID.String(), displayText, resp.Timestamp, true); err != nil {
		return nil, err
	}
	created, err := m.store.SaveMessageBySession(ctx, sessionID, message)
	if err != nil {
		return nil, err
	}
	if created {
		m.broadcast(models.RealtimeEvent{
			SessionID:  normalizeSessionID(sessionID),
			Kind:       "message.new",
			ChatJID:    message.ChatJID,
			MessageID:  message.ID,
			Direction:  "outgoing",
			Text:       message.Text,
			Payload:    messageRealtimePayload(message),
			OccurredAt: message.Timestamp,
		})
	}

	return &message, nil
}

func buildTextMessageProto(text string, contextInfo *waE2E.ContextInfo) *waE2E.Message {
	if contextInfo == nil {
		return &waE2E.Message{Conversation: proto.String(text)}
	}

	return &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
		Text:        proto.String(text),
		ContextInfo: contextInfo,
	}}
}

func (m *Manager) SendReaction(ctx context.Context, req models.SendReactionRequest) (*models.Message, error) {
	return m.SendReactionBySession(ctx, models.DefaultSessionID, req)
}

func (m *Manager) SendReactionBySession(ctx context.Context, sessionID string, req models.SendReactionRequest) (*models.Message, error) {
	emoji := strings.TrimSpace(req.Emoji)
	if emoji == "" {
		return nil, errors.New("reaction emoji is required")
	}

	parsedJID, err := types.ParseJID(strings.TrimSpace(req.JID))
	if err != nil {
		return nil, fmt.Errorf("invalid jid: %w", err)
	}
	parsedJID = parsedJID.ToNonAD()
	if err := validateSendableJID(parsedJID); err != nil {
		return nil, err
	}

	client := m.clientForSession(sessionID)
	connected := client != nil && client.IsConnected()
	if !connected {
		return nil, errors.New("session is not connected")
	}

	normalizedJID, err := normalizeSendJID(ctx, client, parsedJID)
	if err != nil {
		return nil, err
	}

	targetMessageID := strings.TrimSpace(req.MessageID)
	if targetMessageID == "" {
		return nil, errors.New("reaction target message is required")
	}

	target, err := m.store.GetMessageByIDForSession(ctx, sessionID, targetMessageID)
	if err != nil {
		return nil, err
	}
	if target == nil {
		return nil, errors.New("reaction target message not found")
	}
	belongsToConversation, err := m.sameConversationJIDBySession(ctx, sessionID, target.ChatJID, normalizedJID.String())
	if err != nil {
		return nil, err
	}
	if !belongsToConversation {
		return nil, errors.New("reaction target does not belong to this conversation")
	}

	messageProto := &waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{
		Key:               buildReactionMessageKey(*target),
		Text:              proto.String(emoji),
		SenderTimestampMS: proto.Int64(time.Now().UnixMilli()),
	}}

	messageID := types.MessageID(client.GenerateMessageID())
	resp, err := client.SendMessage(
		ctx,
		normalizedJID,
		messageProto,
		whatsmeow.SendRequestExtra{ID: messageID},
	)
	if err != nil {
		return nil, fmt.Errorf("send reaction: %w", err)
	}

	author := strings.TrimSpace(req.Author)
	if author == "" {
		author = "Operador"
	}

	message := models.Message{
		SessionID: normalizeSessionID(sessionID),
		ID:        string(resp.ID),
		ChatJID:   normalizedJID.String(),
		SenderJID: ownDeviceJID(client),
		Author:    author,
		FromMe:    true,
		AckStatus: "sent",
		Kind:      "reaction",
		Text:      emoji,
		RawJSON:   marshalProto(messageProto),
		Timestamp: resp.Timestamp.UTC().Format(time.RFC3339),
	}

	created, err := m.store.SaveMessageBySession(ctx, sessionID, message)
	if err != nil {
		return nil, err
	}
	if created {
		m.broadcast(models.RealtimeEvent{
			SessionID:  normalizeSessionID(sessionID),
			Kind:       "message.new",
			ChatJID:    message.ChatJID,
			MessageID:  message.ID,
			Direction:  "outgoing",
			Text:       message.Text,
			Payload:    messageRealtimePayload(message),
			OccurredAt: message.Timestamp,
		})
	}

	return &message, nil
}

func (m *Manager) buildReplyContext(ctx context.Context, chatJID, replyToMessageID string) (*waE2E.ContextInfo, error) {
	return m.buildReplyContextBySession(ctx, models.DefaultSessionID, chatJID, replyToMessageID)
}

func (m *Manager) buildReplyContextBySession(ctx context.Context, sessionID, chatJID, replyToMessageID string) (*waE2E.ContextInfo, error) {
	replyToMessageID = strings.TrimSpace(replyToMessageID)
	if replyToMessageID == "" {
		return nil, nil
	}

	target, err := m.store.GetMessageByIDForSession(ctx, sessionID, replyToMessageID)
	if err != nil {
		return nil, err
	}
	if target == nil {
		return nil, errors.New("reply target message not found")
	}
	belongsToConversation, err := m.sameConversationJIDBySession(ctx, sessionID, target.ChatJID, chatJID)
	if err != nil {
		return nil, err
	}
	if !belongsToConversation {
		return nil, errors.New("reply target does not belong to this conversation")
	}

	contextInfo := &waE2E.ContextInfo{
		StanzaID:      proto.String(target.ID),
		RemoteJID:     proto.String(target.ChatJID),
		QuotedMessage: buildQuotedMessageProto(*target),
	}

	if participant := quotedMessageParticipant(*target); participant != "" {
		contextInfo.Participant = proto.String(participant)
	}

	return contextInfo, nil
}

func buildQuotedMessageProto(message models.Message) *waE2E.Message {
	if parsed := parseStoredMessageProto(message.RawJSON); parsed != nil {
		return parsed
	}

	switch message.Kind {
	case "image":
		return &waE2E.Message{ImageMessage: &waE2E.ImageMessage{Caption: proto.String(message.Text)}}
	case "video":
		return &waE2E.Message{VideoMessage: &waE2E.VideoMessage{Caption: proto.String(message.Text)}}
	case "audio":
		return &waE2E.Message{AudioMessage: &waE2E.AudioMessage{PTT: proto.Bool(strings.EqualFold(strings.TrimSpace(message.Text), "[voice note]"))}}
	case "document":
		return &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
			Caption:  proto.String(message.Text),
			FileName: proto.String(message.FileName),
		}}
	case "sticker":
		return &waE2E.Message{StickerMessage: &waE2E.StickerMessage{}}
	default:
		return &waE2E.Message{Conversation: proto.String(message.Text)}
	}
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

	return unwrapMessageProto(&message)
}

func quotedMessageParticipant(message models.Message) string {
	if !strings.HasSuffix(message.ChatJID, "@g.us") {
		return ""
	}

	return strings.TrimSpace(message.SenderJID)
}

func (m *Manager) sameConversationJID(ctx context.Context, left, right string) (bool, error) {
	return m.sameConversationJIDBySession(ctx, models.DefaultSessionID, left, right)
}

func (m *Manager) sameConversationJIDBySession(ctx context.Context, sessionID, left, right string) (bool, error) {
	left = strings.TrimSpace(left)
	right = strings.TrimSpace(right)
	if left == "" || right == "" {
		return false, nil
	}
	if left == right {
		return true, nil
	}

	leftResolved, err := m.ResolveConversationJIDBySession(ctx, sessionID, left)
	if err != nil {
		return false, err
	}
	rightResolved, err := m.ResolveConversationJIDBySession(ctx, sessionID, right)
	if err != nil {
		return false, err
	}
	if leftResolved == rightResolved {
		return true, nil
	}

	leftCanonical, err := m.CanonicalConversationJIDBySession(ctx, sessionID, left)
	if err != nil {
		return false, err
	}
	rightCanonical, err := m.CanonicalConversationJIDBySession(ctx, sessionID, right)
	if err != nil {
		return false, err
	}

	return leftCanonical == rightCanonical, nil
}

func applyContextInfoToMessage(message *waE2E.Message, contextInfo *waE2E.ContextInfo) {
	if message == nil || contextInfo == nil {
		return
	}

	if text := strings.TrimSpace(message.GetConversation()); text != "" {
		message.Conversation = nil
		message.ExtendedTextMessage = &waE2E.ExtendedTextMessage{
			Text:        proto.String(text),
			ContextInfo: contextInfo,
		}
		return
	}

	switch {
	case message.GetExtendedTextMessage() != nil:
		message.GetExtendedTextMessage().ContextInfo = contextInfo
	case message.GetImageMessage() != nil:
		message.GetImageMessage().ContextInfo = contextInfo
	case message.GetVideoMessage() != nil:
		message.GetVideoMessage().ContextInfo = contextInfo
	case message.GetDocumentMessage() != nil:
		message.GetDocumentMessage().ContextInfo = contextInfo
	case message.GetAudioMessage() != nil:
		message.GetAudioMessage().ContextInfo = contextInfo
	case message.GetStickerMessage() != nil:
		message.GetStickerMessage().ContextInfo = contextInfo
	}
}

func buildReactionMessageKey(message models.Message) *waCommon.MessageKey {
	key := &waCommon.MessageKey{
		RemoteJID: proto.String(message.ChatJID),
		FromMe:    proto.Bool(message.FromMe),
		ID:        proto.String(message.ID),
	}

	if participant := quotedMessageParticipant(message); participant != "" {
		key.Participant = proto.String(participant)
	}

	return key
}

func (m *Manager) GetMessageMedia(ctx context.Context, messageID string) ([]byte, string, string, error) {
	return m.GetMessageMediaBySession(ctx, models.DefaultSessionID, messageID)
}

func (m *Manager) GetMessageMediaBySession(ctx context.Context, sessionID, messageID string) ([]byte, string, string, error) {
	stored, err := m.store.GetMessageByIDForSession(ctx, sessionID, messageID)
	if err != nil {
		return nil, "", "", err
	}
	if stored == nil {
		return nil, "", "", errors.New("message not found")
	}
	if stored.RawJSON == "" {
		return nil, "", "", errors.New("message has no stored media payload")
	}

	client := m.clientForSession(sessionID)
	connected := client != nil && client.IsConnected()
	if !connected {
		return nil, "", "", errors.New("session is not connected")
	}

	messageProto := &waE2E.Message{}
	if err := waProto.Unmarshal([]byte(stored.RawJSON), messageProto); err != nil {
		return nil, "", "", fmt.Errorf("decode stored message payload: %w", err)
	}
	messageProto = unwrapMessageProto(messageProto)

	downloadable := downloadableFromMessage(messageProto)
	if downloadable == nil {
		return nil, "", "", errors.New("message has no downloadable media")
	}

	data, err := client.Download(ctx, downloadable)
	if err != nil {
		return nil, "", "", fmt.Errorf("download media: %w", err)
	}

	mimeType := stored.MimeType
	if mimeType == "" {
		mimeType = http.DetectContentType(data)
	}

	fileName := stored.FileName
	if fileName == "" {
		fileName = stored.ID
	}

	return data, mimeType, fileName, nil
}

func (m *Manager) MarkChatRead(ctx context.Context, chatJID string) error {
	return m.MarkChatReadBySession(ctx, models.DefaultSessionID, chatJID)
}

func (m *Manager) MarkChatReadBySession(ctx context.Context, sessionID, chatJID string) error {
	resolved, err := m.ResolveConversationJIDBySession(ctx, sessionID, chatJID)
	if err != nil {
		return err
	}
	chatJID = resolved

	grouped, err := m.store.ListUnreadMessageGroupsByChatForSession(ctx, sessionID, chatJID)
	if err != nil {
		return err
	}

	client := m.clientForSession(sessionID)
	connected := client != nil && client.IsConnected()

	if connected {
		chat, err := types.ParseJID(chatJID)
		if err == nil {
			for senderText, messages := range grouped {
				if len(messages) == 0 {
					continue
				}

				ids := make([]types.MessageID, 0, len(messages))
				for _, message := range messages {
					ids = append(ids, types.MessageID(message.ID))
				}

				sender := types.EmptyJID
				if strings.HasSuffix(chatJID, "@g.us") {
					sender, _ = types.ParseJID(senderText)
				}

				if err := client.MarkRead(ctx, ids, time.Now(), chat, sender); err != nil {
					m.logger.Warn("mark read failed", "chat_jid", chatJID, "error", err)
				}
			}
		}
	}

	return m.store.MarkChatReadBySession(ctx, sessionID, chatJID)
}

func (m *Manager) ensureClient(ctx context.Context) error {
	_, err := m.ensureClientForSession(ctx, models.DefaultSessionID)
	return err
}

func (m *Manager) ensureClientForSession(ctx context.Context, sessionID string) (*whatsmeow.Client, error) {
	sessionID = normalizeSessionID(sessionID)
	m.mu.Lock()
	defer m.mu.Unlock()

	runtime := m.runtimeForSession(sessionID)
	if runtime.client != nil {
		return runtime.client, nil
	}

	deviceStore, err := m.loadDeviceStoreForSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	client := whatsmeow.NewClient(deviceStore, waLog.Stdout("Client", "INFO", true))
	client.AddEventHandler(func(evt interface{}) {
		go m.handleEvent(sessionID, evt)
	})
	client.SetForceActiveDeliveryReceipts(true)

	runtime.client = client
	if sessionID == models.DefaultSessionID {
		m.client = client
	}
	return client, nil
}

func (m *Manager) loadDeviceStoreForSession(ctx context.Context, sessionID string) (*wmstore.Device, error) {
	session, err := m.store.GetSessionByID(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session != nil && strings.TrimSpace(session.DeviceJID) != "" {
		jid, err := types.ParseJID(session.DeviceJID)
		if err == nil {
			deviceStore, err := m.container.GetDevice(ctx, jid)
			if err == nil {
				return deviceStore, nil
			}
		}
	}
	if sessionID == models.DefaultSessionID {
		deviceStore, err := m.container.GetFirstDevice(ctx)
		if err == nil {
			return deviceStore, nil
		}
	}
	return m.container.NewDevice(), nil
}

func (m *Manager) setConnecting(value bool) {
	m.setConnectingForSession(models.DefaultSessionID, value)
	m.mu.Lock()
	m.connecting = value
	m.mu.Unlock()
}

func (m *Manager) updateSession(ctx context.Context, mutate func(*models.Session)) error {
	return m.updateSessionByID(ctx, models.DefaultSessionID, mutate)
}

func (m *Manager) updateSessionByID(ctx context.Context, sessionID string, mutate func(*models.Session)) error {
	sessionID = normalizeSessionID(sessionID)
	session, err := m.store.GetSessionByID(ctx, sessionID)
	if err != nil {
		return err
	}
	if session == nil {
		session = &models.Session{
			ID:          sessionID,
			Name:        "WhatsApp principal",
			PhoneNumber: "Nao informado",
			ChannelID:   slugID("channel", "WhatsApp"),
			ChannelName: "WhatsApp",
			Status:      models.SessionStatusIdle,
			CreatedAt:   models.NowString(),
		}
	}

	mutate(session)
	session.UpdatedAt = models.NowString()
	if err := m.store.SaveSession(ctx, *session); err != nil {
		return err
	}
	return nil
}

func (m *Manager) failSession(ctx context.Context, message string) error {
	return m.failSessionByID(ctx, models.DefaultSessionID, message)
}

func (m *Manager) failSessionByID(ctx context.Context, sessionID, message string) error {
	if err := m.updateSessionByID(ctx, sessionID, func(current *models.Session) {
		current.Status = models.SessionStatusError
		current.LastError = message
	}); err != nil {
		return err
	}

	m.broadcast(models.RealtimeEvent{
		SessionID:  sessionID,
		Kind:       "connection",
		Status:     string(models.SessionStatusError),
		Text:       message,
		OccurredAt: models.NowString(),
	})

	return nil
}

func (m *Manager) consumeQRChannel(sessionID string, qrChan <-chan whatsmeow.QRChannelItem) {
	for item := range qrChan {
		switch item.Event {
		case whatsmeow.QRChannelEventCode:
			dataURL, err := qrDataURL(item.Code)
			if err != nil {
				m.logger.Warn("generate qr image failed", "error", err)
				continue
			}
			_ = m.updateSessionByID(context.Background(), sessionID, func(current *models.Session) {
				current.Status = models.SessionStatusQRReady
				current.QRCode = item.Code
				current.QRCodeDataURL = dataURL
				current.LastError = ""
			})
			m.broadcast(models.RealtimeEvent{
				SessionID:  sessionID,
				Kind:       "connection",
				Status:     string(models.SessionStatusQRReady),
				OccurredAt: models.NowString(),
			})
		case whatsmeow.QRChannelSuccess.Event:
			_ = m.updateSessionByID(context.Background(), sessionID, func(current *models.Session) {
				current.Status = models.SessionStatusSyncing
				current.QRCode = ""
				current.QRCodeDataURL = ""
				current.LastError = ""
			})
			m.broadcast(models.RealtimeEvent{
				SessionID:  sessionID,
				Kind:       "connection",
				Status:     string(models.SessionStatusSyncing),
				OccurredAt: models.NowString(),
			})
		case whatsmeow.QRChannelTimeout.Event:
			_ = m.failSessionByID(context.Background(), sessionID, "QR code expirou antes do scan.")
		case whatsmeow.QRChannelEventError:
			_ = m.failSessionByID(context.Background(), sessionID, fmt.Sprintf("QR error: %v", item.Error))
		case whatsmeow.QRChannelErrUnexpectedEvent.Event:
			_ = m.failSessionByID(context.Background(), sessionID, "Evento inesperado durante o pareamento por QR.")
		case whatsmeow.QRChannelClientOutdated.Event:
			_ = m.failSessionByID(context.Background(), sessionID, "Cliente WhatsApp Web desatualizado para esse pareamento.")
		case whatsmeow.QRChannelScannedWithoutMultidevice.Event:
			_ = m.failSessionByID(context.Background(), sessionID, "QR escaneado sem suporte a multidevice.")
		}
	}
}

func (m *Manager) handleEvent(sessionID string, evt interface{}) {
	switch event := evt.(type) {
	case appstateevents.PairSuccess:
		m.handlePairSuccess(sessionID, &event)
	case *appstateevents.PairSuccess:
		m.handlePairSuccess(sessionID, event)
	case appstateevents.Connected, *appstateevents.Connected:
		m.handleConnected(sessionID)
	case appstateevents.Disconnected, *appstateevents.Disconnected:
		m.handleDisconnected(sessionID)
	case appstateevents.LoggedOut:
		m.handleLoggedOut(sessionID, &event)
	case *appstateevents.LoggedOut:
		m.handleLoggedOut(sessionID, event)
	case appstateevents.ConnectFailure:
		m.handleConnectFailure(sessionID, &event)
	case *appstateevents.ConnectFailure:
		m.handleConnectFailure(sessionID, event)
	case appstateevents.Message:
		m.handleRealtimeMessage(sessionID, &event)
	case *appstateevents.Message:
		m.handleRealtimeMessage(sessionID, event)
	case appstateevents.HistorySync:
		m.handleHistorySync(sessionID, &event)
	case *appstateevents.HistorySync:
		m.handleHistorySync(sessionID, event)
	case appstateevents.Receipt:
		m.handleReceipt(sessionID, &event)
	case *appstateevents.Receipt:
		m.handleReceipt(sessionID, event)
	case appstateevents.Contact, *appstateevents.Contact, appstateevents.PushName, *appstateevents.PushName, appstateevents.BusinessName, *appstateevents.BusinessName:
		if err := m.SyncContactsBySession(context.Background(), sessionID); err != nil {
			m.logger.Warn("sync contacts after contact event failed", "error", err)
		}
	case appstateevents.Picture:
		m.handlePicture(sessionID, &event)
	case *appstateevents.Picture:
		m.handlePicture(sessionID, event)
	case appstateevents.GroupInfo:
		m.handleGroupInfo(sessionID, &event)
	case *appstateevents.GroupInfo:
		m.handleGroupInfo(sessionID, event)
	case appstateevents.JoinedGroup:
		m.handleJoinedGroup(sessionID, &event)
	case *appstateevents.JoinedGroup:
		m.handleJoinedGroup(sessionID, event)
	}
}

func (m *Manager) handlePairSuccess(sessionID string, event *appstateevents.PairSuccess) {
	if event == nil {
		return
	}
	phoneNumber := sessionPhoneNumberFromJID(event.ID)
	_ = m.updateSessionByID(context.Background(), sessionID, func(current *models.Session) {
		current.Status = models.SessionStatusSyncing
		current.DeviceJID = event.ID.String()
		if phoneNumber != "" {
			current.PhoneNumber = phoneNumber
		}
		current.BusinessName = event.BusinessName
		current.Platform = event.Platform
		current.LastError = ""
	})
	m.broadcast(models.RealtimeEvent{SessionID: sessionID, Kind: "connection", Status: string(models.SessionStatusSyncing), OccurredAt: models.NowString()})
}

func (m *Manager) handleConnected(sessionID string) {
	ctx := context.Background()
	client := m.clientForSession(sessionID)
	deviceJID := ownDeviceJID(client)
	phoneNumber := sessionPhoneNumberFromJIDString(deviceJID)
	_ = m.updateSessionByID(ctx, sessionID, func(current *models.Session) {
		current.Status = models.SessionStatusActive
		current.DeviceJID = deviceJID
		if phoneNumber != "" {
			current.PhoneNumber = phoneNumber
		}
		current.QRCode = ""
		current.QRCodeDataURL = ""
		current.LastError = ""
		current.ConnectedAt = models.NowString()
	})
	if err := m.SyncContactsBySession(ctx, sessionID); err != nil {
		m.logger.Warn("sync contacts after connect failed", "error", err)
	}
	if err := m.SyncGroupNamesBySession(ctx, sessionID); err != nil {
		m.logger.Warn("sync group names after connect failed", "error", err)
	}
	m.broadcast(models.RealtimeEvent{SessionID: sessionID, Kind: "connection", Status: string(models.SessionStatusActive), OccurredAt: models.NowString()})
}

func (m *Manager) handleDisconnected(sessionID string) {
	_ = m.updateSessionByID(context.Background(), sessionID, func(current *models.Session) {
		current.Status = models.SessionStatusDisconnected
		current.LastError = ""
	})
	m.broadcast(models.RealtimeEvent{SessionID: sessionID, Kind: "connection", Status: string(models.SessionStatusDisconnected), OccurredAt: models.NowString()})
}

func (m *Manager) handleLoggedOut(sessionID string, event *appstateevents.LoggedOut) {
	if event == nil {
		return
	}
	message := event.Reason.String()
	_ = m.updateSessionByID(context.Background(), sessionID, func(current *models.Session) {
		current.Status = models.SessionStatusDisconnected
		current.QRCode = ""
		current.QRCodeDataURL = ""
		current.LastError = message
	})
	m.resetClientByID(sessionID)
	m.broadcast(models.RealtimeEvent{SessionID: sessionID, Kind: "connection", Status: string(models.SessionStatusDisconnected), Text: message, OccurredAt: models.NowString()})
}

func (m *Manager) handleConnectFailure(sessionID string, event *appstateevents.ConnectFailure) {
	if event == nil {
		return
	}
	message := strings.TrimSpace(event.Message)
	if message == "" {
		message = event.Reason.String()
	}
	_ = m.failSessionByID(context.Background(), sessionID, message)
	if event.Reason.IsLoggedOut() {
		m.resetClientByID(sessionID)
	}
}

func (m *Manager) handleRealtimeMessage(sessionID string, evt *appstateevents.Message) {
	if evt == nil || evt.Message == nil {
		return
	}

	evt = evt.UnwrapRaw()
	body, kind, mimeType, fileName, ok := extractMessagePayload(evt.Message)
	if !ok {
		return
	}
	raw := marshalProto(evt.Message)

	if err := m.ingestMessage(
		context.Background(),
		sessionID,
		evt.Info.Chat.String(),
		evt.Info.Sender.String(),
		evt.Info.IsFromMe,
		string(evt.Info.ID),
		body,
		kind,
		mimeType,
		fileName,
		evt.Info.Timestamp,
		raw,
		true,
	); err != nil {
		m.logger.Warn("ingest realtime message failed", "error", err)
	}
}

func (m *Manager) handleHistorySync(sessionID string, evt *appstateevents.HistorySync) {
	if evt == nil || evt.Data == nil {
		return
	}

	m.mu.RLock()
	client := m.clientForSession(sessionID)
	m.mu.RUnlock()
	if client == nil {
		return
	}

	m.storeHistoryLIDMappings(context.Background(), client, evt.Data.GetPhoneNumberToLidMappings())

	hadChat := false
	for _, conversation := range evt.Data.GetConversations() {
		chatJID, err := types.ParseJID(conversation.GetID())
		if err != nil {
			continue
		}
		hadChat = true

		preferredName := bestHistoryConversationName(conversation, chatJID.String())
		if preferredName != "" {
			if err := m.upsertConversationIdentityBySession(context.Background(), sessionID, chatJID.String(), preferredName, strings.HasSuffix(chatJID.String(), "@g.us")); err != nil {
				m.logger.Warn("sync conversation identity failed", "chat_jid", chatJID.String(), "error", err)
			}
		}

		if err := m.ensureChatRecord(context.Background(), sessionID, chatJID.String(), "", time.Now(), false); err != nil {
			m.logger.Warn("ensure chat from history failed", "chat_jid", chatJID.String(), "error", err)
		}

		for _, historyMessage := range conversation.GetMessages() {
			parsed, err := client.ParseWebMessage(chatJID, historyMessage.GetMessage())
			if err != nil {
				continue
			}

			parsed.Message = unwrapMessageProto(parsed.Message)
			body, kind, mimeType, fileName, ok := extractMessagePayload(parsed.Message)
			if !ok {
				continue
			}

			if err := m.ingestMessage(
				context.Background(),
				sessionID,
				parsed.Info.Chat.String(),
				parsed.Info.Sender.String(),
				parsed.Info.IsFromMe,
				string(parsed.Info.ID),
				body,
				kind,
				mimeType,
				fileName,
				parsed.Info.Timestamp,
				marshalProto(parsed.Message),
				false,
			); err != nil {
				m.logger.Warn("ingest history message failed", "error", err)
			}
		}
	}

	if hadChat {
		m.broadcast(models.RealtimeEvent{SessionID: sessionID, Kind: "chat.new", OccurredAt: models.NowString()})
	}

	if err := m.SyncContactsBySession(context.Background(), sessionID); err != nil {
		m.logger.Warn("sync contacts after history failed", "error", err)
	}
}

func (m *Manager) handleReceipt(sessionID string, evt *appstateevents.Receipt) {
	if evt == nil {
		return
	}
	ackStatus := receiptStatus(evt.Type)
	for _, messageID := range evt.MessageIDs {
		if err := m.store.UpdateMessageAckBySession(context.Background(), sessionID, string(messageID), ackStatus); err != nil {
			m.logger.Warn("update message ack failed", "message_id", messageID, "error", err)
			continue
		}
		m.broadcast(models.RealtimeEvent{
			SessionID:  sessionID,
			Kind:       "message.ack",
			ChatJID:    evt.Chat.String(),
			MessageID:  string(messageID),
			AckStatus:  ackStatus,
			OccurredAt: evt.Timestamp.UTC().Format(time.RFC3339),
		})
	}
}

func (m *Manager) handlePicture(sessionID string, evt *appstateevents.Picture) {
	if evt == nil {
		return
	}
	ctx := context.Background()
	if evt.Remove {
		if err := m.store.UpdateContactPhoto(ctx, evt.JID.String(), "", ""); err != nil {
			m.logger.Warn("clear contact photo failed", "jid", evt.JID.String(), "error", err)
		}
		return
	}
	if err := m.refreshProfilePhotoBySession(ctx, sessionID, evt.JID.String(), evt.PictureID, false); err != nil {
		m.logger.Warn("refresh picture failed", "jid", evt.JID.String(), "error", err)
	}
}

func (m *Manager) handleGroupInfo(sessionID string, evt *appstateevents.GroupInfo) {
	if evt == nil {
		return
	}
	name := strings.TrimSpace(evt.Notify)
	if evt.Name != nil && strings.TrimSpace(evt.Name.Name) != "" {
		name = strings.TrimSpace(evt.Name.Name)
	}
	if name == "" {
		return
	}
	if err := m.upsertConversationIdentityBySession(context.Background(), sessionID, evt.JID.String(), name, true); err != nil {
		m.logger.Warn("sync group info name failed", "jid", evt.JID.String(), "error", err)
	}
}

func (m *Manager) handleJoinedGroup(sessionID string, evt *appstateevents.JoinedGroup) {
	if evt == nil {
		return
	}
	name := strings.TrimSpace(evt.Notify)
	if strings.TrimSpace(evt.Name) != "" {
		name = strings.TrimSpace(evt.Name)
	}
	if name == "" {
		return
	}
	if err := m.upsertConversationIdentityBySession(context.Background(), sessionID, evt.JID.String(), name, true); err != nil {
		m.logger.Warn("sync joined group name failed", "jid", evt.JID.String(), "error", err)
	}
}

func (m *Manager) ingestMessage(
	ctx context.Context,
	sessionID string,
	chatJID string,
	senderJID string,
	fromMe bool,
	messageID string,
	body string,
	kind string,
	mimeType string,
	fileName string,
	timestamp time.Time,
	rawJSON string,
	broadcast bool,
) error {
	if chatJID == "" || messageID == "" || shouldIgnoreJID(chatJID) {
		return nil
	}

	if err := m.ensureChatRecord(ctx, sessionID, chatJID, body, timestamp, fromMe); err != nil {
		return err
	}

	author := m.resolveAuthorBySession(ctx, sessionID, chatJID, senderJID, fromMe)
	message := models.Message{
		SessionID: normalizeSessionID(sessionID),
		ID:        messageID,
		ChatJID:   chatJID,
		SenderJID: senderJID,
		Author:    author,
		FromMe:    fromMe,
		AckStatus: defaultAckStatus(fromMe),
		Kind:      kind,
		MimeType:  mimeType,
		FileName:  fileName,
		Text:      body,
		RawJSON:   rawJSON,
		Timestamp: timestamp.UTC().Format(time.RFC3339),
	}

	created, err := m.store.SaveMessageBySession(ctx, sessionID, message)
	if err != nil {
		return err
	}
	if !created || !broadcast {
		return nil
	}

	direction := "incoming"
	if fromMe {
		direction = "outgoing"
	}
	eventChatJID := chatJID
	if canonicalJID, err := m.CanonicalConversationJIDBySession(ctx, sessionID, chatJID); err == nil && canonicalJID != "" {
		eventChatJID = canonicalJID
	}

	m.broadcast(models.RealtimeEvent{
		SessionID:  sessionID,
		Kind:       "message.new",
		ChatJID:    eventChatJID,
		MessageID:  messageID,
		Direction:  direction,
		Text:       body,
		Payload:    messageRealtimePayload(message),
		OccurredAt: message.Timestamp,
	})

	return nil
}

func (m *Manager) ensureChatRecord(ctx context.Context, sessionID, chatJID, preview string, timestamp time.Time, fromMe bool) error {
	chatName := m.resolveChatNameBySession(ctx, sessionID, chatJID)
	existing, err := m.store.GetChatForSession(ctx, sessionID, chatJID)
	if err != nil {
		return err
	}

	chat := models.Chat{
		SessionID:       normalizeSessionID(sessionID),
		JID:             chatJID,
		Name:            chatName,
		ContactJID:      chatJID,
		IsGroup:         strings.HasSuffix(chatJID, "@g.us"),
		LastMessageText: preview,
		LastMessageAt:   timestamp.UTC().Format(time.RFC3339),
		UpdatedAt:       models.NowString(),
	}
	if existing != nil {
		chat.UnreadCount = existing.UnreadCount
		chat.LastMessageID = existing.LastMessageID
		if preview == "" {
			chat.LastMessageText = existing.LastMessageText
		}
		if chat.LastMessageAt == "" {
			chat.LastMessageAt = existing.LastMessageAt
		}
	}

	created, err := m.store.UpsertChatForSession(ctx, sessionID, chat)
	if err != nil {
		return err
	}
	if created {
		m.broadcast(models.RealtimeEvent{
			SessionID:  sessionID,
			Kind:       "chat.new",
			ChatJID:    chatJID,
			OccurredAt: models.NowString(),
		})
	}

	if !strings.HasSuffix(chatJID, "@g.us") {
		go func() {
			if err := m.refreshProfilePhotoBySession(context.Background(), sessionID, chatJID, "", false); err != nil {
				if !errors.Is(err, whatsmeow.ErrProfilePictureUnauthorized) && !errors.Is(err, whatsmeow.ErrProfilePictureNotSet) {
					m.logger.Debug("refresh profile photo skipped", "jid", chatJID, "error", err)
				}
			}
		}()
	}

	_ = fromMe
	return nil
}

func (m *Manager) refreshProfilePhoto(ctx context.Context, jidText string, pictureID string, forceRefresh bool) error {
	return m.refreshProfilePhotoBySession(ctx, models.DefaultSessionID, jidText, pictureID, forceRefresh)
}

func (m *Manager) refreshProfilePhotoBySession(ctx context.Context, sessionID, jidText string, pictureID string, forceRefresh bool) error {
	client := m.clientForSession(sessionID)
	connected := client != nil && client.IsConnected()
	if !connected || jidText == "" || shouldIgnoreJID(jidText) {
		return nil
	}

	jid, err := types.ParseJID(jidText)
	if err != nil {
		return err
	}

	contact, err := m.store.GetContact(ctx, jidText)
	if err != nil {
		return err
	}
	if contact == nil {
		contact = &models.Contact{JID: jidText, DisplayName: m.resolveChatNameBySession(ctx, sessionID, jidText), UpdatedAt: models.NowString()}
		if err := m.store.UpsertContact(ctx, *contact); err != nil {
			return err
		}
	}

	if pictureID != "" && contact.PhotoID == pictureID {
		return nil
	}
	existingID := contact.PhotoID
	if forceRefresh {
		existingID = ""
	}

	info, err := client.GetProfilePictureInfo(ctx, jid, &whatsmeow.GetProfilePictureParams{
		ExistingID: existingID,
		Preview:    true,
	})
	if err != nil {
		return err
	}
	if info == nil {
		return nil
	}

	return m.store.UpdateContactPhoto(ctx, jidText, info.ID, info.URL)
}

func (m *Manager) resolveAuthor(ctx context.Context, chatJID, senderJID string, fromMe bool) string {
	return m.resolveAuthorBySession(ctx, models.DefaultSessionID, chatJID, senderJID, fromMe)
}

func (m *Manager) resolveAuthorBySession(ctx context.Context, sessionID, chatJID, senderJID string, fromMe bool) string {
	if fromMe {
		return "Operador"
	}
	if senderJID != "" && senderJID != chatJID {
		if name := m.resolveParticipantNameBySession(ctx, sessionID, senderJID); name != "" {
			return name
		}
		return localPart(senderJID)
	}
	if contact, err := m.store.GetContact(ctx, chatJID); err == nil && contact != nil && contact.DisplayName != "" {
		return contact.DisplayName
	}
	return localPart(chatJID)
}

func (m *Manager) resolveParticipantName(ctx context.Context, jid string) string {
	return m.resolveParticipantNameBySession(ctx, models.DefaultSessionID, jid)
}

func (m *Manager) resolveParticipantNameBySession(ctx context.Context, sessionID, jid string) string {
	jid = strings.TrimSpace(jid)
	if jid == "" {
		return ""
	}

	candidates := []string{jid}
	if canonical, err := m.CanonicalConversationJIDBySession(ctx, sessionID, jid); err == nil && canonical != "" && canonical != jid {
		candidates = append(candidates, canonical)
	}
	if resolved, err := m.ResolveConversationJIDBySession(ctx, sessionID, jid); err == nil && resolved != "" && resolved != jid {
		candidates = append(candidates, resolved)
	}

	seen := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if _, exists := seen[candidate]; exists {
			continue
		}
		seen[candidate] = struct{}{}

		contact, err := m.store.GetContact(ctx, candidate)
		if err != nil || contact == nil || !isMeaningfulDisplayName(contact.DisplayName, candidate) {
			continue
		}

		if candidate != jid {
			_ = m.store.UpsertContact(ctx, models.Contact{
				JID:          jid,
				Phone:        fallbackPhone(jid, contact.Phone),
				FirstName:    contact.FirstName,
				FullName:     contact.FullName,
				PushName:     contact.PushName,
				BusinessName: contact.BusinessName,
				DisplayName:  contact.DisplayName,
				PhotoID:      contact.PhotoID,
				PhotoURL:     contact.PhotoURL,
				UpdatedAt:    models.NowString(),
			})
		}

		return contact.DisplayName
	}

	return ""
}

func (m *Manager) resolveChatName(ctx context.Context, chatJID string) string {
	return m.resolveChatNameBySession(ctx, models.DefaultSessionID, chatJID)
}

func (m *Manager) resolveChatNameBySession(ctx context.Context, sessionID, chatJID string) string {
	if chat, err := m.store.GetChatForSession(ctx, sessionID, chatJID); err == nil && chat != nil && isMeaningfulDisplayName(chat.Name, chatJID) {
		return chat.Name
	}
	if chat, err := m.store.GetChat(ctx, chatJID); err == nil && chat != nil && isMeaningfulDisplayName(chat.Name, chatJID) {
		return chat.Name
	}
	if contact, err := m.store.GetContact(ctx, chatJID); err == nil && contact != nil && contact.DisplayName != "" {
		return contact.DisplayName
	}
	return localPart(chatJID)
}

func (m *Manager) upsertConversationIdentity(ctx context.Context, chatJID, preferredName string, isGroup bool) error {
	return m.upsertConversationIdentityBySession(ctx, models.DefaultSessionID, chatJID, preferredName, isGroup)
}

func (m *Manager) upsertConversationIdentityBySession(ctx context.Context, sessionID, chatJID, preferredName string, isGroup bool) error {
	preferredName = normalizePreferredName(preferredName)
	if preferredName == "" || !isMeaningfulDisplayName(preferredName, chatJID) {
		return nil
	}

	chat, err := m.store.GetChatForSession(ctx, sessionID, chatJID)
	if err != nil {
		return err
	}
	if chat == nil {
		chat = &models.Chat{
			SessionID:  normalizeSessionID(sessionID),
			JID:        chatJID,
			ContactJID: chatJID,
			IsGroup:    isGroup,
			UpdatedAt:  models.NowString(),
		}
	}
	if shouldReplaceDisplayName(chat.Name, preferredName, chatJID) {
		chat.Name = preferredName
	}
	chat.UpdatedAt = models.NowString()
	if _, err := m.store.UpsertChatForSession(ctx, sessionID, *chat); err != nil {
		return err
	}

	if !isGroup {
		existingContact, err := m.store.GetContact(ctx, chatJID)
		if err != nil {
			return err
		}
		contact := models.Contact{
			JID:         chatJID,
			Phone:       fallbackPhone(chatJID, ""),
			DisplayName: preferredName,
			UpdatedAt:   models.NowString(),
		}
		if existingContact != nil {
			contact = *existingContact
			if shouldReplaceDisplayName(existingContact.DisplayName, preferredName, chatJID) {
				contact.DisplayName = preferredName
			}
			contact.UpdatedAt = models.NowString()
		}
		return m.store.UpsertContact(ctx, contact)
	}

	return nil
}

func (m *Manager) broadcast(event models.RealtimeEvent) {
	if event.SessionID == "" {
		event.SessionID = models.DefaultSessionID
	}
	if event.OccurredAt == "" {
		event.OccurredAt = models.NowString()
	}
	m.hub.Broadcast(event)
}

func (m *Manager) resetClient() {
	m.resetClientByID(models.DefaultSessionID)
}

func (m *Manager) resetClientByID(sessionID string) {
	sessionID = normalizeSessionID(sessionID)
	m.mu.Lock()
	defer m.mu.Unlock()
	runtime := m.runtimeForSession(sessionID)
	runtime.client = nil
	runtime.connecting = false
	if sessionID == models.DefaultSessionID {
		m.client = nil
		m.connecting = false
	}
	deviceStore, err := m.loadDeviceStoreForSession(context.Background(), sessionID)
	if err != nil {
		m.logger.Error("reset device store failed", "session_id", sessionID, "error", err)
		return
	}
	client := whatsmeow.NewClient(deviceStore, waLog.Stdout("Client", "INFO", true))
	client.AddEventHandler(func(evt interface{}) {
		go m.handleEvent(sessionID, evt)
	})
	client.SetForceActiveDeliveryReceipts(true)
	runtime.client = client
	if sessionID == models.DefaultSessionID {
		m.client = client
	}
}

func qrDataURL(code string) (string, error) {
	png, err := qrcode.Encode(code, qrcode.Medium, 256)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), nil
}

func extractMessagePayload(message *waE2E.Message) (string, string, string, string, bool) {
	message = unwrapMessageProto(message)
	if message == nil {
		return "", "", "", "", false
	}
	switch {
	case message.GetConversation() != "":
		return strings.TrimSpace(message.GetConversation()), "text", "text/plain", "", true
	case message.GetExtendedTextMessage().GetText() != "":
		return strings.TrimSpace(message.GetExtendedTextMessage().GetText()), "text", "text/plain", "", true
	case message.GetImageMessage() != nil:
		caption := strings.TrimSpace(message.GetImageMessage().GetCaption())
		if caption == "" {
			caption = "[imagem]"
		}
		return caption, "image", message.GetImageMessage().GetMimetype(), "", true
	case message.GetVideoMessage() != nil:
		caption := strings.TrimSpace(message.GetVideoMessage().GetCaption())
		if caption == "" {
			caption = "[video]"
		}
		return caption, "video", message.GetVideoMessage().GetMimetype(), "", true
	case message.GetDocumentMessage() != nil:
		caption := strings.TrimSpace(message.GetDocumentMessage().GetCaption())
		name := strings.TrimSpace(message.GetDocumentMessage().GetFileName())
		if caption == "" {
			caption = name
		}
		if caption == "" {
			caption = "[documento]"
		}
		return caption, "document", message.GetDocumentMessage().GetMimetype(), name, true
	case message.GetAudioMessage() != nil:
		label := "[audio]"
		if message.GetAudioMessage().GetPTT() {
			label = "[voice note]"
		}
		return label, "audio", message.GetAudioMessage().GetMimetype(), "", true
	case message.GetStickerMessage() != nil:
		return "[figurinha]", "sticker", message.GetStickerMessage().GetMimetype(), "", true
	case message.GetContactMessage() != nil,
		message.GetContactsArrayMessage() != nil,
		message.GetLocationMessage() != nil,
		message.GetLiveLocationMessage() != nil:
		return "[midia]", "media", "", "", true
	case message.GetReactionMessage() != nil:
		return strings.TrimSpace(message.GetReactionMessage().GetText()), "reaction", "", "", true
	case message.GetProtocolMessage() != nil,
		message.GetSenderKeyDistributionMessage() != nil,
		message.GetPlaceholderMessage() != nil:
		return "", "", "", "", false
	default:
		return "", "", "", "", false
	}
}

func unwrapMessageProto(message *waE2E.Message) *waE2E.Message {
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

func downloadableFromMessage(message *waE2E.Message) whatsmeow.DownloadableMessage {
	message = unwrapMessageProto(message)
	if message == nil {
		return nil
	}
	switch {
	case message.GetImageMessage() != nil:
		return message.GetImageMessage()
	case message.GetVideoMessage() != nil:
		return message.GetVideoMessage()
	case message.GetDocumentMessage() != nil:
		return message.GetDocumentMessage()
	case message.GetAudioMessage() != nil:
		return message.GetAudioMessage()
	case message.GetStickerMessage() != nil:
		return message.GetStickerMessage()
	default:
		return nil
	}
}

func buildUploadMessage(client *whatsmeow.Client, req models.SendMediaRequest) (*waE2E.Message, string, string, string, string, error) {
	if client == nil {
		return nil, "", "", "", "", errors.New("session client unavailable")
	}
	data := req.Data
	mimeType := strings.TrimSpace(req.MimeType)
	if mimeType == "" {
		mimeType = http.DetectContentType(data)
	}
	fileName := strings.TrimSpace(req.FileName)
	caption := strings.TrimSpace(req.Caption)

	mediaType, kind, err := classifyUpload(mimeType, req.Sticker)
	if err != nil {
		return nil, "", "", "", "", err
	}
	resp, err := client.Upload(context.Background(), data, mediaType)
	if err != nil {
		return nil, "", "", "", "", fmt.Errorf("upload media: %w", err)
	}

	displayText := caption
	if displayText == "" {
		switch kind {
		case "image":
			displayText = "[imagem]"
		case "video":
			displayText = "[video]"
		case "audio":
			displayText = "[audio]"
		case "sticker":
			displayText = "[figurinha]"
		default:
			if fileName != "" {
				displayText = fileName
			} else {
				displayText = "[documento]"
			}
		}
	}

	commonURL := proto.String(resp.URL)
	commonPath := proto.String(resp.DirectPath)
	commonLength := proto.Uint64(resp.FileLength)

	switch kind {
	case "image":
		return &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
			Mimetype:      proto.String(mimeType),
			Caption:       proto.String(caption),
			URL:           commonURL,
			DirectPath:    commonPath,
			MediaKey:      resp.MediaKey,
			FileEncSHA256: resp.FileEncSHA256,
			FileSHA256:    resp.FileSHA256,
			FileLength:    commonLength,
		}}, kind, mimeType, fileName, displayText, nil
	case "video":
		return &waE2E.Message{VideoMessage: &waE2E.VideoMessage{
			Mimetype:      proto.String(mimeType),
			Caption:       proto.String(caption),
			URL:           commonURL,
			DirectPath:    commonPath,
			MediaKey:      resp.MediaKey,
			FileEncSHA256: resp.FileEncSHA256,
			FileSHA256:    resp.FileSHA256,
			FileLength:    commonLength,
		}}, kind, mimeType, fileName, displayText, nil
	case "audio":
		return &waE2E.Message{AudioMessage: &waE2E.AudioMessage{
			Mimetype:      proto.String(mimeType),
			PTT:           proto.Bool(false),
			URL:           commonURL,
			DirectPath:    commonPath,
			MediaKey:      resp.MediaKey,
			FileEncSHA256: resp.FileEncSHA256,
			FileSHA256:    resp.FileSHA256,
			FileLength:    commonLength,
		}}, kind, mimeType, fileName, displayText, nil
	case "sticker":
		return &waE2E.Message{StickerMessage: &waE2E.StickerMessage{
			Mimetype:      proto.String("image/webp"),
			URL:           commonURL,
			DirectPath:    commonPath,
			MediaKey:      resp.MediaKey,
			FileEncSHA256: resp.FileEncSHA256,
			FileSHA256:    resp.FileSHA256,
			FileLength:    commonLength,
		}}, kind, "image/webp", fileName, displayText, nil
	default:
		return &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
			Mimetype:      proto.String(mimeType),
			FileName:      proto.String(fileName),
			Caption:       proto.String(caption),
			URL:           commonURL,
			DirectPath:    commonPath,
			MediaKey:      resp.MediaKey,
			FileEncSHA256: resp.FileEncSHA256,
			FileSHA256:    resp.FileSHA256,
			FileLength:    commonLength,
		}}, kind, mimeType, fileName, displayText, nil
	}
}

func classifyUpload(mimeType string, sticker bool) (whatsmeow.MediaType, string, error) {
	if sticker {
		if mimeType != "image/webp" {
			return whatsmeow.MediaImage, "", errors.New("stickers must be sent as image/webp")
		}
		return whatsmeow.MediaImage, "sticker", nil
	}
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return whatsmeow.MediaImage, "image", nil
	case strings.HasPrefix(mimeType, "video/"):
		return whatsmeow.MediaVideo, "video", nil
	case strings.HasPrefix(mimeType, "audio/"):
		return whatsmeow.MediaAudio, "audio", nil
	default:
		return whatsmeow.MediaDocument, "document", nil
	}
}

func marshalProto(message proto.Message) string {
	if message == nil {
		return ""
	}
	payload, err := waProto.Marshal(message)
	if err != nil {
		return ""
	}
	return string(payload)
}

func receiptStatus(receiptType types.ReceiptType) string {
	switch receiptType {
	case types.ReceiptTypeDelivered:
		return "delivered"
	case types.ReceiptTypeSender:
		return "server_ack"
	case types.ReceiptTypeRetry:
		return "retry"
	case types.ReceiptTypeRead:
		return "read"
	case types.ReceiptTypeReadSelf:
		return "read-self"
	case types.ReceiptTypePlayed:
		return "played"
	default:
		return fmt.Sprint(receiptType)
	}
}

func defaultAckStatus(fromMe bool) string {
	if fromMe {
		return "sent"
	}
	return "received"
}

func bestHistoryConversationName(conversation *waHistorySync.Conversation, chatJID string) string {
	if conversation == nil {
		return ""
	}
	for _, candidate := range []string{
		conversation.GetDisplayName(),
		conversation.GetName(),
		conversation.GetUsername(),
		conversation.GetDescription(),
	} {
		candidate = normalizePreferredName(candidate)
		if isMeaningfulDisplayName(candidate, chatJID) {
			return candidate
		}
	}
	return ""
}

func normalizePreferredName(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Join(strings.Fields(value), " ")
	return value
}

func isMeaningfulDisplayName(value, jid string) bool {
	value = normalizePreferredName(value)
	if value == "" {
		return false
	}
	local := localPart(jid)
	if value == jid || value == local {
		return false
	}
	if strings.HasSuffix(jid, "@s.whatsapp.net") && isMostlyNumeric(value) {
		return false
	}
	return true
}

func shouldReplaceDisplayName(current, candidate, jid string) bool {
	current = normalizePreferredName(current)
	candidate = normalizePreferredName(candidate)
	if !isMeaningfulDisplayName(candidate, jid) {
		return false
	}
	if !isMeaningfulDisplayName(current, jid) {
		return true
	}
	if len(candidate) > len(current) && !isMostlyNumeric(candidate) {
		return true
	}
	return false
}

func isMostlyNumeric(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	digits := 0
	letters := 0
	for _, r := range value {
		switch {
		case r >= '0' && r <= '9':
			digits++
		case (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z'):
			letters++
		}
	}
	return digits > 0 && letters == 0
}

func contactDisplayName(jid, firstName, fullName, pushName, businessName, redactedPhone string) string {
	for _, value := range []string{fullName, firstName, pushName, businessName, redactedPhone} {
		value = normalizePreferredName(value)
		if isMeaningfulDisplayName(value, jid) {
			return value
		}
	}
	return localPart(jid)
}

func fallbackPhone(jid, redactedPhone string) string {
	if strings.TrimSpace(redactedPhone) != "" {
		return strings.TrimSpace(redactedPhone)
	}
	return localPart(jid)
}

func shouldIgnoreJID(jid string) bool {
	return strings.HasSuffix(jid, "@broadcast") || strings.Contains(jid, "@newsletter")
}

func slugID(prefix, value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return prefix
	}
	var builder strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		case r == ' ' || r == '-' || r == '_':
			builder.WriteRune('-')
		}
	}
	clean := strings.Trim(builder.String(), "-")
	if clean == "" {
		return prefix
	}
	return prefix + "-" + clean
}

func localPart(jid string) string {
	parts := strings.SplitN(jid, "@", 2)
	if parts[0] != "" {
		return parts[0]
	}
	return jid
}

func ownDeviceJID(client *whatsmeow.Client) string {
	if client == nil || client.Store == nil || client.Store.ID == nil {
		return ""
	}
	return client.Store.ID.String()
}

func sessionPhoneNumberFromJIDString(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	jid, err := types.ParseJID(trimmed)
	if err != nil {
		return ""
	}
	return sessionPhoneNumberFromJID(jid)
}

func sessionPhoneNumberFromJID(jid types.JID) string {
	return strings.TrimSpace(jid.User)
}

func (m *Manager) storeHistoryLIDMappings(ctx context.Context, client *whatsmeow.Client, mappings []*waHistorySync.PhoneNumberToLIDMapping) {
	if client == nil || client.Store == nil || client.Store.LIDs == nil || len(mappings) == 0 {
		return
	}

	items := make([]wmstore.LIDMapping, 0, len(mappings))
	for _, mapping := range mappings {
		if mapping == nil {
			continue
		}
		pn, err := types.ParseJID(mapping.GetPnJID())
		if err != nil {
			continue
		}
		lid, err := types.ParseJID(mapping.GetLidJID())
		if err != nil {
			continue
		}
		items = append(items, wmstore.LIDMapping{PN: pn.ToNonAD(), LID: lid.ToNonAD()})
	}
	if len(items) == 0 {
		return
	}
	if err := client.Store.LIDs.PutManyLIDMappings(ctx, items); err != nil {
		m.logger.Warn("store history lid mappings failed", "error", err)
	}
}

func mergeMessages(primary, secondary []models.Message) []models.Message {
	merged := make([]models.Message, 0, len(primary)+len(secondary))
	seen := make(map[string]struct{}, len(primary)+len(secondary))
	for _, message := range append(primary, secondary...) {
		if _, ok := seen[message.ID]; ok {
			continue
		}
		seen[message.ID] = struct{}{}
		merged = append(merged, message)
	}
	sort.Slice(merged, func(i, j int) bool {
		if merged[i].Timestamp == merged[j].Timestamp {
			return merged[i].ID < merged[j].ID
		}
		return merged[i].Timestamp < merged[j].Timestamp
	})
	return merged
}

func limitLatestMessages(messages []models.Message, limit int) []models.Message {
	if limit <= 0 || len(messages) <= limit {
		return messages
	}
	return messages[len(messages)-limit:]
}

func messageRealtimePayload(message models.Message) string {
	payload, err := json.Marshal(message)
	if err != nil {
		return ""
	}
	return string(payload)
}

func filterRenderableMessages(messages []models.Message) []models.Message {
	filtered := make([]models.Message, 0, len(messages))
	for _, message := range messages {
		if !message.FromMe && message.Text == "[midia]" && (message.Author == "." || message.SenderJID == ".") {
			continue
		}
		filtered = append(filtered, message)
	}
	return filtered
}

func normalizeSendJID(ctx context.Context, client *whatsmeow.Client, jid types.JID) (types.JID, error) {
	jid = jid.ToNonAD()
	if err := validateSendableJID(jid); err != nil {
		return types.EmptyJID, err
	}
	if client == nil || client.Store == nil {
		return jid, nil
	}

	if jid.Server == types.HiddenUserServer {
		alt, err := client.Store.GetAltJID(ctx, jid)
		if err != nil {
			return types.EmptyJID, fmt.Errorf("resolve recipient jid: %w", err)
		}
		if !alt.IsEmpty() {
			return alt.ToNonAD(), nil
		}
	}

	return jid, nil
}

func validateSendableJID(jid types.JID) error {
	if jid.IsEmpty() {
		return errors.New("recipient jid is required")
	}
	if jid.Server == types.BroadcastServer || jid.Server == types.NewsletterServer {
		return fmt.Errorf("messages can't be sent to %s", jid.String())
	}
	if jid.Server == types.DefaultUserServer && jid.User == "0" {
		return fmt.Errorf("messages can't be sent to %s", jid.String())
	}
	return nil
}

func toJSONArray[T any](items []T) string {
	payload, _ := json.Marshal(items)
	return string(payload)
}

var _ *waHistorySync.HistorySync
var _ *wmstore.Device
