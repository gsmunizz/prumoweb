package server

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/gsmunizz/prumoweb/api/internal/auth"
	"github.com/gsmunizz/prumoweb/api/internal/httpx"
	"github.com/gsmunizz/prumoweb/api/internal/syncer"
)

const (
	syncPushPath        = "/api/v1/sync/push"
	syncPushBodyLimit   = 5 << 20 // 5 MB (SYN-13)
	defaultBodyLimit    = 1 << 20
	syncPushesPerMinute = 60 // SYN-13
)

// bodyLimit aplica 1 MB a tudo, menos ao push do sync, que aceita 5 MB.
func (s *Server) bodyLimit(c *gin.Context) {
	if c.Request.URL.Path == syncPushPath {
		httpx.BodyLimit(syncPushBodyLimit)(c)
		return
	}
	httpx.BodyLimit(defaultBodyLimit)(c)
}

func (s *Server) registerSyncRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/sync", s.requireAuth(false))
	g.POST("/push", s.syncPush)
	g.GET("/pull", s.syncPull)
}

// pushLimiter limita os pushes por usuário numa janela de um minuto (SYN-13). Vive na memória
// da instância: com mais de uma instância da API, o limite efetivo é o múltiplo delas.
type pushLimiter struct {
	limit int
	mu    sync.Mutex
	hits  map[uuid.UUID][]time.Time
}

func newPushLimiter(limit int) *pushLimiter {
	return &pushLimiter{limit: limit, hits: map[uuid.UUID][]time.Time{}}
}

// allow registra um push e diz se cabe no limite; se não, devolve quanto esperar.
func (l *pushLimiter) allow(user uuid.UUID, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := now.Add(-time.Minute)
	recent := l.hits[user][:0]
	for _, t := range l.hits[user] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	if len(recent) >= l.limit {
		l.hits[user] = recent
		return false, recent[0].Add(time.Minute).Sub(now)
	}
	l.hits[user] = append(recent, now)
	if len(l.hits) > 10_000 { // evita crescer sem fim com usuários que sumiram
		for u, ts := range l.hits {
			if len(ts) == 0 || !ts[len(ts)-1].After(cutoff) {
				delete(l.hits, u)
			}
		}
	}
	return true, 0
}

func (s *Server) syncPush(c *gin.Context) {
	uid := userID(c)
	if ok, wait := s.pushes.allow(uid, s.now()); !ok {
		s.fail(c, &auth.RateLimitError{RetryAfter: max(wait.Round(time.Second), time.Second)})
		return
	}
	var req syncer.PushRequest
	if !bind(c, &req) {
		return
	}
	resp, err := s.sync.Push(c.Request.Context(), uid, req)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (s *Server) syncPull(c *gin.Context) {
	since, limit := int64(0), syncer.MaxPullLimit
	if v := c.Query("since"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			httpx.Abort(c, httpx.ValidationFailed(httpx.FieldError{Field: "since", Reason: "INVALID_VALUE"}))
			return
		}
		since = n
	}
	if v := c.Query("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > syncer.MaxPullLimit {
			httpx.Abort(c, httpx.ValidationFailed(httpx.FieldError{Field: "limit", Reason: "OUT_OF_RANGE"}))
			return
		}
		limit = n
	}
	resp, err := s.sync.Pull(c.Request.Context(), userID(c), since, limit)
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}
