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

	"github.com/google/uuid"
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
		session_id TEXT NOT NULL DEFAULT 'default',
		remote_jid TEXT NOT NULL DEFAULT '',
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
		session_id TEXT NOT NULL DEFAULT 'default',
		remote_id TEXT NOT NULL DEFAULT '',
		chat_jid TEXT NOT NULL,
		remote_chat_jid TEXT NOT NULL DEFAULT '',
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

	CREATE TABLE IF NOT EXISTS contact_label (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		emoji TEXT NOT NULL DEFAULT '',
		color TEXT NOT NULL,
		created_by TEXT NOT NULL DEFAULT '',
		updated_by TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS app_user (
		id TEXT PRIMARY KEY,
		email TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL,
		is_active BOOLEAN NOT NULL DEFAULT TRUE,
		last_login_at TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS app_user_session (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		token_hash TEXT NOT NULL UNIQUE,
		last_seen_at TEXT NOT NULL,
		expires_at TEXT NOT NULL,
		revoked_at TEXT NOT NULL DEFAULT '',
		user_agent TEXT NOT NULL DEFAULT '',
		remote_addr TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		CONSTRAINT fk_app_user FOREIGN KEY(user_id) REFERENCES app_user(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS audit_log (
		id TEXT PRIMARY KEY,
		actor_user_id TEXT NOT NULL DEFAULT '',
		actor_name TEXT NOT NULL DEFAULT '',
		actor_role TEXT NOT NULL DEFAULT '',
		action TEXT NOT NULL,
		resource_type TEXT NOT NULL,
		resource_id TEXT NOT NULL DEFAULT '',
		summary TEXT NOT NULL DEFAULT '',
		details_json TEXT NOT NULL DEFAULT '{}',
		remote_addr TEXT NOT NULL DEFAULT '',
		user_agent TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS quick_reply (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		shortcut TEXT NOT NULL,
		content TEXT NOT NULL,
		category TEXT NOT NULL DEFAULT '',
		visibility_scope TEXT NOT NULL,
		visibility_user_id TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL,
		created_by_user_id TEXT NOT NULL DEFAULT '',
		created_by TEXT NOT NULL DEFAULT '',
		updated_by_user_id TEXT NOT NULL DEFAULT '',
		updated_by TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';
	ALTER TABLE messages ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT '';
	ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name TEXT NOT NULL DEFAULT '';
	ALTER TABLE chats ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT 'default';
	ALTER TABLE chats ADD COLUMN IF NOT EXISTS remote_jid TEXT NOT NULL DEFAULT '';
	ALTER TABLE messages ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT 'default';
	ALTER TABLE messages ADD COLUMN IF NOT EXISTS remote_id TEXT NOT NULL DEFAULT '';
	ALTER TABLE messages ADD COLUMN IF NOT EXISTS remote_chat_jid TEXT NOT NULL DEFAULT '';

	CREATE INDEX IF NOT EXISTS idx_contacts_display_name ON contacts(display_name);
	CREATE INDEX IF NOT EXISTS idx_chats_last_message_at ON chats(last_message_at DESC);
	CREATE INDEX IF NOT EXISTS idx_chats_session_id ON chats(session_id, last_message_at DESC);
	CREATE INDEX IF NOT EXISTS idx_chats_session_conversation_sort ON chats(session_id, (COALESCE(NULLIF(remote_jid, ''), jid)), (COALESCE(NULLIF(last_message_at, ''), updated_at)) DESC);
	CREATE INDEX IF NOT EXISTS idx_chats_session_unread ON chats(session_id, unread_count);
	CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp ON messages(chat_jid, timestamp ASC);
	CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp_desc ON messages(chat_jid, timestamp DESC, id DESC);
	CREATE INDEX IF NOT EXISTS idx_messages_session_remote_id ON messages(session_id, remote_id);
	CREATE INDEX IF NOT EXISTS idx_contact_kanban_stage_updated_at ON contact_kanban_stage(updated_at DESC);
	CREATE INDEX IF NOT EXISTS idx_contact_kanban_board_updated_at ON contact_kanban_board(updated_at DESC);
	CREATE INDEX IF NOT EXISTS idx_contact_crm_profile_updated_at ON contact_crm_profile(updated_at DESC);
	CREATE INDEX IF NOT EXISTS idx_contact_label_updated_at ON contact_label(updated_at DESC);
	CREATE INDEX IF NOT EXISTS idx_app_user_role ON app_user(role);
	CREATE INDEX IF NOT EXISTS idx_app_user_session_user_id ON app_user_session(user_id);
	CREATE INDEX IF NOT EXISTS idx_app_user_session_expires_at ON app_user_session(expires_at);
	CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
	CREATE INDEX IF NOT EXISTS idx_audit_log_actor_user_id ON audit_log(actor_user_id, created_at DESC);
	CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id, created_at DESC);
	CREATE INDEX IF NOT EXISTS idx_quick_reply_name ON quick_reply(name);
	CREATE INDEX IF NOT EXISTS idx_quick_reply_shortcut ON quick_reply(shortcut);
	CREATE INDEX IF NOT EXISTS idx_quick_reply_visibility ON quick_reply(visibility_scope, visibility_user_id);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_quick_reply_shortcut_all_unique ON quick_reply (LOWER(shortcut)) WHERE visibility_scope = 'all';
	CREATE UNIQUE INDEX IF NOT EXISTS idx_quick_reply_shortcut_user_unique ON quick_reply (visibility_user_id, LOWER(shortcut)) WHERE visibility_scope = 'user';
	`

	if _, err := s.db.ExecContext(ctx, query); err != nil {
		return fmt.Errorf("migrate postgres schema: %w", err)
	}

	return nil
}

func (s *Store) GetSession(ctx context.Context) (*models.Session, error) {
	return s.GetSessionByID(ctx, models.DefaultSessionID)
}

func (s *Store) GetSessionByID(ctx context.Context, sessionID string) (*models.Session, error) {
	sessionID = normalizeSessionID(sessionID)
	row := s.db.QueryRowContext(ctx, `
		SELECT id, name, phone_number, channel_id, channel_name, status, qr_code,
			qr_code_data_url, last_error, device_jid, business_name, platform,
			connected_at, created_at, updated_at
		FROM app_session
		WHERE id = $1
	`, sessionID)

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
		return nil, fmt.Errorf("get session %s: %w", sessionID, err)
	}

	return &session, nil
}

func (s *Store) ListSessions(ctx context.Context) ([]models.Session, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, phone_number, channel_id, channel_name, status, qr_code,
			qr_code_data_url, last_error, device_jid, business_name, platform,
			connected_at, created_at, updated_at
		FROM app_session
		ORDER BY created_at ASC, id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	items := make([]models.Session, 0)
	for rows.Next() {
		var session models.Session
		if err := rows.Scan(
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
			return nil, fmt.Errorf("scan session: %w", err)
		}
		items = append(items, session)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sessions: %w", err)
	}

	return items, nil
}

func (s *Store) SaveSession(ctx context.Context, session models.Session) error {
	session.ID = normalizeSessionID(session.ID)
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

func (s *Store) DeleteSessionByID(ctx context.Context, sessionID string) (err error) {
	sessionID = normalizeSessionID(sessionID)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete session %s: %w", sessionID, err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	queries := []struct {
		name  string
		query string
	}{
		{name: "delete contact crm profiles", query: `DELETE FROM contact_crm_profile WHERE session_id = $1`},
		{name: "delete contact kanban stages", query: `DELETE FROM contact_kanban_stage WHERE session_id = $1`},
		{name: "delete messages", query: `DELETE FROM messages WHERE session_id = $1`},
		{name: "delete chats", query: `DELETE FROM chats WHERE session_id = $1`},
		{name: "delete session", query: `DELETE FROM app_session WHERE id = $1`},
	}

	for _, item := range queries {
		if _, err = tx.ExecContext(ctx, item.query, sessionID); err != nil {
			return fmt.Errorf("%s %s: %w", item.name, sessionID, err)
		}
	}

	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit delete session %s: %w", sessionID, err)
	}

	return nil
}

func normalizeSessionID(sessionID string) string {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return models.DefaultSessionID
	}
	return sessionID
}

func storageChatKey(sessionID, remoteJID string) string {
	sessionID = normalizeSessionID(sessionID)
	remoteJID = strings.TrimSpace(remoteJID)
	if sessionID == models.DefaultSessionID {
		return remoteJID
	}
	return sessionID + "::" + remoteJID
}

func storageMessageKey(sessionID, remoteID string) string {
	sessionID = normalizeSessionID(sessionID)
	remoteID = strings.TrimSpace(remoteID)
	if sessionID == models.DefaultSessionID {
		return remoteID
	}
	return sessionID + "::" + remoteID
}

func (s *Store) EnsureSeedUser(ctx context.Context, email, name, passwordHash string, role models.AuthRole) (*models.AuthUser, error) {
	email = normalizeUserEmail(email)
	if email == "" {
		return nil, errors.New("seed user email is required")
	}
	if strings.TrimSpace(passwordHash) == "" {
		return nil, errors.New("seed user password hash is required")
	}
	if strings.TrimSpace(name) == "" {
		name = "Pulse Hub Admin"
	}
	role = normalizeAuthRole(role)
	now := models.NowString()

	existing, currentPasswordHash, err := s.GetAuthUserByEmail(ctx, email)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		if currentPasswordHash == "" {
			if _, err := s.db.ExecContext(ctx, `
				UPDATE app_user
				SET password_hash = $1, role = $2, is_active = TRUE, updated_at = $3
				WHERE id = $4
			`, passwordHash, string(role), now, existing.ID); err != nil {
				return nil, fmt.Errorf("update seed user %s: %w", existing.ID, err)
			}
			existing.Role = role
			existing.IsActive = true
			existing.UpdatedAt = now
		}
		return existing, nil
	}

	user := models.AuthUser{
		ID:        uuid.NewString(),
		Email:     email,
		Name:      name,
		Role:      role,
		IsActive:  true,
		CreatedAt: now,
		UpdatedAt: now,
	}

	created, err := s.CreateAuthUser(ctx, user, passwordHash)
	if err != nil {
		return nil, err
	}

	return created, nil
}

func (s *Store) GetAuthUserByEmail(ctx context.Context, email string) (*models.AuthUser, string, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, email, name, password_hash, role, is_active, last_login_at, created_at, updated_at
		FROM app_user
		WHERE email = $1
	`, normalizeUserEmail(email))

	var user models.AuthUser
	var passwordHash string
	if err := row.Scan(
		&user.ID,
		&user.Email,
		&user.Name,
		&passwordHash,
		&user.Role,
		&user.IsActive,
		&user.LastLoginAt,
		&user.CreatedAt,
		&user.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, "", nil
		}
		return nil, "", fmt.Errorf("get auth user by email %s: %w", email, err)
	}

	return &user, passwordHash, nil
}

func (s *Store) GetAuthUserByID(ctx context.Context, userID string) (*models.AuthUser, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, email, name, role, is_active, last_login_at, created_at, updated_at
		FROM app_user
		WHERE id = $1
	`, strings.TrimSpace(userID))

	var user models.AuthUser
	if err := row.Scan(
		&user.ID,
		&user.Email,
		&user.Name,
		&user.Role,
		&user.IsActive,
		&user.LastLoginAt,
		&user.CreatedAt,
		&user.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get auth user %s: %w", userID, err)
	}

	return &user, nil
}

func (s *Store) ListAuthUsers(ctx context.Context) ([]models.AuthUser, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, email, name, role, is_active, last_login_at, created_at, updated_at
		FROM app_user
		ORDER BY name ASC, email ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list auth users: %w", err)
	}
	defer rows.Close()

	users := make([]models.AuthUser, 0)
	for rows.Next() {
		var user models.AuthUser
		if err := rows.Scan(
			&user.ID,
			&user.Email,
			&user.Name,
			&user.Role,
			&user.IsActive,
			&user.LastLoginAt,
			&user.CreatedAt,
			&user.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan auth user: %w", err)
		}
		users = append(users, user)
	}

	return users, rows.Err()
}

func (s *Store) CreateAuthUser(ctx context.Context, user models.AuthUser, passwordHash string) (*models.AuthUser, error) {
	if user.ID == "" {
		user.ID = uuid.NewString()
	}
	user.Email = normalizeUserEmail(user.Email)
	user.Role = normalizeAuthRole(user.Role)
	if user.CreatedAt == "" {
		user.CreatedAt = models.NowString()
	}
	if user.UpdatedAt == "" {
		user.UpdatedAt = user.CreatedAt
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO app_user (id, email, name, password_hash, role, is_active, last_login_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, user.ID, user.Email, user.Name, passwordHash, string(user.Role), user.IsActive, user.LastLoginAt, user.CreatedAt, user.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create auth user %s: %w", user.Email, err)
	}

	return &user, nil
}

func (s *Store) UpdateAuthUser(ctx context.Context, user models.AuthUser, passwordHash *string) (*models.AuthUser, error) {
	user.Email = normalizeUserEmail(user.Email)
	user.Role = normalizeAuthRole(user.Role)
	user.UpdatedAt = models.NowString()

	if passwordHash != nil {
		_, err := s.db.ExecContext(ctx, `
			UPDATE app_user
			SET name = $1, role = $2, is_active = $3, password_hash = $4, updated_at = $5
			WHERE id = $6
		`, user.Name, string(user.Role), user.IsActive, *passwordHash, user.UpdatedAt, user.ID)
		if err != nil {
			return nil, fmt.Errorf("update auth user %s: %w", user.ID, err)
		}
	} else {
		_, err := s.db.ExecContext(ctx, `
			UPDATE app_user
			SET name = $1, role = $2, is_active = $3, updated_at = $4
			WHERE id = $5
		`, user.Name, string(user.Role), user.IsActive, user.UpdatedAt, user.ID)
		if err != nil {
			return nil, fmt.Errorf("update auth user %s: %w", user.ID, err)
		}
	}

	return s.GetAuthUserByID(ctx, user.ID)
}

func (s *Store) SaveAuthSession(ctx context.Context, session models.AuthSession) error {
	if session.ID == "" {
		session.ID = uuid.NewString()
	}
	if session.CreatedAt == "" {
		session.CreatedAt = models.NowString()
	}
	if session.LastSeenAt == "" {
		session.LastSeenAt = session.CreatedAt
	}
	if session.UpdatedAt == "" {
		session.UpdatedAt = session.LastSeenAt
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO app_user_session (
			id, user_id, token_hash, last_seen_at, expires_at, revoked_at,
			user_agent, remote_addr, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, session.ID, session.UserID, session.TokenHash, session.LastSeenAt, session.ExpiresAt, session.RevokedAt, session.UserAgent, session.RemoteAddr, session.CreatedAt, session.UpdatedAt)
	if err != nil {
		return fmt.Errorf("save auth session %s: %w", session.ID, err)
	}

	return nil
}

func (s *Store) GetAuthUserBySessionTokenHash(ctx context.Context, tokenHash string) (*models.AuthUser, *models.AuthSession, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT
			u.id, u.email, u.name, u.role, u.is_active, u.last_login_at, u.created_at, u.updated_at,
			s.id, s.user_id, s.token_hash, s.last_seen_at, s.expires_at, s.revoked_at,
			s.user_agent, s.remote_addr, s.created_at, s.updated_at
		FROM app_user_session s
		INNER JOIN app_user u ON u.id = s.user_id
		WHERE s.token_hash = $1
	`, strings.TrimSpace(tokenHash))

	var user models.AuthUser
	var session models.AuthSession
	if err := row.Scan(
		&user.ID,
		&user.Email,
		&user.Name,
		&user.Role,
		&user.IsActive,
		&user.LastLoginAt,
		&user.CreatedAt,
		&user.UpdatedAt,
		&session.ID,
		&session.UserID,
		&session.TokenHash,
		&session.LastSeenAt,
		&session.ExpiresAt,
		&session.RevokedAt,
		&session.UserAgent,
		&session.RemoteAddr,
		&session.CreatedAt,
		&session.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, nil
		}
		return nil, nil, fmt.Errorf("get auth session by token: %w", err)
	}

	return &user, &session, nil
}

