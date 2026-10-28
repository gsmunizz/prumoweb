// Package mail envia os e-mails transacionais do Prumo (verificação, redefinição de senha,
// troca de e-mail). O envio real usa a API do Resend; em desenvolvimento, sem chave, o
// conteúdo vai para o log.
package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// Message é um e-mail em texto simples; os links vão no corpo, em linhas próprias.
type Message struct {
	To      string
	Subject string
	Text    string
}

// Sender entrega uma mensagem. Erros são só registrados pelo chamador: um e-mail que
// falha nunca derruba o cadastro nem revela se um endereço existe.
type Sender interface {
	Send(ctx context.Context, m Message) error
}

const resendEndpoint = "https://api.resend.com/emails"

// Resend envia pela API HTTP do Resend.
type Resend struct {
	APIKey   string
	From     string
	Endpoint string // vazio usa a API oficial; os testes apontam para um servidor local
	Client   *http.Client
}

func (r *Resend) Send(ctx context.Context, m Message) error {
	endpoint := r.Endpoint
	if endpoint == "" {
		endpoint = resendEndpoint
	}
	client := r.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	body, err := json.Marshal(map[string]any{
		"from": r.From, "to": []string{m.To}, "subject": m.Subject, "text": m.Text,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+r.APIKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("resend: %w", err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("resend: status %d: %s", res.StatusCode, bytes.TrimSpace(detail))
	}
	return nil
}

// Log escreve a mensagem no log em vez de enviar. Só para desenvolvimento: o corpo contém
// o link com o token, então nunca é usado em produção (config.Load exige RESEND_API_KEY lá).
type Log struct{ Logger *slog.Logger }

func (l Log) Send(_ context.Context, m Message) error {
	l.Logger.Info("e-mail não enviado (sem RESEND_API_KEY)", "to", m.To, "subject", m.Subject, "text", m.Text)
	return nil
}

// Memory guarda as mensagens enviadas; existe para os testes lerem os links.
type Memory struct {
	mu   sync.Mutex
	msgs []Message
	Err  error // se definido, Send falha com ele
}

func (m *Memory) Send(_ context.Context, msg Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Err != nil {
		return m.Err
	}
	m.msgs = append(m.msgs, msg)
	return nil
}

// Messages devolve uma cópia das mensagens enviadas até agora.
func (m *Memory) Messages() []Message {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Message(nil), m.msgs...)
}

// To devolve as mensagens enviadas para um endereço.
func (m *Memory) To(addr string) []Message {
	var out []Message
	for _, msg := range m.Messages() {
		if msg.To == addr {
			out = append(out, msg)
		}
	}
	return out
}
