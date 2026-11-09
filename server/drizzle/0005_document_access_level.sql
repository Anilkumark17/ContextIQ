CREATE TYPE "public"."access_level" AS ENUM('employee', 'admin');--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "access_level" "access_level" DEFAULT 'employee' NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_access_created_idx" ON "documents" USING btree ("access_level","created_at");