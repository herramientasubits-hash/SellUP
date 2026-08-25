-- ============================================================================
-- LOCAL (UNNUMBERED) — BR-SOURCE FUNCTIONAL CUT D
-- Fenced promotion of a resolved Receita identity onto a prospect_candidate
-- ============================================================================
--
-- 🔴 THIS FILE IS DELIBERATELY UNNUMBERED.
--
-- The repository's migration namespace is contended: 125, 126, 127 and 128 were
-- each claimed by a different line of work, twice with renames mid-review. This
-- cut is being developed LOCALLY, with no PR and no remote branch, so claiming a
-- number now would either collide with whatever lands next or force a rename
-- later. `LOCAL_` also keeps the file outside every ceiling guard in the repo,
-- all of which select migrations with `/^\d{3}_/` or `parseInt(name.slice(0,3))`
-- — so this file cannot make an unrelated suite fail while it has no number.
--
-- Numbering happens when this work returns to GitHub, and not before.
--
--
-- WHAT THIS CLOSES, STATED AS THE DEFECT
-- --------------------------------------
--
-- CUT C resolves a Brazilian candidate that arrived WITHOUT a CNPJ to exactly one
-- establishment of the run's pinned publication. It then uses that CNPJ for the
-- lookup and DROPS it. Its own report says why:
--
--     DURABLE_TAX_ID_SAFE_PATH = NOT_FOUND
--
-- Agent 1's identity authority evaluates identity at INSERT time only. Migration
-- 126 fences INSERTs (`insert_fenced_prospect_candidates`); nothing fences the
-- ADDITION of a fiscal identity to a row that already exists. So the only way to
-- persist the resolved CNPJ was:
--
--     .update({ tax_identifier })
--
-- which is precisely what `enrich-with-tax-resolution.ts` does for CO/MX today.
-- That statement is unsafe in four separate ways, and each one is a real defect:
--
--   1. it declares no epoch, so a decision taken against a stale photograph of
--      the batch commits anyway;
--   2. it filters by `id` alone, so a caller holding one batch's fence can write
--      into another batch's candidate;
--   3. it never looks at whether ANOTHER candidate of the same batch already
--      holds that fiscal identity — two rows silently become one company;
--   4. it leaves `identity_key` describing the PRE-resolution candidate, so the
--      persisted key and the persisted identifier disagree from that moment on.
--
-- This function is the fenced alternative. It is the ONLY authorized way for the
-- Brazil path to make a resolved Receita identity durable.
--
--
-- WHAT THIS MIGRATION IS NOT
-- --------------------------
--
-- 🔴 The database does NOT become a second identity authority.
--
-- Nothing here canonicalizes a fiscal identifier, normalizes a domain, reads a
-- LinkedIn URL, compares provider ids, canonicalizes a name, or implements a
-- TIER. That policy lives, whole and uncopied, in `fiscal-identity.ts`,
-- `company-identity-evidence.ts` and `batch-identity-registry.ts` — the same
-- separation migration 126 established and for the same reason: two ideas of
-- "the same company" diverge at the first correction.
--
-- The peer scan below compares `p_tax_identifier` to the STORED column values
-- with a plain `=`. That is not identity policy and must never be mistaken for
-- it. It is a narrow structural BACKSTOP over the single population this cut
-- serves, where the value written is always the canonical 14-digit CNPJ that
-- `normalizeBrazilCnpj` produced. It can only REFUSE; it can never approve
-- something TypeScript refused, because TypeScript evaluates first and with the
-- canonical authority. A candidate whose peer stores the same company under a
-- different REPRESENTATION is caught by TypeScript, not by this `=`.
--
-- 🔴 No unique index is created — not on `tax_identifier`, not on `identity_key`,
-- not on anything. The reasons migration 126 gives still hold word for word:
-- `UNIQUE(identity_key)` is impossible by fact (Production already holds
-- historical duplicates) and a fiscal unique index would be a global claim this
-- cut has no authority to make. The scope here is ONE BATCH.
--
-- 🔴 No backfill. No historical row is read, rewritten or recomputed. Applying
-- this migration changes zero rows.
--
--
-- THE MECHANISM
-- -------------
--
-- The same optimistic fence migration 126 introduced, reused rather than
-- reinvented: `prospect_batches.identity_epoch` is a per-batch CHANGE COUNTER,
-- TypeScript reads (rows + epoch) as one coherent photograph via
-- `read_batch_identity_snapshot`, decides with its own authority, and declares
-- here which epoch it decided against.
--
--   · expected epoch == current  ⇒ the row is promoted and the epoch advances by
--                                  EXACTLY 1 — a promotion CHANGES the batch's
--                                  identity state, so a concurrent INSERT decided
--                                  against the pre-promotion photograph must be
--                                  forced to re-decide;
--   · expected epoch != current  ⇒ NOTHING is written, the epoch does not move,
--                                  and `stale` is returned. Normal concurrency
--                                  control, never a fault;
--   · nothing to change          ⇒ `already_same_identity`, and the epoch does
--                                  NOT advance. Replay is idempotent because the
--                                  identity state did not change.
--
-- `FOR UPDATE` on the batch row is what makes it real: two promotions of the same
-- batch SERIALIZE, and under READ COMMITTED the second re-reads the already
-- updated row when it unblocks, sees E+1, and returns `stale`. The lock order is
-- batch-then-candidate, the same order `insert_fenced_prospect_candidates` starts
-- from, so the two functions cannot deadlock against each other.
--
--
-- 🔴 IDOR — THE BATCH IS PART OF THE CANDIDATE LOOKUP
--
-- The candidate is located by `id AND batch_id`, never by `id` alone, and the
-- UPDATE repeats that pair. A caller holding a legitimate fence on batch A
-- therefore cannot promote a candidate of batch B: the row is simply not found.
--
--
-- 🔴 PRIVACY (§ 6)
--
-- No return value of this function carries a CNPJ. `fiscal_identity_conflict`
-- reports a CATEGORY (`candidate_holds_other_identity` /
-- `batch_peer_holds_identity`) and never the colliding identifier, so a conflict
-- cannot be used to read back a value the caller was not entitled to. The
-- identifier travels IN, into its authorized column, and does not travel out.
--
--
-- IDEMPOTENCE AND COMPATIBILITY
-- -----------------------------
--
--   · `CREATE OR REPLACE`: reapplying changes nothing.
--   · No column is added. `tax_identifier`, `tax_id`, `identity_key`,
--     `updated_at` and `status` all predate this file (040 / 045 / 092 / 105).
--   · `identity_epoch` comes from migration 126 and is NOT redefined here: this
--     migration REQUIRES 126 and does not restate it.
--   · While this migration is NOT applied the function does not exist, the
--     TypeScript client detects it (SQLSTATE 42883 / PostgREST PGRST202) and the
--     Brazil path keeps EXACTLY the CUT C behaviour — the resolved CNPJ stays
--     transient, the enrichment still happens, and nothing is written. The
--     promotion is PRESENT in code and INERT until this migration applies.
--
--   · `search_path = pg_catalog, public, pg_temp` for the reason CUT-3B5 proved
--     against Production and wrote into migration 126: these functions are
--     SECURITY INVOKER, so RLS runs under the caller, and Production's policies
--     call `has_active_access()`, which references `internal_users` UNQUALIFIED
--     with `proconfig = NULL`. Dropping `public` from the path makes that nested
--     lookup fail with 42P01. `pg_catalog` stays FIRST so nothing planted in
--     `public` can hijack a catalog function or type.
--
-- 0 providers. 0 credits. 0 HubSpot writes. 0 Production application.
-- ============================================================================


