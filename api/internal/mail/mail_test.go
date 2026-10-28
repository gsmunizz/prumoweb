package mail

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResendSendsExpectedRequest(t *testing.T) {
	var gotAuth string
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	r := &Resend{APIKey: "chave-de-teste", From: "Prumo <oi@exemplo.test>", Endpoint: srv.URL}
	if err := r.Send(context.Background(), Message{To: "a@b.test", Subject: "Assunto", Text: "Corpo"}); err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer chave-de-teste" {
		t.Errorf("Authorization = %q", gotAuth)
	}
	if body["from"] != "Prumo <oi@exemplo.test>" || body["subject"] != "Assunto" || body["text"] != "Corpo" {
		t.Errorf("corpo = %v", body)
	}
	if to, _ := body["to"].([]any); len(to) != 1 || to[0] != "a@b.test" {
		t.Errorf("to = %v", body["to"])
	}
}

func TestResendReportsFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"message":"domínio não verificado"}`))
	}))
	defer srv.Close()

	err := (&Resend{APIKey: "k", From: "x", Endpoint: srv.URL}).Send(context.Background(), Message{To: "a@b.test"})
	if err == nil || !strings.Contains(err.Error(), "422") {
		t.Fatalf("err = %v", err)
	}
	if strings.Contains(err.Error(), "Bearer") {
		t.Error("o erro não pode carregar a chave")
	}
}
