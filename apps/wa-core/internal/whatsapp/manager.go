package whatsapp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/lib/pq"
	qrcode "github.com/skip2/go-qrcode"
	waProto "google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"go.mau.fi/whatsmeow"
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
	mu         sync.RWMutex
	logger     *slog.Logger
	store      *appstore.Store
	hub        *ws.Hub
	container  *sqlstore.Container
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
	}

	return manager, nil
}

func (m *Manager) Start(ctx context.Context) error {
	if err := m.ensureClient(ctx); err != nil {
		return err
	}

	session, err := m.store.GetSession(ctx)
	if err != nil || session == nil {
		return err
	}

	if m.client.Store != nil && m.client.Store.ID != nil {
		go func() {
			if _, err := m.InitSession(context.Background(), models.SessionInitRequest{}); err != nil {
				m.logger.Error("auto reconnect failed", "error", err)
			}
		}()
		return nil
	}

	if session.Status == models.SessionStatusActive || session.Status == models.SessionStatusSyncing || session.Status == models.SessionStatusInitializing {
		_ = m.updateSession(ctx, func(current *models.Session) {
			current.Status = models.SessionStatusDisconnected
			current.LastError = "Sessao aguardando nova conexao."
			current.QRCode = ""
			current.QRCodeDataURL = ""
		})
	}

	return nil
}

