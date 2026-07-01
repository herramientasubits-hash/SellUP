-- Hito J: monthly provider allowances on tool_catalog
-- These represent the external contracted quota per provider per month.
-- Distinct from budget_rules (internal SellUp enforcement rules).
-- Both fields are nullable — null means "not configured yet".
alter table tool_catalog
  add column if not exists monthly_credits_allowance numeric null,
  add column if not exists monthly_usd_allowance numeric null;
