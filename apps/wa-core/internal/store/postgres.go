package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	_ "github.com/lib/pq"

	"pulsehub/wa-core/internal/models"
)

type Store struct {
	db *sql.DB
}

func OpenPostgres(dsn string) (*Store, error) {
	if strings.TrimSpace(dsn) == "" {
		return nil, errors.New("DATABASE_URL is required")
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(25)
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	store := &Store{db: db}
	if err := store.migrate(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}

	return store, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) migrate(ctx context.Context) error {
	query := `
	CREATE TABLE IF NOT EXISTS app_session (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		phone_number TEXT NOT NULL,
		channel_id TEXT NOT NULL,
		channel_name TEXT NOT NULL,
		status TEXT NOT NULL,
		qr_code TEXT NOT NULL DEFAULT '',
		qr_code_data_url TEXT NOT NULL DEFAULT '',
		last_error TEXT NOT NULL DEFAULT '',
		device_jid TEXT NOT NULL DEFAULT '',
		business_name TEXT NOT NULL DEFAULT '',
		platform TEXT NOT NULL DEFAULT '',
		connected_at TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS contacts (
		jid TEXT PRIMARY KEY,
		phone TEXT NOT NULL DEFAULT '',
		first_name TEXT NOT NULL DEFAULT '',
		full_name TEXT NOT NULL DEFAULT '',
		push_name TEXT NOT NULL DEFAULT '',
		business_name TEXT NOT NULL DEFAULT '',
		display_name TEXT NOT NULL,
		photo_id TEXT NOT NULL DEFAULT '',
		photo_url TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS chats (
		jid TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		contact_jid TEXT NOT NULL DEFAULT '',
		is_group BOOLEAN NOT NULL DEFAULT FALSE,
		unread_count INTEGER NOT NULL DEFAULT 0,
		last_message_id TEXT NOT NULL DEFAULT '',
		last_message_text TEXT NOT NULL DEFAULT '',
		last_message_at TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		chat_jid TEXT NOT NULL,
		sender_jid TEXT NOT NULL DEFAULT '',
		author TEXT NOT NULL DEFAULT '',
		from_me BOOLEAN NOT NULL DEFAULT FALSE,
		ack_status TEXT NOT NULL DEFAULT '',
		kind TEXT NOT NULL DEFAULT 'text',
		mime_type TEXT NOT NULL DEFAULT '',
		file_name TEXT NOT NULL DEFAULT '',
		text TEXT NOT NULL,
		raw_json TEXT NOT NULL DEFAULT '',
		timestamp TEXT NOT NULL,
		created_at TEXT NOT NULL,
		CONSTRAINT fk_chat FOREIGN KEY(chat_jid) REFERENCES chats(jid) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS contact_kanban_stage (
		session_id TEXT NOT NULL,
		conversation_id TEXT NOT NULL,
		stage TEXT NOT NULL,
		updated_by TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL,
		PRIMARY KEY (session_id, conversation_id)
	);

	CREATE TABLE IF NOT EXISTS contact_kanban_board (
		id TEXT PRIMARY KEY,
		label TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		contacts_filter TEXT NOT NULL DEFAULT 'all',
		contacts_audience_filter TEXT NOT NULL DEFAULT 'all',
		contacts_channel_filter TEXT NOT NULL DEFAULT 'all',
		created_by TEXT NOT NULL DEFAULT '',
		updated_by TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS contact_crm_profile (
		session_id TEXT NOT NULL,
		conversation_id TEXT NOT NULL,
		assignee TEXT NOT NULL DEFAULT '',
		priority TEXT NOT NULL DEFAULT '',
		notes TEXT NOT NULL DEFAULT '',
		tags_json TEXT NOT NULL DEFAULT '[]',
		updated_by TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL,
		PRIMARY KEY (session_id, conversation_id)
	);

	ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';
	ALTER TABLE messages ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT '';
	ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name TEXT NOT NULL DEFAULT '';

	CREATE INDEX IF NOT EXISTS idx_contacts_display_name ON contacts(display_name);
	CREATE INDEX IF NOT EXISTS idx_chats_last_message_at ON chats(last_message_at DESC);
	CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp ON messages(chat_jid, timestamp ASC);
	CREATE INDEX IF NOT EXISTS idx_contact_kanban_stage_updated_at ON contact_kanban_stage(updated_at DESC);
	CREATE INDEX IF NOT EXISTS idx_contact_kanban_board_updated_at ON contact_kanban_board(updated_at DESC);
	CREATE INDEX IF NOT EXISTS idx_contact_crm_profile_updated_at ON contact_crm_profile(updated_at DESC);
	`

	if _, err := s.db.ExecContext(ctx, query); err != nil {
		return fmt.Errorf("migrate postgres schema: %w", err)
	}

	return nil
}

func (s *Store) GetSession(ctx context.Context) (*models.Session, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, name, phone_number, channel_id, channel_name, status, qr_code,
			qr_code_data_url, last_error, device_jid, business_name, platform,
			connected_at, created_at, updated_at
		FROM app_session
		WHERE id = $1
	`, models.DefaultSessionID)

	var session models.Session
	if err := row.Scan(
		&session.ID,
		&session.Name,
		&session.PhoneNumber,
		&session.ChannelID,
		&session.ChannelName,
		&session.Status,
		&session.QRCode,
		&session.QRCodeDataURL,
		&session.LastError,
		&session.DeviceJID,
		&session.BusinessName,
		&session.Platform,
		&session.ConnectedAt,
		&session.CreatedAt,
		&session.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get session: %w", err)
	}

	return &session, nil
}

func (s *Store) SaveSession(ctx context.Context, session models.Session) error {
	if session.ID == "" {
		session.ID = models.DefaultSessionID
	}
	if session.CreatedAt == "" {
		session.CreatedAt = models.NowString()
	}
	if session.UpdatedAt == "" {
		session.UpdatedAt = models.NowString()
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO app_session (
			id, name, phone_number, channel_id, channel_name, status, qr_code,
			qr_code_data_url, last_error, device_jid, business_name, platform,
			connected_at, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			phone_number = excluded.phone_number,
			channel_id = excluded.channel_id,
			channel_name = excluded.channel_name,
			status = excluded.status,
			qr_code = excluded.qr_code,
			qr_code_data_url = excluded.qr_code_data_url,
			last_error = excluded.last_error,
			device_jid = excluded.device_jid,
			business_name = excluded.business_name,
			platform = excluded.platform,
			connected_at = excluded.connected_at,
			updated_at = excluded.updated_at
	`,
		session.ID,
		session.Name,
		session.PhoneNumber,
		session.ChannelID,
		session.ChannelName,
		string(session.Status),
		session.QRCode,
		session.QRCodeDataURL,
		session.LastError,
		session.DeviceJID,
		session.BusinessName,
		session.Platform,
		session.ConnectedAt,
		session.CreatedAt,
		session.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("save session: %w", err)
	}

	return nil
}

