-- Migration 123: provider_seen_entities — the memory of WHICH COMPANY A PAID
-- PROVIDER ALREADY SHOWED US, independent of `prospect_candidates`.
-- (Agente 1 · AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 · ADDENDUM PROVIDER-SEEN,
--  gate 2: AGENT1-PROVIDER-SEEN-MEMORY-2)
--
-- ✅ APPLIED IN PRODUCTION. Remote version 20260820153919 (2026-08-20), applied exactly
--    once via the numbered Supabase MCP against project lrdruowtadwbdulndlph, on the
--    owner's authorization and BEFORE any runtime was pointed at the table.
--
--    Verified read-only right after apply:
--      · `provider_seen_entities` exists · `record_provider_seen_entities(jsonb, text,
--        timestamptz)` exists · 0 rows.
--      · anon SELECT = false · authenticated SELECT = false.
--      · service_role SELECT = true · INSERT = true · UPDATE = true · DELETE = FALSE.
--
--    🔴 The order mattered and was respected: schema FIRST, runtime SECOND. Flipping
--    `resolveProviderSeenStore()` before this line was true would have made every run
--    write against a table that did not exist.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
-- ═══════════════════════════════════════════════════════════════════
--
-- Today the ONLY durable trace of a company a paid provider returned lives INSIDE
-- the persisted candidate: `prospect_candidates.source_trace->>'providerCompanyId'`.
-- Measured in Production, read-only, 2026-08-20: 66 of 66 Lusha candidates carry it,
-- and 0 of 10 Apollo candidates carry anything equivalent.
--
-- That is the worst possible shape for the hole. We remember exactly the companies we
-- did NOT need to remember — the ones we already own — and we forget every company
-- that was paid for and then dropped:
--
--     rejected by macro precision · exact duplicate · active historical candidate ·
--     over target · rejected by the writer · discarded · never persisted
--
-- All of those were paid for, all of them are forgotten, and the next run pays for
-- them again. This table is that memory, and it is deliberately NOT a column on
-- `prospect_candidates`: a memory that only survives when the candidate survives is
-- the defect, not the fix.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY A NEW TABLE (the audit that came first)
-- ═══════════════════════════════════════════════════════════════════
--
-- No existing authority can answer the question, and each rejection has its own
-- reason (full write-up: docs/agent1/provider-seen-memory-schema-proposal.md):
--
--   · `prospect_candidates`          — no provider-id column at all; the trace only
--                                      exists for companies that persisted.
--   · `provider_suppressions`        — unique (provider, provider_person_id). That is
--                                      a PRIVACY authority over PEOPLE. Reusing it for
--                                      company economics would repeat verbatim the
--                                      defect #295 fixed: using a spend key as a
--                                      privacy key.
--   · `provider_usage_logs`          — ONE AGGREGATE ROW PER RUN (#307). It has no
--                                      per-company identity and must not grow one.
--   · `source_company_snapshots` /
--     `source_company_signals`       — OFFICIAL country sources. Writing Lusha there
--                                      would falsify their semantics.
--   · `provider_industry_raw_label_observations`
--                                    — the closest in SHAPE (provider key + normalized
--                                      key + first/last_observed_at + first/last run
--                                      id, upsert per observation). It stores INDUSTRY
--                                      LABELS, not company identity: a design
--                                      precedent, not an authority. This table copies
--                                      its shape on purpose.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT THIS TABLE IS NOT
-- ═══════════════════════════════════════════════════════════════════
--
-- It is NOT a copy of the purchased profile. No company name, no size, no industry,
-- no phone, no address, no contact, no revenue. Remembering "I have already seen this
-- id" is not retaining the data that was bought, and that distinction is what keeps
-- this memory outside the reach of a provider redistribution clause.
--
-- It is NOT a dedupe authority. A hit here does not reject a candidate, does not
-- reduce `residualGap` and does not replace the run dedupe. Already-seen is not
-- already-ours.
--
-- It is NOT a ledger and NOT spend observability. It never touches
-- `wizard_budget_reservations`, `wizard_monthly_budget_periods` or the usage log.
--
-- ═══════════════════════════════════════════════════════════════════
-- SAFETY
-- ═══════════════════════════════════════════════════════════════════
--
-- Idempotent: every object uses IF NOT EXISTS / CREATE OR REPLACE, the GRANT block is
-- declarative (REVOKE ALL then enumerate) and there is NO backfill — this migration
-- creates an EMPTY table and reads no existing row. Applying it twice changes nothing.
--
-- Writes no phone number, no email and no person anywhere.

-- ═══════════════════════════════════════════════════════════════════
-- 1. provider_seen_entities
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.provider_seen_entities (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CLOSED vocabulary, fail-closed. This is the border that keeps a free source
  -- (`co_siis`, `co_rues`), HubSpot, an import or a fixture out of the memory of what
  -- was PAID for. A third paid provider arrives with its own migration, not by someone
  -- writing a new string into an open text column.
  provider                text        NOT NULL
    CONSTRAINT provider_seen_entities_provider_check
    CHECK (provider IN ('lusha', 'apollo')),

  -- Today only 'company'. It exists as a COLUMN and not as an implicit assumption
  -- because provider memory of PEOPLE is a different problem with its own privacy
  -- rules (`provider_suppressions` already governs it). Fusing them into one key would
  -- be the exact error #295 corrected.
  provider_entity_type    text        NOT NULL
    CONSTRAINT provider_seen_entities_entity_type_check
    CHECK (provider_entity_type IN ('company')),

  -- The provider native id, stored VERBATIM as the provider issued it (Lusha emits
  -- `v1.<token>`; Apollo emits its Organization ID). It is never normalized across
  -- providers and never translated between them: the pair (provider, id) only means
  -- something inside that provider namespace.
  provider_entity_id      text        NULL
    CONSTRAINT provider_seen_entities_entity_id_not_blank
    CHECK (provider_entity_id IS NULL OR btrim(provider_entity_id) <> ''),

  -- The domain normalized by the EXCLUSION normalizer (`normalizeExclusionDomain`),
  -- which is the one that TRAVELS to the provider — not the laxer run-dedupe one.
  -- Storing it with the lax normalizer and sending it with the strict one would make a
  -- remembered domain never match a sent domain: the memory would be inert and nothing
  -- would fail. The CHECK below mirrors that normalizer so an un-normalized value is
  -- refused at the boundary instead of being silently unmatchable forever.
  normalized_domain       text        NULL
    CONSTRAINT provider_seen_entities_domain_normalized
    CHECK (
      normalized_domain IS NULL
      OR (
        normalized_domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
        AND normalized_domain NOT LIKE 'www.%'
      )
    ),

  first_seen_at           timestamptz NOT NULL,
  last_seen_at            timestamptz NOT NULL,

  -- Run correlation, no PII. Nullable because a run without correlation is still worth
  -- remembering: refusing the memory would cost credits to protect a label.
  first_seen_correlation  text        NULL,
  last_seen_correlation   text        NULL,

  -- A row with NEITHER signal remembers nothing. § 22(I) of the base hito already
  -- forbids inventing a domain, so the alternative to this CHECK is not "a weaker row",
  -- it is a row that occupies the cap and can never match anything.
  CONSTRAINT provider_seen_entities_identity_signal_present
    CHECK (provider_entity_id IS NOT NULL OR normalized_domain IS NOT NULL),

  -- Cannot be violated through the sanctioned path: INSERT sets both to the same
  -- instant and the upsert only ever moves `last_seen_at` forward with GREATEST.
  CONSTRAINT provider_seen_entities_window_ordered
    CHECK (last_seen_at >= first_seen_at)
);

-- ═══════════════════════════════════════════════════════════════════
-- 2. Uniqueness PER SIGNAL, never combined — the key decision
-- ═══════════════════════════════════════════════════════════════════
--
-- The conflict key is the STRONGEST signal available: the native id when the provider
-- gave one, the domain only when it did not. Two PARTIAL indexes with DISJOINT
-- predicates, so every row is covered by exactly one of them.
--
-- 🔴 What the second index deliberately does NOT do: it does not make the domain
-- globally unique. Two DIFFERENT native ids may share a domain (a group and its
-- subsidiary, a holding, a shared corporate site) and they stay TWO rows. A single
-- unique key over the domain would collapse legitimately distinct entities into one,
-- and the memory would then claim we had already seen a company we never saw.
--
-- 🔴 And the symmetric consequence, stated so it is not discovered later: a domain-only
-- row and a later id-bearing row at the SAME domain are TWO rows, not one. Merging them
-- would require asserting that a domain identifies an entity — the very thing the
-- paragraph above refuses. Nothing is lost: `buildProviderSeenMemory` unions both
-- signals into two independent sets, and `isProviderSeenKnown` matches on either.
--
-- 🔴 A combined (id, domain) key is prohibited by § 5 while the written Lusha contract
-- is pending: it would bake a combined ids+domains semantics into the schema before the
-- provider has confirmed one.

CREATE UNIQUE INDEX IF NOT EXISTS provider_seen_entities_native_id_key
  ON public.provider_seen_entities (provider, provider_entity_type, provider_entity_id)
  WHERE provider_entity_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS provider_seen_entities_domain_only_key
  ON public.provider_seen_entities (provider, provider_entity_type, normalized_domain)
  WHERE provider_entity_id IS NULL;

-- The bounded load reads exactly this: one provider, one entity type, most recent
-- first. `id` is in the index so the tie-break of two rows sharing an instant is
-- stable and two identical runs load the same page.
CREATE INDEX IF NOT EXISTS provider_seen_entities_load_idx
  ON public.provider_seen_entities (provider, provider_entity_type, last_seen_at DESC, id);

COMMENT ON TABLE public.provider_seen_entities IS
  'AGENT1-PROVIDER-SEEN-MEMORY-2 — memory of which company a PAID provider already returned, independent of prospect_candidates so that a company rejected, duplicated, over target or never persisted is not paid for twice. Identity only: provider native id and/or exclusion-normalized domain. Never stores the purchased profile (no name, size, industry, phone, address, contact). Not a dedupe authority, not a ledger, not spend observability. Uniqueness is PER SIGNAL and never combined: distinct native ids may share a domain and stay distinct rows. Service-role only.';

COMMENT ON COLUMN public.provider_seen_entities.provider_entity_id IS
  'Provider native id, verbatim. Immutable after insert: it is the identity of the row, not an attribute of it.';

COMMENT ON COLUMN public.provider_seen_entities.normalized_domain IS
  'Domain normalized by the EXCLUSION normalizer (the one that travels to the provider). Mutable in ONE direction only: a non-null observation that is not older replaces it, and a null observation never erases it.';

COMMENT ON COLUMN public.provider_seen_entities.first_seen_at IS
  'Instant of the FIRST write we processed for this identity. Immutable, enforced by trigger. It is not a claim about the earliest instant that ever existed: a late-arriving older write does not move it backwards.';

-- ═══════════════════════════════════════════════════════════════════
-- 3. Immutability, enforced by the TABLE and not trusted to the writer
-- ═══════════════════════════════════════════════════════════════════
--
-- The trigger PINS instead of raising. Raising would surface an exception to a caller
-- whose only job is to remember something, and a memory write that can fail the run it
-- belongs to is worse than a memory write that quietly refuses to lie. What it pins:
--
--   · the identity columns — an UPDATE must never turn one entity into another. That
--     includes `normalized_domain` ON A ROW WITH NO NATIVE ID, where the domain IS the
--     identity: it is the column its partial unique index decides on;
--   · `first_seen_*` — the origin of the window is written once;
--   · on a row that DOES have a native id, a non-null `normalized_domain` against being
--     nulled — absence of an observation is not an observation of absence.
--
-- Everything else (`last_seen_*`, and replacing a domain with a newer non-null one)
-- stays writable, which is exactly the mutable surface section 4 needs.

CREATE OR REPLACE FUNCTION public.provider_seen_entities_pin_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  NEW.id                     := OLD.id;
  NEW.provider               := OLD.provider;
  NEW.provider_entity_type   := OLD.provider_entity_type;
  NEW.provider_entity_id     := OLD.provider_entity_id;
  NEW.first_seen_at          := OLD.first_seen_at;
  NEW.first_seen_correlation := OLD.first_seen_correlation;

  IF OLD.provider_entity_id IS NULL THEN
    -- En una fila sin id nativo el DOMINIO es la identidad: es la columna sobre la que
    -- decide su indice unico parcial. Cambiarlo por un UPDATE convertiria una empresa
    -- en otra, igual que cambiar el id en el caso contrario.
    NEW.normalized_domain := OLD.normalized_domain;
  ELSIF NEW.normalized_domain IS NULL THEN
    NEW.normalized_domain := OLD.normalized_domain;
  END IF;

  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.provider_seen_entities_pin_identity() IS
  'AGENT1-PROVIDER-SEEN-MEMORY-2 — pins the immutable half of a provider_seen_entities row (identity columns, first_seen_*) and refuses to let a null erase a remembered domain. Pins rather than raises: a memory write must never be able to fail the run it belongs to.';

DROP TRIGGER IF EXISTS provider_seen_entities_pin_identity_trg ON public.provider_seen_entities;
CREATE TRIGGER provider_seen_entities_pin_identity_trg
  BEFORE UPDATE ON public.provider_seen_entities
  FOR EACH ROW EXECUTE FUNCTION public.provider_seen_entities_pin_identity();

-- ═══════════════════════════════════════════════════════════════════
-- 4. RLS — service_role only, mirroring migration 120
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.provider_seen_entities ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'provider_seen_entities'
      AND policyname = 'service_role_all_provider_seen_entities'
  ) THEN
    CREATE POLICY "service_role_all_provider_seen_entities"
      ON public.provider_seen_entities FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 5. Table GRANTS — declarative end state, mirroring migrations 107 and 120
