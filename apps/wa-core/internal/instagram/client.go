package instagram

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"pulsehub/wa-core/internal/models"
)

const (
	defaultGraphBaseURL     = "https://graph.instagram.com"
	defaultImageHostBaseURL = "https://freeimage.host/api/1/upload"
	defaultImageHostAPIKey  = "6d207e02198a847aa98d0a2a901485a5"
)

type Config struct {
	AppID            string
	AppSecret        string
	AccessToken      string
	UserID           string
	ImageHostAPIKey  string
	GraphBaseURL     string
	ImageHostBaseURL string
}

type Client struct {
	httpClient       *http.Client
	appID            string
	appSecret        string
	accessToken      string
	userID           string
	imageHostAPIKey  string
	graphBaseURL     string
	imageHostBaseURL string
}

type PublishRequest struct {
	ImageURL string
	FileName string
	MimeType string
	Data     []byte
	Caption  string
	Story    bool
}

type graphErrorResponse struct {
	Error struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    int    `json:"code"`
		Subcode int    `json:"error_subcode"`
		TraceID string `json:"fbtrace_id"`
	} `json:"error"`
}

type mediaStatusResponse struct {
	StatusCode    string `json:"status_code"`
	Status        string `json:"status"`
	StatusMessage string `json:"status_message"`
}

type profileResponse struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	AccountType string `json:"account_type"`
}

func NewClient(config Config) *Client {
	graphBaseURL := strings.TrimRight(strings.TrimSpace(config.GraphBaseURL), "/")
	if graphBaseURL == "" {
		graphBaseURL = defaultGraphBaseURL
	}
	imageHostBaseURL := strings.TrimSpace(config.ImageHostBaseURL)
	if imageHostBaseURL == "" {
		imageHostBaseURL = defaultImageHostBaseURL
	}
	imageHostAPIKey := strings.TrimSpace(config.ImageHostAPIKey)
	if imageHostAPIKey == "" {
		imageHostAPIKey = defaultImageHostAPIKey
	}

	return &Client{
		httpClient:       &http.Client{Timeout: 45 * time.Second},
		appID:            strings.TrimSpace(config.AppID),
		appSecret:        strings.TrimSpace(config.AppSecret),
		accessToken:      strings.TrimSpace(config.AccessToken),
		userID:           strings.TrimSpace(config.UserID),
		imageHostAPIKey:  imageHostAPIKey,
		graphBaseURL:     graphBaseURL,
		imageHostBaseURL: imageHostBaseURL,
	}
}

func (c *Client) Status(ctx context.Context) models.InstagramPublishStatusResponse {
	status := models.InstagramPublishStatusResponse{
		TokenConfigured:        c.accessToken != "",
		AppIDConfigured:        c.appID != "",
		AppSecretProofEnabled:  c.appSecret != "",
		ImageHostingConfigured: c.imageHostAPIKey != "",
		UserID:                 c.userID,
	}

	if c.accessToken == "" {
		status.LastError = "configure INSTAGRAM_ACCESS_TOKEN no backend"
		return status
	}

	profile, err := c.getProfile(ctx)
	if err != nil {
		status.LastError = err.Error()
		return status
	}

	status.TokenValid = true
	status.Username = profile.Username
	status.AccountType = profile.AccountType
	if status.UserID == "" {
		status.UserID = profile.ID
	}
	status.Configured = strings.TrimSpace(status.UserID) != ""
	return status
}

