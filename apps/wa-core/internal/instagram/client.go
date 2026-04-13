package instagram

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"pulsehub/wa-core/internal/models"
)

const (
	defaultGraphBaseURL     = "https://graph.instagram.com"
	defaultImageHostBaseURL = "https://freeimage.host/api/1/upload"
	defaultCloudinaryURL    = "https://api.cloudinary.com"
	defaultImageHostAPIKey  = "6d207e02198a847aa98d0a2a901485a5"
)

type Config struct {
	AppID            string
	AppSecret        string
	AccessToken      string
	UserID           string
	CloudName        string
	CloudAPIKey      string
	CloudAPISecret   string
	CloudFolder      string
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
	cloudName        string
	cloudAPIKey      string
	cloudAPISecret   string
	cloudFolder      string
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

type instagramMediaKind string

const (
	instagramMediaKindImage instagramMediaKind = "image"
	instagramMediaKindVideo instagramMediaKind = "video"
)

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
		cloudName:        strings.TrimSpace(config.CloudName),
		cloudAPIKey:      strings.TrimSpace(config.CloudAPIKey),
		cloudAPISecret:   strings.TrimSpace(config.CloudAPISecret),
		cloudFolder:      strings.Trim(strings.TrimSpace(config.CloudFolder), "/"),
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
		ImageHostingConfigured: c.cloudinaryConfigured() || c.imageHostAPIKey != "",
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

	mediaURL := strings.TrimSpace(request.ImageURL)
	mediaKind := detectInstagramMediaKind(strings.TrimSpace(request.MimeType), mediaURL)
	if mediaURL == "" {
		if len(request.Data) == 0 {
			return nil, errors.New("envie uma midia ou informe uma URL publica")
		}
		if mediaKind == "" {
			return nil, errors.New("apenas imagens e videos sao suportados para publicacao no Instagram")
		}
		uploadedURL, err := c.uploadMedia(ctx, request.Data, request.FileName, request.MimeType, mediaKind)
		if err != nil {
			return nil, err
		}
		mediaURL = uploadedURL
	} else if mediaKind == "" {
		return nil, errors.New("nao foi possivel identificar se a URL publica e imagem ou video")
	}

	creationID, err := c.createMediaContainer(ctx, userID, mediaURL, mediaKind, strings.TrimSpace(request.Caption), request.Story)
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
		ImageURL:    mediaURL,
	}, nil
}

func (c *Client) uploadMedia(ctx context.Context, data []byte, fileName, mimeType string, mediaKind instagramMediaKind) (string, error) {
	if c.cloudinaryConfigured() {
		return c.uploadMediaToCloudinary(ctx, data, fileName, mimeType, mediaKind)
	}
	if mediaKind == instagramMediaKindVideo {
		return "", errors.New("configure Cloudinary para upload de videos do Instagram")
	}
	return c.uploadImageToFreeImage(ctx, data)
}

