import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/context/auth-context'

const permissions = {
  employee: ['Ask questions about organizational documents', 'View your own account'],
  admin: [
    'Ask questions about organizational documents',
    'View your own account',
    'View all users',
    'Change user roles',
  ],
}

export default function Overview() {
  const { user } = useAuth()
  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, { dateStyle: 'long' })

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {user.name.split(' ')[0]}</h1>
        <p className="text-muted-foreground">Here is your account at a glance.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Your profile details.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-medium">{user.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="truncate font-medium">{user.email}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Member since</dt>
                <dd className="font-medium">{memberSince}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Access level
              <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="capitalize">
                {user.role}
              </Badge>
            </CardTitle>
            <CardDescription>What your role allows you to do.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid list-disc gap-2 pl-5 text-sm">
              {permissions[user.role].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
