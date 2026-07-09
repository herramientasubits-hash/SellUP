-- ============================================================
-- Migration 083: Activate Provider Industry Mapping DRAFT +
--                 Publication (S2) — narrow runtime activation
--                 (Q3F-5AN.2)
-- ============================================================
-- Migration 082 installed the provider-industry-mapping physical
-- substrate INERT: service_role received SELECT only on all four
-- mapping tables, and no EXECUTE grant existed on any of the three
-- lifecycle RPCs.
--
-- Q3F-5AN.1 added the trusted server-only application boundary
-- (mapping-runtime-wrappers.ts + server.ts): every mapping DB call
-- now runs behind that boundary as service_role, and actor identity
-- is resolved server-side from the authenticated Supabase session
-- (auth.getUser()) to an active public.internal_users record before
-- being passed into the domain services as a trusted argument. No
-- client-supplied actor id is ever accepted.
--
-- This migration activates ONLY the exact S2 write/publication scope
-- required by the current DRAFT + publication domain services:
--   - snapshots:     INSERT + UPDATE   (no DELETE)
--   - concept entries: INSERT + UPDATE + DELETE
--   - associations:    INSERT + UPDATE + DELETE
--   - source vocabularies: no DML (SELECT-only posture unchanged)
--   - publish_provider_industry_mapping_snapshot: EXECUTE
-- Archive and draft-delete RPC execution remain disabled — there are
-- no application/domain callers for them today.
--
-- No SELECT privilege is added or removed here (082's SELECT posture
-- for authenticated/service_role stands unchanged). No RLS policy is
-- created, altered, or dropped. No table/function/trigger DDL. No row
-- data is read, written, or seeded. This migration only issues
-- privilege GRANT/REVOKE statements.
-- ============================================================


-- ============================================================
-- SECTION 1: Table DML privilege baseline (explicit REVOKE)
-- ============================================================
-- Deterministic baseline for all four mapping tables, independent of
-- any privilege that may have been introduced manually after
-- migration 082. Does not touch SELECT.
-- ============================================================

REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_source_vocabularies FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_source_vocabularies FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_source_vocabularies FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_source_vocabularies FROM service_role;

REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_mapping_snapshots FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_mapping_snapshots FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_mapping_snapshots FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_mapping_snapshots FROM service_role;

REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_concept_entries FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_concept_entries FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_concept_entries FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_concept_entries FROM service_role;

REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_mapping_associations FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_mapping_associations FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_mapping_associations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.provider_industry_mapping_associations FROM service_role;


-- ============================================================
-- SECTION 2: Exact service_role table DML grants (S2 scope)
-- ============================================================
-- provider_industry_source_vocabularies receives NO DML grant here —
-- its SELECT-only posture from migration 082 stands unchanged.
-- ============================================================

GRANT INSERT, UPDATE
  ON TABLE public.provider_industry_mapping_snapshots
  TO service_role;

GRANT INSERT, UPDATE, DELETE
  ON TABLE public.provider_industry_concept_entries
  TO service_role;

GRANT INSERT, UPDATE, DELETE
  ON TABLE public.provider_industry_mapping_associations
  TO service_role;


-- ============================================================
-- SECTION 3: Lifecycle RPC EXECUTE privilege baseline (explicit REVOKE)
-- ============================================================
-- Deterministic baseline for all three lifecycle RPCs, independent of
-- any privilege that may have been introduced manually after
-- migration 082. Does not modify function owner, SECURITY DEFINER,
-- or search_path.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.publish_provider_industry_mapping_snapshot(UUID, UUID, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.publish_provider_industry_mapping_snapshot(UUID, UUID, BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.publish_provider_industry_mapping_snapshot(UUID, UUID, BIGINT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.publish_provider_industry_mapping_snapshot(UUID, UUID, BIGINT) FROM service_role;

REVOKE EXECUTE ON FUNCTION public.archive_provider_industry_mapping_snapshot(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_provider_industry_mapping_snapshot(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.archive_provider_industry_mapping_snapshot(UUID, UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.archive_provider_industry_mapping_snapshot(UUID, UUID) FROM service_role;

REVOKE EXECUTE ON FUNCTION public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID) FROM service_role;


-- ============================================================
-- SECTION 4: Exact publication RPC EXECUTE grant (S2 scope)
-- ============================================================
-- archive_provider_industry_mapping_snapshot and
-- delete_draft_provider_industry_mapping_snapshot receive NO EXECUTE
-- grant — there are no application/domain callers for them today.
-- ============================================================

GRANT EXECUTE
  ON FUNCTION public.publish_provider_industry_mapping_snapshot(UUID, UUID, BIGINT)
  TO service_role;
