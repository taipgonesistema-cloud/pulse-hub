package models

import "time"

const DefaultSessionID = "default"

type SessionStatus string

const (
	SessionStatusIdle         SessionStatus = "idle"
	SessionStatusInitializing SessionStatus = "initializing"
	SessionStatusQRReady      SessionStatus = "qr_ready"
	SessionStatusSyncing      SessionStatus = "syncing"
	SessionStatusActive       SessionStatus = "active"
	SessionStatusDisconnected SessionStatus = "disconnected"
	SessionStatusError        SessionStatus = "error"
)

type Session struct {
	ID            string        `json:"id"`
	Name          string        `json:"name"`
	PhoneNumber   string        `json:"phoneNumber"`
	ChannelID     string        `json:"channelId"`
	ChannelName   string        `json:"channelName"`
	Status        SessionStatus `json:"status"`
	QRCode        string        `json:"qrCode,omitempty"`
	QRCodeDataURL string        `json:"qrCodeDataUrl,omitempty"`
	LastError     string        `json:"lastError,omitempty"`
	DeviceJID     string        `json:"deviceJid,omitempty"`
	BusinessName  string        `json:"businessName,omitempty"`
	Platform      string        `json:"platform,omitempty"`
	ConnectedAt   string        `json:"connectedAt,omitempty"`
	CreatedAt     string        `json:"createdAt"`
	UpdatedAt     string        `json:"updatedAt"`
}

type Contact struct {
	JID          string `json:"jid"`
	Phone        string `json:"phone,omitempty"`
	FirstName    string `json:"firstName,omitempty"`
	FullName     string `json:"fullName,omitempty"`
	PushName     string `json:"pushName,omitempty"`
	BusinessName string `json:"businessName,omitempty"`
	DisplayName  string `json:"displayName"`
	PhotoID      string `json:"photoId,omitempty"`
	PhotoURL     string `json:"photoUrl,omitempty"`
	UpdatedAt    string `json:"updatedAt"`
}

type Chat struct {
	JID             string `json:"jid"`
	Name            string `json:"name"`
	ContactJID      string `json:"contactJid,omitempty"`
	IsGroup         bool   `json:"isGroup"`
	UnreadCount     int    `json:"unreadCount"`
	LastMessageID   string `json:"lastMessageId,omitempty"`
	LastMessageText string `json:"lastMessageText,omitempty"`
	LastMessageAt   string `json:"lastMessageAt,omitempty"`
	UpdatedAt       string `json:"updatedAt"`
}

type Message struct {
	ID        string `json:"id"`
	ChatJID   string `json:"chatJid"`
	SenderJID string `json:"senderJid,omitempty"`
	Author    string `json:"author"`
	FromMe    bool   `json:"fromMe"`
	AckStatus string `json:"ackStatus,omitempty"`
	Kind      string `json:"kind,omitempty"`
	MimeType  string `json:"mimeType,omitempty"`
	FileName  string `json:"fileName,omitempty"`
	Text      string `json:"text"`
	RawJSON   string `json:"rawJson,omitempty"`
	Timestamp string `json:"timestamp"`
}

type SessionInitRequest struct {
	Name        string `json:"name"`
	PhoneNumber string `json:"phoneNumber"`
	ChannelName string `json:"channelName"`
}

type SendTextRequest struct {
	JID  string `json:"jid"`
	Text string `json:"text"`
}

type SendMediaRequest struct {
	JID      string
	Caption  string
	FileName string
	MimeType string
	Data     []byte
	Sticker  bool
}

type SessionQRResponse struct {
	Status           SessionStatus `json:"status"`
	Code             string        `json:"code,omitempty"`
	ImageDataURL     string        `json:"imageDataUrl,omitempty"`
	ExpiresInSeconds int           `json:"expiresInSeconds"`
}