func (s *Store) DeleteAuthSessionByTokenHash(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM app_user_session WHERE token_hash = $1`, strings.TrimSpace(tokenHash))
	if err != nil {
		return fmt.Errorf("delete auth session: %w", err)
	}
	return nil
}

func (s *Store) TouchAuthSession(ctx context.Context, sessionID, lastSeenAt string) error {
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	if strings.TrimSpace(lastSeenAt) == "" {
		lastSeenAt = models.NowString()
	}

	_, err := s.db.ExecContext(ctx, `
		UPDATE app_user_session
		SET last_seen_at = $1, updated_at = $2
		WHERE id = $3
	`, lastSeenAt, lastSeenAt, strings.TrimSpace(sessionID))
	if err != nil {
		return fmt.Errorf("touch auth session %s: %w", sessionID, err)
	}
	return nil
}

func (s *Store) SetAuthUserLastLogin(ctx context.Context, userID, lastLoginAt string) error {
	if strings.TrimSpace(userID) == "" {
		return nil
	}
	if strings.TrimSpace(lastLoginAt) == "" {
		lastLoginAt = models.NowString()
	}

	_, err := s.db.ExecContext(ctx, `
		UPDATE app_user
		SET last_login_at = $1, updated_at = $2
		WHERE id = $3
	`, lastLoginAt, lastLoginAt, strings.TrimSpace(userID))
	if err != nil {
		return fmt.Errorf("set auth user last login %s: %w", userID, err)
	}
	return nil
}

func (s *Store) CountActiveAuthSessions(ctx context.Context) (int, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM app_user_session
		WHERE revoked_at = '' AND expires_at > $1
	`, models.NowString())

	var count int
	if err := row.Scan(&count); err != nil {
		return 0, fmt.Errorf("count active auth sessions: %w", err)
	}

	return count, nil
}

