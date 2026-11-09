import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { FileTextIcon, LayoutDashboardIcon, LogOutIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Logo } from '@/components/logo'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/context/auth-context'
import { cn, initials } from '@/lib/utils'

const navItems = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboardIcon, end: true, roles: ['employee', 'admin'] },
  { to: '/dashboard/documents', label: 'Documents', icon: FileTextIcon, roles: ['employee', 'admin'] },
  { to: '/dashboard/users', label: 'Users', icon: UsersIcon, roles: ['admin'] },
]

export default function DashboardLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const visibleItems = navItems.filter((item) => item.roles.includes(user.role))

  async function handleLogout() {
    await logout()
    toast.success('Signed out')
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="border-b bg-muted/40 md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex h-14 items-center px-4">
          <Logo to="/dashboard" />
        </div>
        <nav className="flex gap-1 px-2 pb-2 md:flex-col">
          {visibleItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  isActive && 'bg-muted text-foreground',
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-3 border-b px-4">
          <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="capitalize">
            {user.role}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <Avatar>
                <AvatarFallback>{initials(user.name)}</AvatarFallback>
              </Avatar>
              <span className="sr-only">Open account menu</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <div className="font-medium text-foreground">{user.name}</div>
                  <div className="truncate text-xs font-normal">{user.email}</div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOutIcon />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
