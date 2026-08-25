CREATE TABLE "scan_usage" (
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "scan_usage_user_id_period_pk" PRIMARY KEY("user_id","period")
);
--> statement-breakpoint
ALTER TABLE "receipt_item_shares" ADD COLUMN "units" integer;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD COLUMN "tax_group" text;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD COLUMN "line_type" text;--> statement-breakpoint
ALTER TABLE "receipt_scans" ADD COLUMN "second_total_cents" integer;--> statement-breakpoint
ALTER TABLE "receipt_scans" ADD COLUMN "second_currency" text;--> statement-breakpoint
ALTER TABLE "receipt_scans" ADD COLUMN "dual_total_matches" boolean;--> statement-breakpoint
ALTER TABLE "receipt_scans" ADD COLUMN "cost_microusd" integer;--> statement-breakpoint
ALTER TABLE "receipt_scans" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "scan_usage" ADD CONSTRAINT "scan_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;