CREATE TABLE "ladders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" text NOT NULL,
	"format" "format_enum" NOT NULL,
	"name" varchar(50) NOT NULL,
	"lockout_minutes" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ladders_game_format_unique" UNIQUE("game_id","format")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ladder_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_user_unique" UNIQUE("team_id","user_id"),
	CONSTRAINT "team_members_user_ladder_unique" UNIQUE("user_id","ladder_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ladder_id" uuid NOT NULL,
	"name" varchar(50) NOT NULL,
	"captain_id" uuid NOT NULL,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_ladder_name_unique" UNIQUE("ladder_id","name")
);
--> statement-breakpoint
ALTER TABLE "ladders" ADD CONSTRAINT "ladders_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_ladder_id_ladders_id_fk" FOREIGN KEY ("ladder_id") REFERENCES "public"."ladders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_ladder_id_ladders_id_fk" FOREIGN KEY ("ladder_id") REFERENCES "public"."ladders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_captain_id_users_id_fk" FOREIGN KEY ("captain_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");
--> statement-breakpoint
INSERT INTO "ladders" (game_id, format, name, lockout_minutes) VALUES
  ('chess', '1v1', 'Chess 1v1', 30),
  ('lol',   '5v5', 'League of Legends 5v5', 60),
  ('cs2',   '5v5', 'Counter-Strike 2 5v5', 60),
  ('cs2',   '2v2', 'Counter-Strike 2 2v2 (Wingman)', 30),
  ('val',   '5v5', 'Valorant 5v5', 60),
  ('val',   '2v2', 'Valorant 2v2', 30),
  ('rl',    '1v1', 'Rocket League 1v1', 30),
  ('rl',    '2v2', 'Rocket League 2v2', 30),
  ('rl',    '3v3', 'Rocket League 3v3', 30)
ON CONFLICT (game_id, format) DO NOTHING;
