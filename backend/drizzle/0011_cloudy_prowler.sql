CREATE TABLE "dispute_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"submitted_by_user_id" uuid,
	"match_side_id" uuid NOT NULL,
	"evidence_url" text NOT NULL,
	"description" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"status" "dispute_status_enum" DEFAULT 'open' NOT NULL,
	"resolution" "dispute_resolution_enum",
	"resolved_by_user_id" uuid,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "disputes_match_unique" UNIQUE("match_id")
);
--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_match_side_id_match_sides_id_fk" FOREIGN KEY ("match_side_id") REFERENCES "public"."match_sides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispute_evidence_dispute_side_idx" ON "dispute_evidence" USING btree ("dispute_id","match_side_id");--> statement-breakpoint
CREATE INDEX "disputes_status_created_at_idx" ON "disputes" USING btree ("status","created_at");