import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import { UpdatePrompt } from './components/UpdatePrompt'
import { HomePage } from './pages/HomePage'

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <UpdatePrompt />
    </>
  ),
})

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage })

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
