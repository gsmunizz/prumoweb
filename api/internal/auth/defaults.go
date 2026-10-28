package auth

// Categorias e conta padrão criadas no cadastro (AUT-06, CAT-07). Os ícones são chaves
// do catálogo compartilhado com o cliente (GER-11); as cores vêm do design system.

type defaultCategory struct {
	Name, Type, Icon, Color string
}

var defaultCategories = []defaultCategory{
	{"Alimentação", "expense", "utensils", "#E08A1E"},
	{"Mercado", "expense", "shopping-cart", "#0E8577"},
	{"Transporte", "expense", "car", "#6941E0"},
	{"Moradia", "expense", "home", "#2446D8"},
	{"Contas e serviços", "expense", "receipt", "#C23A66"},
	{"Saúde", "expense", "heart-pulse", "#C2341B"},
	{"Educação", "expense", "graduation-cap", "#4F46E5"},
	{"Lazer", "expense", "gamepad", "#BE185D"},
	{"Compras", "expense", "shopping-bag", "#B45F06"},
	{"Assinaturas", "expense", "repeat", "#6941E0"},
	{"Impostos e taxas", "expense", "landmark", "#667085"},
	{"Outros", "expense", "circle-ellipsis", "#98A2B3"},

	{"Salário", "income", "briefcase", "#087A55"},
	{"Freelance", "income", "laptop", "#0E8577"},
	{"Rendimentos", "income", "trending-up", "#2446D8"},
	{"Reembolso", "income", "undo", "#4F46E5"},
	{"Presente", "income", "gift", "#BE185D"},
	{"Outros", "income", "circle-ellipsis", "#98A2B3"},
}

const (
	defaultAccountName  = "Carteira"
	defaultAccountType  = "carteira"
	defaultAccountColor = "#2446D8"
	defaultAccountIcon  = "wallet"
)
