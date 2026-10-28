package syncer

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	_ "time/tzdata" // fusos IANA do perfil, mesmo em imagem sem /usr/share/zoneinfo

	"github.com/gsmunizz/prumoweb/api/internal/httpx"
)

const (
	MaxOps         = 500  // SYN-13
	MaxPullLimit   = 1000 // SYN-13
	maxAttempts    = 25
	resultApplied  = "applied"
	resultStale    = "stale"
	resultRejected = "rejected"
)

// ErrSyncResetRequired responde o pull de um cursor anterior à limpeza de excluídos (SYN-09).
var (
	ErrSyncResetRequired = httpx.NewError(410, "SYNC_RESET_REQUIRED", "o cursor é anterior à limpeza de excluídos; baixe tudo de novo")
	ErrTooManyOps        = httpx.NewError(413, "PAYLOAD_TOO_LARGE", "lote com mais de 500 operações")
)

type Service struct {
	app *pgxpool.Pool
	now func() time.Time
}

func New(app *pgxpool.Pool) *Service { return &Service{app: app, now: time.Now} }

// SetClock troca o relógio do serviço; existe para os testes.
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// lockUser serializa os pushes do mesmo usuário. Sem isso, dois lotes concorrentes poderiam
// confirmar server_versions fora de ordem e um pull entre eles pularia registros para sempre.
func lockUser(ctx context.Context, tx pgx.Tx, userID uuid.UUID) error {
	_, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", userID.String())
	return err
}

func pgCode(err error) (code, constraint string) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code, pgErr.ConstraintName
	}
	return "", ""
}