CREATE OR REPLACE FUNCTION public.promote_candidate_fiscal_identity_fenced(
  p_batch_id           uuid,
  p_candidate_id       uuid,
  p_expected_epoch     bigint,
  p_tax_identifier     text,
  p_identity_key       text,
  p_blocking_statuses  text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_now           timestamptz := clock_timestamp();
  v_current_epoch bigint;
  v_existing      text;
  v_conflict      boolean;
BEGIN
  -- 🔴 `p_identity_key` is MANDATORY. A promotion that changed `tax_identifier`
  -- while leaving `identity_key` describing the pre-resolution candidate is one
  -- of the four defects this function exists to prevent, so "the caller forgot
  -- to recompute it" has to be an explicit refusal rather than a silent half
  -- write. The key is composed by the canonical authority
  -- (`buildProspectCandidateIdentityKey`); this function never derives one.
  IF p_batch_id IS NULL
     OR p_candidate_id IS NULL
     OR p_expected_epoch IS NULL
     OR p_tax_identifier IS NULL
     OR btrim(p_tax_identifier) = ''
     OR p_identity_key IS NULL
     OR btrim(p_identity_key) = ''
  THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  -- Serializes promotions AND fenced inserts of the SAME batch. The waiter
  -- re-reads the committed row on unblocking and therefore sees the advanced
  -- epoch. This is the whole guarantee.
  SELECT b.identity_epoch
    INTO v_current_epoch
    FROM public.prospect_batches b
   WHERE b.id = p_batch_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'batch_not_found');
  END IF;

  IF v_current_epoch <> p_expected_epoch THEN
    -- ZERO writes, ZERO epoch movement. The decision came from another state.
    RETURN jsonb_build_object(
      'status',        'stale',
      'current_epoch', v_current_epoch
    );
  END IF;

  -- 🔴 `id AND batch_id`. See the IDOR note above.
  SELECT c.tax_identifier
    INTO v_existing
    FROM public.prospect_candidates c
   WHERE c.id = p_candidate_id
     AND c.batch_id = p_batch_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'candidate_not_found');
  END IF;

  IF v_existing IS NOT NULL AND btrim(v_existing) <> '' THEN
    IF v_existing = p_tax_identifier THEN
      -- Replay. Nothing changed, so the epoch does not move either.
      RETURN jsonb_build_object(
        'status',        'already_same_identity',
        'current_epoch', v_current_epoch
      );
    END IF;
    -- 🔴 A source-supplied fiscal identity is NEVER overwritten by a resolved
    -- one. Two different fiscal identities claiming one row is TIER 0 by another
    -- name, and picking either would be adjudicating in silence.
    RETURN jsonb_build_object(
      'status',   'fiscal_identity_conflict',
      'conflict', 'candidate_holds_other_identity'
    );
  END IF;

  -- The structural backstop. Blocking statuses arrive as a PARAMETER for the
  -- same reason `read_batch_identity_snapshot` takes them: the admission
  -- vocabulary is TypeScript policy and writing it in SQL would create a second
  -- vocabulary that diverges at the first correction.
  SELECT EXISTS (
    SELECT 1
      FROM public.prospect_candidates o
     WHERE o.batch_id = p_batch_id
       AND o.id <> p_candidate_id
       AND o.status = ANY (COALESCE(p_blocking_statuses, ARRAY[]::text[]))
       AND (o.tax_identifier = p_tax_identifier OR o.tax_id = p_tax_identifier)
  )
    INTO v_conflict;

  IF v_conflict THEN
    RETURN jsonb_build_object(
      'status',   'fiscal_identity_conflict',
      'conflict', 'batch_peer_holds_identity'
    );
  END IF;

  UPDATE public.prospect_candidates
     SET tax_identifier = p_tax_identifier,
         identity_key   = p_identity_key,
         updated_at     = v_now
   WHERE id = p_candidate_id
     AND batch_id = p_batch_id;

  -- Exactly once. The epoch counts CHANGES to the batch's identity state, and a
  -- promotion is one.
  UPDATE public.prospect_batches
     SET identity_epoch = v_current_epoch + 1
   WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'status',         'promoted',
    'previous_epoch', v_current_epoch,
    'next_epoch',     v_current_epoch + 1
  );
