-- ============================================================
-- Migration 085: Activate Provider Industry Mapping Delete-DRAFT
--                 EXECUTE (Q3F-5AS.1) — narrow runtime activation
-- ============================================================
-- Migration 082 installed the provider-industry-mapping physical
-- substrate INERT: no EXECUTE grant existed on any of the three
-- lifecycle RPCs.
--
-- Migration 083 activated the narrow S2 (DRAFT + publication) scope:
-- service_role received EXECUTE on
-- publish_provider_industry_mapping_snapshot only. The archive and
-- delete-DRAFT RPCs remained without an EXECUTE grant, because at that
-- time no application/domain caller existed for either.
--
-- A trusted server-only application boundary now exists for the
-- delete-DRAFT path: an authenticated server session resolves a
-- trusted actor through the existing internal_users record, then calls
-- through a narrow service-role RPC client into
-- delete_draft_provider_industry_mapping_snapshot. No client-supplied
-- actor id is accepted, and there is no direct table DELETE and no
-- archive/publish RPC call anywhere in that path.
--
-- This migration activates ONLY the delete-DRAFT RPC EXECUTE grant for
-- service_role. The publish RPC's EXECUTE grant from migration 083 is
-- untouched. The archive RPC continues to receive no EXECUTE grant —
-- there is still no application/domain caller for it.
--
-- No table privilege change. No RLS policy change. No table/function/
-- trigger DDL. No row data is read, written, or seeded. This migration
-- only issues EXECUTE privilege GRANT/REVOKE statements on the
-- delete-DRAFT RPC.
-- ============================================================


-- ============================================================
-- SECTION 1: Delete-DRAFT RPC EXECUTE privilege baseline
--            (explicit REVOKE)
-- ============================================================
-- Deterministic baseline, independent of any privilege that may have
-- been introduced manually after migration 082 or 083. Does not modify
-- function owner, SECURITY DEFINER, or search_path.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID) FROM service_role;


-- ============================================================
-- SECTION 2: Exact delete-DRAFT RPC EXECUTE grant (service_role only)
-- ============================================================
-- No other role receives this grant. The publish and archive RPC
-- EXECUTE postures are not referenced or modified by this migration.
-- ============================================================

GRANT EXECUTE
  ON FUNCTION public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID)
  TO service_role;
