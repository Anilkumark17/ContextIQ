import { Link } from 'react-router-dom'
import { BookOpenTextIcon } from 'lucide-react'

export function Logo({ to = '/' }) {
  return (
    <Link to={to} className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <BookOpenTextIcon className="size-4" />
      </span>
      ContextIQ
    </Link>
  )
}
