import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/context/auth-context'
import { errorMessage } from '@/lib/api'
import { AuthLayout } from './AuthLayout'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError('')
    setSubmitting(true)
    try {
      const user = await register({
        name: form.get('name'),
        email: form.get('email'),
        password: form.get('password'),
      })
      toast.success(`Welcome, ${user.name}`)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(errorMessage(err, 'Could not create account'))
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Get access to your organization's knowledge copilot."
      footer={
        <span>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </span>
      }
    >
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" name="name" autoComplete="name" minLength={2} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting && <Loader2Icon className="animate-spin" />}
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
