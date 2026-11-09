import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2Icon } from 'lucide-react'
import { useAuth } from '@/context/auth-context'

function FullPageLoader() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}

// Authentication: only signed-in users get through.
export function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageLoader />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

// Authorization: only users with one of the allowed roles get through.
export function RoleRoute({ roles }) {
  const { user } = useAuth()
  if (!roles.includes(user?.role)) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

// Login/register pages are pointless once signed in.
export function GuestRoute() {
  const { user, loading } = useAuth()
  if (loading) return <FullPageLoader />
  if (user) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
