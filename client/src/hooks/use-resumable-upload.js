import { useCallback, useEffect, useRef, useState } from 'react'
import { createUpload } from '@/lib/uploadthing'

// Resumable single-file upload on top of UploadThing's createUpload.
//
// phase:
//   idle       nothing in flight
//   preparing  asking our server for a presigned URL (auth + file checks run here)
//   uploading  bytes are being sent
//   paused     paused by the user
//   offline    paused automatically because the browser lost its connection
//   finishing  all bytes sent; waiting for the server to record the document
//
// Pause aborts the request. Resume asks UploadThing how many bytes it already has and sends only
// the rest. Resuming works while the page stays open and the presigned URL is valid (1 hour).
// A connection that drops mid-request (before the `offline` event pauses it) cannot be resumed:
// UploadThing settles the upload as failed, and onError is called.
export function useResumableUpload(endpoint, { onComplete, onError } = {}) {
  const [phase, setPhase] = useState('idle')
  const [progress, setProgress] = useState({ loaded: 0, total: 0, percent: 0 })
  const [fileName, setFileName] = useState('')

  const phaseRef = useRef('idle')
  const handleRef = useRef(null)
  const runRef = useRef(0)
  const callbacksRef = useRef({ onComplete, onError })

  useEffect(() => {
    callbacksRef.current = { onComplete, onError }
  }, [onComplete, onError])

  const changePhase = useCallback((next) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const reset = useCallback(() => {
    handleRef.current = null
    changePhase('idle')
    setProgress({ loaded: 0, total: 0, percent: 0 })
    setFileName('')
  }, [changePhase])

  const safePause = () => {
    try {
      handleRef.current?.pauseUpload()
    } catch {
      // Already aborted; nothing to pause.
    }
  }

  const start = useCallback(
    async (file, input) => {
      if (!file || phaseRef.current !== 'idle') return
      const run = ++runRef.current
      setFileName(file.name)
      setProgress({ loaded: 0, total: file.size, percent: 0 })
      changePhase('preparing')

      try {
        const handle = await createUpload(endpoint, {
          files: [file],
          input,
          onUploadProgress: ({ loaded }) => {
            if (run !== runRef.current) return
            const percent = file.size ? Math.min(100, Math.round((loaded / file.size) * 100)) : 100
            setProgress({ loaded, total: file.size, percent })
            if (loaded >= file.size && phaseRef.current === 'uploading') changePhase('finishing')
          },
        })

        if (run !== runRef.current) {
          // Cancelled while the presigned URL was being prepared.
          handle.pauseUpload()
          return
        }

        handleRef.current = handle
        if (phaseRef.current === 'preparing') changePhase('uploading')
        if (!navigator.onLine) {
          safePause()
          changePhase('offline')
        }

        const [result] = await handle.done()
        if (run !== runRef.current) return
        reset()
        callbacksRef.current.onComplete?.(result)
      } catch (err) {
        if (run !== runRef.current) return
        reset()
        callbacksRef.current.onError?.(err)
      }
    },
    [endpoint, changePhase, reset],
  )

  const pause = useCallback(() => {
    if (phaseRef.current !== 'uploading' || !handleRef.current) return
    safePause()
    changePhase('paused')
  }, [changePhase])

  const resume = useCallback(() => {
    if (!['paused', 'offline'].includes(phaseRef.current) || !handleRef.current) return
    if (!navigator.onLine) return changePhase('offline')
    handleRef.current.resumeUpload()
    changePhase('uploading')
  }, [changePhase])

  // Abandons the upload. The partial file never completes in UploadThing, so no document is created.
  const cancel = useCallback(() => {
    if (phaseRef.current === 'idle') return
    runRef.current++
    if (phaseRef.current === 'uploading' || phaseRef.current === 'finishing') safePause()
    reset()
  }, [reset])

  useEffect(() => {
    const handleOffline = () => {
      if (phaseRef.current !== 'uploading' || !handleRef.current) return
      safePause()
      changePhase('offline')
    }
    const handleOnline = () => {
      if (phaseRef.current !== 'offline' || !handleRef.current) return
      handleRef.current.resumeUpload()
      changePhase('uploading')
    }
    // Leaving the page loses the upload, so ask first.
    const handleBeforeUnload = (event) => {
      if (phaseRef.current !== 'idle') event.preventDefault()
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [changePhase])

  return { phase, progress, fileName, start, pause, resume, cancel }
}
