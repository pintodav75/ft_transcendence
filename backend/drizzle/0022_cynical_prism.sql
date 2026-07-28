CREATE TYPE "public"."team_invitation_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'team_invitation_received';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'team_invitation_accepted';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'team_invitation_declined';--> statement-breakpoint
CREATE TABLE "team_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ladder_id" uuid NOT NULL,
	"status" "team_invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_ladder_id_ladders_id_fk" FOREIGN KEY ("ladder_id") REFERENCES "public"."ladders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_invitations_team_user_pending_unique" ON "team_invitations" USING btree ("team_id","user_id") WHERE "team_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "team_invitations_user_status_idx" ON "team_invitations" USING btree ("user_id","status");