func (s *Store) ListActiveAuthSessionsByUser(ctx context.Context, userID string) ([]models.AuthSessionRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, created_at, last_seen_at, expires_at, user_agent, remote_addr, updated_at
		FROM app_user_session
		WHERE user_id = $1 AND revoked_at = '' AND expires_at > $2
		ORDER BY last_seen_at DESC, created_at DESC
	`, strings.TrimSpace(userID), models.NowString())
	if err != nil {
		return nil, fmt.Errorf("list active auth sessions for user %s: %w", userID, err)
	}
	defer rows.Close()

	sessions := make([]models.AuthSessionRecord, 0)
	for rows.Next() {
		var session models.AuthSessionRecord
		if err := rows.Scan(
			&session.ID,
			&session.UserID,
			&session.CreatedAt,
			&session.LastSeenAt,
			&session.ExpiresAt,
			&session.UserAgent,
			&session.RemoteAddr,
			&session.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan auth session: %w", err)
		}
		sessions = append(sessions, session)
	}

	return sessions, rows.Err()
}

func (s *Store) RevokeAuthSessionByID(ctx context.Context, userID, sessionID string) error {
	userID = strings.TrimSpace(userID)
	sessionID = strings.TrimSpace(sessionID)
	if userID == "" || sessionID == "" {
		return nil
	}

	now := models.NowString()
	_, err := s.db.ExecContext(ctx, `
		UPDATE app_user_session
		SET revoked_at = $1, updated_at = $2
		WHERE id = $3 AND user_id = $4
	`, now, now, sessionID, userID)
	if err != nil {
		return fmt.Errorf("revoke auth session %s: %w", sessionID, err)
	}

	return nil
}

func (s *Store) SaveAuditLog(ctx context.Context, item models.AuditLogRecord) error {
	if item.ID == "" {
		item.ID = uuid.NewString()
	}
	if item.CreatedAt == "" {
		item.CreatedAt = models.NowString()
	}
	detailsJSON, err := json.Marshal(item.Details)
	if err != nil {
		return fmt.Errorf("marshal audit log details: %w", err)
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO audit_log (
			id, actor_user_id, actor_name, actor_role, action, resource_type, resource_id,
			summary, details_json, remote_addr, user_agent, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, item.ID, item.ActorUserID, item.ActorName, string(item.ActorRole), item.Action, item.ResourceType, item.ResourceID, item.Summary, string(detailsJSON), item.RemoteAddr, item.UserAgent, item.CreatedAt)
	if err != nil {
		return fmt.Errorf("save audit log %s: %w", item.Action, err)
	}

	return nil
}

func (s *Store) ListAuditLogs(ctx context.Context, limit int) ([]models.AuditLogRecord, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, actor_user_id, actor_name, actor_role, action, resource_type, resource_id,
			summary, details_json, remote_addr, user_agent, created_at
		FROM audit_log
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("list audit logs: %w", err)
	}
	defer rows.Close()

	items := make([]models.AuditLogRecord, 0, limit)
	for rows.Next() {
		var item models.AuditLogRecord
		var detailsJSON string
		if err := rows.Scan(
			&item.ID,
			&item.ActorUserID,
			&item.ActorName,
			&item.ActorRole,
			&item.Action,
			&item.ResourceType,
			&item.ResourceID,
			&item.Summary,
			&detailsJSON,
			&item.RemoteAddr,
			&item.UserAgent,
			&item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan audit log: %w", err)
		}
		if detailsJSON != "" {
			if err := json.Unmarshal([]byte(detailsJSON), &item.Details); err != nil {
				item.Details = map[string]any{}
			}
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate audit logs: %w", err)
	}

	return items, nil
}

func (s *Store) ListQuickReplies(ctx context.Context, search string) ([]models.QuickReplyRecord, error) {
	return s.listQuickReplies(ctx, search, false, false, "")
}

func (s *Store) ListVisibleQuickReplies(ctx context.Context, userID, search string, activeOnly bool) ([]models.QuickReplyRecord, error) {
	return s.listQuickReplies(ctx, search, true, activeOnly, userID)
}

func (s *Store) listQuickReplies(ctx context.Context, search string, restrictVisibility bool, activeOnly bool, userID string) ([]models.QuickReplyRecord, error) {
	filters := make([]string, 0, 3)
	args := make([]any, 0, 4)

	if restrictVisibility {
		args = append(args, strings.TrimSpace(userID))
		filters = append(filters, fmt.Sprintf("(visibility_scope = 'all' OR (visibility_scope = 'user' AND visibility_user_id = $%d))", len(args)))
	}
	if activeOnly {
		filters = append(filters, "status = 'active'")
	}
	if trimmedSearch := strings.TrimSpace(search); trimmedSearch != "" {
		args = append(args, "%"+trimmedSearch+"%")
		filters = append(filters, fmt.Sprintf("(name ILIKE $%d OR shortcut ILIKE $%d OR content ILIKE $%d)", len(args), len(args), len(args)))
	}

	query := `
		SELECT id, name, shortcut, content, category, visibility_scope, visibility_user_id,
			status, created_by_user_id, created_by, updated_by_user_id, updated_by, created_at, updated_at
		FROM quick_reply
	`
	if len(filters) > 0 {
		query += " WHERE " + strings.Join(filters, " AND ")
	}
	query += " ORDER BY LOWER(name) ASC, created_at DESC"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list quick replies: %w", err)
	}
	defer rows.Close()

	items := make([]models.QuickReplyRecord, 0)
	for rows.Next() {
		var item models.QuickReplyRecord
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.Shortcut,
			&item.Content,
			&item.Category,
			&item.VisibilityScope,
			&item.VisibilityUserID,
			&item.Status,
			&item.CreatedByUserID,
			&item.CreatedBy,
			&item.UpdatedByUserID,
			&item.UpdatedBy,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan quick reply: %w", err)
		}
		items = append(items, item)
	}

	return items, rows.Err()
}

func (s *Store) GetQuickReply(ctx context.Context, id string) (*models.QuickReplyRecord, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, name, shortcut, content, category, visibility_scope, visibility_user_id,
			status, created_by_user_id, created_by, updated_by_user_id, updated_by, created_at, updated_at
		FROM quick_reply
		WHERE id = $1
	`, strings.TrimSpace(id))

	var item models.QuickReplyRecord
	if err := row.Scan(
		&item.ID,
		&item.Name,
		&item.Shortcut,
		&item.Content,
		&item.Category,
		&item.VisibilityScope,
		&item.VisibilityUserID,
		&item.Status,
		&item.CreatedByUserID,
		&item.CreatedBy,
		&item.UpdatedByUserID,
		&item.UpdatedBy,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get quick reply %s: %w", id, err)
	}

	return &item, nil
}

