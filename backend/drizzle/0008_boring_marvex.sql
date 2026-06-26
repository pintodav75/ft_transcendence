CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"required_provider" "provider_enum" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_external_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "provider_enum" NOT NULL,
	"external_id" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_external_accounts_user_provider_unique" UNIQUE("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "user_external_accounts" ADD CONSTRAINT "user_external_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_external_accounts_provider_ext_idx" ON "user_external_accounts" USING btree ("provider","external_id");

--> statement-breakpoint
INSERT INTO "games" (id, name, required_provider) VALUES
  ('lol', 'League of Legends', 'riot'),
  ('cs2', 'Counter-Strike 2', 'steam'),
  ('val', 'Valorant', 'riot'),
  ('rl', 'Rocket League', 'epic'),
  ('chess', 'Chess', 'chess_com')
ON CONFLICT (id) DO NOTHING;