-- ═══════════════════════════════════════════════════════════════════
--
-- 🔴 RLS is NOT the layer that keeps this table off a session client. On Supabase the
-- new table is BORN with all eight privileges for anon, authenticated and service_role
-- (`ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES`), and `GRANT` only ever adds, so
-- the only way to reach a known end state is REVOKE ALL first and then enumerate.
-- Enabling RLS alone would leave the GRANT in place; that is the failure mode this
-- block exists for.
--
-- service_role gets SELECT, INSERT and UPDATE. It does NOT get DELETE: deleting a row
-- here silently makes us pay for that company again, which is the one operation this
-- subsystem must not be able to perform by accident. A retention policy is deferred
-- work and depends on the written Lusha answer about id stability (proposal § 3);
-- when it exists it arrives with its own migration and its own grant.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'provider_seen_entities' AND c.relkind = 'r'
  ) THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.provider_seen_entities FROM PUBLIC';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.provider_seen_entities FROM anon';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.provider_seen_entities FROM authenticated';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.provider_seen_entities FROM service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.provider_seen_entities TO service_role';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 6. record_provider_seen_entities — the ONE place upsert semantics live
-- ═══════════════════════════════════════════════════════════════════
--
-- The write is a function and not a client-side upsert for one reason: with TWO partial
-- unique indexes there are TWO conflict targets, and PostgREST cannot express either
-- the partial inference target or the ordered merge below. Splitting that logic between
-- SQL and TypeScript is exactly how a schema and its client end up with two different
-- notions of identity.
--
-- ── Merge rules, stated once ───────────────────────────────────────
--
--   first_seen_at / first_seen_correlation  never move (trigger-pinned).
--   last_seen_at                            GREATEST(stored, incoming).
--   last_seen_correlation                   follows whichever instant won.
--   normalized_domain                       a null never erases; otherwise the most
--                                           recent non-null observation wins, ties by
--                                           arrival.
--
-- 🔴 Those comparisons are what make the result a function of the SET of writes rather
-- than of their arrival order. Plain last-write-wins would converge to whichever
-- request happened to land second, so two concurrent writers could leave two different
-- rows depending on scheduling. Here they cannot.
--
-- 🔴 Why the domain is allowed to move at all: the alternative — keep the first non-null
-- forever — makes the row assert a pairing the provider has stopped emitting while
-- `last_seen_at` claims the row is fresh. The cost is stated plainly: this table keeps
-- no domain HISTORY, and it does not pretend to.
--
-- The batch is collapsed by conflict key BEFORE the insert. Without that, one statement
-- carrying the same identity twice raises "ON CONFLICT DO UPDATE command cannot affect
-- row a second time" — a caller-visible exception produced by a duplicate that is
-- entirely normal in a provider page.
--
-- Rows that carry neither signal, or an unknown provider, are counted as rejected and
-- never inserted. They are reported, not raised: a memory write must not be able to
-- fail the run it belongs to.