func (c *Client) uploadImageToFreeImage(ctx context.Context, data []byte) (string, error) {
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

func (c *Client) uploadMediaToCloudinary(ctx context.Context, data []byte, fileName, mimeType string, mediaKind instagramMediaKind) (string, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	resourceType := "image"
	if mediaKind == instagramMediaKindVideo {
		resourceType = "video"
	}

	timestamp := fmt.Sprintf("%d", time.Now().Unix())
	paramsToSign := map[string]string{
		"timestamp": timestamp,
	}
	if c.cloudFolder != "" {
		paramsToSign["folder"] = c.cloudFolder
	}
	signature := cloudinarySignature(paramsToSign, c.cloudAPISecret)

	for key, value := range map[string]string{
		"api_key":   c.cloudAPIKey,
		"timestamp": timestamp,
		"signature": signature,
		"folder":    c.cloudFolder,
	} {
		if strings.TrimSpace(value) == "" {
			continue
		}
		if err := writer.WriteField(key, value); err != nil {
			return "", fmt.Errorf("write cloudinary field %s: %w", key, err)
		}
	}

	part, err := writer.CreateFormFile("file", resolvedInstagramFileName(fileName, mediaKind, mimeType))
	if err != nil {
		return "", fmt.Errorf("create cloudinary file part: %w", err)
	}
	if _, err := part.Write(data); err != nil {
		return "", fmt.Errorf("write cloudinary file data: %w", err)
	}
	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("close cloudinary multipart body: %w", err)
	}

	endpoint := fmt.Sprintf("%s/v1_1/%s/%s/upload", defaultCloudinaryURL, url.PathEscape(c.cloudName), resourceType)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return "", fmt.Errorf("create cloudinary request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("send cloudinary request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read cloudinary response: %w", err)
	}

	var payload struct {
		SecureURL string `json:"secure_url"`
		Error     struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(bodyBytes, &payload); err != nil {
		return "", fmt.Errorf("decode cloudinary response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || strings.TrimSpace(payload.SecureURL) == "" {
		message := strings.TrimSpace(payload.Error.Message)
		if message == "" {
			message = fmt.Sprintf("cloudinary retornou status %d", resp.StatusCode)
		}
		return "", errors.New(message)
	}

	return strings.TrimSpace(payload.SecureURL), nil
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

func (c *Client) createMediaContainer(ctx context.Context, userID, mediaURL string, mediaKind instagramMediaKind, caption string, story bool) (string, error) {
	form := url.Values{}
	c.addGraphAuth(form)
	if mediaKind == instagramMediaKindVideo {
		form.Set("video_url", mediaURL)
		if story {
			form.Set("media_type", "STORIES")
		} else {
			form.Set("media_type", "REELS")
		}
	} else {
		form.Set("image_url", mediaURL)
		if story {
			form.Set("media_type", "STORIES")
		}
	}
	if !story && mediaKind == instagramMediaKindImage && caption != "" {
		form.Set("caption", caption)
	}
	if !story && mediaKind == instagramMediaKindVideo && caption != "" {
		form.Set("caption", caption)
	}
	if story {
		form.Set("media_type", "STORIES")
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
	params.Set("fields", "status_code,status")
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

func (c *Client) cloudinaryConfigured() bool {
	return c.cloudName != "" && c.cloudAPIKey != "" && c.cloudAPISecret != ""
}

func (c *Client) appSecretProof() string {
	if c.accessToken == "" || c.appSecret == "" {
		return ""
	}

	mac := hmac.New(sha256.New, []byte(c.appSecret))
	_, _ = mac.Write([]byte(c.accessToken))
	return hex.EncodeToString(mac.Sum(nil))
}

func cloudinarySignature(params map[string]string, secret string) string {
	keys := make([]string, 0, len(params))
	for key, value := range params {
		if strings.TrimSpace(value) == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%s=%s", key, params[key]))
	}
	raw := strings.Join(parts, "&") + secret
	sum := sha1.Sum([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func resolvedInstagramFileName(fileName string, mediaKind instagramMediaKind, mimeType string) string {
	trimmed := strings.TrimSpace(fileName)
	if trimmed != "" {
		return trimmed
	}

	ext := extensionFromMimeType(mimeType)
	if ext == "" {
		if mediaKind == instagramMediaKindVideo {
			ext = ".mp4"
		} else {
			ext = ".jpg"
		}
	}

	return "instagram-upload" + ext
}

func detectInstagramMediaKind(mimeType, publicURL string) instagramMediaKind {
	lowerMimeType := strings.ToLower(strings.TrimSpace(mimeType))
	switch {
	case strings.HasPrefix(lowerMimeType, "image/"):
		return instagramMediaKindImage
	case strings.HasPrefix(lowerMimeType, "video/"):
		return instagramMediaKindVideo
	}

	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(publicURL)))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif":
		return instagramMediaKindImage
	case ".mp4", ".mov", ".m4v", ".webm":
		return instagramMediaKindVideo
	default:
		return ""
	}
}

func extensionFromMimeType(mimeType string) string {
	lowerMimeType := strings.ToLower(strings.TrimSpace(mimeType))
	switch lowerMimeType {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "video/mp4":
		return ".mp4"
	case "video/quicktime":
		return ".mov"
	case "video/webm":
		return ".webm"
	default:
		return ""
	}
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