func (m *Manager) CreateOrUpdateSession(ctx context.Context, req models.SessionInitRequest) (*models.Session, error) {
	name := strings.TrimSpace(req.Name)
	phone := strings.TrimSpace(req.PhoneNumber)
	channel := strings.TrimSpace(req.ChannelName)

	if name == "" {
		name = "WhatsApp principal"
	}
	if phone == "" {
		phone = "Nao informado"
	}
	if channel == "" {
		channel = "WhatsApp"
	}

	now := models.NowString()
	session, err := m.store.GetSession(ctx)
	if err != nil {
		return nil, err
	}

	if session == nil {
		session = &models.Session{
			ID:          models.DefaultSessionID,
			Name:        name,
			PhoneNumber: phone,
			ChannelID:   slugID("channel", channel),
			ChannelName: channel,
			Status:      models.SessionStatusIdle,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
	} else {
		session.Name = name
		session.PhoneNumber = phone
		session.ChannelName = channel
		session.ChannelID = slugID("channel", channel)
		session.UpdatedAt = now
		if session.Status == "" {
			session.Status = models.SessionStatusIdle
		}
	}

	if err := m.store.SaveSession(ctx, *session); err != nil {
		return nil, err
	}

	updated, err := m.store.GetSession(ctx)
	if err != nil {
		return nil, err
	}

	m.broadcast(models.RealtimeEvent{
		Kind:       "connection",
		Status:     string(updated.Status),
		OccurredAt: models.NowString(),
	})

	return updated, nil
}

func (m *Manager) InitSession(ctx context.Context, req models.SessionInitRequest) (*models.Session, error) {
	_, err := m.CreateOrUpdateSession(ctx, req)
	if err != nil {
		return nil, err
	}

	if err := m.ensureClient(ctx); err != nil {
		return nil, err
	}

	m.mu.Lock()
	if m.client.IsConnected() {
		m.mu.Unlock()
		_ = m.updateSession(ctx, func(current *models.Session) {
			current.Status = models.SessionStatusActive
			current.LastError = ""
			current.ConnectedAt = models.NowString()
		})
		return m.store.GetSession(ctx)
	}
	if m.connecting {
		m.mu.Unlock()
		return m.store.GetSession(ctx)
	}
	m.connecting = true
	client := m.client
	m.mu.Unlock()

	if client.Store != nil && client.Store.ID == nil {
		qrChan, err := client.GetQRChannel(context.Background())
		if err != nil {
			m.setConnecting(false)
			_ = m.failSession(ctx, fmt.Sprintf("falha ao abrir QR channel: %v", err))
			return nil, err
		}
		go m.consumeQRChannel(qrChan)
	}

	_ = m.updateSession(ctx, func(current *models.Session) {
		current.Status = models.SessionStatusInitializing
		current.LastError = ""
	})

	go func() {
		defer m.setConnecting(false)
		if err := client.Connect(); err != nil {
			m.logger.Error("whatsmeow connect failed", "error", err)
			_ = m.failSession(context.Background(), err.Error())
		}
	}()

	return m.store.GetSession(ctx)
}

func (m *Manager) Disconnect(ctx context.Context) (*models.Session, error) {
	m.mu.RLock()
	client := m.client
	m.mu.RUnlock()

	if client != nil && client.IsConnected() {
		client.Disconnect()
	}

	if err := m.updateSession(ctx, func(current *models.Session) {
		current.Status = models.SessionStatusDisconnected
		current.QRCode = ""
		current.QRCodeDataURL = ""
		current.LastError = ""
	}); err != nil {
		return nil, err
	}

	m.broadcast(models.RealtimeEvent{
		Kind:       "connection",
		Status:     string(models.SessionStatusDisconnected),
		OccurredAt: models.NowString(),
	})

	return m.store.GetSession(ctx)
}

func (m *Manager) GetSession(ctx context.Context) (*models.Session, error) {
	return m.store.GetSession(ctx)
}

func (m *Manager) GetQR(ctx context.Context) (*models.SessionQRResponse, error) {
	session, err := m.store.GetSession(ctx)
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
	session, err := m.store.GetSession(ctx)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return &models.SessionStatusResponse{Status: models.SessionStatusIdle}, nil
	}

	m.mu.RLock()
	connected := m.client != nil && m.client.IsConnected()
	authenticated := m.client != nil && m.client.IsLoggedIn()
	m.mu.RUnlock()

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
	m.mu.RLock()
	client := m.client
	m.mu.RUnlock()
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

func (m *Manager) ListContacts(ctx context.Context) ([]models.Contact, error) {
	if err := m.SyncContacts(ctx); err != nil {
		m.logger.Warn("sync contacts failed", "error", err)
	}
	return m.store.ListContacts(ctx)
}

func (m *Manager) GetProfilePhoto(ctx context.Context, jid string) (*models.PhotoResponse, error) {
	if err := m.refreshProfilePhoto(ctx, jid, ""); err != nil {
		var unauthorized bool
		if errors.Is(err, whatsmeow.ErrProfilePictureUnauthorized) || errors.Is(err, whatsmeow.ErrProfilePictureNotSet) {
			unauthorized = true
		}
		if !unauthorized {
			return nil, err
		}
	}

	contact, err := m.store.GetContact(ctx, jid)
	if err != nil {
		return nil, err
	}
	if contact == nil {
		contact = &models.Contact{JID: jid}
	}

	return &models.PhotoResponse{
		JID:      jid,
		PhotoID:  contact.PhotoID,
		PhotoURL: contact.PhotoURL,
		Cached:   contact.PhotoURL != "",
	}, nil
}

func (m *Manager) ListChats(ctx context.Context) ([]models.Chat, error) {
	return m.store.ListChats(ctx)
}

func (m *Manager) ListMessages(ctx context.Context, chatJID string) ([]models.Message, error) {
	return m.store.ListMessagesByChat(ctx, chatJID)
}

func (m *Manager) SendText(ctx context.Context, req models.SendTextRequest) (*models.Message, error) {
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

	m.mu.RLock()
	client := m.client
	connected := client != nil && client.IsConnected()
	m.mu.RUnlock()
	if !connected {
		return nil, errors.New("session is not connected")
	}

	normalizedJID, err := normalizeSendJID(ctx, client, parsedJID)
	if err != nil {
		return nil, err
	}

	messageID := types.MessageID(client.GenerateMessageID())
	resp, err := client.SendMessage(
		ctx,
		normalizedJID,
		&waE2E.Message{Conversation: proto.String(text)},
		whatsmeow.SendRequestExtra{ID: messageID},
	)
	if err != nil {
		return nil, fmt.Errorf("send message: %w", err)
	}

	author := "Operador"
	message := models.Message{
		ID:        string(resp.ID),
		ChatJID:   normalizedJID.String(),
		SenderJID: ownDeviceJID(client),
		Author:    author,
		FromMe:    true,
		AckStatus: "sent",
		Text:      text,
		Timestamp: resp.Timestamp.UTC().Format(time.RFC3339),
	}

	if err := m.ensureChatRecord(ctx, normalizedJID.String(), text, resp.Timestamp, true); err != nil {
		return nil, err
	}
	created, err := m.store.SaveMessage(ctx, message)
	if err != nil {
		return nil, err
	}

	if created {
		m.broadcast(models.RealtimeEvent{
			Kind:       "message.new",
			ChatJID:    message.ChatJID,
			MessageID:  message.ID,
			Direction:  "outgoing",
			Text:       message.Text,
			OccurredAt: message.Timestamp,
		})
	}

	return &message, nil
}

func (m *Manager) MarkChatRead(ctx context.Context, chatJID string) error {
	grouped, err := m.store.ListUnreadMessageGroupsByChat(ctx, chatJID)
	if err != nil {
		return err
	}

	m.mu.RLock()
	client := m.client
	connected := client != nil && client.IsConnected()
	m.mu.RUnlock()

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

	return m.store.MarkChatRead(ctx, chatJID)
}

func (m *Manager) ensureClient(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.client != nil {
		return nil
	}

	deviceStore, err := m.container.GetFirstDevice(ctx)
	if err != nil {
		return fmt.Errorf("get first device: %w", err)
	}

	client := whatsmeow.NewClient(deviceStore, waLog.Stdout("Client", "INFO", true))
	client.AddEventHandler(func(evt interface{}) {
		go m.handleEvent(evt)
	})
	client.SetForceActiveDeliveryReceipts(true)

	m.client = client
	return nil
}

func (m *Manager) setConnecting(value bool) {
	m.mu.Lock()
	m.connecting = value
	m.mu.Unlock()
}

func (m *Manager) updateSession(ctx context.Context, mutate func(*models.Session)) error {
	session, err := m.store.GetSession(ctx)
	if err != nil {
		return err
	}
	if session == nil {
		session = &models.Session{
			ID:          models.DefaultSessionID,
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
	if err := m.updateSession(ctx, func(current *models.Session) {
		current.Status = models.SessionStatusError
		current.LastError = message
	}); err != nil {
		return err
	}

	m.broadcast(models.RealtimeEvent{
		Kind:       "connection",
		Status:     string(models.SessionStatusError),
		Text:       message,
		OccurredAt: models.NowString(),
	})

	return nil
}

func (m *Manager) consumeQRChannel(qrChan <-chan whatsmeow.QRChannelItem) {
	for item := range qrChan {
		switch item.Event {
		case whatsmeow.QRChannelEventCode:
			dataURL, err := qrDataURL(item.Code)
			if err != nil {
				m.logger.Warn("generate qr image failed", "error", err)
				continue
			}
			_ = m.updateSession(context.Background(), func(current *models.Session) {
				current.Status = models.SessionStatusQRReady
				current.QRCode = item.Code
				current.QRCodeDataURL = dataURL
				current.LastError = ""
			})
			m.broadcast(models.RealtimeEvent{
				Kind:       "connection",
				Status:     string(models.SessionStatusQRReady),
				OccurredAt: models.NowString(),
			})
		case whatsmeow.QRChannelSuccess.Event:
			_ = m.updateSession(context.Background(), func(current *models.Session) {
				current.Status = models.SessionStatusSyncing
				current.QRCode = ""
				current.QRCodeDataURL = ""
				current.LastError = ""
			})
			m.broadcast(models.RealtimeEvent{
				Kind:       "connection",
				Status:     string(models.SessionStatusSyncing),
				OccurredAt: models.NowString(),
			})
		case whatsmeow.QRChannelTimeout.Event:
			_ = m.failSession(context.Background(), "QR code expirou antes do scan.")
		case whatsmeow.QRChannelEventError:
			_ = m.failSession(context.Background(), fmt.Sprintf("QR error: %v", item.Error))
		case whatsmeow.QRChannelErrUnexpectedEvent.Event:
			_ = m.failSession(context.Background(), "Evento inesperado durante o pareamento por QR.")
		case whatsmeow.QRChannelClientOutdated.Event:
			_ = m.failSession(context.Background(), "Cliente WhatsApp Web desatualizado para esse pareamento.")
		case whatsmeow.QRChannelScannedWithoutMultidevice.Event:
			_ = m.failSession(context.Background(), "QR escaneado sem suporte a multidevice.")
		}
	}
}

func (m *Manager) handleEvent(evt interface{}) {
	switch event := evt.(type) {
	case appstateevents.PairSuccess:
		m.handlePairSuccess(&event)
	case *appstateevents.PairSuccess:
		m.handlePairSuccess(event)
	case appstateevents.Connected, *appstateevents.Connected:
		m.handleConnected()
	case appstateevents.Disconnected, *appstateevents.Disconnected:
		m.handleDisconnected()
	case appstateevents.LoggedOut:
		m.handleLoggedOut(&event)
	case *appstateevents.LoggedOut:
		m.handleLoggedOut(event)
	case appstateevents.ConnectFailure:
		m.handleConnectFailure(&event)
	case *appstateevents.ConnectFailure:
		m.handleConnectFailure(event)
	case appstateevents.Message:
		m.handleRealtimeMessage(&event)
	case *appstateevents.Message:
		m.handleRealtimeMessage(event)
	case appstateevents.HistorySync:
		m.handleHistorySync(&event)
	case *appstateevents.HistorySync:
		m.handleHistorySync(event)
	case appstateevents.Receipt:
		m.handleReceipt(&event)
	case *appstateevents.Receipt:
		m.handleReceipt(event)
	case appstateevents.Contact, *appstateevents.Contact, appstateevents.PushName, *appstateevents.PushName, appstateevents.BusinessName, *appstateevents.BusinessName:
		if err := m.SyncContacts(context.Background()); err != nil {
			m.logger.Warn("sync contacts after contact event failed", "error", err)
		}
	case appstateevents.Picture:
		m.handlePicture(&event)
	case *appstateevents.Picture:
		m.handlePicture(event)
	}
}

func (m *Manager) handlePairSuccess(event *appstateevents.PairSuccess) {
	if event == nil {
		return
	}
	_ = m.updateSession(context.Background(), func(current *models.Session) {
		current.Status = models.SessionStatusSyncing
		current.DeviceJID = event.ID.String()
		current.BusinessName = event.BusinessName
		current.Platform = event.Platform
		current.LastError = ""
	})
	m.broadcast(models.RealtimeEvent{Kind: "connection", Status: string(models.SessionStatusSyncing), OccurredAt: models.NowString()})
}

func (m *Manager) handleConnected() {
	ctx := context.Background()
	_ = m.updateSession(ctx, func(current *models.Session) {
		current.Status = models.SessionStatusActive
		current.DeviceJID = ownDeviceJID(m.client)
		current.QRCode = ""
		current.QRCodeDataURL = ""
		current.LastError = ""
		current.ConnectedAt = models.NowString()
	})
	if err := m.SyncContacts(ctx); err != nil {
		m.logger.Warn("sync contacts after connect failed", "error", err)
	}
	m.broadcast(models.RealtimeEvent{Kind: "connection", Status: string(models.SessionStatusActive), OccurredAt: models.NowString()})
}

func (m *Manager) handleDisconnected() {
	_ = m.updateSession(context.Background(), func(current *models.Session) {
		current.Status = models.SessionStatusDisconnected
		current.LastError = ""
	})
	m.broadcast(models.RealtimeEvent{Kind: "connection", Status: string(models.SessionStatusDisconnected), OccurredAt: models.NowString()})
}

func (m *Manager) handleLoggedOut(event *appstateevents.LoggedOut) {
	if event == nil {
		return
	}
	message := event.Reason.String()
	_ = m.updateSession(context.Background(), func(current *models.Session) {
		current.Status = models.SessionStatusDisconnected
		current.QRCode = ""
		current.QRCodeDataURL = ""
		current.LastError = message
	})
	m.resetClient()
	m.broadcast(models.RealtimeEvent{Kind: "connection", Status: string(models.SessionStatusDisconnected), Text: message, OccurredAt: models.NowString()})
}

func (m *Manager) handleConnectFailure(event *appstateevents.ConnectFailure) {
	if event == nil {
		return
	}
	message := strings.TrimSpace(event.Message)
	if message == "" {
		message = event.Reason.String()
	}
	_ = m.failSession(context.Background(), message)
	if event.Reason.IsLoggedOut() {
		m.resetClient()
	}
}

func (m *Manager) handleRealtimeMessage(evt *appstateevents.Message) {
	if evt == nil || evt.Message == nil {
		return
	}

	body := extractMessageText(evt.Message)
	if body == "" {
		body = "[midia]"
	}
	raw := marshalProto(evt.Message)

	if err := m.ingestMessage(
		context.Background(),
		evt.Info.Chat.String(),
		evt.Info.Sender.String(),
		evt.Info.IsFromMe,
		string(evt.Info.ID),
		body,
		evt.Info.Timestamp,
		raw,
		true,
	); err != nil {
		m.logger.Warn("ingest realtime message failed", "error", err)
	}
}

func (m *Manager) handleHistorySync(evt *appstateevents.HistorySync) {
	if evt == nil || evt.Data == nil {
		return
	}

	m.mu.RLock()
	client := m.client
	m.mu.RUnlock()
	if client == nil {
		return
	}

	hadChat := false
	for _, conversation := range evt.Data.GetConversations() {
		chatJID, err := types.ParseJID(conversation.GetID())
		if err != nil {
			continue
		}
		hadChat = true

		if err := m.ensureChatRecord(context.Background(), chatJID.String(), "", time.Now(), false); err != nil {
			m.logger.Warn("ensure chat from history failed", "chat_jid", chatJID.String(), "error", err)
		}

		for _, historyMessage := range conversation.GetMessages() {
			parsed, err := client.ParseWebMessage(chatJID, historyMessage.GetMessage())
			if err != nil {
				continue
			}

			body := extractMessageText(parsed.Message)
			if body == "" {
				body = "[midia]"
			}

			if err := m.ingestMessage(
				context.Background(),
				parsed.Info.Chat.String(),
				parsed.Info.Sender.String(),
				parsed.Info.IsFromMe,
				string(parsed.Info.ID),
				body,
				parsed.Info.Timestamp,
				marshalProto(parsed.Message),
				false,
			); err != nil {
				m.logger.Warn("ingest history message failed", "error", err)
			}
		}
	}

	if hadChat {
		m.broadcast(models.RealtimeEvent{Kind: "chat.new", OccurredAt: models.NowString()})
	}

	if err := m.SyncContacts(context.Background()); err != nil {
		m.logger.Warn("sync contacts after history failed", "error", err)
	}
}

func (m *Manager) handleReceipt(evt *appstateevents.Receipt) {
	if evt == nil {
		return
	}
	ackStatus := receiptStatus(evt.Type)
	for _, messageID := range evt.MessageIDs {
		if err := m.store.UpdateMessageAck(context.Background(), string(messageID), ackStatus); err != nil {
			m.logger.Warn("update message ack failed", "message_id", messageID, "error", err)
			continue
		}
		m.broadcast(models.RealtimeEvent{
			Kind:       "message.ack",
			ChatJID:    evt.Chat.String(),
			MessageID:  string(messageID),
			AckStatus:  ackStatus,
			OccurredAt: evt.Timestamp.UTC().Format(time.RFC3339),
		})
	}
}

func (m *Manager) handlePicture(evt *appstateevents.Picture) {
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
	if err := m.refreshProfilePhoto(ctx, evt.JID.String(), evt.PictureID); err != nil {
		m.logger.Warn("refresh picture failed", "jid", evt.JID.String(), "error", err)
	}
}

func (m *Manager) ingestMessage(
	ctx context.Context,
	chatJID string,
	senderJID string,
	fromMe bool,
	messageID string,
	body string,
	timestamp time.Time,
	rawJSON string,
	broadcast bool,
) error {
	if chatJID == "" || messageID == "" || shouldIgnoreJID(chatJID) {
		return nil
	}

	if err := m.ensureChatRecord(ctx, chatJID, body, timestamp, fromMe); err != nil {
		return err
	}

	author := m.resolveAuthor(ctx, chatJID, senderJID, fromMe)
	message := models.Message{
		ID:        messageID,
		ChatJID:   chatJID,
		SenderJID: senderJID,
		Author:    author,
		FromMe:    fromMe,
		AckStatus: defaultAckStatus(fromMe),
		Text:      body,
		RawJSON:   rawJSON,
		Timestamp: timestamp.UTC().Format(time.RFC3339),
	}

	created, err := m.store.SaveMessage(ctx, message)
	if err != nil {
		return err
	}
	if !created || !broadcast {
		return nil
	}

	kind := "incoming"
	if fromMe {
		kind = "outgoing"
	}

	m.broadcast(models.RealtimeEvent{
		Kind:       "message.new",
		ChatJID:    chatJID,
		MessageID:  messageID,
		Direction:  kind,
		Text:       body,
		OccurredAt: message.Timestamp,
	})

	return nil
}

func (m *Manager) ensureChatRecord(ctx context.Context, chatJID, preview string, timestamp time.Time, fromMe bool) error {
	chatName := m.resolveChatName(ctx, chatJID)
	existing, err := m.store.GetChat(ctx, chatJID)
	if err != nil {
		return err
	}

	chat := models.Chat{
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

	created, err := m.store.UpsertChat(ctx, chat)
	if err != nil {
		return err
	}
	if created {
		m.broadcast(models.RealtimeEvent{
			Kind:       "chat.new",
			ChatJID:    chatJID,
			OccurredAt: models.NowString(),
		})
	}

	if !strings.HasSuffix(chatJID, "@g.us") {
		go func() {
			if err := m.refreshProfilePhoto(context.Background(), chatJID, ""); err != nil {
				if !errors.Is(err, whatsmeow.ErrProfilePictureUnauthorized) && !errors.Is(err, whatsmeow.ErrProfilePictureNotSet) {
					m.logger.Debug("refresh profile photo skipped", "jid", chatJID, "error", err)
				}
			}
		}()
	}

	_ = fromMe
	return nil
}

func (m *Manager) refreshProfilePhoto(ctx context.Context, jidText string, pictureID string) error {
	m.mu.RLock()
	client := m.client
	connected := client != nil && client.IsConnected()
	m.mu.RUnlock()
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
		contact = &models.Contact{JID: jidText, DisplayName: m.resolveChatName(ctx, jidText), UpdatedAt: models.NowString()}
		if err := m.store.UpsertContact(ctx, *contact); err != nil {
			return err
		}
	}

	if pictureID != "" && contact.PhotoID == pictureID {
		return nil
	}
	existingID := contact.PhotoID

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
	if fromMe {
		return "Operador"
	}
	if senderJID != "" && senderJID != chatJID {
		if sender, err := m.store.GetContact(ctx, senderJID); err == nil && sender != nil && sender.DisplayName != "" {
			return sender.DisplayName
		}
	}
	if contact, err := m.store.GetContact(ctx, chatJID); err == nil && contact != nil && contact.DisplayName != "" {
		return contact.DisplayName
	}
	return localPart(chatJID)
}

func (m *Manager) resolveChatName(ctx context.Context, chatJID string) string {
	if contact, err := m.store.GetContact(ctx, chatJID); err == nil && contact != nil && contact.DisplayName != "" {
		return contact.DisplayName
	}
	return localPart(chatJID)
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
	m.mu.Lock()
	defer m.mu.Unlock()
	m.client = nil
	m.connecting = false
	deviceStore, err := m.container.GetFirstDevice(context.Background())
	if err != nil {
		m.logger.Error("reset device store failed", "error", err)
		return
	}
	client := whatsmeow.NewClient(deviceStore, waLog.Stdout("Client", "INFO", true))
	client.AddEventHandler(func(evt interface{}) {
		go m.handleEvent(evt)
	})
	client.SetForceActiveDeliveryReceipts(true)
	m.client = client
}

func qrDataURL(code string) (string, error) {
	png, err := qrcode.Encode(code, qrcode.Medium, 256)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), nil
}

func extractMessageText(message *waE2E.Message) string {
	if message == nil {
		return ""
	}
	switch {
	case message.GetConversation() != "":
		return strings.TrimSpace(message.GetConversation())
	case message.GetExtendedTextMessage().GetText() != "":
		return strings.TrimSpace(message.GetExtendedTextMessage().GetText())
	case message.GetImageMessage().GetCaption() != "":
		return strings.TrimSpace(message.GetImageMessage().GetCaption())
	case message.GetVideoMessage().GetCaption() != "":
		return strings.TrimSpace(message.GetVideoMessage().GetCaption())
	case message.GetDocumentMessage().GetCaption() != "":
		return strings.TrimSpace(message.GetDocumentMessage().GetCaption())
	default:
		return ""
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

func contactDisplayName(jid, firstName, fullName, pushName, businessName, redactedPhone string) string {
	for _, value := range []string{fullName, firstName, pushName, businessName, redactedPhone} {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
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
