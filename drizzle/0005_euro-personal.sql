CREATE TABLE "group_reads" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "group_reads_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "groups" ALTER COLUMN "currency" SET DEFAULT 'EUR';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "show_bgn_equivalent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "group_reads" ADD CONSTRAINT "group_reads_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_reads" ADD CONSTRAINT "group_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;