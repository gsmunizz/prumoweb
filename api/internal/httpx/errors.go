// Package httpx reúne as convenções HTTP da API: formato de erro, request id,
// logs sem dados financeiros e cabeçalhos de segurança.
package httpx

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Error é o erro padrão da API. Code é estável e o cliente o traduz para a mensagem
// em português; Message serve só para depuração.
type Error struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func NewError(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

var (
	ErrNotFound    = NewError(http.StatusNotFound, "NOT_FOUND", "recurso não encontrado")
	ErrInternal    = NewError(http.StatusInternalServerError, "INTERNAL", "erro interno")
	ErrUnavailable = NewError(http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "serviço indisponível")
	ErrTooLarge    = NewError(http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "corpo acima do limite")
)

// FieldError é um item de details em VALIDATION_FAILED.
type FieldError struct {
	Field  string `json:"field"`
	Reason string `json:"reason"` // REQUIRED, TOO_SHORT, TOO_LONG, OUT_OF_RANGE, INVALID_FORMAT, INVALID_VALUE, IMMUTABLE
}

func ValidationFailed(fields ...FieldError) *Error {
	return &Error{
		Status:  http.StatusUnprocessableEntity,
		Code:    "VALIDATION_FAILED",
		Message: "um ou mais campos inválidos",
		Details: fields,
	}
}

// Abort encerra a requisição com o corpo de erro padrão:
// { "error": { code, message, details?, request_id } }.
// Erros que não são *Error viram INTERNAL, sem vazar a mensagem original.
func Abort(c *gin.Context, err error) {
	var apiErr *Error
	if !errors.As(err, &apiErr) {
		_ = c.Error(err) // fica para o log, que registra só o tipo
		apiErr = ErrInternal
	}
	body := gin.H{
		"code":       apiErr.Code,
		"message":    apiErr.Message,
		"request_id": RequestID(c),
	}
	if apiErr.Details != nil {
		body["details"] = apiErr.Details
	}
	c.AbortWithStatusJSON(apiErr.Status, gin.H{"error": body})
}
