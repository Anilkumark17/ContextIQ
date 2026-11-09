import { generateReactHelpers } from '@uploadthing/react'

// Uploads go browser -> UploadThing storage via presigned URLs, which the UploadThing client
// negotiates with our /api/uploadthing route. The auth cookie rides along (same origin via Vite proxy).
//
// createUpload gives a resumable upload: pauseUpload() aborts the request, resumeUpload() asks
// UploadThing how many bytes it already has (HEAD -> x-ut-range-start) and sends only the rest.
export const { createUpload } = generateReactHelpers({
  url: `${window.location.origin}/api/uploadthing`,
})
