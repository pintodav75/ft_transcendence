ALTER TABLE "match_participants" DROP CONSTRAINT "match_participants_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;