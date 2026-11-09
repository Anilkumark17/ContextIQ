ALTER TYPE "public"."document_status" ADD VALUE 'chunked' BEFORE 'ready';--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "page_start" integer;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "page_end" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "page_count" integer;