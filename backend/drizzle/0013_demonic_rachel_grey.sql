CREATE TABLE "game_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" text NOT NULL,
	"name" varchar,
	CONSTRAINT "game_maps_game_name_unique" UNIQUE("game_id","name")
);
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "maps" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "game_maps" ADD CONSTRAINT "game_maps_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "game_maps" ("game_id", "name") VALUES
	('val', 'Ascent'),
	('val', 'Lotus'),
	('val', 'Sunset'),
	('val', 'Split'),
	('val', 'Breeze'),
	('val', 'Summit'),
	('cs2', 'Mirage'),
	('cs2', 'Inferno'),
	('cs2', 'Nuke'),
	('cs2', 'Ancient'),
	('cs2', 'Anubis'),
	('cs2', 'Vertigo'),
	('cs2', 'Dust2')
ON CONFLICT ("game_id", "name") DO NOTHING;