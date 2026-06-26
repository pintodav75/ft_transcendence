CREATE TABLE "match_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_side_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "match_participants_side_user_unique" UNIQUE("match_side_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "match_sides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"side_index" smallint NOT NULL,
	"team_id" uuid,
	"submitted_at" timestamp with time zone,
	"submitted_winner_side_id" uuid,
	CONSTRAINT "match_sides_match_side_unique" UNIQUE("match_id","side_index"),
	CONSTRAINT "match_sides_side_index_check" CHECK ("match_sides"."side_index" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ladder_id" uuid NOT NULL,
	"status" "match_status_enum" DEFAULT 'pending' NOT NULL,
	"winner_side_id" uuid,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_side_id_match_sides_id_fk" FOREIGN KEY ("match_side_id") REFERENCES "public"."match_sides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_sides" ADD CONSTRAINT "match_sides_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_sides" ADD CONSTRAINT "match_sides_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_sides" ADD CONSTRAINT "match_sides_submitted_winner_side_id_match_sides_id_fk" FOREIGN KEY ("submitted_winner_side_id") REFERENCES "public"."match_sides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_ladder_id_ladders_id_fk" FOREIGN KEY ("ladder_id") REFERENCES "public"."ladders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_side_id_match_sides_id_fk" FOREIGN KEY ("winner_side_id") REFERENCES "public"."match_sides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_participants_user_idx" ON "match_participants" USING btree ("user_id","match_side_id");--> statement-breakpoint
CREATE INDEX "match_sides_team_match_idx" ON "match_sides" USING btree ("team_id","match_id");--> statement-breakpoint
CREATE INDEX "matches_ladder_status_idx" ON "matches" USING btree ("ladder_id","status");--> statement-breakpoint
CREATE INDEX "matches_ladder_completed_at_idx" ON "matches" USING btree ("ladder_id","completed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "matches_status_scheduled_at_idx" ON "matches" USING btree ("status","scheduled_at");