type SessionStatusResponse struct {
	Status        SessionStatus `json:"status"`
	Connected     bool          `json:"connected"`
	Authenticated bool          `json:"authenticated"`
	HasQR         bool          `json:"hasQr"`
	DeviceJID     string        `json:"deviceJid,omitempty"`
	BusinessName  string        `json:"businessName,omitempty"`
	Platform      string        `json:"platform,omitempty"`
	LastError     string        `json:"lastError,omitempty"`
}

type PhotoResponse struct {
	JID          string `json:"jid"`
	CanonicalJID string `json:"canonicalJid,omitempty"`
	PhotoID      string `json:"photoId,omitempty"`
	PhotoURL     string `json:"photoUrl,omitempty"`
	ProxyURL     string `json:"proxyUrl,omitempty"`
	Cached       bool   `json:"cached"`
}

type RealtimeEvent struct {
	Kind       string `json:"kind"`
	SessionID  string `json:"sessionId"`
	ChatJID    string `json:"chatJid,omitempty"`
	MessageID  string `json:"messageId,omitempty"`
	Direction  string `json:"direction,omitempty"`
	Status     string `json:"status,omitempty"`
	AckStatus  string `json:"ackStatus,omitempty"`
	Text       string `json:"text,omitempty"`
	Payload    string `json:"payload,omitempty"`
	OccurredAt string `json:"occurredAt"`
}

