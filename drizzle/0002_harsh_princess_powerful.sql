CREATE TABLE "account_avatars" (
	"uid" integer PRIMARY KEY NOT NULL,
	"image" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "avatar_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_avatars" ADD CONSTRAINT "account_avatars_uid_accounts_uid_fk" FOREIGN KEY ("uid") REFERENCES "public"."accounts"("uid") ON DELETE cascade ON UPDATE no action;