CREATE OR REPLACE FUNCTION public.record_provider_seen_entities(
  p_observations  jsonb,
  p_correlation   text,
  p_observed_at   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_batch          jsonb   := '[]'::jsonb;
  v_seen           integer := 0;
  v_valid          integer := 0;
  v_accepted       integer := 0;
  v_new_ids        integer := 0;
  v_new_domains    integer := 0;
  v_refreshed      integer := 0;
  v_refreshed_ids  integer := 0;
  v_refreshed_dom  integer := 0;
BEGIN
  IF p_observations IS NULL
     OR jsonb_typeof(p_observations) <> 'array'
     OR p_observed_at IS NULL
  THEN
    RETURN jsonb_build_object(
      'accepted_count', 0, 'rejected_count', 0, 'duplicate_count', 0,
      'new_ids_recorded', 0, 'new_domains_recorded', 0, 'refreshed_count', 0
    );
  END IF;

  -- Parse, validate and collapse in one pass. `btrim` + `NULLIF` are defensive only:
  -- normalization authority stays in `normalizeExclusionDomain` on the TypeScript side,
  -- and the CHECK on the column refuses anything that did not go through it.
  WITH raw AS (
    SELECT
      NULLIF(btrim(o.value ->> 'provider'), '')                            AS provider,
      COALESCE(NULLIF(btrim(o.value ->> 'entity_type'), ''), 'company')    AS entity_type,
      NULLIF(btrim(o.value ->> 'provider_entity_id'), '')                  AS provider_entity_id,
      NULLIF(btrim(o.value ->> 'normalized_domain'), '')                   AS normalized_domain,
      o.ord                                                                AS ord
    FROM jsonb_array_elements(p_observations) WITH ORDINALITY AS o(value, ord)
  ),
  valid AS (
    SELECT r.*
    FROM raw r
    WHERE r.provider IN ('lusha', 'apollo')
      AND r.entity_type = 'company'
      AND (r.provider_entity_id IS NOT NULL OR r.normalized_domain IS NOT NULL)
  ),
  collapsed AS (
    SELECT
      v.provider,
      v.entity_type,
      v.provider_entity_id,
      -- Most recent non-null domain inside the batch. Ties break by arrival, which is
      -- the same rule the cross-run merge uses when two writes share an instant.
      (array_agg(v.normalized_domain ORDER BY v.ord DESC)
         FILTER (WHERE v.normalized_domain IS NOT NULL))[1] AS normalized_domain
    FROM valid v
    GROUP BY
      v.provider,
      v.entity_type,
      v.provider_entity_id,
      COALESCE('id:' || v.provider_entity_id, 'domain:' || v.normalized_domain)
  )
  SELECT
    COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb),
    (SELECT count(*) FROM raw),
    (SELECT count(*) FROM valid)
  INTO v_batch, v_seen, v_valid
  FROM collapsed c;

  SELECT count(*)::integer INTO v_accepted FROM jsonb_array_elements(v_batch);

  -- Novelty is counted BEFORE the write, over the whole table and not just the
  -- conflicting row: an id can be new while its domain is already known from a
  -- different row, and reporting either as "new" would misdescribe the batch.
  SELECT count(*)::integer INTO v_new_ids
  FROM (
    SELECT DISTINCT b.provider, b.entity_type, b.provider_entity_id
    FROM jsonb_to_recordset(v_batch)
      AS b(provider text, entity_type text, provider_entity_id text, normalized_domain text)
    WHERE b.provider_entity_id IS NOT NULL
  ) d
  WHERE NOT EXISTS (
    SELECT 1 FROM public.provider_seen_entities e
    WHERE e.provider             = d.provider
      AND e.provider_entity_type = d.entity_type
      AND e.provider_entity_id   = d.provider_entity_id
  );

  SELECT count(*)::integer INTO v_new_domains
  FROM (
    SELECT DISTINCT b.provider, b.entity_type, b.normalized_domain
    FROM jsonb_to_recordset(v_batch)
      AS b(provider text, entity_type text, provider_entity_id text, normalized_domain text)
    WHERE b.normalized_domain IS NOT NULL
  ) d
  WHERE NOT EXISTS (
    SELECT 1 FROM public.provider_seen_entities e
    WHERE e.provider             = d.provider
      AND e.provider_entity_type = d.entity_type
      AND e.normalized_domain    = d.normalized_domain
  );

  -- Branch 1: rows the provider identified natively. Conflict target is the id index.
  WITH src AS (
    SELECT b.provider, b.entity_type, b.provider_entity_id, b.normalized_domain
    FROM jsonb_to_recordset(v_batch)
      AS b(provider text, entity_type text, provider_entity_id text, normalized_domain text)
    WHERE b.provider_entity_id IS NOT NULL
  ),
  ins AS (
    INSERT INTO public.provider_seen_entities AS t (
      provider, provider_entity_type, provider_entity_id, normalized_domain,
      first_seen_at, last_seen_at, first_seen_correlation, last_seen_correlation
    )
    SELECT
      s.provider, s.entity_type, s.provider_entity_id, s.normalized_domain,
      p_observed_at, p_observed_at, p_correlation, p_correlation
    FROM src s
    ON CONFLICT (provider, provider_entity_type, provider_entity_id)
      WHERE provider_entity_id IS NOT NULL
    DO UPDATE SET
      last_seen_at = GREATEST(t.last_seen_at, EXCLUDED.last_seen_at),
      last_seen_correlation = CASE
        WHEN EXCLUDED.last_seen_at >= t.last_seen_at THEN EXCLUDED.last_seen_correlation
        ELSE t.last_seen_correlation
      END,
      normalized_domain = CASE
        WHEN EXCLUDED.normalized_domain IS NULL       THEN t.normalized_domain
        WHEN t.normalized_domain        IS NULL       THEN EXCLUDED.normalized_domain
        WHEN EXCLUDED.last_seen_at >= t.last_seen_at  THEN EXCLUDED.normalized_domain
        ELSE t.normalized_domain
      END
    RETURNING (xmax <> 0) AS refreshed
  )
  SELECT count(*) FILTER (WHERE i.refreshed)::integer INTO v_refreshed_ids FROM ins i;

  -- Branch 2: rows identified only by domain. Conflict target is the domain index,
  -- whose predicate makes it apply to these rows and to no other.
  WITH src AS (
    SELECT b.provider, b.entity_type, b.normalized_domain
    FROM jsonb_to_recordset(v_batch)
      AS b(provider text, entity_type text, provider_entity_id text, normalized_domain text)
    WHERE b.provider_entity_id IS NULL
  ),
  ins AS (
    INSERT INTO public.provider_seen_entities AS t (
      provider, provider_entity_type, provider_entity_id, normalized_domain,
      first_seen_at, last_seen_at, first_seen_correlation, last_seen_correlation
    )
    SELECT
      s.provider, s.entity_type, NULL, s.normalized_domain,
      p_observed_at, p_observed_at, p_correlation, p_correlation
    FROM src s
    ON CONFLICT (provider, provider_entity_type, normalized_domain)
      WHERE provider_entity_id IS NULL
    DO UPDATE SET
      last_seen_at = GREATEST(t.last_seen_at, EXCLUDED.last_seen_at),
      last_seen_correlation = CASE
        WHEN EXCLUDED.last_seen_at >= t.last_seen_at THEN EXCLUDED.last_seen_correlation
        ELSE t.last_seen_correlation
      END
    RETURNING (xmax <> 0) AS refreshed
  )
  SELECT count(*) FILTER (WHERE i.refreshed)::integer INTO v_refreshed_dom FROM ins i;

  v_refreshed := COALESCE(v_refreshed_ids, 0) + COALESCE(v_refreshed_dom, 0);

  -- 🔴 Una repeticion NO es un rechazo. Restar lo aceptado de lo recibido las mezclaba,
  -- y una pagina que trae la misma empresa dos veces habria reportado un rechazo que no
  -- ocurrio. Se separan porque son dos hechos distintos: lo que no era identificable, y
  -- lo que era la misma identidad otra vez.
  RETURN jsonb_build_object(
    'accepted_count',       v_accepted,
    'rejected_count',       v_seen - v_valid,
    'duplicate_count',      v_valid - v_accepted,
    'new_ids_recorded',     v_new_ids,
    'new_domains_recorded', v_new_domains,
    'refreshed_count',      v_refreshed
  );
END
$fn$;

COMMENT ON FUNCTION public.record_provider_seen_entities(jsonb, text, timestamptz) IS
  'AGENT1-PROVIDER-SEEN-MEMORY-2 — the ONE place where provider_seen_entities upsert semantics live. Collapses the batch by conflict key, routes each row to the partial unique index that covers it, keeps first_seen_* frozen, moves last_seen_at only forward and lets a non-null domain replace an older one while a null never erases. Idempotent and concurrency-safe; rows without an identity signal are reported as rejected, never raised. Writes no purchased profile field. Service-role only.';

REVOKE ALL ON FUNCTION public.record_provider_seen_entities(jsonb, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_provider_seen_entities(jsonb, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.record_provider_seen_entities(jsonb, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_provider_seen_entities(jsonb, text, timestamptz) TO postgres, service_role;