type AuthUser struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	IsActive    bool   `json:"isActive"`
	LastLoginAt string `json:"lastLoginAt,omitempty"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type SignInRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type SignInResponse struct {
	User  AuthUser `json:"user"`
	Token string   `json:"token"`
}

type ChannelRecord struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Color            string `json:"color"`
	ConnectedNumbers int    `json:"connectedNumbers"`
}

type MessageRecord struct {
	ID             string `json:"id"`
	ConversationID string `json:"conversationId"`
	Direction      string `json:"direction"`
	Kind           string `json:"kind,omitempty"`
	Body           string `json:"body"`
	MediaURL       string `json:"mediaUrl,omitempty"`
	MimeType       string `json:"mimeType,omitempty"`
	FileName       string `json:"fileName,omitempty"`
	Timestamp      string `json:"timestamp"`
	Author         string `json:"author"`
}

type ConversationRecord struct {
	ID            string          `json:"id"`
	SessionID     string          `json:"sessionId"`
	SessionName   string          `json:"sessionName"`
	Contact       string          `json:"contact"`
	AvatarURL     string          `json:"avatarUrl,omitempty"`
	ParticipantID string          `json:"participantId"`
	Owner         string          `json:"owner"`
	Status        string          `json:"status"`
	ChannelName   string          `json:"channelName"`
	WaitingTime   string          `json:"waitingTime"`
	Unread        int             `json:"unread"`
	Preview       string          `json:"preview"`
	LastMessageAt string          `json:"lastMessageAt"`
	Messages      []MessageRecord `json:"messages"`
}

type SessionRecord struct {
	ID            string        `json:"id"`
	Name          string        `json:"name"`
	PhoneNumber   string        `json:"phoneNumber"`
	ChannelID     string        `json:"channelId"`
	ChannelName   string        `json:"channelName"`
	Status        SessionStatus `json:"status"`
	Attendants    int           `json:"attendants"`
	Waiting       int           `json:"waiting"`
	Unread        int           `json:"unread"`
	LastHeartbeat string        `json:"lastHeartbeat"`
	IsDemo        bool          `json:"isDemo"`
	QRCode        string        `json:"qrCode,omitempty"`
	QRCodeDataURL string        `json:"qrCodeDataUrl,omitempty"`
	LastError     string        `json:"lastError,omitempty"`
}

type DashboardOverview struct {
	Product string `json:"product"`
	Phase   string `json:"phase"`
	Metrics struct {
		ConnectedNumbers     int `json:"connectedNumbers"`
		ActiveSessions       int `json:"activeSessions"`
		OnlineUsers          int `json:"onlineUsers"`
		WaitingConversations int `json:"waitingConversations"`
	} `json:"metrics"`
	Analytics struct {
		ResponseVelocity DashboardResponseVelocityAnalytics `json:"responseVelocity"`
	} `json:"analytics"`
	Channels      []ChannelRecord      `json:"channels"`
	Sessions      []SessionRecord      `json:"sessions"`
	Conversations []ConversationRecord `json:"conversations"`
}

type DashboardResponseVelocityAnalytics struct {
	AverageSeconds int                              `json:"averageSeconds"`
	DeltaSeconds   int                              `json:"deltaSeconds"`
	TargetSeconds  int                              `json:"targetSeconds"`
	PeakLabel      string                           `json:"peakLabel"`
	Points         []DashboardResponseVelocityPoint `json:"points"`
}

type DashboardResponseVelocityPoint struct {
	Label          string `json:"label"`
	AverageSeconds int    `json:"averageSeconds"`
}

type ContactKanbanStageRecord struct {
	SessionID      string `json:"sessionId"`
	ConversationID string `json:"conversationId"`
	Stage          string `json:"stage"`
	UpdatedBy      string `json:"updatedBy,omitempty"`
	UpdatedAt      string `json:"updatedAt"`
}

type ContactKanbanBoardRecord struct {
	ID                     string `json:"id"`
	Label                  string `json:"label"`
	Description            string `json:"description"`
	ContactsFilter         string `json:"contactsFilter"`
	ContactsAudienceFilter string `json:"contactsAudienceFilter"`
	ContactsChannelFilter  string `json:"contactsChannelFilter"`
	CreatedBy              string `json:"createdBy,omitempty"`
	UpdatedBy              string `json:"updatedBy,omitempty"`
	CreatedAt              string `json:"createdAt"`
	UpdatedAt              string `json:"updatedAt"`
}

type ContactCRMProfileRecord struct {
	SessionID      string   `json:"sessionId"`
	ConversationID string   `json:"conversationId"`
	Assignee       string   `json:"assignee,omitempty"`
	Priority       string   `json:"priority,omitempty"`
	Notes          string   `json:"notes,omitempty"`
	Tags           []string `json:"tags,omitempty"`
	UpdatedBy      string   `json:"updatedBy,omitempty"`
	UpdatedAt      string   `json:"updatedAt"`
}

type UpdateContactKanbanStageRequest struct {
	SessionID      string `json:"sessionId"`
	ConversationID string `json:"conversationId"`
	Stage          string `json:"stage"`
	UpdatedBy      string `json:"updatedBy,omitempty"`
}

type CreateManualContactRequest struct {
	SessionID string `json:"sessionId"`
	Name      string `json:"name"`
	Phone     string `json:"phone"`
	Stage     string `json:"stage,omitempty"`
	UpdatedBy string `json:"updatedBy,omitempty"`
}

type CreateContactKanbanBoardRequest struct {
	ID                     string `json:"id"`
	Label                  string `json:"label"`
	Description            string `json:"description"`
	ContactsFilter         string `json:"contactsFilter"`
	ContactsAudienceFilter string `json:"contactsAudienceFilter"`
	ContactsChannelFilter  string `json:"contactsChannelFilter"`
	CreatedBy              string `json:"createdBy,omitempty"`
	UpdatedBy              string `json:"updatedBy,omitempty"`
}

type UpdateContactCRMProfileRequest struct {
	SessionID      string   `json:"sessionId"`
	ConversationID string   `json:"conversationId"`
	Assignee       string   `json:"assignee,omitempty"`
	Priority       string   `json:"priority,omitempty"`
	Notes          string   `json:"notes,omitempty"`
	Tags           []string `json:"tags,omitempty"`
	UpdatedBy      string   `json:"updatedBy,omitempty"`
}

func NowString() string {
	return time.Now().UTC().Format(time.RFC3339)
}
