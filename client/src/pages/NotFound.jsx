import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { buttonVariants } from '@/components/ui/button'

export default function NotFound() {
  const error = useRouteError()
  const notFound = !error || (isRouteErrorResponse(error) && error.status === 404)

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{notFound ? '404' : 'Something went wrong'}</h1>
      <p className="text-muted-foreground">
        {notFound ? 'This page does not exist.' : 'An unexpected error occurred. Please try again.'}
      </p>
      <Link to="/" className={buttonVariants()}>
        Back to home
      </Link>
    </div>
  )
}
