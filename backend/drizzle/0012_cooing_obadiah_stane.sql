CREATE TABLE "rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ladder_id" uuid NOT NULL,
	"user_id" uuid,
	"team_id" uuid,
	"elo" integer DEFAULT 1000 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"last_match_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rankings_user_team_xor_check" CHECK (("rankings"."user_id" IS NULL) <> ("rankings"."team_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_ladder_id_ladders_id_fk" FOREIGN KEY ("ladder_id") REFERENCES "public"."ladders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rankings_ladder_user_unique" ON "rankings" USING btree ("ladder_id","user_id") WHERE "rankings"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "rankings_ladder_team_unique" ON "rankings" USING btree ("ladder_id","team_id") WHERE "rankings"."team_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "rankings_ladder_elo_idx" ON "rankings" USING btree ("ladder_id","elo" DESC NULLS LAST);