func (s *Store) SaveQuickReply(ctx context.Context, item models.QuickReplyRecord) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO quick_reply (
			id, name, shortcut, content, category, visibility_scope, visibility_user_id,
			status, created_by_user_id, created_by, updated_by_user_id, updated_by, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		ON CONFLICT (id) DO UPDATE SET
			name = excluded.name,
			shortcut = excluded.shortcut,
			content = excluded.content,
			category = excluded.category,
			visibility_scope = excluded.visibility_scope,
			visibility_user_id = excluded.visibility_user_id,
			status = excluded.status,
			updated_by_user_id = excluded.updated_by_user_id,
			updated_by = excluded.updated_by,
			updated_at = excluded.updated_at
	`,
		item.ID,
		item.Name,
		item.Shortcut,
		item.Content,
		item.Category,
		string(item.VisibilityScope),
		item.VisibilityUserID,
		string(item.Status),
		item.CreatedByUserID,
		item.CreatedBy,
		item.UpdatedByUserID,
		item.UpdatedBy,
		item.CreatedAt,
		item.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("save quick reply %s: %w", item.ID, err)
	}
	return nil
}

func (s *Store) DeleteQuickReply(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM quick_reply WHERE id = $1`, strings.TrimSpace(id))
	if err != nil {
		return fmt.Errorf("delete quick reply %s: %w", id, err)
	}
	return nil
}

