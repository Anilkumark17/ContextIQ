import {
  bigint,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Stack: Postgres (Neon) holds relational data and chunk text; Pinecone holds the vectors;
// UploadThing stores the original files; Groq runs embeddings + chat; RIUS traces workflows.

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------- Enums ----------

export const roleEnum = pgEnum('role', ['employee', 'admin']);
export const documentStatusEnum = pgEnum('document_status', ['pending', 'processing', 'ready', 'failed']);
// Lowest role allowed to retrieve a document: 'employee' = everyone, 'admin' = admins only.
export const accessLevelEnum = pgEnum('access_level', ['employee', 'admin']);
export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system', 'tool']);
export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected', 'expired']);
export const feedbackRatingEnum = pgEnum('feedback_rating', ['up', 'down']);
export const auditStatusEnum = pgEnum('audit_status', ['success', 'failure']);

// ---------- Users ----------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('employee'),
  createdAt: createdAt(),
});

// ---------- Documents (ingestion + RAG) ----------

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 255 }).notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 120 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    // UploadThing file key (used to delete the file) and its public URL.
    fileKey: varchar('file_key', { length: 255 }).notNull().unique(),
    fileUrl: text('file_url').notNull(),
    // SHA-256 of the file contents, used to skip re-ingesting the same file.
    checksum: varchar('checksum', { length: 64 }).notNull().unique(),
    status: documentStatusEnum('status').notNull().default('pending'),
    accessLevel: accessLevelEnum('access_level').notNull().default('employee'),
    error: text('error'),
    chunkCount: integer('chunk_count').notNull().default(0),
    // Groq embedding model the chunks were embedded with; re-embed when it changes.
    embeddingModel: varchar('embedding_model', { length: 120 }),
    // Pinecone namespace holding this document's vectors.
    pineconeNamespace: varchar('pinecone_namespace', { length: 120 }).notNull().default('default'),
    metadata: jsonb('metadata').notNull().default({}),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('documents_status_idx').on(t.status),
    index('documents_access_created_idx').on(t.accessLevel, t.createdAt),
  ],
);

// Chunk text lives here for citations; the vector lives in Pinecone.
// The Pinecone vector id is this row's `id`, so search hits map straight back to a chunk.
export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count'),
    // Set once the vector is upserted to Pinecone; null means not indexed yet.
    indexedAt: timestamp('indexed_at', { withTimezone: true }),
    // e.g. { page: 3, section: "Leave policy" } for citations.
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [unique('document_chunks_document_chunk_unique').on(t.documentId, t.chunkIndex)],
);

// ---------- Chat history (persistent conversation memory) ----------

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull().default('New conversation'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('conversations_user_updated_idx').on(t.userId, t.updatedAt)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    // Chunks the answer was grounded on: [{ chunkId, documentId, score }].
    citations: jsonb('citations').notNull().default([]),
    // Groq model that produced an assistant message.
    model: varchar('model', { length: 120 }),
    // RIUS trace id of the workflow run that produced this message.
    traceId: varchar('trace_id', { length: 64 }),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    latencyMs: integer('latency_ms'),
    createdAt: createdAt(),
  },
  (t) => [index('messages_conversation_created_idx').on(t.conversationId, t.createdAt)],
);

// ---------- Human-in-the-loop approvals ----------

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // What the workflow wants to do, e.g. "share_salary_data".
    action: varchar('action', { length: 120 }).notNull(),
    // Why the safety layer flagged it as sensitive.
    reason: text('reason').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: approvalStatusEnum('status').notNull().default('pending'),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    reviewerNote: text('reviewer_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('approval_requests_status_created_idx').on(t.status, t.createdAt),
    index('approval_requests_requested_by_idx').on(t.requestedBy),
  ],
);

// ---------- Feedback on answers ----------

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: feedbackRatingEnum('rating').notNull(),
    comment: text('comment'),
    createdAt: createdAt(),
  },
  (t) => [unique('feedback_message_user_unique').on(t.messageId, t.userId)],
);

// ---------- Audit events (observability) ----------

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Null for system-initiated events or deleted users.
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    // Dotted event name, e.g. "auth.login", "document.ingested", "approval.decided".
    action: varchar('action', { length: 120 }).notNull(),
    entityType: varchar('entity_type', { length: 60 }),
    entityId: uuid('entity_id'),
    status: auditStatusEnum('status').notNull().default('success'),
    // RIUS trace id; groups every step of one AI workflow run. Not a UUID (tracer-generated).
    traceId: varchar('trace_id', { length: 64 }),
    latencyMs: integer('latency_ms'),
    metadata: jsonb('metadata').notNull().default({}),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_events_created_idx').on(t.createdAt),
    index('audit_events_actor_created_idx').on(t.actorId, t.createdAt),
    index('audit_events_entity_idx').on(t.entityType, t.entityId),
    index('audit_events_trace_idx').on(t.traceId),
  ],
);
