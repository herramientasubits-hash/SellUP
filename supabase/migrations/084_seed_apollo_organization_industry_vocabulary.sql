-- ============================================================
-- Migration 084: Seed Apollo Organization Industry Vocabulary —
--                 durable configuration bootstrap (Q3F-5AO.2)
-- ============================================================
-- Migration 082 installed the provider-industry-mapping physical
-- substrate INERT: all four tables started empty, and no
-- sourceVocabularyKey was seeded.
--
-- Migration 083 activated ONLY the narrow S2 (DRAFT + publication)
-- runtime write scope for snapshots/concept-entries/associations.
-- provider_industry_source_vocabularies intentionally remained
-- SELECT-only for every role — no DML privilege was granted there,
-- and this migration does not change that posture.
--
-- Q3F-5AO.0 grounded the missing durable source-vocabulary bootstrap:
-- the vocabulary registry table was installed but never seeded, so no
-- recognized sourceVocabularyKey existed for any provider.
--
-- Q3F-5AO.1 froze the Apollo vocabulary identity:
--   source_vocabulary_key = 'apollo_organization_industry'
--   display_name           = 'Apollo Organization Industry'
--   lifecycle               = 'active'
--   seed row count          = 1
--
-- This migration seeds exactly that one ACTIVE durable vocabulary row.
--
-- Vocabulary identity vs. Apollo operation identity: this is a
-- source_vocabulary_key (durable raw-label vocabulary identity), and
-- is distinct from provider_key ('apollo') and from operation_key
-- values ('organizations_search', 'organization_enrichment', both of
-- which are billing/provider-operation identities). None of those
-- three identifiers are interchangeable, and no operation key is used
-- as the seeded vocabulary key here.
--
-- The vocabulary represents the conceptual Apollo ORGANIZATION
-- INDUSTRY raw-label domain. Current Apollo organization response
-- shapes expose both a scalar `industry: string | null` field and an
-- `industries: string[] | null` array field; both are treated as
-- transport-shape variants of the SAME conceptual source vocabulary
-- identity, not as two vocabularies.
--
-- This migration does NOT define raw-label ingestion/fan-out
-- semantics: it does not split arrays, does not insert concept
-- entries, does not normalize raw labels, and does not decide how
-- scalar vs. array values, nulls, or duplicate raw labels are
-- combined. That scalar/array fan-out and normalized dedup policy is
-- left for a later hito, before any DRAFT snapshot is populated for
-- this vocabulary.
--
-- The existing industry_tag_ids / organization_industry_tag_ids
-- fields observed in current Apollo response shapes are NOT treated
-- as a usable taxonomy version or label-code boundary by this
-- migration, and are not seeded or referenced here.
--
-- No mapping snapshot, concept entry, association, or canonical
-- industry mapping is seeded by this migration. Runtime DML on
-- source vocabularies remains disabled after this migration —
-- service_role keeps SELECT-only access, matching migrations 082/083.
--
-- Auditability: the physical table has no created_by/updated_by/
-- deprecated_by column (Q3F-5AO.0: AUDIT_B — FUNCTIONAL_BUT_WEAK).
-- This migration does not add actor columns or redesign the table.
-- For this deployment/configuration bootstrap, authorship trace is
-- provided by Git commit / PR / migration history, not by a DB
-- column. Ongoing runtime/admin governance over source vocabularies
-- is intentionally NOT activated by this seed.
-- ============================================================


-- ============================================================
-- SECTION 1: Seed the single frozen Apollo source vocabulary row
-- ============================================================
-- Plain explicit INSERT, no conflict-handling clause. The live
-- provider_industry_source_vocabularies domain was proven empty
-- before this bootstrap (Q3F-5AO context). source_vocabulary_key is
-- the table's PRIMARY KEY, so if this exact key unexpectedly already
-- exists at apply time, this statement fails closed on the PK
-- uniqueness violation instead of silently accepting an unexpected
-- prior row, a different lifecycle, or a different display_name.
-- Migration history owns exactly-once application; this migration is
-- intentionally not written for safe reapplication.
-- ============================================================

INSERT INTO public.provider_industry_source_vocabularies (
  source_vocabulary_key,
  lifecycle,
  display_name
)
VALUES (
  'apollo_organization_industry',
  'active',
  'Apollo Organization Industry'
);