func (s *Store) QuickReplyShortcutExists(ctx context.Context, shortcut string, scope models.QuickReplyVisibilityScope, visibilityUserID, excludeID string) (bool, error) {
	filters := []string{"LOWER(shortcut) = LOWER($1)", "visibility_scope = $2"}
	args := []any{strings.TrimSpace(shortcut), string(scope)}

	if scope == models.QuickReplyVisibilityUser {
		args = append(args, strings.TrimSpace(visibilityUserID))
		filters = append(filters, fmt.Sprintf("visibility_user_id = $%d", len(args)))
	}
	if trimmedExcludeID := strings.TrimSpace(excludeID); trimmedExcludeID != "" {
		args = append(args, trimmedExcludeID)
		filters = append(filters, fmt.Sprintf("id <> $%d", len(args)))
	}

	row := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM quick_reply
		WHERE `+strings.Join(filters, " AND "), args...)

	var count int
	if err := row.Scan(&count); err != nil {
		return false, fmt.Errorf("check quick reply shortcut: %w", err)
	}

	return count > 0, nil
}

func normalizeUserEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func normalizeAuthRole(role models.AuthRole) models.AuthRole {
	switch role {
	case models.AuthRoleAdmin, models.AuthRoleSupervisor, models.AuthRoleAttendant:
		return role
	default:
		return models.AuthRoleAttendant
	}
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
	return s.UpsertChatForSession(ctx, models.DefaultSessionID, chat)
}

func (s *Store) UpsertChatForSession(ctx context.Context, sessionID string, chat models.Chat) (bool, error) {
	sessionID = normalizeSessionID(sessionID)
	chat.SessionID = sessionID
	chat.JID = strings.TrimSpace(chat.JID)
	if chat.JID == "" {
		return false, errors.New("chat jid is required")
	}
	if chat.Name == "" {
		chat.Name = chat.JID
	}
	if chat.UpdatedAt == "" {
		chat.UpdatedAt = models.NowString()
	}

	existing, err := s.GetChatForSession(ctx, sessionID, chat.JID)
	if err != nil {
		return false, err
	}
	storageJID := storageChatKey(sessionID, chat.JID)

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO chats (
			jid, session_id, remote_jid, name, contact_jid, is_group, unread_count, last_message_id,
			last_message_text, last_message_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT(jid) DO UPDATE SET
			session_id = excluded.session_id,
			remote_jid = excluded.remote_jid,
			name = excluded.name,
			contact_jid = excluded.contact_jid,
			is_group = excluded.is_group,
			unread_count = CASE WHEN excluded.unread_count < chats.unread_count THEN chats.unread_count ELSE excluded.unread_count END,
			last_message_id = CASE WHEN excluded.last_message_id = '' THEN chats.last_message_id ELSE excluded.last_message_id END,
			last_message_text = CASE WHEN excluded.last_message_text = '' THEN chats.last_message_text ELSE excluded.last_message_text END,
			last_message_at = CASE WHEN excluded.last_message_at = '' THEN chats.last_message_at ELSE excluded.last_message_at END,
			updated_at = excluded.updated_at
	`,
		storageJID,
		sessionID,
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
	return s.GetChatForSession(ctx, models.DefaultSessionID, jid)
}

func (s *Store) GetChatForSession(ctx context.Context, sessionID, jid string) (*models.Chat, error) {
	sessionID = normalizeSessionID(sessionID)
	storageJID := storageChatKey(sessionID, jid)
	row := s.db.QueryRowContext(ctx, `
		SELECT jid, session_id, remote_jid, name, contact_jid, is_group, unread_count, last_message_id,
			last_message_text, last_message_at, updated_at
		FROM chats
		WHERE jid = $1
	`, storageJID)

	var chat models.Chat
	var sessionIDValue string
	var remoteJID string
	if err := row.Scan(
		&chat.JID,
		&sessionIDValue,
		&remoteJID,
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
		return nil, fmt.Errorf("get chat %s for session %s: %w", jid, sessionID, err)
	}
	chat.SessionID = normalizeSessionID(sessionIDValue)
	if strings.TrimSpace(remoteJID) != "" {
		chat.JID = strings.TrimSpace(remoteJID)
	}

	return &chat, nil
}

func (s *Store) ListChats(ctx context.Context) ([]models.Chat, error) {
	return s.ListChatsBySession(ctx, models.DefaultSessionID)
}

