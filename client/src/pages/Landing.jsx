import { Link } from 'react-router-dom'
import {
  ActivityIcon,
  BrainCircuitIcon,
  FileSearchIcon,
  MessagesSquareIcon,
  ShieldCheckIcon,
  UserCheckIcon,
} from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Logo } from '@/components/logo'
import { useAuth } from '@/context/auth-context'

const features = [
  {
    icon: FileSearchIcon,
    title: 'Document ingestion',
    description: 'Bring policies, handbooks and procedures into one searchable knowledge base.',
  },
  {
    icon: BrainCircuitIcon,
    title: 'Grounded answers',
    description: 'Retrieval-augmented generation answers from your documents, with sources, not guesses.',
  },
  {
    icon: MessagesSquareIcon,
    title: 'Conversation memory',
    description: 'Follow-up questions keep their context across a conversation.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Safety controls',
    description: 'Guardrails keep responses on-policy and away from what they should not touch.',
  },
  {
    icon: UserCheckIcon,
    title: 'Human approval',
    description: 'Sensitive requests wait for a person to approve them before anything happens.',
  },
  {
    icon: ActivityIcon,
    title: 'Observability',
    description: 'See failures, response latency and every step an AI workflow took.',
  },
]

export default function Landing() {
  const { user } = useAuth()

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Logo />
          <nav className="flex items-center gap-2">
            {user ? (
              <Link to="/dashboard" className={buttonVariants()}>
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className={buttonVariants({ variant: 'ghost' })}>
                  Sign in
                </Link>
                <Link to="/register" className={buttonVariants()}>
                  Get started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-20 text-center sm:py-28">
          <p className="mb-4 text-sm font-medium text-muted-foreground">Enterprise AI knowledge copilot</p>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Ask your organization&apos;s documents anything. Get answers you can trust.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-muted-foreground">
            Organizational knowledge is scattered across policies, handbooks and internal documents.
            ContextIQ gives employees grounded, contextual answers in plain language, with the
            controls and visibility your teams need.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link to={user ? '/dashboard' : '/register'} className={buttonVariants({ size: 'lg' })}>
              {user ? 'Open dashboard' : 'Create an account'}
            </Link>
            {!user && (
              <Link to="/login" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
                Sign in
              </Link>
            )}
          </div>
        </section>

        <section className="border-t bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 className="text-2xl font-semibold tracking-tight">Built for how teams actually work</h2>
            <p className="mt-2 text-muted-foreground">
              No more hunting for answers, inconsistent responses or chatbots that make things up.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map(({ icon: Icon, title, description }) => (
                <Card key={title}>
                  <CardHeader>
                    <Icon className="mb-2 size-5 text-primary" />
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted-foreground">
          © {new Date().getFullYear()} ContextIQ
        </div>
      </footer>
    </div>
  )
}
