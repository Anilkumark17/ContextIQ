import { useCallback, useEffect, useState } from 'react'
import { FileTextIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react'
import { DocumentUploader } from '@/components/document-uploader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/context/auth-context'
import { api, errorMessage } from '@/lib/api'
import { formatBytes } from '@/lib/utils'

const statusVariant = {
  pending: 'outline',
  processing: 'secondary',
  ready: 'default',
  failed: 'destructive',
}

const fetchDocuments = () => api.get('/documents').then(({ data }) => data.documents)

export default function Documents() {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const applyResult = useCallback((promise) => {
    promise
      .then((docs) => {
        setDocuments(docs)
        setError('')
      })
      .catch((err) => setError(errorMessage(err, 'Could not load documents')))
      .finally(() => setLoading(false))
  }, [])

  const loadDocuments = useCallback(() => applyResult(fetchDocuments()), [applyResult])

  useEffect(() => {
    applyResult(fetchDocuments())
  }, [applyResult])

  return (
    <div className='mx-auto grid max-w-5xl gap-6'>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>Documents</h1>
        <p className='text-muted-foreground'>Upload organizational documents for the copilot to answer from.</p>
      </div>

      <DocumentUploader isAdmin={isAdmin} onUploaded={loadDocuments} />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="grid gap-1.5">
            <CardTitle>Library</CardTitle>
            <CardDescription>
              {loading ? 'Loading…' : `${documents.length} document${documents.length === 1 ? '' : 's'}`}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={loadDocuments} disabled={loading}>
            <RefreshCwIcon />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : documents.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No documents yet. Upload one above.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin && <TableHead className="hidden md:table-cell">Access</TableHead>}
                  <TableHead className="hidden sm:table-cell">Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <a
                            href={doc.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {doc.title}
                          </a>
                          <div className="truncate text-xs text-muted-foreground">
                            {doc.fileName} · {formatBytes(doc.sizeBytes)}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[doc.status]} className="capitalize" title={doc.error ?? undefined}>
                        {doc.status}
                      </Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="hidden md:table-cell">
                        <Badge variant={doc.accessLevel === 'admin' ? 'secondary' : 'outline'}>
                          {doc.accessLevel === 'admin' ? 'Admins only' : 'All employees'}
                        </Badge>
                      </TableCell>
                    )}
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      <div>{new Date(doc.createdAt).toLocaleDateString()}</div>
                      {doc.uploadedBy && <div className="text-xs">by {doc.uploadedBy}</div>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