func (s *Store) ListChatsBySession(ctx context.Context, sessionID string) ([]models.Chat, error) {
	sessionID = normalizeSessionID(sessionID)
	rows, err := s.db.QueryContext(ctx, `
		SELECT jid, session_id, remote_jid, name, contact_jid, is_group, unread_count, last_message_id,
			last_message_text, last_message_at, updated_at
		FROM chats
		WHERE session_id = $1
		ORDER BY CASE WHEN last_message_at = '' THEN updated_at ELSE last_message_at END DESC, name ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("list chats for session %s: %w", sessionID, err)
	}
	defer rows.Close()

	chats := make([]models.Chat, 0)
	for rows.Next() {
		var chat models.Chat
		var sessionIDValue string
		var remoteJID string
		if err := rows.Scan(
			&chat.JID,
			&sessionIDValue,
			&remoteJID,
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
		chat.SessionID = normalizeSessionID(sessionIDValue)
		if strings.TrimSpace(remoteJID) != "" {
			chat.JID = strings.TrimSpace(remoteJID)
		}
		chats = append(chats, chat)
	}

	return chats, rows.Err()
}

func (s *Store) ListChatsBySessionPage(ctx context.Context, sessionID string, limit int, cursorSortAt, cursorName, cursorJID string) ([]models.Chat, error) {
	sessionID = normalizeSessionID(sessionID)
	if limit <= 0 {
		limit = 80
	}
	if limit > 250 {
		limit = 250
	}

	rows, err := s.db.QueryContext(ctx, `
		WITH ranked_chats AS (
			SELECT
				COALESCE(NULLIF(remote_jid, ''), jid) AS conversation_id,
				session_id,
				name,
				contact_jid,
				is_group,
				unread_count,
				last_message_id,
				last_message_text,
				last_message_at,
				updated_at,
				COALESCE(NULLIF(last_message_at, ''), updated_at) AS sort_at,
				ROW_NUMBER() OVER (
					PARTITION BY COALESCE(NULLIF(remote_jid, ''), jid)
					ORDER BY COALESCE(NULLIF(last_message_at, ''), updated_at) DESC, name ASC, jid ASC
				) AS row_number
			FROM chats
			WHERE session_id = $1
				AND jid NOT LIKE '%@broadcast'
				AND jid NOT LIKE '%@newsletter'
				AND (remote_jid = '' OR (remote_jid NOT LIKE '%@broadcast' AND remote_jid NOT LIKE '%@newsletter'))
		)
		SELECT conversation_id, session_id, name, contact_jid, is_group, unread_count, last_message_id,
			last_message_text, last_message_at, updated_at
		FROM ranked_chats
		WHERE row_number = 1
			AND (
				$2 = ''
				OR sort_at < $2
				OR (sort_at = $2 AND name > $3)
				OR (sort_at = $2 AND name = $3 AND conversation_id > $4)
			)
		ORDER BY sort_at DESC, name ASC, conversation_id ASC
		LIMIT $5
	`, sessionID, strings.TrimSpace(cursorSortAt), strings.TrimSpace(cursorName), strings.TrimSpace(cursorJID), limit)
	if err != nil {
		return nil, fmt.Errorf("list chat page for session %s: %w", sessionID, err)
	}
	defer rows.Close()

	chats := make([]models.Chat, 0, limit)
	for rows.Next() {
		var chat models.Chat
		var sessionIDValue string
		if err := rows.Scan(
			&chat.JID,
			&sessionIDValue,
			&chat.Name,
			&chat.ContactJID,
			&chat.IsGroup,
			&chat.UnreadCount,
			&chat.LastMessageID,
			&chat.LastMessageText,
			&chat.LastMessageAt,
			&chat.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan chat page: %w", err)
		}
		chat.SessionID = normalizeSessionID(sessionIDValue)
		chats = append(chats, chat)
	}

	return chats, rows.Err()
}

func (s *Store) GetChatStatsBySession(ctx context.Context, sessionID string) (waiting int, unread int, err error) {
	sessionID = normalizeSessionID(sessionID)
	row := s.db.QueryRowContext(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE unread_count > 0)::int,
			COALESCE(SUM(unread_count), 0)::int
		FROM (
			SELECT
				COALESCE(NULLIF(remote_jid, ''), jid) AS conversation_id,
				MAX(unread_count) AS unread_count
			FROM chats
			WHERE session_id = $1
				AND jid NOT LIKE '%@broadcast'
				AND jid NOT LIKE '%@newsletter'
				AND (remote_jid = '' OR (remote_jid NOT LIKE '%@broadcast' AND remote_jid NOT LIKE '%@newsletter'))
			GROUP BY COALESCE(NULLIF(remote_jid, ''), jid)
		) AS stats
	`, sessionID)

	if err := row.Scan(&waiting, &unread); err != nil {
		return 0, 0, fmt.Errorf("get chat stats for session %s: %w", sessionID, err)
	}

	return waiting, unread, nil
}

func (s *Store) SaveMessage(ctx context.Context, message models.Message) (bool, error) {
	return s.SaveMessageBySession(ctx, models.DefaultSessionID, message)
	/*
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

		if message.Kind == "reaction" {
			return true, nil
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
	*/
}

func (s *Store) ListMessagesByChat(ctx context.Context, chatJID string) ([]models.Message, error) {
	return s.ListMessagesByChatForSession(ctx, models.DefaultSessionID, chatJID)
	/*
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
	*/
}

func (s *Store) GetMessageByID(ctx context.Context, messageID string) (*models.Message, error) {
	return s.GetMessageByIDForSession(ctx, models.DefaultSessionID, messageID)
	/*
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
	*/
}

func (s *Store) ListUnreadMessageGroupsByChat(ctx context.Context, chatJID string) (map[string][]models.Message, error) {
	return s.ListUnreadMessageGroupsByChatForSession(ctx, models.DefaultSessionID, chatJID)
	/*
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
	*/
}

func (s *Store) MarkChatRead(ctx context.Context, chatJID string) error {
	return s.MarkChatReadBySession(ctx, models.DefaultSessionID, chatJID)
}

func (s *Store) UpdateMessageAck(ctx context.Context, messageID, ackStatus string) error {
	return s.UpdateMessageAckBySession(ctx, models.DefaultSessionID, messageID, ackStatus)
	/*
		_, err := s.db.ExecContext(ctx, `UPDATE messages SET ack_status = $1 WHERE id = $2`, ackStatus, messageID)
		if err != nil {
			return fmt.Errorf("update ack for message %s: %w", messageID, err)
		}
		return nil
	*/
}

func (s *Store) UpdateMessageAckBySession(ctx context.Context, sessionID, messageID, ackStatus string) error {
	sessionID = normalizeSessionID(sessionID)
	storageID := storageMessageKey(sessionID, messageID)
	_, err := s.db.ExecContext(ctx, `UPDATE messages SET ack_status = $1 WHERE id = $2`, ackStatus, storageID)
	if err != nil {
		return fmt.Errorf("update ack for message %s in session %s: %w", messageID, sessionID, err)
	}
	return nil
}

func (s *Store) UpsertChatBySession(ctx context.Context, sessionID string, chat models.Chat) (bool, error) {
	return s.UpsertChatForSession(ctx, sessionID, chat)
}

func (s *Store) GetChatBySession(ctx context.Context, sessionID, jid string) (*models.Chat, error) {
	return s.GetChatForSession(ctx, sessionID, jid)
}

func (s *Store) ListChatsScoped(ctx context.Context, sessionID string) ([]models.Chat, error) {
	return s.ListChatsBySession(ctx, sessionID)
}