func (c *Client) Publish(ctx context.Context, request PublishRequest) (*models.InstagramPublishResult, error) {
	if c.accessToken == "" {
		return nil, errors.New("integracao do Instagram nao configurada no backend")
	}
	userID, err := c.resolveTargetUserID(ctx)
	if err != nil {
		return nil, err
	}

	imageURL := strings.TrimSpace(request.ImageURL)
	if imageURL == "" {
		if len(request.Data) == 0 {
			return nil, errors.New("envie uma imagem ou informe uma URL publica")
		}
		if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(request.MimeType)), "image/") {
			return nil, errors.New("apenas imagens sao suportadas para publicacao no Instagram")
		}
		uploadedURL, err := c.uploadImage(ctx, request.Data)
		if err != nil {
			return nil, err
		}
		imageURL = uploadedURL
	}

	creationID, err := c.createMediaContainer(ctx, userID, imageURL, strings.TrimSpace(request.Caption), request.Story)
	if err != nil {
		return nil, err
	}
	if err := c.waitForMediaReady(ctx, creationID); err != nil {
		return nil, err
	}

	publishedID, err := c.publishMediaContainer(ctx, userID, creationID)
	if err != nil {
		return nil, err
	}

	mode := "feed"
	if request.Story {
		mode = "story"
	}

	return &models.InstagramPublishResult{
		Mode:        mode,
		CreationID:  creationID,
		PublishedID: publishedID,
		ImageURL:    imageURL,
	}, nil
}