func (s *Store) UpsertContact(ctx context.Context, contact models.Contact) error {
	if contact.DisplayName == "" {
		contact.DisplayName = contact.JID
	}
	if contact.UpdatedAt == "" {
		contact.UpdatedAt = models.NowString()
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO contacts (
			jid, phone, first_name, full_name, push_name, business_name, display_name,
			photo_id, photo_url, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT(jid) DO UPDATE SET
			phone = excluded.phone,
			first_name = excluded.first_name,
			full_name = excluded.full_name,
			push_name = excluded.push_name,
			business_name = excluded.business_name,
			display_name = excluded.display_name,
			photo_id = CASE WHEN excluded.photo_id = '' THEN contacts.photo_id ELSE excluded.photo_id END,
			photo_url = CASE WHEN excluded.photo_url = '' THEN contacts.photo_url ELSE excluded.photo_url END,
			updated_at = excluded.updated_at
	`,
		contact.JID,
		contact.Phone,
		contact.FirstName,
		contact.FullName,
		contact.PushName,
		contact.BusinessName,
		contact.DisplayName,
		contact.PhotoID,
		contact.PhotoURL,
		contact.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("upsert contact %s: %w", contact.JID, err)
	}

	return nil
}

func (s *Store) UpdateContactPhoto(ctx context.Context, jid, photoID, photoURL string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE contacts
		SET photo_id = $1, photo_url = $2, updated_at = $3
		WHERE jid = $4
	`, photoID, photoURL, models.NowString(), jid)
	if err != nil {
		return fmt.Errorf("update contact photo %s: %w", jid, err)
	}
	return nil
}

func (s *Store) GetContact(ctx context.Context, jid string) (*models.Contact, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT jid, phone, first_name, full_name, push_name, business_name, display_name,
			photo_id, photo_url, updated_at
		FROM contacts
		WHERE jid = $1
	`, jid)

	var contact models.Contact
	if err := row.Scan(
		&contact.JID,
		&contact.Phone,
		&contact.FirstName,
		&contact.FullName,
		&contact.PushName,
		&contact.BusinessName,
		&contact.DisplayName,
		&contact.PhotoID,
		&contact.PhotoURL,
		&contact.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get contact %s: %w", jid, err)
	}

	return &contact, nil
}

func (s *Store) ListContacts(ctx context.Context) ([]models.Contact, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT jid, phone, first_name, full_name, push_name, business_name, display_name,
			photo_id, photo_url, updated_at
		FROM contacts
		ORDER BY display_name ASC, jid ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list contacts: %w", err)
	}
	defer rows.Close()

	contacts := make([]models.Contact, 0)
	for rows.Next() {
		var contact models.Contact
		if err := rows.Scan(
			&contact.JID,
			&contact.Phone,
			&contact.FirstName,
			&contact.FullName,
			&contact.PushName,
			&contact.BusinessName,
			&contact.DisplayName,
			&contact.PhotoID,
			&contact.PhotoURL,
			&contact.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan contact: %w", err)
		}
		contacts = append(contacts, contact)
	}

	return contacts, rows.Err()
}

func (s *Store) UpsertChat(ctx context.Context, chat models.Chat) (bool, error) {
	if chat.Name == "" {
		chat.Name = chat.JID
	}
	if chat.UpdatedAt == "" {
		chat.UpdatedAt = models.NowString()
	}

	existing, err := s.GetChat(ctx, chat.JID)
	if err != nil {
		return false, err
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO chats (
			jid, name, contact_jid, is_group, unread_count, last_message_id,
			last_message_text, last_message_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT(jid) DO UPDATE SET
			name = excluded.name,
			contact_jid = excluded.contact_jid,
			is_group = excluded.is_group,
			unread_count = CASE WHEN excluded.unread_count < chats.unread_count THEN chats.unread_count ELSE excluded.unread_count END,
			last_message_id = CASE WHEN excluded.last_message_id = '' THEN chats.last_message_id ELSE excluded.last_message_id END,
			last_message_text = CASE WHEN excluded.last_message_text = '' THEN chats.last_message_text ELSE excluded.last_message_text END,
			last_message_at = CASE WHEN excluded.last_message_at = '' THEN chats.last_message_at ELSE excluded.last_message_at END,
			updated_at = excluded.updated_at
	`,
		chat.JID,
		chat.Name,
		chat.ContactJID,
		chat.IsGroup,
		chat.UnreadCount,
		chat.LastMessageID,
		chat.LastMessageText,
		chat.LastMessageAt,
		chat.UpdatedAt,
	)
	if err != nil {
		return false, fmt.Errorf("upsert chat %s: %w", chat.JID, err)
	}

	return existing == nil, nil
}

