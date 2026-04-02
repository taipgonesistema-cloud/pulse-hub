package models

import "time"

const DefaultSessionID = "default"

type SessionStatus string

type AuthRole string
type QuickReplyVisibilityScope string
type QuickReplyStatus string

const (
	SessionStatusIdle         SessionStatus = "idle"
	SessionStatusInitializing SessionStatus = "initializing"
	SessionStatusQRReady      SessionStatus = "qr_ready"
	SessionStatusSyncing      SessionStatus = "syncing"
	SessionStatusActive       SessionStatus = "active"
	SessionStatusDisconnected SessionStatus = "disconnected"
	SessionStatusError        SessionStatus = "error"

	AuthRoleAdmin      AuthRole = "admin"
	AuthRoleSupervisor AuthRole = "supervisor"
	AuthRoleAttendant  AuthRole = "attendant"

	QuickReplyVisibilityAll  QuickReplyVisibilityScope = "all"
	QuickReplyVisibilityUser QuickReplyVisibilityScope = "user"

	QuickReplyStatusActive   QuickReplyStatus = "active"
	QuickReplyStatusInactive QuickReplyStatus = "inactive"
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
	JID              string `json:"jid"`
	Text             string `json:"text"`
	ReplyToMessageID string `json:"replyToMessageId,omitempty"`
}

type SendMediaRequest struct {
	JID              string
	Caption          string
	FileName         string
	MimeType         string
	Data             []byte
	Sticker          bool
	ReplyToMessageID string
}

type SendReactionRequest struct {
	JID       string `json:"jid"`
	MessageID string `json:"messageId"`
	Emoji     string `json:"emoji"`
	Author    string `json:"author,omitempty"`
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
	ID          string   `json:"id"`
	Email       string   `json:"email"`
	Name        string   `json:"name"`
	Role        AuthRole `json:"role"`
	IsActive    bool     `json:"isActive"`
	LastLoginAt string   `json:"lastLoginAt,omitempty"`
	CreatedAt   string   `json:"createdAt"`
	UpdatedAt   string   `json:"updatedAt"`
}

type AuthSession struct {
	ID         string `json:"id"`
	UserID     string `json:"userId"`
	TokenHash  string `json:"-"`
	CreatedAt  string `json:"createdAt"`
	LastSeenAt string `json:"lastSeenAt"`
	ExpiresAt  string `json:"expiresAt"`
	RevokedAt  string `json:"revokedAt,omitempty"`
	UserAgent  string `json:"userAgent,omitempty"`
	RemoteAddr string `json:"remoteAddr,omitempty"`
	UpdatedAt  string `json:"updatedAt"`
}

type AuthSessionRecord struct {
	ID         string `json:"id"`
	UserID     string `json:"userId"`
	CreatedAt  string `json:"createdAt"`
	LastSeenAt string `json:"lastSeenAt"`
	ExpiresAt  string `json:"expiresAt"`
	UserAgent  string `json:"userAgent,omitempty"`
	RemoteAddr string `json:"remoteAddr,omitempty"`
	UpdatedAt  string `json:"updatedAt"`
}

type AuditLogRecord struct {
	ID           string         `json:"id"`
	ActorUserID  string         `json:"actorUserId,omitempty"`
	ActorName    string         `json:"actorName,omitempty"`
	ActorRole    AuthRole       `json:"actorRole,omitempty"`
	Action       string         `json:"action"`
	ResourceType string         `json:"resourceType"`
	ResourceID   string         `json:"resourceId,omitempty"`
	Summary      string         `json:"summary"`
	Details      map[string]any `json:"details,omitempty"`
	RemoteAddr   string         `json:"remoteAddr,omitempty"`
	UserAgent    string         `json:"userAgent,omitempty"`
	CreatedAt    string         `json:"createdAt"`
}

type SignInRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type SignInResponse struct {
	User      AuthUser `json:"user"`
	CSRFToken string   `json:"csrfToken"`
}

type CurrentUserResponse struct {
	User      AuthUser `json:"user"`
	CSRFToken string   `json:"csrfToken"`
}

type CreateUserRequest struct {
	Email    string   `json:"email"`
	Name     string   `json:"name"`
	Password string   `json:"password"`
	Role     AuthRole `json:"role"`
	IsActive *bool    `json:"isActive,omitempty"`
}

type UpdateUserRequest struct {
	Name     string   `json:"name"`
	Password string   `json:"password,omitempty"`
	Role     AuthRole `json:"role"`
	IsActive *bool    `json:"isActive,omitempty"`
}

