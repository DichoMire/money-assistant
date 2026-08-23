CREATE TABLE "receipt_item_shares" (
	"item_id" uuid NOT NULL,
	"alias_id" uuid NOT NULL,
	"exact_cents" integer,
	CONSTRAINT "receipt_item_shares_item_id_alias_id_pk" PRIMARY KEY("item_id","alias_id")
);
--> statement-breakpoint
CREATE TABLE "receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"raw_text" text,
	"name" text NOT NULL,
	"quantity" double precision DEFAULT 1 NOT NULL,
	"unit_price_cents" integer,
	"total_cents" integer NOT NULL,
	"category" text,
	"assign_mode" text DEFAULT 'unassigned' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_scan_images" (
	"scan_id" uuid PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"content_type" text DEFAULT 'image/jpeg' NOT NULL,
	"byte_size" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"created_by" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"merchant" text,
	"date" date NOT NULL,
	"currency" text NOT NULL,
	"subtotal_cents" integer,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"discounts_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"confidence" double precision,
	"reconciles" boolean DEFAULT false NOT NULL,
	"model" text,
	"image_hash" text NOT NULL,
	"expense_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipt_item_shares" ADD CONSTRAINT "receipt_item_shares_item_id_receipt_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."receipt_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_item_shares" ADD CONSTRAINT "receipt_item_shares_alias_id_aliases_id_fk" FOREIGN KEY ("alias_id") REFERENCES "public"."aliases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_scan_id_receipt_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."receipt_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_scan_images" ADD CONSTRAINT "receipt_scan_images_scan_id_receipt_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."receipt_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_scans_group_hash_idx" ON "receipt_scans" USING btree ("group_id","image_hash");