func (s *Store) GetChat(ctx context.Context, jid string) (*models.Chat, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT jid, name, contact_jid, is_group, unread_count, last_message_id,
			last_message_text, last_message_at, updated_at
		FROM chats
		WHERE jid = $1
	`, jid)

	var chat models.Chat
	if err := row.Scan(
		&chat.JID,
		&chat.Name,
		&chat.ContactJID,
		&chat.IsGroup,
		&chat.UnreadCount,
		&chat.LastMessageID,
		&chat.LastMessageText,
		&chat.LastMessageAt,
		&chat.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get chat %s: %w", jid, err)
	}

	return &chat, nil
}

func (s *Store) ListChats(ctx context.Context) ([]models.Chat, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT jid, name, contact_jid, is_group, unread_count, last_message_id,
			last_message_text, last_message_at, updated_at
		FROM chats
		ORDER BY CASE WHEN last_message_at = '' THEN updated_at ELSE last_message_at END DESC, name ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list chats: %w", err)
	}
	defer rows.Close()

	chats := make([]models.Chat, 0)
	for rows.Next() {
		var chat models.Chat
		if err := rows.Scan(
			&chat.JID,
			&chat.Name,
			&chat.ContactJID,
			&chat.IsGroup,
			&chat.UnreadCount,
			&chat.LastMessageID,
			&chat.LastMessageText,
			&chat.LastMessageAt,
			&chat.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan chat: %w", err)
		}
		chats = append(chats, chat)
	}

	return chats, rows.Err()
}

func (s *Store) SaveMessage(ctx context.Context, message models.Message) (bool, error) {
	message.Timestamp = strings.TrimSpace(message.Timestamp)
	if message.Timestamp == "" {
		message.Timestamp = models.NowString()
	}

	res, err := s.db.ExecContext(ctx, `
		INSERT INTO messages (
			id, chat_jid, sender_jid, author, from_me, ack_status, kind, mime_type,
			file_name, text, raw_json, timestamp, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		ON CONFLICT (id) DO NOTHING
	`,
		message.ID,
		message.ChatJID,
		message.SenderJID,
		message.Author,
		message.FromMe,
		message.AckStatus,
		message.Kind,
		message.MimeType,
		message.FileName,
		message.Text,
		message.RawJSON,
		message.Timestamp,
		models.NowString(),
	)
	if err != nil {
		return false, fmt.Errorf("insert message %s: %w", message.ID, err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("rows affected for message %s: %w", message.ID, err)
	}

	if affected == 0 {
		_, err = s.db.ExecContext(ctx, `
			UPDATE messages
			SET sender_jid = CASE WHEN $1 = '' THEN sender_jid ELSE $1 END,
				author = CASE WHEN $2 = '' THEN author ELSE $2 END,
				from_me = CASE WHEN from_me = TRUE THEN TRUE ELSE $3 END,
				ack_status = CASE WHEN $4 = '' THEN ack_status ELSE $4 END,
				kind = CASE WHEN $5 = '' THEN kind ELSE $5 END,
				mime_type = CASE WHEN $6 = '' THEN mime_type ELSE $6 END,
				file_name = CASE WHEN $7 = '' THEN file_name ELSE $7 END,
				text = CASE
					WHEN ($8 = '' OR $8 = '[midia]') AND text <> '' AND text <> '[midia]' THEN text
					ELSE $8
				END,
				raw_json = CASE WHEN $9 = '' THEN raw_json ELSE $9 END,
				timestamp = CASE WHEN $10 = '' THEN timestamp ELSE $10 END
			WHERE id = $11
		`,
			message.SenderJID,
			message.Author,
			message.FromMe,
			message.AckStatus,
			message.Kind,
			message.MimeType,
			message.FileName,
			message.Text,
			message.RawJSON,
			message.Timestamp,
			message.ID,
		)
		if err != nil {
			return false, fmt.Errorf("update message %s: %w", message.ID, err)
		}
		return false, nil
	}

	chat, err := s.GetChat(ctx, message.ChatJID)
	if err != nil {
		return true, err
	}
	if chat == nil {
		chat = &models.Chat{
			JID:       message.ChatJID,
			Name:      message.ChatJID,
			UpdatedAt: models.NowString(),
		}
	}

	if !message.FromMe {
		chat.UnreadCount++
	}
	chat.LastMessageID = message.ID
	chat.LastMessageText = message.Text
	chat.LastMessageAt = message.Timestamp
	chat.UpdatedAt = models.NowString()

	_, err = s.UpsertChat(ctx, *chat)
	if err != nil {
		return true, err
	}

	return true, nil
}

func (s *Store) ListMessagesByChat(ctx context.Context, chatJID string) ([]models.Message, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, chat_jid, sender_jid, author, from_me, ack_status, kind, mime_type, file_name, text, raw_json, timestamp
		FROM messages
		WHERE chat_jid = $1
		ORDER BY timestamp ASC, id ASC
	`, chatJID)
	if err != nil {
		return nil, fmt.Errorf("list messages for chat %s: %w", chatJID, err)
	}
	defer rows.Close()

	messages := make([]models.Message, 0)
	for rows.Next() {
		var message models.Message
		if err := rows.Scan(
			&message.ID,
			&message.ChatJID,
			&message.SenderJID,
			&message.Author,
			&message.FromMe,
			&message.AckStatus,
			&message.Kind,
			&message.MimeType,
			&message.FileName,
			&message.Text,
			&message.RawJSON,
			&message.Timestamp,
		); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		messages = append(messages, message)
	}

	return messages, rows.Err()
}

