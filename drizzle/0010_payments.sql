CREATE TABLE "payment_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"iban" text,
	"account_name" text,
	"blink_phone" text,
	"revolut_tag" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "payment_profiles" ADD CONSTRAINT "payment_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;