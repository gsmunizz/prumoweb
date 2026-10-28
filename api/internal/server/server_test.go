package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gsmunizz/prumoweb/api/internal/config"
	"github.com/gsmunizz/prumoweb/api/internal/database"
)

func TestHealth(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL não definida")
	}
	pool, err := database.Connect(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	cfg := config.Config{Env: "development", Version: "teste"}
	h := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), pool, pool).Handler()

	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/health", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	var body healthResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body != (healthResponse{Status: "ok", Version: "teste", DB: "ok"}) {
		t.Errorf("corpo = %+v", body)
	}

	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/nada", nil))
	if w.Code != http.StatusNotFound {
		t.Errorf("rota inexistente: status %d", w.Code)
	}
}