END;
$fn$;

COMMENT ON FUNCTION public.promote_candidate_fiscal_identity_fenced(uuid, uuid, bigint, text, text, text[]) IS
  'BR-SOURCE CUT D. Epoch check + batch-scoped candidate lookup + peer conflict '
  'backstop + tax_identifier/identity_key update + epoch advance, in ONE '
  'transaction. Contains NO identity policy: no fiscal canonicalization, no '
  'domain, no LinkedIn, no TIER. Returns stale without writing when the decision '
  'came from another state, and never returns a fiscal identifier.';


-- ── GRANTS — declarative final state ────────────────────────────────────────
--
-- SECURITY INVOKER, so the function runs under the caller's role and its RLS.
-- It grants nothing a writer did not already have: the Brazil enrichment hook
-- already updates `prospect_candidates` with these same roles. `anon` and PUBLIC
-- stay out, and are REVOKED first because in Supabase every function is born
-- executable by PUBLIC.

REVOKE ALL ON FUNCTION public.promote_candidate_fiscal_identity_fenced(uuid, uuid, bigint, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_candidate_fiscal_identity_fenced(uuid, uuid, bigint, text, text, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.promote_candidate_fiscal_identity_fenced(uuid, uuid, bigint, text, text, text[])
  TO postgres, authenticated, service_role;


-- ── Explicit PostgREST schema-cache reload ──────────────────────────────────
--
-- Without this, applying the migration may not ACTIVATE it. The client reads
-- PGRST202 as "capability absent", which is correct while the migration is not
-- applied; if it IS applied and PostgREST still serves a stale schema cache the
-- same PGRST202 would mean something else entirely and the Brazil path would
-- keep dropping resolved identities without saying so. Migration 105 set this
-- precedent after a real stale-cache incident; 126 repeated it; so does this.
NOTIFY pgrst, 'reload schema';