func (s *Store) SaveMessageBySession(ctx context.Context, sessionID string, message models.Message) (bool, error) {
	sessionID = normalizeSessionID(sessionID)
	message.SessionID = sessionID
	message.ID = strings.TrimSpace(message.ID)
	message.ChatJID = strings.TrimSpace(message.ChatJID)
	if message.ID == "" || message.ChatJID == "" {
		return false, errors.New("message id and chat jid are required")
	}
	message.Timestamp = strings.TrimSpace(message.Timestamp)
	if message.Timestamp == "" {
		message.Timestamp = models.NowString()
	}

	storageID := storageMessageKey(sessionID, message.ID)
	storageChatJID := storageChatKey(sessionID, message.ChatJID)
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO messages (
			id, session_id, remote_id, chat_jid, remote_chat_jid, sender_jid, author, from_me, ack_status, kind, mime_type,
			file_name, text, raw_json, timestamp, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		ON CONFLICT (id) DO NOTHING
	`, storageID, sessionID, message.ID, storageChatJID, message.ChatJID, message.SenderJID, message.Author, message.FromMe, message.AckStatus, message.Kind, message.MimeType, message.FileName, message.Text, message.RawJSON, message.Timestamp, models.NowString())
	if err != nil {
		return false, fmt.Errorf("insert message %s in session %s: %w", message.ID, sessionID, err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("rows affected for message %s in session %s: %w", message.ID, sessionID, err)
	}
	return affected > 0, nil
}

func (s *Store) ListUnreadMessageGroupsByChatForSession(ctx context.Context, sessionID, chatJID string) (map[string][]models.Message, error) {
	messages, err := s.ListMessagesByChatForSession(ctx, sessionID, chatJID)
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

func (s *Store) ListMessagesByChatForSession(ctx context.Context, sessionID, chatJID string) ([]models.Message, error) {
	sessionID = normalizeSessionID(sessionID)
	storageChatJID := storageChatKey(sessionID, chatJID)
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, remote_id, chat_jid, remote_chat_jid, sender_jid, author, from_me, ack_status, kind, mime_type, file_name, text, raw_json, timestamp
		FROM messages
		WHERE chat_jid = $1
		ORDER BY timestamp ASC, id ASC
	`, storageChatJID)
	if err != nil {
		return nil, fmt.Errorf("list messages for chat %s in session %s: %w", chatJID, sessionID, err)
	}
	defer rows.Close()

	items := make([]models.Message, 0)
	for rows.Next() {
		var message models.Message
		var storedSessionID, remoteID, remoteChatJID string
		if err := rows.Scan(&message.ID, &storedSessionID, &remoteID, &message.ChatJID, &remoteChatJID, &message.SenderJID, &message.Author, &message.FromMe, &message.AckStatus, &message.Kind, &message.MimeType, &message.FileName, &message.Text, &message.RawJSON, &message.Timestamp); err != nil {
			return nil, fmt.Errorf("scan message by session: %w", err)
		}
		message.SessionID = normalizeSessionID(storedSessionID)
		if strings.TrimSpace(remoteID) != "" {
			message.ID = strings.TrimSpace(remoteID)
		}
		if strings.TrimSpace(remoteChatJID) != "" {
			message.ChatJID = strings.TrimSpace(remoteChatJID)
		}
		items = append(items, message)
	}

	return items, rows.Err()
}

func (s *Store) ListMessagesByChatForSessionPage(ctx context.Context, sessionID, chatJID string, limit int, before string) ([]models.Message, error) {
	sessionID = normalizeSessionID(sessionID)
	limit = normalizeMessageLimit(limit)
	storageChatJID := storageChatKey(sessionID, chatJID)

	whereClause := "WHERE chat_jid = $1"
	args := []any{storageChatJID, limit}
	limitParam := 2
	if before = strings.TrimSpace(before); before != "" {
		whereClause += " AND timestamp < $2"
		args = []any{storageChatJID, before, limit}
		limitParam = 3
	}

	rows, err := s.db.QueryContext(ctx, fmt.Sprintf(`
		SELECT id, session_id, remote_id, chat_jid, remote_chat_jid, sender_jid, author, from_me, ack_status, kind, mime_type, file_name, text, raw_json, timestamp
		FROM (
			SELECT id, session_id, remote_id, chat_jid, remote_chat_jid, sender_jid, author, from_me, ack_status, kind, mime_type, file_name, text, raw_json, timestamp
			FROM messages
			%s
			ORDER BY timestamp DESC, id DESC
			LIMIT $%d
		) AS recent_messages
		ORDER BY timestamp ASC, id ASC
	`, whereClause, limitParam), args...)
	if err != nil {
		return nil, fmt.Errorf("list message page for chat %s in session %s: %w", chatJID, sessionID, err)
	}
	defer rows.Close()

	return scanSessionMessages(rows)
}

