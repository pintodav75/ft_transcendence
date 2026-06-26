CREATE TYPE "public"."dispute_resolution_enum" AS ENUM('side_0_wins', 'side_1_wins', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."dispute_status_enum" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."format_enum" AS ENUM('1v1', '2v2', '3v3', '5v5');--> statement-breakpoint
CREATE TYPE "public"."match_status_enum" AS ENUM('pending', 'in_progress', 'awaiting_confirmation', 'completed', 'disputed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."provider_enum" AS ENUM('riot', 'steam', 'epic', 'chess_com');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;