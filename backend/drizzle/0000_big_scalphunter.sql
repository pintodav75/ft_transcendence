CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pseudo" varchar NOT NULL,
	"email" varchar NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_pseudo_unique" UNIQUE("pseudo"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
