import { useCallback, useRef, useState } from 'react'
import { Loader2Icon, PauseIcon, PlayIcon, UploadIcon, WifiOffIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useResumableUpload } from '@/hooks/use-resumable-upload'
import { cn, formatBytes } from '@/lib/utils'

const ACCEPT = '.pdf,.txt,.md,.docx'

const accessLevels = [
  { value: 'employee', label: 'All employees' },
  { value: 'admin', label: 'Admins only' },
]

const outcomeMessage = {
  created: 'Document uploaded and queued for processing',
  retried: 'Document was previously failed; queued for processing again',
  duplicate: 'This document has already been uploaded',
}

const phaseLabel = {
  preparing: 'Preparing upload…',
  uploading: 'Uploading…',
  paused: 'Paused',
  offline: 'Connection lost. Will resume automatically when you are back online.',
  finishing: 'Saving document…',
}

export function DocumentUploader({ isAdmin, onUploaded }) {
  const inputRef = useRef(null)
  const [accessLevel, setAccessLevel] = useState('employee')
  const [dragging, setDragging] = useState(false)

  const handleComplete = useCallback(
    (result) => {
      const outcome = result?.serverData?.outcome
      if (outcome === 'duplicate') toast.info(outcomeMessage.duplicate)
      else toast.success(outcomeMessage[outcome] ?? 'Upload complete')
      onUploaded?.()
    },
    [onUploaded],
  )

  const handleError = useCallback((err) => {
    const message = err?.message && err.message !== 'UPLOAD_FAILED' ? err.message : null
    toast.error(message ?? 'Upload was interrupted. Please upload the file again.')
  }, [])

  const { phase, progress, fileName, start, pause, resume, cancel } = useResumableUpload('documentUploader', {
    onComplete: handleComplete,
    onError: handleError,
  })

  const busy = phase !== 'idle'

  function choose(file) {
    if (inputRef.current) inputRef.current.value = ''
    start(file, { accessLevel: isAdmin ? accessLevel : 'employee' })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a document</CardTitle>
        <CardDescription>
          PDF, DOCX or text. Up to 16 MB. Uploads can be paused and resume where they stopped. Identical files are
          detected and not stored twice.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {isAdmin && (
          <div className="grid max-w-xs gap-2">
            <Label>Who can see answers from it</Label>
            <Select items={accessLevels} value={accessLevel} onValueChange={setAccessLevel} disabled={busy}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accessLevels.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    {level.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {busy ? (
          <div className="grid gap-3 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{fileName}</p>
                <p className={cn('text-xs text-muted-foreground', phase === 'offline' && 'text-destructive')}>
                  {phase === 'offline' && <WifiOffIcon className="mr-1 inline size-3" />}
                  {phaseLabel[phase]}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {phase === 'uploading' && (
                  <Button variant="outline" size="sm" onClick={pause}>
                    <PauseIcon />
                    Pause
                  </Button>
                )}
                {phase === 'paused' && (
                  <Button variant="outline" size="sm" onClick={resume}>
                    <PlayIcon />
                    Resume
                  </Button>
                )}
                {phase !== 'finishing' && (
                  <Button variant="ghost" size="sm" onClick={cancel}>
                    <XIcon />
                    Cancel
                  </Button>
                )}
              </div>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={cn('h-full bg-primary transition-all', phase !== 'uploading' && 'opacity-60')}
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              {(phase === 'preparing' || phase === 'finishing') && <Loader2Icon className="size-3 animate-spin" />}
              {formatBytes(progress.loaded)} of {formatBytes(progress.total)} · {progress.percent}%
            </p>
          </div>
        ) : (
          <label
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              choose(e.dataTransfer.files?.[0])
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors hover:bg-muted/50',
              dragging && 'border-primary bg-muted/50',
            )}
          >
            <UploadIcon className="size-6 text-muted-foreground" />
            <span className="text-sm font-medium">Drop a file here or click to choose</span>
            <span className="text-xs text-muted-foreground">One file at a time</span>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(e) => choose(e.target.files?.[0])}
            />
          </label>
        )}
      </CardContent>
    </Card>
  )
}
