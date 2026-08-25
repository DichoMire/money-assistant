CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE INDEX "activity_log_group_created_idx" ON "activity_log" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "aliases_group_idx" ON "aliases" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "expense_payers_alias_idx" ON "expense_payers" USING btree ("alias_id");--> statement-breakpoint
CREATE INDEX "expense_shares_alias_idx" ON "expense_shares" USING btree ("alias_id");--> statement-breakpoint
CREATE INDEX "expenses_group_date_idx" ON "expenses" USING btree ("group_id","date");--> statement-breakpoint
CREATE INDEX "group_invites_group_idx" ON "group_invites" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_members_user_idx" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "receipt_scans_expense_idx" ON "receipt_scans" USING btree ("expense_id");