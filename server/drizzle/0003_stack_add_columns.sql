DROP INDEX "document_chunks_embedding_idx";--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "trace_id" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "file_key" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "file_url" text NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "embedding_model" varchar(120);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "pinecone_namespace" varchar(120) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "trace_id" varchar(64);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_file_key_unique" UNIQUE("file_key");