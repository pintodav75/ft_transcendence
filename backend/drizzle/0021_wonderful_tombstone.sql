ALTER TABLE "match_sides" ADD COLUMN "submitted_score_self" smallint;--> statement-breakpoint
ALTER TABLE "match_sides" ADD COLUMN "submitted_score_opponent" smallint;--> statement-breakpoint
ALTER TABLE "match_sides" ADD COLUMN "score" smallint;--> statement-breakpoint
ALTER TABLE "match_sides" ADD COLUMN "elo_delta" smallint;--> statement-breakpoint
ALTER TABLE "match_sides" ADD COLUMN "elo_after" integer;