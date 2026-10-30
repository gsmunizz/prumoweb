import { createRootRoute, createRoute, createRouter, Navigate, Outlet } from '@tanstack/react-router'
import { AppShell } from './components/AppShell'
import { UpdatePrompt } from './components/UpdatePrompt'
import { useSession } from './lib/session'
import { CallbackPage } from './pages/auth/CallbackPage'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { LoginPage } from './pages/auth/LoginPage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { ConfirmEmailPage, VerifyEmailPage } from './pages/auth/TokenPage'
import { HomePage } from './pages/HomePage'
import { MaisPage } from './pages/MaisPage'
import { PlaceholderPage } from './pages/PlaceholderPage'

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <UpdatePrompt />
    </>
  ),
})

// Telas autenticadas, dentro do shell com a barra de navegação.
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: AppShell })
const homeRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: HomePage })
const transacoesRoute = createRoute({ getParentRoute: () => appRoute, path: '/transacoes', component: () => <PlaceholderPage title="Transações" /> })
const calendarioRoute = createRoute({ getParentRoute: () => appRoute, path: '/calendario', component: () => <PlaceholderPage title="Calendário" /> })
const investimentosRoute = createRoute({ getParentRoute: () => appRoute, path: '/investimentos', component: () => <PlaceholderPage title="Investimentos" /> })
const maisRoute = createRoute({ getParentRoute: () => appRoute, path: '/mais', component: MaisPage })

// Telas para quem ainda não entrou; quem já tem sessão vai direto para o início.
function Guest() {
  const session = useSession()
  if (session.status === 'loading') return null
  if (session.status === 'authenticated') return <Navigate to="/" replace />
  return <Outlet />
}
const guestRoute = createRoute({ getParentRoute: () => rootRoute, id: 'guest', component: Guest })
const loginRoute = createRoute({ getParentRoute: () => guestRoute, path: '/login', component: LoginPage })
const registerRoute = createRoute({ getParentRoute: () => guestRoute, path: '/register', component: RegisterPage })
const forgotRoute = createRoute({ getParentRoute: () => guestRoute, path: '/forgot-password', component: ForgotPasswordPage })

// Links de e-mail e retorno do Google: abrem com ou sem sessão.
const resetRoute = createRoute({ getParentRoute: () => rootRoute, path: '/reset-password', component: ResetPasswordPage })
const verifyRoute = createRoute({ getParentRoute: () => rootRoute, path: '/verify-email', component: VerifyEmailPage })
const confirmRoute = createRoute({ getParentRoute: () => rootRoute, path: '/confirm-email', component: ConfirmEmailPage })
const callbackRoute = createRoute({ getParentRoute: () => rootRoute, path: '/auth/callback', component: CallbackPage })

const routeTree = rootRoute.addChildren([
  appRoute.addChildren([homeRoute, transacoesRoute, calendarioRoute, investimentosRoute, maisRoute]),
  guestRoute.addChildren([loginRoute, registerRoute, forgotRoute]),
  resetRoute,
  verifyRoute,
  confirmRoute,
  callbackRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
