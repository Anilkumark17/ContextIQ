import { createBrowserRouter } from 'react-router-dom'
import { GuestRoute, ProtectedRoute, RoleRoute } from '@/components/route-guards'
import Landing from '@/pages/Landing'
import NotFound from '@/pages/NotFound'
import Login from '@/pages/auth/Login'
import Register from '@/pages/auth/Register'
import DashboardLayout from '@/pages/dashboard/DashboardLayout'
import Documents from '@/pages/dashboard/Documents'
import Overview from '@/pages/dashboard/Overview'
import Users from '@/pages/dashboard/Users'

export const router = createBrowserRouter([
  {
    errorElement: <NotFound />,
    children: [
      { path: '/', element: <Landing /> },
      {
        element: <GuestRoute />,
        children: [
          { path: '/login', element: <Login /> },
          { path: '/register', element: <Register /> },
        ],
      },
      {
        path: '/dashboard',
        element: <ProtectedRoute />,
        children: [
          {
            element: <DashboardLayout />,
            children: [
              { index: true, element: <Overview /> },
              { path: 'documents', element: <Documents /> },
              {
                element: <RoleRoute roles={['admin']} />,
                children: [{ path: 'users', element: <Users /> }],
              },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
])
