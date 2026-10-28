package mail

import "fmt"

const signature = "\n\nEquipe Prumo\n"

// Verification é o e-mail do link de verificação (AUT-07), válido por 24 horas.
func Verification(to, link string) Message {
	return Message{
		To: to, Subject: "Confirme seu e-mail no Prumo",
		Text: fmt.Sprintf("Olá!\n\nPara confirmar seu e-mail no Prumo, abra o link abaixo. Ele vale por 24 horas.\n\n%s\n\nSe você não criou uma conta, ignore esta mensagem.%s", link, signature),
	}
}

// PasswordReset é o e-mail do link de redefinição de senha (AUT-25), válido por 1 hora.
func PasswordReset(to, link string) Message {
	return Message{
		To: to, Subject: "Redefinição de senha do Prumo",
		Text: fmt.Sprintf("Olá!\n\nRecebemos um pedido para redefinir sua senha. Abra o link abaixo para escolher uma nova. Ele vale por 1 hora e só pode ser usado uma vez.\n\n%s\n\nSe não foi você, ignore esta mensagem: sua senha continua a mesma.%s", link, signature),
	}
}

// EmailChange é o e-mail enviado ao endereço novo, com o link de confirmação (AUT-28).
func EmailChange(to, link string) Message {
	return Message{
		To: to, Subject: "Confirme seu novo e-mail no Prumo",
		Text: fmt.Sprintf("Olá!\n\nPara trocar o e-mail da sua conta do Prumo para este endereço, abra o link abaixo. Ele vale por 1 hora.\n\n%s\n\nSe não foi você, ignore esta mensagem.%s", link, signature),
	}
}

// EmailChangeNotice avisa o endereço antigo de que a troca foi pedida (AUT-28).
func EmailChangeNotice(to, newEmail string) Message {
	return Message{
		To: to, Subject: "Pedido de troca de e-mail no Prumo",
		Text: fmt.Sprintf("Olá!\n\nAlguém com acesso à sua conta pediu para trocar o e-mail dela para %s. A troca só vale depois da confirmação nesse endereço novo.\n\nSe não foi você, troque sua senha agora e encerre as outras sessões em Configurações.%s", newEmail, signature),
	}
}