func (s *Store) GetMessageByID(ctx context.Context, messageID string) (*models.Message, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, chat_jid, sender_jid, author, from_me, ack_status, kind, mime_type, file_name, text, raw_json, timestamp
		FROM messages
		WHERE id = $1
	`, messageID)

	var message models.Message
	if err := row.Scan(
		&message.ID,
		&message.ChatJID,
		&message.SenderJID,
		&message.Author,
		&message.FromMe,
		&message.AckStatus,
		&message.Kind,
		&message.MimeType,
		&message.FileName,
		&message.Text,
		&message.RawJSON,
		&message.Timestamp,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get message %s: %w", messageID, err)
	}

	return &message, nil
}

func (s *Store) ListUnreadMessageGroupsByChat(ctx context.Context, chatJID string) (map[string][]models.Message, error) {
	messages, err := s.ListMessagesByChat(ctx, chatJID)
	if err != nil {
		return nil, err
	}

	grouped := make(map[string][]models.Message)
	for _, message := range messages {
		if message.FromMe || message.AckStatus == "read" || message.AckStatus == "read-self" || message.AckStatus == "played" {
			continue
		}
		sender := message.SenderJID
		if sender == "" {
			sender = message.ChatJID
		}
		grouped[sender] = append(grouped[sender], message)
	}

	for sender := range grouped {
		sort.Slice(grouped[sender], func(i, j int) bool {
			return grouped[sender][i].Timestamp < grouped[sender][j].Timestamp
		})
	}

	return grouped, nil
}

func (s *Store) MarkChatRead(ctx context.Context, chatJID string) error {
	if _, err := s.db.ExecContext(ctx, `UPDATE chats SET unread_count = 0, updated_at = $1 WHERE jid = $2`, models.NowString(), chatJID); err != nil {
		return fmt.Errorf("mark chat read %s: %w", chatJID, err)
	}

	if _, err := s.db.ExecContext(ctx, `
		UPDATE messages
		SET ack_status = CASE WHEN from_me = FALSE THEN 'read' ELSE ack_status END
		WHERE chat_jid = $1
	`, chatJID); err != nil {
		return fmt.Errorf("mark messages read for chat %s: %w", chatJID, err)
	}

	return nil
}

func (s *Store) UpdateMessageAck(ctx context.Context, messageID, ackStatus string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE messages SET ack_status = $1 WHERE id = $2`, ackStatus, messageID)
	if err != nil {
		return fmt.Errorf("update ack for message %s: %w", messageID, err)
	}
	return nil
}

