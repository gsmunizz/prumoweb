package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

func newRouter() *gin.Engine {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	r := gin.New()
	r.Use(RequestIDMiddleware(), LoggerMiddleware(log), Recovery(log), SecurityHeaders(true), BodyLimit(16))
	r.GET("/api-error", func(c *gin.Context) {
		Abort(c, ValidationFailed(FieldError{Field: "amount_cents", Reason: "OUT_OF_RANGE"}))
	})
	r.GET("/plain-error", func(c *gin.Context) { Abort(c, errors.New("senha do banco: hunter2")) })
	r.GET("/panic", func(c *gin.Context) { panic("boom") })
	r.POST("/echo", func(c *gin.Context) {
		if _, err := io.ReadAll(c.Request.Body); err != nil {
			Abort(c, ErrTooLarge)
			return
		}
		c.Status(http.StatusNoContent)
	})
	return r
}

type errorBody struct {
	Error struct {
		Code      string       `json:"code"`
		Message   string       `json:"message"`
		Details   []FieldError `json:"details"`
		RequestID string       `json:"request_id"`
	} `json:"error"`
}

func do(t *testing.T, r http.Handler, req *http.Request) (*httptest.ResponseRecorder, errorBody) {
	t.Helper()
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var body errorBody
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return w, body
}

func TestErrorFormat(t *testing.T) {
	w, body := do(t, newRouter(), httptest.NewRequest(http.MethodGet, "/api-error", nil))
	if w.Code != http.StatusUnprocessableEntity || body.Error.Code != "VALIDATION_FAILED" {
		t.Fatalf("status %d, code %q", w.Code, body.Error.Code)
	}
	if len(body.Error.Details) != 1 || body.Error.Details[0].Reason != "OUT_OF_RANGE" {
		t.Errorf("details = %+v", body.Error.Details)
	}
	if body.Error.RequestID == "" || body.Error.RequestID != w.Header().Get("X-Request-Id") {
		t.Errorf("request_id %q não bate com o cabeçalho %q", body.Error.RequestID, w.Header().Get("X-Request-Id"))
	}
}

func TestUnknownErrorDoesNotLeak(t *testing.T) {
	w, body := do(t, newRouter(), httptest.NewRequest(http.MethodGet, "/plain-error", nil))
	if w.Code != http.StatusInternalServerError || body.Error.Code != "INTERNAL" {
		t.Fatalf("status %d, code %q", w.Code, body.Error.Code)
	}
	if strings.Contains(w.Body.String(), "hunter2") {
		t.Error("a mensagem interna vazou na resposta")
	}
}

func TestPanicBecomesInternal(t *testing.T) {
	w, body := do(t, newRouter(), httptest.NewRequest(http.MethodGet, "/panic", nil))
	if w.Code != http.StatusInternalServerError || body.Error.Code != "INTERNAL" {
		t.Fatalf("status %d, code %q", w.Code, body.Error.Code)
	}
}

func TestRequestID(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api-error", nil)
	req.Header.Set("X-Request-Id", "cliente-1234")
	w, _ := do(t, newRouter(), req)
	if got := w.Header().Get("X-Request-Id"); got != "cliente-1234" {
		t.Errorf("X-Request-Id = %q, quer o do cliente", got)
	}

	req = httptest.NewRequest(http.MethodGet, "/api-error", nil)
	req.Header.Set("X-Request-Id", "<script>")
	w, _ = do(t, newRouter(), req)
	if got := w.Header().Get("X-Request-Id"); len(got) != 32 {
		t.Errorf("X-Request-Id inválido deveria ser trocado, veio %q", got)
	}
}

func TestSecurityHeaders(t *testing.T) {
	w, _ := do(t, newRouter(), httptest.NewRequest(http.MethodGet, "/api-error", nil))
	for _, h := range []string{"Strict-Transport-Security", "X-Content-Type-Options", "Content-Security-Policy"} {
		if w.Header().Get(h) == "" {
			t.Errorf("cabeçalho %s ausente", h)
		}
	}
}

func TestBodyLimit(t *testing.T) {
	w, body := do(t, newRouter(), httptest.NewRequest(http.MethodPost, "/echo", strings.NewReader(strings.Repeat("x", 17))))
	if w.Code != http.StatusRequestEntityTooLarge || body.Error.Code != "PAYLOAD_TOO_LARGE" {
		t.Fatalf("status %d, code %q", w.Code, body.Error.Code)
	}
	w, _ = do(t, newRouter(), httptest.NewRequest(http.MethodPost, "/echo", strings.NewReader("ok")))
	if w.Code != http.StatusNoContent {
		t.Fatalf("status %d", w.Code)
	}
}
