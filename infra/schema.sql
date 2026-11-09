-- Full database schema, concatenated from server/drizzle migrations.
-- Source of truth: server/src/db/schema.js. Regenerate after changing it:
--   cd server && npm run db:generate && npm run schema:sql

-- 0000_round_firedrake.sql
CREATE TYPE "public"."role" AS ENUM('employee', 'admin');
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'employee' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);


-- 0001_enable_pgvector.sql
-- pgvector is required by document_chunks.embedding (next migration).
CREATE EXTENSION IF NOT EXISTS vector;


-- 0002_rag_tables.sql
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');
CREATE TYPE "public"."audit_status" AS ENUM('success', 'failure');
CREATE TYPE "public"."document_status" AS ENUM('pending', 'processing', 'ready', 'failed');
CREATE TYPE "public"."feedback_rating" AS ENUM('up', 'down');
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system', 'tool');
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"requested_by" uuid NOT NULL,
	"action" varchar(120) NOT NULL,
	"reason" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"reviewer_note" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" varchar(120) NOT NULL,
	"entity_type" varchar(60),
	"entity_id" uuid,
	"status" "audit_status" DEFAULT 'success' NOT NULL,
	"trace_id" uuid,
	"latency_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(255) DEFAULT 'New conversation' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer,
	"embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunks_document_chunk_unique" UNIQUE("document_id","chunk_index")
);

CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_path" text NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_checksum_unique" UNIQUE("checksum")
);

CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" "feedback_rating" NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_message_user_unique" UNIQUE("message_id","user_id")
);

CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" varchar(120),
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "approval_requests_status_created_idx" ON "approval_requests" USING btree ("status","created_at");
CREATE INDEX "approval_requests_requested_by_idx" ON "approval_requests" USING btree ("requested_by");
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");
CREATE INDEX "audit_events_actor_created_idx" ON "audit_events" USING btree ("actor_id","created_at");
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");
CREATE INDEX "audit_events_trace_idx" ON "audit_events" USING btree ("trace_id");
CREATE INDEX "conversations_user_updated_idx" ON "conversations" USING btree ("user_id","updated_at");
CREATE INDEX "document_chunks_embedding_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status");
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");

-- 0003_stack_add_columns.sql
DROP INDEX "document_chunks_embedding_idx";
ALTER TABLE "audit_events" ALTER COLUMN "trace_id" SET DATA TYPE varchar(64);
ALTER TABLE "document_chunks" ADD COLUMN "indexed_at" timestamp with time zone;
ALTER TABLE "documents" ADD COLUMN "file_key" varchar(255) NOT NULL;
ALTER TABLE "documents" ADD COLUMN "file_url" text NOT NULL;
ALTER TABLE "documents" ADD COLUMN "embedding_model" varchar(120);
ALTER TABLE "documents" ADD COLUMN "pinecone_namespace" varchar(120) DEFAULT 'default' NOT NULL;
ALTER TABLE "messages" ADD COLUMN "trace_id" varchar(64);
ALTER TABLE "documents" ADD CONSTRAINT "documents_file_key_unique" UNIQUE("file_key");

-- 0004_stack_drop_columns.sql
ALTER TABLE "document_chunks" DROP COLUMN "embedding";
ALTER TABLE "documents" DROP COLUMN "storage_path";

-- 0005_document_access_level.sql
CREATE TYPE "public"."access_level" AS ENUM('employee', 'admin');
ALTER TABLE "documents" ADD COLUMN "access_level" "access_level" DEFAULT 'employee' NOT NULL;
CREATE INDEX "documents_access_created_idx" ON "documents" USING btree ("access_level","created_at");
