// Comando keygen gera a semente da chave que assina os tokens de acesso (AUT-12).
//
//	go run ./cmd/keygen
//
// Guarde AUTH_SIGNING_KEY no cofre do provedor, nunca no repositório. Para girar a
// chave, gere outra com um kid novo e deixe a pública da antiga em
// AUTH_PREVIOUS_PUBLIC_KEYS até os tokens dela expirarem (15 minutos).
package main

import (
	"fmt"
	"os"

	"github.com/gsmunizz/prumoweb/api/internal/auth"
)

func main() {
	seed, err := auth.GenerateSeed()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("AUTH_SIGNING_KEY=%s\n", seed)
}
