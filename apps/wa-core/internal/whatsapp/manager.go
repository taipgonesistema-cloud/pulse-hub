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
	lastGroupNameSync time.Time
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

func (m *Manager) SyncGroupNames(ctx context.Context) error {
	m.mu.RLock()
	client := m.client
	connected := client != nil && client.IsConnected()
	m.mu.RUnlock()
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

		if err := m.upsertConversationIdentity(ctx, group.JID.String(), name, true); err != nil {
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
	canonicalJID, err := m.ResolvePhotoJID(ctx, jid)
	if err != nil {
		return nil, err
	}

	if err := m.refreshProfilePhoto(ctx, canonicalJID, "", forceRefresh); err != nil {
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
	chats, err := m.store.ListChats(ctx)
	if err != nil {
		return nil, err
	}

	if m.shouldRefreshGroupNames(chats) {
		if err := m.SyncGroupNames(ctx); err != nil {
			m.logger.Warn("sync group names before list chats failed", "error", err)
		} else {
			refreshedChats, refreshErr := m.store.ListChats(ctx)
			if refreshErr == nil {
				chats = refreshedChats
			}
		}
	}

	return chats, nil
}

func (m *Manager) shouldRefreshGroupNames(chats []models.Chat) bool {
	m.mu.RLock()
	lastSync := m.lastGroupNameSync
	client := m.client
	connected := client != nil && client.IsConnected()
	m.mu.RUnlock()

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
	resolved, err := m.ResolveConversationJID(ctx, chatJID)
	if err != nil {
		return nil, err
	}
	if resolved == chatJID {
		messages, err := m.store.ListMessagesByChat(ctx, chatJID)
		if err != nil {
			return nil, err
		}
		return filterRenderableMessages(messages), nil
	}

	primary, err := m.store.ListMessagesByChat(ctx, resolved)
	if err != nil {
		return nil, err
	}
	secondary, err := m.store.ListMessagesByChat(ctx, chatJID)
	if err != nil {
		return nil, err
	}
	return filterRenderableMessages(mergeMessages(primary, secondary)), nil
}

func (m *Manager) ResolveConversationJID(ctx context.Context, chatJID string) (string, error) {
	parsed, err := types.ParseJID(strings.TrimSpace(chatJID))
	if err != nil {
		return "", fmt.Errorf("invalid jid: %w", err)
	}
	parsed = parsed.ToNonAD()

	m.mu.RLock()
	client := m.client
	m.mu.RUnlock()
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
	parsed, err := types.ParseJID(strings.TrimSpace(chatJID))
	if err != nil {
		return "", fmt.Errorf("invalid jid: %w", err)
	}
	parsed = parsed.ToNonAD()

	if parsed.Server != types.HiddenUserServer {
		return parsed.String(), nil
	}

	m.mu.RLock()
	client := m.client
	m.mu.RUnlock()
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
	canonical, err := m.CanonicalConversationJID(ctx, jid)
	if err == nil && canonical != "" {
		return canonical, nil
	}
	resolved, resolveErr := m.ResolveConversationJID(ctx, jid)
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

	contextInfo, err := m.buildReplyContext(ctx, normalizedJID.String(), req.ReplyToMessageID)
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

func (m *Manager) SendMedia(ctx context.Context, req models.SendMediaRequest) (*models.Message, error) {
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

	messageProto, kind, mimeType, fileName, displayText, err := buildUploadMessage(client, req)
	if err != nil {
		return nil, err
	}

	contextInfo, err := m.buildReplyContext(ctx, normalizedJID.String(), req.ReplyToMessageID)
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

	if err := m.ensureChatRecord(ctx, normalizedJID.String(), displayText, resp.Timestamp, true); err != nil {
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

	targetMessageID := strings.TrimSpace(req.MessageID)
	if targetMessageID == "" {
		return nil, errors.New("reaction target message is required")
	}

	target, err := m.store.GetMessageByID(ctx, targetMessageID)
	if err != nil {
		return nil, err
	}
	if target == nil {
		return nil, errors.New("reaction target message not found")
	}
	belongsToConversation, err := m.sameConversationJID(ctx, target.ChatJID, normalizedJID.String())
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

func (m *Manager) buildReplyContext(ctx context.Context, chatJID, replyToMessageID string) (*waE2E.ContextInfo, error) {
	replyToMessageID = strings.TrimSpace(replyToMessageID)
	if replyToMessageID == "" {
		return nil, nil
	}

	target, err := m.store.GetMessageByID(ctx, replyToMessageID)
	if err != nil {
		return nil, err
	}
	if target == nil {
		return nil, errors.New("reply target message not found")
	}
	belongsToConversation, err := m.sameConversationJID(ctx, target.ChatJID, chatJID)
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
	left = strings.TrimSpace(left)
	right = strings.TrimSpace(right)
	if left == "" || right == "" {
		return false, nil
	}
	if left == right {
		return true, nil
	}

	leftResolved, err := m.ResolveConversationJID(ctx, left)
	if err != nil {
		return false, err
	}
	rightResolved, err := m.ResolveConversationJID(ctx, right)
	if err != nil {
		return false, err
	}
	if leftResolved == rightResolved {
		return true, nil
	}

	leftCanonical, err := m.CanonicalConversationJID(ctx, left)
	if err != nil {
		return false, err
	}
	rightCanonical, err := m.CanonicalConversationJID(ctx, right)
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
	stored, err := m.store.GetMessageByID(ctx, messageID)
	if err != nil {
		return nil, "", "", err
	}
	if stored == nil {
		return nil, "", "", errors.New("message not found")
	}
	if stored.RawJSON == "" {
		return nil, "", "", errors.New("message has no stored media payload")
	}

	m.mu.RLock()
	client := m.client
	connected := client != nil && client.IsConnected()
	m.mu.RUnlock()
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
	resolved, err := m.ResolveConversationJID(ctx, chatJID)
	if err != nil {
		return err
	}
	chatJID = resolved

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
	case appstateevents.GroupInfo:
		m.handleGroupInfo(&event)
	case *appstateevents.GroupInfo:
		m.handleGroupInfo(event)
	case appstateevents.JoinedGroup:
		m.handleJoinedGroup(&event)
	case *appstateevents.JoinedGroup:
		m.handleJoinedGroup(event)
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
	if err := m.SyncGroupNames(ctx); err != nil {
		m.logger.Warn("sync group names after connect failed", "error", err)
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

	evt = evt.UnwrapRaw()
	body, kind, mimeType, fileName, ok := extractMessagePayload(evt.Message)
	if !ok {
		return
	}
	raw := marshalProto(evt.Message)

	if err := m.ingestMessage(
		context.Background(),
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
			if err := m.upsertConversationIdentity(context.Background(), chatJID.String(), preferredName, strings.HasSuffix(chatJID.String(), "@g.us")); err != nil {
				m.logger.Warn("sync conversation identity failed", "chat_jid", chatJID.String(), "error", err)
			}
		}

		if err := m.ensureChatRecord(context.Background(), chatJID.String(), "", time.Now(), false); err != nil {
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
	if err := m.refreshProfilePhoto(ctx, evt.JID.String(), evt.PictureID, false); err != nil {
		m.logger.Warn("refresh picture failed", "jid", evt.JID.String(), "error", err)
	}
}

func (m *Manager) handleGroupInfo(evt *appstateevents.GroupInfo) {
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
	if err := m.upsertConversationIdentity(context.Background(), evt.JID.String(), name, true); err != nil {
		m.logger.Warn("sync group info name failed", "jid", evt.JID.String(), "error", err)
	}
}

func (m *Manager) handleJoinedGroup(evt *appstateevents.JoinedGroup) {
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
	if err := m.upsertConversationIdentity(context.Background(), evt.JID.String(), name, true); err != nil {
		m.logger.Warn("sync joined group name failed", "jid", evt.JID.String(), "error", err)
	}
}

func (m *Manager) ingestMessage(
	ctx context.Context,
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
		Kind:      kind,
		MimeType:  mimeType,
		FileName:  fileName,
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

	direction := "incoming"
	if fromMe {
		direction = "outgoing"
	}

	m.broadcast(models.RealtimeEvent{
		Kind:       "message.new",
		ChatJID:    chatJID,
		MessageID:  messageID,
		Direction:  direction,
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
			if err := m.refreshProfilePhoto(context.Background(), chatJID, "", false); err != nil {
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
	if fromMe {
		return "Operador"
	}
	if senderJID != "" && senderJID != chatJID {
		if name := m.resolveParticipantName(ctx, senderJID); name != "" {
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
	jid = strings.TrimSpace(jid)
	if jid == "" {
		return ""
	}

	candidates := []string{jid}
	if canonical, err := m.CanonicalConversationJID(ctx, jid); err == nil && canonical != "" && canonical != jid {
		candidates = append(candidates, canonical)
	}
	if resolved, err := m.ResolveConversationJID(ctx, jid); err == nil && resolved != "" && resolved != jid {
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
	if chat, err := m.store.GetChat(ctx, chatJID); err == nil && chat != nil && isMeaningfulDisplayName(chat.Name, chatJID) {
		return chat.Name
	}
	if contact, err := m.store.GetContact(ctx, chatJID); err == nil && contact != nil && contact.DisplayName != "" {
		return contact.DisplayName
	}
	return localPart(chatJID)
}

func (m *Manager) upsertConversationIdentity(ctx context.Context, chatJID, preferredName string, isGroup bool) error {
	preferredName = normalizePreferredName(preferredName)
	if preferredName == "" || !isMeaningfulDisplayName(preferredName, chatJID) {
		return nil
	}

	chat, err := m.store.GetChat(ctx, chatJID)
	if err != nil {
		return err
	}
	if chat == nil {
		chat = &models.Chat{
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
	if _, err := m.store.UpsertChat(ctx, *chat); err != nil {
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