type QuickReplyRecord struct {
	ID               string                    `json:"id"`
	Name             string                    `json:"name"`
	Shortcut         string                    `json:"shortcut"`
	Content          string                    `json:"content"`
	Category         string                    `json:"category,omitempty"`
	VisibilityScope  QuickReplyVisibilityScope `json:"visibilityScope"`
	VisibilityUserID string                    `json:"visibilityUserId,omitempty"`
	Status           QuickReplyStatus          `json:"status"`
	CreatedByUserID  string                    `json:"createdByUserId,omitempty"`
	CreatedBy        string                    `json:"createdBy,omitempty"`
	UpdatedByUserID  string                    `json:"updatedByUserId,omitempty"`
	UpdatedBy        string                    `json:"updatedBy,omitempty"`
	CreatedAt        string                    `json:"createdAt"`
	UpdatedAt        string                    `json:"updatedAt"`
}

type SaveQuickReplyRequest struct {
	Name             string                    `json:"name"`
	Shortcut         string                    `json:"shortcut"`
	Content          string                    `json:"content"`
	Category         string                    `json:"category,omitempty"`
	VisibilityScope  QuickReplyVisibilityScope `json:"visibilityScope"`
	VisibilityUserID string                    `json:"visibilityUserId,omitempty"`
	Status           QuickReplyStatus          `json:"status"`
}

type ChannelRecord struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Color            string `json:"color"`
	ConnectedNumbers int    `json:"connectedNumbers"`
}

type MessageRecord struct {
	ID             string              `json:"id"`
	ConversationID string              `json:"conversationId"`
	Direction      string              `json:"direction"`
	Kind           string              `json:"kind,omitempty"`
	Body           string              `json:"body"`
	MediaURL       string              `json:"mediaUrl,omitempty"`
	MimeType       string              `json:"mimeType,omitempty"`
	FileName       string              `json:"fileName,omitempty"`
	Timestamp      string              `json:"timestamp"`
	Author         string              `json:"author"`
	ReplyTo        *MessageReplyRecord `json:"replyTo,omitempty"`
	Reactions      []MessageReaction   `json:"reactions,omitempty"`
}

type MessageReplyRecord struct {
	MessageID string `json:"messageId"`
	Author    string `json:"author,omitempty"`
	Body      string `json:"body,omitempty"`
	Kind      string `json:"kind,omitempty"`
}

type MessageReaction struct {
	Emoji  string `json:"emoji"`
	Count  int    `json:"count"`
	FromMe bool   `json:"fromMe,omitempty"`
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
	Dashboard DashboardDerivedMetrics `json:"dashboard"`
	Analytics struct {
		ResponseVelocity   DashboardResponseVelocityAnalytics  `json:"responseVelocity"`
		HealthScore        float64                             `json:"healthScore"`
		ResolvedRate       float64                             `json:"resolvedRate"`
		TotalConversations int                                 `json:"totalConversations"`
		UnreadVolume       int                                 `json:"unreadVolume"`
		WaitingVolume      int                                 `json:"waitingVolume"`
		ChannelTotals      DashboardChannelTotals              `json:"channelTotals"`
		WeeklySeries       []DashboardWeeklyChannelSeriesPoint `json:"weeklyChannelSeries"`
		HeatmapRows        []DashboardHeatmapRow               `json:"heatmapRows"`
		ResolvedTickets    []DashboardResolvedConversation     `json:"resolvedTickets"`
	} `json:"analytics"`
	Channels      []ChannelRecord      `json:"channels"`
	Sessions      []SessionRecord      `json:"sessions"`
	Conversations []ConversationRecord `json:"conversations"`
}

type DashboardDerivedMetrics struct {
	Snapshot    DashboardSnapshot         `json:"snapshot"`
	Leaderboard []DashboardLeaderboardRow `json:"leaderboard"`
}

type DashboardSnapshot struct {
	ActiveSessions      int `json:"activeSessions"`
	OnlineUsers         int `json:"onlineUsers"`
	RecentConversations int `json:"recentConversations"`
	TeamCount           int `json:"teamCount"`
}

type DashboardLeaderboardRow struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
	Score       int    `json:"score"`
	Volume      int    `json:"volume"`
	VolumeLabel string `json:"volumeLabel"`
	Rank        int    `json:"rank"`
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

type DashboardChannelTotals struct {
	WhatsApp  int `json:"whatsapp"`
	Instagram int `json:"instagram"`
	Facebook  int `json:"facebook"`
}

type DashboardWeeklyChannelSeriesPoint struct {
	Day     string `json:"day"`
	Channel string `json:"channel"`
	Value   int    `json:"value"`
}

type DashboardHeatmapRow struct {
	Day    string `json:"day"`
	Values []int  `json:"values"`
}

type DashboardResolvedConversation struct {
	ID             string `json:"id"`
	Customer       string `json:"customer"`
	CustomerAvatar string `json:"customerAvatar,omitempty"`
	Channel        string `json:"channel"`
	Agent          string `json:"agent"`
	LastActivityAt string `json:"lastActivityAt"`
	StatusLabel    string `json:"statusLabel"`
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