func (c *Client) uploadImage(ctx context.Context, data []byte) (string, error) {
	if c.imageHostAPIKey == "" {
		return "", errors.New("configure INSTAGRAM_IMAGE_HOST_API_KEY para upload de imagem local")
	}

	form := url.Values{}
	form.Set("key", c.imageHostAPIKey)
	form.Set("action", "upload")
	form.Set("source", base64.StdEncoding.EncodeToString(data))
	form.Set("format", "json")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.imageHostBaseURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("create image host request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("send image host request: %w", err)
	}
	defer resp.Body.Close()

	var payload struct {
		Image struct {
			URL string `json:"url"`
		} `json:"image"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("decode image host response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || strings.TrimSpace(payload.Image.URL) == "" {
		message := strings.TrimSpace(payload.Error.Message)
		if message == "" {
			message = "falha ao hospedar a imagem publicamente"
		}
		return "", errors.New(message)
	}

	return strings.TrimSpace(payload.Image.URL), nil
}

func (c *Client) resolveTargetUserID(ctx context.Context) (string, error) {
	if c.userID != "" {
		return c.userID, nil
	}

	profile, err := c.getProfile(ctx)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(profile.ID) == "" {
		return "", errors.New("instagram nao retornou o user id da conta")
	}

	return strings.TrimSpace(profile.ID), nil
}

func (c *Client) getProfile(ctx context.Context) (profileResponse, error) {
	params := url.Values{}
	params.Set("fields", "id,username,account_type")
	c.addGraphAuth(params)

	endpoint := fmt.Sprintf("%s/me?%s", c.graphBaseURL, params.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return profileResponse{}, fmt.Errorf("create instagram profile request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return profileResponse{}, fmt.Errorf("send instagram profile request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return profileResponse{}, fmt.Errorf("read instagram profile response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var payload graphErrorResponse
		if err := json.Unmarshal(body, &payload); err == nil && strings.TrimSpace(payload.Error.Message) != "" {
			return profileResponse{}, errors.New(formatGraphError(payload))
		}
		return profileResponse{}, fmt.Errorf("instagram retornou status %d ao consultar perfil", resp.StatusCode)
	}

	var profile profileResponse
	if err := json.Unmarshal(body, &profile); err != nil {
		return profileResponse{}, fmt.Errorf("decode instagram profile response: %w", err)
	}

	return profile, nil
}

func (c *Client) createMediaContainer(ctx context.Context, userID, imageURL, caption string, story bool) (string, error) {
	form := url.Values{}
	form.Set("image_url", imageURL)
	c.addGraphAuth(form)
	if story {
		form.Set("media_type", "STORIES")
	} else if caption != "" {
		form.Set("caption", caption)
	}

	endpoint := fmt.Sprintf("%s/%s/media", c.graphBaseURL, url.PathEscape(userID))
	responseBody, err := c.postForm(ctx, endpoint, form)
	if err != nil {
		return "", err
	}

	var payload struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return "", fmt.Errorf("decode instagram container response: %w", err)
	}
	if strings.TrimSpace(payload.ID) == "" {
		return "", errors.New("instagram nao retornou o container da publicacao")
	}

	return strings.TrimSpace(payload.ID), nil
}

func (c *Client) waitForMediaReady(ctx context.Context, creationID string) error {
	deadline := time.Now().Add(45 * time.Second)
	for {
		status, err := c.getMediaStatus(ctx, creationID)
		if err != nil {
			return err
		}

		switch strings.ToUpper(strings.TrimSpace(status.StatusCode)) {
		case "FINISHED", "PUBLISHED":
			return nil
		case "ERROR", "EXPIRED":
			message := strings.TrimSpace(status.StatusMessage)
			if message == "" {
				message = strings.TrimSpace(status.Status)
			}
			if message == "" {
				message = "a midia do Instagram falhou antes da publicacao"
			}
			return errors.New(message)
		}

		if time.Now().After(deadline) {
			return errors.New("o container do Instagram nao ficou pronto a tempo para publicar")
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

func (c *Client) getMediaStatus(ctx context.Context, creationID string) (mediaStatusResponse, error) {
	params := url.Values{}
	params.Set("fields", "status_code,status,status_message")
	c.addGraphAuth(params)
	endpoint := fmt.Sprintf("%s/%s?%s", c.graphBaseURL, url.PathEscape(creationID), params.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return mediaStatusResponse{}, fmt.Errorf("create instagram status request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return mediaStatusResponse{}, fmt.Errorf("send instagram status request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return mediaStatusResponse{}, fmt.Errorf("read instagram status response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var payload graphErrorResponse
		if err := json.Unmarshal(body, &payload); err == nil && strings.TrimSpace(payload.Error.Message) != "" {
			return mediaStatusResponse{}, errors.New(strings.TrimSpace(payload.Error.Message))
		}
		return mediaStatusResponse{}, fmt.Errorf("instagram retornou status %d ao consultar container", resp.StatusCode)
	}

	var payload mediaStatusResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return mediaStatusResponse{}, fmt.Errorf("decode instagram status response: %w", err)
	}

	return payload, nil
}

func (c *Client) publishMediaContainer(ctx context.Context, userID, creationID string) (string, error) {
	form := url.Values{}
	form.Set("creation_id", creationID)
	c.addGraphAuth(form)

	endpoint := fmt.Sprintf("%s/%s/media_publish", c.graphBaseURL, url.PathEscape(userID))
	responseBody, err := c.postForm(ctx, endpoint, form)
	if err != nil {
		return "", err
	}

	var payload struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return "", fmt.Errorf("decode instagram publish response: %w", err)
	}
	if strings.TrimSpace(payload.ID) == "" {
		return "", errors.New("instagram nao retornou o id da publicacao")
	}

	return strings.TrimSpace(payload.ID), nil
}

func (c *Client) postForm(ctx context.Context, endpoint string, form url.Values) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create instagram request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("send instagram request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read instagram response: %w", err)
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return body, nil
	}

	var payload graphErrorResponse
	if err := json.Unmarshal(body, &payload); err == nil && strings.TrimSpace(payload.Error.Message) != "" {
		return nil, errors.New(formatGraphError(payload))
	}

	return nil, fmt.Errorf("instagram retornou status %d", resp.StatusCode)
}

func (c *Client) addGraphAuth(values url.Values) {
	values.Set("access_token", c.accessToken)
	if proof := c.appSecretProof(); proof != "" {
		values.Set("appsecret_proof", proof)
	}
}

func (c *Client) appSecretProof() string {
	if c.accessToken == "" || c.appSecret == "" {
		return ""
	}

	mac := hmac.New(sha256.New, []byte(c.appSecret))
	_, _ = mac.Write([]byte(c.accessToken))
	return hex.EncodeToString(mac.Sum(nil))
}

func formatGraphError(payload graphErrorResponse) string {
	message := strings.TrimSpace(payload.Error.Message)
	if message == "" {
		message = "falha ao publicar no Instagram"
	}

	parts := []string{message}
	if payload.Error.Code > 0 {
		parts = append(parts, fmt.Sprintf("code=%d", payload.Error.Code))
	}
	if payload.Error.Subcode > 0 {
		parts = append(parts, fmt.Sprintf("subcode=%d", payload.Error.Subcode))
	}
	if traceID := strings.TrimSpace(payload.Error.TraceID); traceID != "" {
		parts = append(parts, fmt.Sprintf("trace=%s", traceID))
	}

	return strings.Join(parts, " | ")
}