func (s *Store) ListContactKanbanStages(ctx context.Context) ([]models.ContactKanbanStageRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT session_id, conversation_id, stage, updated_by, updated_at
		FROM contact_kanban_stage
		ORDER BY updated_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list contact kanban stages: %w", err)
	}
	defer rows.Close()

	items := make([]models.ContactKanbanStageRecord, 0)
	for rows.Next() {
		var item models.ContactKanbanStageRecord
		if err := rows.Scan(
			&item.SessionID,
			&item.ConversationID,
			&item.Stage,
			&item.UpdatedBy,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan contact kanban stage: %w", err)
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate contact kanban stages: %w", err)
	}

	return items, nil
}

func (s *Store) SaveContactKanbanStage(ctx context.Context, item models.ContactKanbanStageRecord) error {
	if item.UpdatedAt == "" {
		item.UpdatedAt = models.NowString()
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO contact_kanban_stage (
			session_id, conversation_id, stage, updated_by, updated_at
		)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (session_id, conversation_id) DO UPDATE SET
			stage = excluded.stage,
			updated_by = excluded.updated_by,
			updated_at = excluded.updated_at
	`, item.SessionID, item.ConversationID, item.Stage, item.UpdatedBy, item.UpdatedAt)
	if err != nil {
		return fmt.Errorf("save contact kanban stage: %w", err)
	}

	return nil
}

func (s *Store) ListContactKanbanBoards(ctx context.Context) ([]models.ContactKanbanBoardRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, label, description, contacts_filter, contacts_audience_filter, contacts_channel_filter,
			created_by, updated_by, created_at, updated_at
		FROM contact_kanban_board
		ORDER BY updated_at DESC, label ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list contact kanban boards: %w", err)
	}
	defer rows.Close()

	items := make([]models.ContactKanbanBoardRecord, 0)
	for rows.Next() {
		var item models.ContactKanbanBoardRecord
		if err := rows.Scan(
			&item.ID,
			&item.Label,
			&item.Description,
			&item.ContactsFilter,
			&item.ContactsAudienceFilter,
			&item.ContactsChannelFilter,
			&item.CreatedBy,
			&item.UpdatedBy,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan contact kanban board: %w", err)
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate contact kanban boards: %w", err)
	}

	return items, nil
}

func (s *Store) SaveContactKanbanBoard(ctx context.Context, item models.ContactKanbanBoardRecord) error {
	if item.CreatedAt == "" {
		item.CreatedAt = models.NowString()
	}
	if item.UpdatedAt == "" {
		item.UpdatedAt = models.NowString()
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO contact_kanban_board (
			id, label, description, contacts_filter, contacts_audience_filter, contacts_channel_filter,
			created_by, updated_by, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (id) DO UPDATE SET
			label = excluded.label,
			description = excluded.description,
			contacts_filter = excluded.contacts_filter,
			contacts_audience_filter = excluded.contacts_audience_filter,
			contacts_channel_filter = excluded.contacts_channel_filter,
			updated_by = excluded.updated_by,
			updated_at = excluded.updated_at
	`, item.ID, item.Label, item.Description, item.ContactsFilter, item.ContactsAudienceFilter, item.ContactsChannelFilter, item.CreatedBy, item.UpdatedBy, item.CreatedAt, item.UpdatedAt)
	if err != nil {
		return fmt.Errorf("save contact kanban board: %w", err)
	}

	return nil
}

