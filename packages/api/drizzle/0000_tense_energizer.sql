CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "editorial_contradictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"topic_id" varchar(64) NOT NULL,
	"prior_fact_id" uuid NOT NULL,
	"new_evidence" text NOT NULL,
	"tension_type" varchar(32) NOT NULL,
	"explanation" text NOT NULL,
	"resolution" varchar(32) DEFAULT 'pending' NOT NULL,
	"resolved_in_piece_id" varchar(128),
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "editorial_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"topic_id" varchar(64) NOT NULL,
	"piece_id" varchar(128) NOT NULL,
	"fact_type" varchar(32) NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"confidence" varchar(16) DEFAULT 'moderate' NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"superseded_by" uuid,
	"source_event_id" varchar(128) NOT NULL,
	"extraction_model" varchar(64) NOT NULL,
	"extraction_cost_usd" numeric(10, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_piece_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"topic_id" varchar(64) NOT NULL,
	"piece_id" varchar(128) NOT NULL,
	"event_id" varchar(128) NOT NULL,
	"directional_view" varchar(16) NOT NULL,
	"view_confidence" varchar(16) NOT NULL,
	"one_sentence_summary" text NOT NULL,
	"word_count" integer NOT NULL,
	"memory_context_tokens" integer DEFAULT 0 NOT NULL,
	"contradictions_surfaced" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editorial_contradictions" ADD CONSTRAINT "editorial_contradictions_prior_fact_id_editorial_facts_id_fk" FOREIGN KEY ("prior_fact_id") REFERENCES "public"."editorial_facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_facts" ADD CONSTRAINT "editorial_facts_superseded_by_editorial_facts_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."editorial_facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_contradictions_pending" ON "editorial_contradictions" USING btree ("tenant_id","topic_id","resolution") WHERE "editorial_contradictions"."resolution" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_facts_tenant_topic_valid_from" ON "editorial_facts" USING btree ("tenant_id","topic_id","valid_from");--> statement-breakpoint
CREATE INDEX "idx_facts_active" ON "editorial_facts" USING btree ("tenant_id","topic_id") WHERE "editorial_facts"."valid_to" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_piece_logs_piece_id" ON "editorial_piece_logs" USING btree ("piece_id");--> statement-breakpoint
CREATE INDEX "idx_piece_logs_tenant_topic_published" ON "editorial_piece_logs" USING btree ("tenant_id","topic_id","published_at");--> statement-breakpoint
CREATE INDEX "idx_facts_embedding_hnsw" ON "editorial_facts" USING hnsw ("embedding" vector_cosine_ops);