func (s *Store) ListMessagesByChatForSessionSince(ctx context.Context, sessionID, chatJID string, since string, limit int) ([]models.Message, error) {
	sessionID = normalizeSessionID(sessionID)
	limit = normalizeMessageLimit(limit)
	storageChatJID := storageChatKey(sessionID, chatJID)

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, remote_id, chat_jid, remote_chat_jid, sender_jid, author, from_me, ack_status, kind, mime_type, file_name, text, raw_json, timestamp
		FROM messages
		WHERE chat_jid = $1 AND timestamp >= $2
		ORDER BY timestamp ASC, id ASC
		LIMIT $3
	`, storageChatJID, strings.TrimSpace(since), limit)
	if err != nil {
		return nil, fmt.Errorf("list recent messages for chat %s in session %s: %w", chatJID, sessionID, err)
	}
	defer rows.Close()

	return scanSessionMessages(rows)
}

func normalizeMessageLimit(limit int) int {
	if limit <= 0 {
		return 120
	}
	if limit > 500 {
		return 500
	}
	return limit
}

func scanSessionMessages(rows *sql.Rows) ([]models.Message, error) {
	items := make([]models.Message, 0)
	for rows.Next() {
		var message models.Message
		var storedSessionID, remoteID, remoteChatJID string
		if err := rows.Scan(&message.ID, &storedSessionID, &remoteID, &message.ChatJID, &remoteChatJID, &message.SenderJID, &message.Author, &message.FromMe, &message.AckStatus, &message.Kind, &message.MimeType, &message.FileName, &message.Text, &message.RawJSON, &message.Timestamp); err != nil {
			return nil, fmt.Errorf("scan message by session: %w", err)
		}
		message.SessionID = normalizeSessionID(storedSessionID)
		if strings.TrimSpace(remoteID) != "" {
			message.ID = strings.TrimSpace(remoteID)
		}
		if strings.TrimSpace(remoteChatJID) != "" {
			message.ChatJID = strings.TrimSpace(remoteChatJID)
		}
		items = append(items, message)
	}

	return items, rows.Err()
}

func (s *Store) GetMessageByIDForSession(ctx context.Context, sessionID, messageID string) (*models.Message, error) {
	sessionID = normalizeSessionID(sessionID)
	storageID := storageMessageKey(sessionID, messageID)
	row := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, remote_id, chat_jid, remote_chat_jid, sender_jid, author, from_me, ack_status, kind, mime_type, file_name, text, raw_json, timestamp
		FROM messages
		WHERE id = $1
	`, storageID)

	var message models.Message
	var storedSessionID, remoteID, remoteChatJID string
	if err := row.Scan(&message.ID, &storedSessionID, &remoteID, &message.ChatJID, &remoteChatJID, &message.SenderJID, &message.Author, &message.FromMe, &message.AckStatus, &message.Kind, &message.MimeType, &message.FileName, &message.Text, &message.RawJSON, &message.Timestamp); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get message %s in session %s: %w", messageID, sessionID, err)
	}
	message.SessionID = normalizeSessionID(storedSessionID)
	if strings.TrimSpace(remoteID) != "" {
		message.ID = strings.TrimSpace(remoteID)
	}
	if strings.TrimSpace(remoteChatJID) != "" {
		message.ChatJID = strings.TrimSpace(remoteChatJID)
	}
	return &message, nil
}

func (s *Store) MarkChatReadBySession(ctx context.Context, sessionID, chatJID string) error {
	sessionID = normalizeSessionID(sessionID)
	storageChatJID := storageChatKey(sessionID, chatJID)
	if _, err := s.db.ExecContext(ctx, `UPDATE chats SET unread_count = 0, updated_at = $1 WHERE jid = $2`, models.NowString(), storageChatJID); err != nil {
		return fmt.Errorf("mark chat read %s in session %s: %w", chatJID, sessionID, err)
	}

	if _, err := s.db.ExecContext(ctx, `
		UPDATE messages
		SET ack_status = CASE WHEN from_me = FALSE THEN 'read' ELSE ack_status END
		WHERE chat_jid = $1
	`, storageChatJID); err != nil {
		return fmt.Errorf("mark messages read for chat %s in session %s: %w", chatJID, sessionID, err)
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

func (s *Store) ListContactLabels(ctx context.Context) ([]models.ContactLabelRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, emoji, color, created_by, updated_by, created_at, updated_at
		FROM contact_label
		ORDER BY updated_at DESC, name ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list contact labels: %w", err)
	}
	defer rows.Close()

	items := make([]models.ContactLabelRecord, 0)
	for rows.Next() {
		var item models.ContactLabelRecord
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.Emoji,
			&item.Color,
			&item.CreatedBy,
			&item.UpdatedBy,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan contact label: %w", err)
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate contact labels: %w", err)
	}

	return items, nil
}

func (s *Store) SaveContactLabel(ctx context.Context, item models.ContactLabelRecord) (models.ContactLabelRecord, error) {
	if strings.TrimSpace(item.ID) == "" {
		item.ID = uuid.NewString()
	}
	if strings.TrimSpace(item.CreatedAt) == "" {
		item.CreatedAt = models.NowString()
	}
	if strings.TrimSpace(item.UpdatedAt) == "" {
		item.UpdatedAt = models.NowString()
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO contact_label (
			id, name, emoji, color, created_by, updated_by, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (id) DO UPDATE SET
			name = excluded.name,
			emoji = excluded.emoji,
			color = excluded.color,
			updated_by = excluded.updated_by,
			updated_at = excluded.updated_at
	`, item.ID, item.Name, item.Emoji, item.Color, item.CreatedBy, item.UpdatedBy, item.CreatedAt, item.UpdatedAt)
	if err != nil {
		return models.ContactLabelRecord{}, fmt.Errorf("save contact label: %w", err)
	}

	return item, nil
}

func (s *Store) DeleteContactLabel(ctx context.Context, labelID string) (err error) {
	labelID = strings.TrimSpace(labelID)
	if labelID == "" {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete contact label: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	rows, err := tx.QueryContext(ctx, `
		SELECT session_id, conversation_id, tags_json
		FROM contact_crm_profile
		WHERE tags_json LIKE $1
	`, "%"+labelID+"%")
	if err != nil {
		return fmt.Errorf("query crm labels for delete: %w", err)
	}

	type profileTags struct {
		sessionID      string
		conversationID string
		tags           []string
	}

	profiles := make([]profileTags, 0)
	for rows.Next() {
		var (
			sessionID      string
			conversationID string
			tagsJSON       string
		)
		if err := rows.Scan(&sessionID, &conversationID, &tagsJSON); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan crm labels for delete: %w", err)
		}

		var tags []string
		if err := json.Unmarshal([]byte(tagsJSON), &tags); err != nil {
			continue
		}

		nextTags := make([]string, 0, len(tags))
		changed := false
		for _, tag := range tags {
			if strings.TrimSpace(tag) == labelID {
				changed = true
				continue
			}
			nextTags = append(nextTags, tag)
		}
		if changed {
			profiles = append(profiles, profileTags{sessionID: sessionID, conversationID: conversationID, tags: nextTags})
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate crm labels for delete: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close crm labels for delete: %w", err)
	}

	for _, profile := range profiles {
		tagsJSON, marshalErr := json.Marshal(profile.tags)
		if marshalErr != nil {
			return fmt.Errorf("marshal crm tags during label delete: %w", marshalErr)
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE contact_crm_profile
			SET tags_json = $3, updated_at = $4
			WHERE session_id = $1 AND conversation_id = $2
		`, profile.sessionID, profile.conversationID, string(tagsJSON), models.NowString()); err != nil {
			return fmt.Errorf("update crm tags during label delete: %w", err)
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM contact_label WHERE id = $1`, labelID); err != nil {
		return fmt.Errorf("delete contact label: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit delete contact label: %w", err)
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