func (s *Store) DeleteContactKanbanBoard(ctx context.Context, boardID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM contact_kanban_board WHERE id = $1`, boardID)
	if err != nil {
		return fmt.Errorf("delete contact kanban board: %w", err)
	}

	return nil
}

func (s *Store) ListContactCRMProfiles(ctx context.Context) ([]models.ContactCRMProfileRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT session_id, conversation_id, assignee, priority, notes, tags_json, updated_by, updated_at
		FROM contact_crm_profile
		ORDER BY updated_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list contact crm profiles: %w", err)
	}
	defer rows.Close()

	items := make([]models.ContactCRMProfileRecord, 0)
	for rows.Next() {
		var item models.ContactCRMProfileRecord
		var tagsJSON string
		if err := rows.Scan(
			&item.SessionID,
			&item.ConversationID,
			&item.Assignee,
			&item.Priority,
			&item.Notes,
			&tagsJSON,
			&item.UpdatedBy,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan contact crm profile: %w", err)
		}
		if err := json.Unmarshal([]byte(tagsJSON), &item.Tags); err != nil {
			item.Tags = []string{}
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate contact crm profiles: %w", err)
	}

	return items, nil
}

func (s *Store) SaveContactCRMProfile(ctx context.Context, item models.ContactCRMProfileRecord) error {
	if item.UpdatedAt == "" {
		item.UpdatedAt = models.NowString()
	}

	tagsJSON, err := json.Marshal(item.Tags)
	if err != nil {
		return fmt.Errorf("marshal contact crm tags: %w", err)
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO contact_crm_profile (
			session_id, conversation_id, assignee, priority, notes, tags_json, updated_by, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (session_id, conversation_id) DO UPDATE SET
			assignee = excluded.assignee,
			priority = excluded.priority,
			notes = excluded.notes,
			tags_json = excluded.tags_json,
			updated_by = excluded.updated_by,
			updated_at = excluded.updated_at
	`, item.SessionID, item.ConversationID, item.Assignee, item.Priority, item.Notes, string(tagsJSON), item.UpdatedBy, item.UpdatedAt)
	if err != nil {
		return fmt.Errorf("save contact crm profile: %w", err)
	}

	return nil
}
