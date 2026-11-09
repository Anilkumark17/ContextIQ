// src/services/uploadthing/uploadthing.route.js
//
// ROUTES
// - /api/uploadthing : UploadThing protocol endpoint (presigned upload + completion callback).
//                      The browser talks to it through the UploadThing client, not axios.
// - /api/documents   : app API, called with axios from the dashboard.

import { Router } from 'express';
import { createRouteHandler, createUploadthing } from 'uploadthing/express';
import { z } from 'zod';
import { config } from '../../config.js';
import { requireAuth } from '../../common/middleware/auth.js';
import { authorizeUpload, getDocuments, handleUploadComplete } from './uploadthing.controller.js';

const f = createUploadthing();

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const uploadRouter = {
  // Organizational documents for ingestion. One file per upload so each gets its own outcome.
  documentUploader: f({
    pdf: { maxFileSize: '16MB', maxFileCount: 1 },
    text: { maxFileSize: '4MB', maxFileCount: 1 },
    [DOCX]: { maxFileSize: '16MB', maxFileCount: 1 },
  })
    // Only admins can actually restrict; authorizeUpload forces 'employee' for everyone else.
    .input(z.object({ accessLevel: z.enum(['employee', 'admin']).default('employee') }))
    .middleware(authorizeUpload)
    .onUploadComplete(handleUploadComplete),
};

export const uploadthingRoutes = createRouteHandler({
  router: uploadRouter,
  config: {
    token: config.uploadthingToken,
    // Outside production, UploadThing cannot reach localhost with its completion callback.
    // Dev mode makes this server pull the callback over a stream instead, so onUploadComplete runs.
    // UploadThing only infers this from NODE_ENV === 'development', which nodemon does not set.
    isDev: !config.isProd,
  },
});

export const documentRoutes = Router();
documentRoutes.get('/', requireAuth, getDocuments);
