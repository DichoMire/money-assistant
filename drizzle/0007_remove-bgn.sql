-- Retire BGN entirely: convert all stored BGN data to EUR at the fixed legal
-- rate (1 EUR = 1.95583 BGN, half away from zero per amount), then drop the
-- leva-equivalent preference column. Statements are ordered so every
-- conversion still sees currency = 'BGN'; the currency flips happen last.
-- Per-expense drift after rounding is settled on the largest payer/share row
-- so sums stay exactly equal to the converted totals. Idempotent: a second
-- run finds no BGN rows and changes nothing.
WITH conv AS (
  SELECT p.expense_id, p.alias_id,
    ROUND(p.paid_cents / 1.95583)::int AS new_cents,
    ROW_NUMBER() OVER (PARTITION BY p.expense_id ORDER BY p.paid_cents DESC, p.alias_id) AS rn,
    (ROUND(e.amount_cents / 1.95583) - SUM(ROUND(p.paid_cents / 1.95583)) OVER (PARTITION BY p.expense_id))::int AS drift
  FROM expense_payers p
  JOIN expenses e ON e.id = p.expense_id
  WHERE e.currency = 'BGN'
)
UPDATE expense_payers p
SET paid_cents = conv.new_cents + CASE WHEN conv.rn = 1 THEN conv.drift ELSE 0 END
FROM conv
WHERE p.expense_id = conv.expense_id AND p.alias_id = conv.alias_id;--> statement-breakpoint
WITH conv AS (
  SELECT s.expense_id, s.alias_id,
    ROUND(s.owed_cents / 1.95583)::int AS new_cents,
    ROW_NUMBER() OVER (PARTITION BY s.expense_id ORDER BY s.owed_cents DESC, s.alias_id) AS rn,
    (ROUND(e.amount_cents / 1.95583) - SUM(ROUND(s.owed_cents / 1.95583)) OVER (PARTITION BY s.expense_id))::int AS drift
  FROM expense_shares s
  JOIN expenses e ON e.id = s.expense_id
  WHERE e.currency = 'BGN'
)
UPDATE expense_shares s
SET owed_cents = conv.new_cents + CASE WHEN conv.rn = 1 THEN conv.drift ELSE 0 END
FROM conv
WHERE s.expense_id = conv.expense_id AND s.alias_id = conv.alias_id;--> statement-breakpoint
-- split_value is cents-denominated only for "adjustment" (raw adjustment) and
-- "exact" (mirrors owed_cents, already converted above); percent/shares/equal
-- values are unitless and stay as typed.
UPDATE expense_shares s
SET split_value = ROUND((s.split_value / 1.95583)::numeric)
FROM expenses e
WHERE e.id = s.expense_id AND e.currency = 'BGN' AND e.split_method = 'adjustment' AND s.split_value IS NOT NULL;--> statement-breakpoint
UPDATE expense_shares s
SET split_value = s.owed_cents
FROM expenses e
WHERE e.id = s.expense_id AND e.currency = 'BGN' AND e.split_method = 'exact' AND s.split_value IS NOT NULL;--> statement-breakpoint
UPDATE expenses
SET amount_cents = ROUND(amount_cents / 1.95583)::int, currency = 'EUR'
WHERE currency = 'BGN';--> statement-breakpoint
UPDATE receipt_items i
SET total_cents = ROUND(i.total_cents / 1.95583)::int,
    unit_price_cents = CASE WHEN i.unit_price_cents IS NULL THEN NULL ELSE ROUND(i.unit_price_cents / 1.95583)::int END
FROM receipt_scans rs
WHERE rs.id = i.scan_id AND rs.currency = 'BGN';--> statement-breakpoint
-- Exact-mode item shares must keep summing to the (already converted) item
-- total; drift lands on the largest share of each item.
WITH conv AS (
  SELECT sh.item_id, sh.alias_id,
    ROUND(sh.exact_cents / 1.95583)::int AS new_cents,
    ROW_NUMBER() OVER (PARTITION BY sh.item_id ORDER BY sh.exact_cents DESC, sh.alias_id) AS rn,
    (i.total_cents - SUM(ROUND(sh.exact_cents / 1.95583)) OVER (PARTITION BY sh.item_id))::int AS drift
  FROM receipt_item_shares sh
  JOIN receipt_items i ON i.id = sh.item_id
  JOIN receipt_scans rs ON rs.id = i.scan_id
  WHERE rs.currency = 'BGN' AND sh.exact_cents IS NOT NULL
)
UPDATE receipt_item_shares sh
SET exact_cents = conv.new_cents + CASE WHEN conv.rn = 1 THEN conv.drift ELSE 0 END
FROM conv
WHERE sh.item_id = conv.item_id AND sh.alias_id = conv.alias_id;--> statement-breakpoint
UPDATE receipt_scans
SET subtotal_cents = CASE WHEN subtotal_cents IS NULL THEN NULL ELSE ROUND(subtotal_cents / 1.95583)::int END,
    tax_cents = ROUND(tax_cents / 1.95583)::int,
    tip_cents = ROUND(tip_cents / 1.95583)::int,
    discounts_cents = ROUND(discounts_cents / 1.95583)::int,
    total_cents = ROUND(total_cents / 1.95583)::int
WHERE currency = 'BGN';--> statement-breakpoint
-- Per-field rounding can shift the reconciliation identity by a cent; store
-- the recomputed truth.
UPDATE receipt_scans rs
SET reconciles = (COALESCE(agg.items_sum, 0) + rs.tax_cents + rs.tip_cents - rs.discounts_cents = rs.total_cents)
FROM (SELECT scan_id, SUM(total_cents) AS items_sum FROM receipt_items GROUP BY scan_id) agg
WHERE agg.scan_id = rs.id AND rs.currency = 'BGN';--> statement-breakpoint
UPDATE receipt_scans SET currency = 'EUR' WHERE currency = 'BGN';--> statement-breakpoint
-- Make the changeover visible in each migrated group's own audit trail.
INSERT INTO activity_log (group_id, actor_user_id, actor_name, action, details)
SELECT id, NULL, 'System', 'group.currency_changed', '{"from":"BGN","to":"EUR"}'::jsonb
FROM groups WHERE currency = 'BGN';--> statement-breakpoint
UPDATE groups SET currency = 'EUR' WHERE currency = 'BGN';--> statement-breakpoint
UPDATE fx_rates SET rates = rates - 'BGN' WHERE rates ? 'BGN';--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "show_bgn_equivalent";
