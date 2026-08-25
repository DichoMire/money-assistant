ALTER TABLE "groups" DROP CONSTRAINT "groups_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "receipt_scans" ADD COLUMN "keep_image" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_export_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "policies_accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Minimization backfill: emails were denormalized into activity_log jsonb by
-- five writers (member joins/leaves/removals, alias attach). The renderers no
-- longer read these keys; scrub them from historical rows too.
UPDATE activity_log SET details = details - 'email' - 'accountEmail'
WHERE details ? 'email' OR details ? 'accountEmail';
