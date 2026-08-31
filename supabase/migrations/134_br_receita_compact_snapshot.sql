-- 134 — BR RECEITA COMPACT NATIONAL SNAPSHOT STORAGE.
-- Milestone: BR-COMPACT-SNAPSHOT-PRODUCTIZATION.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- APPLIED IN PRODUCTION: NO.
--
-- This migration is AUTHORED and NUMBERED. It is part of the numbered chain and it
-- is a release artifact — but it is NOT applied. No apply_migration, no SQL editor,
-- no remote SQL, no Production. Applying it is a separate, later, explicitly
-- authorized step by the owner.
--
-- 🔴 Numbered 134 against an independently verified ceiling: `origin/main` at
-- 9b7ff9db carries 133_br_candidate_identity_promotion.sql as its highest
-- migration, and no open pull request claims 134.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- ── Why a dedicated table, measured rather than argued ─────────────────────────
--
-- Brazil's monthly publication is 72,318,975 establishments. Measured on real
-- Receita 2026-07 rows in an ephemeral PostgreSQL 17.6, the CURRENT generic
-- projection costs 1409 B/row all-in — 94.9 GB for ONE national month. That is
-- not a raw_data problem alone; it is a shape problem, and the shape is generic:
--
--   heap   1030 B/row  · of which ~831 B is the jsonb, and ~61% of the jsonb text
--                        is key NAMES and punctuation repeated 72M times, plus a
--                        constant source_key ('br_receita_cnpj_dados_abertos',
--                        29 B), a duplicated source_period, a surrogate uuid id,
--                        priority_score, two '{}'::jsonb columns and six NULL
--                        columns no Brazil reader ever consults.
--   index   377 B/row  · SEVEN indexes land on every Brazil row. Three of them
--                        lead with that constant source_key. One of them,
--                        source_company_snapshots_cn1_record_identity_key, is a
--                        UNIQUE index over a column Brazil is FORBIDDEN to
--                        populate — 72M NULL entries.
--
-- The generic table cannot be fixed for Brazil without altering indexes that ten
-- other connectors depend on. A dedicated table can carry exactly the columns
-- Brazil's readers consume and exactly the two indexes Brazil's queries need:
--
--   heap    ~283 B/row
--   index   ~128-140 B/row  · PK ~48 B/row + the read-path name index ~77 B/row
--   total   411-423 B/row   →  27.7-28.5 GB for ONE national month  (~3.4x smaller)
--
-- The range is not vagueness: it is two runs of the same harness over real Receita
-- rows at two sample sizes (17,273 and 170,525 accepted rows), and per-row overhead
-- shrinks slightly as pages fill. Both runs land in the same place.
--
-- ── Storage plan — the OWNER'S figures, which are deliberately conservative ─────
--
-- The owner plans above the measurement rather than at it:
--
--   ONE PERIOD           ~29.19 GB
--   TWO PERIODS          ~58.38 GB   (current + previous, the retention contract)
--   NORMAL REFRESH PEAK  ~82.32 GB   (current + previous + the preparing month)
--
-- 🔴 PROPOSED PRODUCTION DISK: 150 GB — not 120. The extra headroom is for a case
-- this migration makes possible and § 4 makes visible: a normal refresh peak PLUS
-- one retained same-period superseded national run, with WAL, the temporary sort
-- space of the index build, and the non-Brazil half of the database still fitting.
--
-- Nothing is resized here. This migration allocates no disk and changes no compute.
--
-- ── Why partitioned by run, and not just a table ───────────────────────────────
--
-- Retention has to remove ~72M rows a month. As a DELETE that is tens of GB of
-- WAL, a long transaction on a small compute, and 27 GB of dead tuples. As a
-- partition it is a catalog operation.
--
-- Partitioning by snapshot_run_id also makes two contracts STRUCTURAL rather
-- than remembered:
--
--   · a `preparing` run's child is a DETACHED standalone table. Its rows are not
--     reachable through the parent AT ALL. A partial month is unreadable because
--     it is not attached, not merely because a publish_state filter says so.
--   · the read-path name index is built ONCE, by sort, on the detached child
--     before it is attached. Measured: 78 B/row instead of 127 B/row for the same
--     index grown row-by-row under random-order inserts.
--
-- ── What this migration deliberately does NOT do ───────────────────────────────
--
--   · it does not touch source_company_snapshots, its constraints or its indexes;
--   · it does not touch source_snapshot_runs — publication stays exactly where
--     migration 127 put it, and there is no second publication system;
--   · it does not touch migration 133 or promote_candidate_fiscal_identity_fenced;
--   · it does not create a partition. Partitions are minted per run, at run time.
--
-- ── Privacy ────────────────────────────────────────────────────────────────────
--
-- Exactly ONE persisted representation of the establishment CNPJ, in
-- `normalized_tax_id`, exactly as GATE-4A authorized. There is no `tax_id`
-- column, no `record_identity_key` column, no jsonb that could carry CNPJ
-- material, and no CNPJ fragment anywhere. Socios/QSA/CPF, person names, phones,
-- e-mail and fine street address have no column to land in — the refusal is
-- structural, not a rule the writer has to remember.
--
-- 🔴 GATE-4A LOCATION AMENDMENT — APPROVED BY THE OWNER, and narrow.
--
-- The GATE-4A grant of 2026-08-24 named `source_company_snapshots` as the location
-- of the single permitted representation. The owner has AMENDED that location, and
-- only that location:
--
--     FROM  public.source_company_snapshots.normalized_tax_id
--     TO    public.br_receita_snapshots.normalized_tax_id
--
-- Nothing else in GATE-4A changes. The permission is NOT widened. Still prohibited,
-- and still structurally impossible in this table: `tax_id` persistence,
-- `record_identity_key` persistence, CNPJ in JSON, CNPJ fragments, any
-- hash/fingerprint/surrogate derived from the CNPJ, and any logging, reporting or
-- public projection of `normalized_tax_id`.
--
-- The amendment is Brazil-specific. It says nothing about any other connector, and
-- it moves no permission onto any other table.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. The compact national projection
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.br_receita_snapshots (
  -- ── publication ──
  -- The run this row belongs to. FK to the SAME source_snapshot_runs migration 127
  -- already governs: one publication model, not two.
  snapshot_run_id          uuid NOT NULL
                             REFERENCES public.source_snapshot_runs (id) ON DELETE RESTRICT,
  -- Redundant with the run row on purpose: every reader predicate already carries
  -- it, and keeping it means the pinned/published readers keep their exact
  -- (period, run) scoping instead of trusting the run alone. 8 B/row.
  source_period            text NOT NULL
                             CHECK (source_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  -- ── identity — the ONE persisted representation (GATE-4A) ──
  normalized_tax_id        text NOT NULL
                             CHECK (normalized_tax_id ~ '^[A-Z0-9]{12}[0-9]{2}$'),

  -- ── company ──
  legal_name               text,
  -- Derived by the writer from legal_name with normalizeBrCompanyLegalName. The
  -- resolver filters on it with a plain `=`; writer and reader must agree on the
  -- same function, which is why both live in one module.
  normalized_legal_name    text,

  -- ── Agent1-approved business signals (GATE-3 closed allowlist) ──
  -- One column each, instead of one jsonb carrying its own key names 72M times.
  matrix_branch_flag       text,
  company_size_code        text,
  capital_social_value     text,
  registration_status_code text,
  -- Always NULL today (Receita publishes no status label in the families this
  -- connector reads). Kept as a column so a future label costs no migration and,
  -- while NULL, costs no bytes beyond the null bitmap that already exists.
  registration_status_label text,
  cnae_main_code           text,
  cnae_main_label          text,
  -- The secondary CNAE list, joined with ','. The parser splits source values on
  -- every non-alphanumeric character, so a ',' can never occur INSIDE a code and
  -- the round trip is exact. A text[] would cost ~30 B/row of array overhead for
  -- a mean of 1.9 codes.
  cnae_secondary_codes     text,
  municipality_code        text,
  -- Read by CUT C to disambiguate two establishments that share a legal name.
  municipality_name        text,
  uf                       text,
  start_date               text,

  -- Query A (exact pinned CNPJ lookup) and the one-row-per-identity-per-run
  -- contract the readers' CARDINALITY_VIOLATION depends on. Also query D
  -- (rows of one run, for lifecycle) by leading-column prefix scan.
  PRIMARY KEY (snapshot_run_id, normalized_tax_id)
) PARTITION BY LIST (snapshot_run_id);

COMMENT ON TABLE public.br_receita_snapshots IS
  'BR Receita monthly national establishment projection. One LIST partition per '
  'source_snapshot_runs.id. Carries exactly the columns the Brazil readers consume '
  'and exactly one representation of the establishment CNPJ (normalized_tax_id, '
  'GATE-4A). No tax_id, no record_identity_key, no jsonb, no socios/QSA/CPF, no '
  'person name, no phone, no e-mail, no fine street address.';

COMMENT ON COLUMN public.br_receita_snapshots.snapshot_run_id IS
  'Publication run and partition key. A version identifier ONLY: never derived '
  'from a tax identifier and never an identity representation.';

COMMENT ON COLUMN public.br_receita_snapshots.normalized_tax_id IS
  'The ONE persisted exact-lookup representation of the establishment CNPJ, '
  'GATE-4A. Never printed, never logged, never reported, never publicly projected.';

-- Query B (exact normalized legal-name lookup inside one publication). Declared
-- on the parent so every partition is guaranteed to carry it; built on each child
-- BEFORE attach, so it is packed by sort rather than grown by random insert.
CREATE INDEX br_receita_snapshots_name_idx
  ON public.br_receita_snapshots (snapshot_run_id, normalized_legal_name);

-- Same posture as migration 065: internal, server-side only, no public access.
ALTER TABLE public.br_receita_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access br receita snapshots"
  ON public.br_receita_snapshots FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.br_receita_snapshots FROM anon, authenticated;
GRANT ALL ON TABLE public.br_receita_snapshots TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Partition lifecycle
--
-- The DDL lives HERE, reviewed once, rather than being assembled from strings in
-- TypeScript. The gateway calls these functions and passes a uuid; it never emits
-- an identifier it built itself.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.br_receita_run_partition_name(p_snapshot_run_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  -- 20 + 2 + 32 = 54 characters, inside the 63-byte identifier limit.
  SELECT 'br_receita_snapshots_p' || replace(p_snapshot_run_id::text, '-', '')
$fn$;

/**
 * Mint the standalone child for a run. DETACHED on purpose: until it is attached
 * its rows are unreachable through the parent, so a half-built month cannot be
 * read even by a reader that forgot to check publish_state.
 */
CREATE OR REPLACE FUNCTION public.br_receita_begin_run_partition(p_snapshot_run_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_name text;
BEGIN
  IF p_snapshot_run_id IS NULL THEN
    RAISE EXCEPTION 'br_receita_begin_run_partition: snapshot_run_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.source_snapshot_runs r
     WHERE r.id = p_snapshot_run_id
       AND r.source_key = 'br_receita_cnpj_dados_abertos'
  ) THEN
    RAISE EXCEPTION
      'br_receita_begin_run_partition: % is not a br_receita_cnpj_dados_abertos run',
      p_snapshot_run_id;
  END IF;

  v_name := public.br_receita_run_partition_name(p_snapshot_run_id);

  EXECUTE format(
    'CREATE TABLE public.%I ('
    '  LIKE public.br_receita_snapshots INCLUDING DEFAULTS INCLUDING CONSTRAINTS,'
    -- The CHECK that matches the future FOR VALUES clause. With it present,
    -- ATTACH PARTITION skips the validation scan entirely.
    '  CONSTRAINT %I CHECK (snapshot_run_id = %L::uuid),'
    '  PRIMARY KEY (snapshot_run_id, normalized_tax_id)'
    ')',
    v_name, v_name || '_run_chk', p_snapshot_run_id
  );

  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_name);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
    v_name || '_svc', v_name
  );
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', v_name);
  EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_name);

  RETURN v_name;
END;
$fn$;

/**
 * Build the read-path index on the detached child. Separate from attach so the
 * publish transaction stays short: this is the slow step on 72M rows, and it
 * touches a table no reader can see.
 */
CREATE OR REPLACE FUNCTION public.br_receita_build_run_partition_indexes(p_snapshot_run_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_name text := public.br_receita_run_partition_name(p_snapshot_run_id);
BEGIN
  IF to_regclass('public.' || quote_ident(v_name)) IS NULL THEN
    RAISE EXCEPTION 'br_receita_build_run_partition_indexes: partition % does not exist', v_name;
  END IF;

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (snapshot_run_id, normalized_legal_name)',
    v_name || '_name_idx', v_name
  );
  EXECUTE format('ANALYZE public.%I', v_name);
  RETURN v_name;
END;
$fn$;

/**
 * Make the month visible. Called INSIDE the publish transaction, so the rows
 * become reachable in the same commit that promotes the run to `published`.
 */
CREATE OR REPLACE FUNCTION public.br_receita_attach_run_partition(p_snapshot_run_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_name text := public.br_receita_run_partition_name(p_snapshot_run_id);
BEGIN
  IF to_regclass('public.' || quote_ident(v_name)) IS NULL THEN
    RAISE EXCEPTION 'br_receita_attach_run_partition: partition % does not exist', v_name;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_inherits i
     WHERE i.inhrelid = ('public.' || quote_ident(v_name))::regclass
       AND i.inhparent = 'public.br_receita_snapshots'::regclass
  ) THEN
    RETURN v_name;  -- already attached: a replay is a no-op, not an error
  END IF;

  EXECUTE format(
    'ALTER TABLE public.br_receita_snapshots ATTACH PARTITION public.%I FOR VALUES IN (%L)',
    v_name, p_snapshot_run_id
  );
  RETURN v_name;
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Retention — publication-generation, fail-closed
--
-- Policy: keep the CURRENT published period and the PREVIOUS published period.
-- No time TTL is invented: this repository records no authoritative maximum
-- Agent1 run lifetime, so the safety boundary is a generation count, not a clock.
--
-- The guard lives in the database because the dangerous mistake is a caller that
-- passes the wrong run id. A caller cannot talk this function into dropping a run
-- that a pinned batch might still read:
--
--   · a run that was PUBLISHED and whose period is the newest or the previous
--     published period is refused;
--   · a run that was SUPERSEDED by a same-period republish is refused on the same
--     terms — the pinned reader does NOT re-check publish_state, so a batch pinned
--     to the demoted run still reads its rows;
--   · `preparing` / `failed` / `rolled_back` runs were never published (migration
--     127's publish transition and the fail path both refuse to move a published
--     run), so no pin can exist for them and they are always droppable;
--   · the scope is ONE snapshot_run_id. There is no period-wide variant, and the
--     function takes no period argument at all.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.br_receita_retained_periods()
RETURNS TABLE (source_period text, generation int)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  -- 🔴 DISTINCT, not decoration. `source_snapshot_runs_published_period_uidx` should make two
  -- simultaneously-published runs of one period impossible, but if it ever did happen this
  -- query would return that period TWICE, LIMIT 2 would swallow the PREVIOUS generation, and
  -- the previous month would silently become droppable. Deduplicating first means a malformed
  -- state costs protection it should not, never protection it should have.
  SELECT period AS source_period,
         (row_number() OVER (ORDER BY period DESC))::int AS generation
    FROM (
      SELECT DISTINCT r.source_period AS period
        FROM public.source_snapshot_runs r
       WHERE r.source_key    = 'br_receita_cnpj_dados_abertos'
         AND r.country_code  = 'BR'
         AND r.publish_state = 'published'
         AND r.source_period IS NOT NULL
    ) published
   ORDER BY period DESC
   LIMIT 2
$fn$;

CREATE OR REPLACE FUNCTION public.br_receita_drop_run_partition(p_snapshot_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_state    text;
  v_period   text;
  v_name     text;
  v_retained boolean;
BEGIN
  IF p_snapshot_run_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  SELECT r.publish_state, r.source_period
    INTO v_state, v_period
    FROM public.source_snapshot_runs r
   WHERE r.id = p_snapshot_run_id
     AND r.source_key = 'br_receita_cnpj_dados_abertos'
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'run_not_found');
  END IF;

  -- Only a run that reached publication can be pinned by a batch. Everything
  -- else is staging debris.
  IF v_state IN ('published', 'superseded') THEN
    -- 🔴 FAIL CLOSED on an indeterminate retention set. A run that reached publication while the
    -- source has NO published period at all is a state this system cannot explain — the closest
    -- real cause is a `superseded` run whose successor was rolled back, and a batch pinned to that
    -- run still reads its rows. "I cannot compute the retained generations" is not the same fact
    -- as "this run is old", so it refuses rather than guessing.
    IF NOT EXISTS (SELECT 1 FROM public.br_receita_retained_periods()) THEN
      RETURN jsonb_build_object(
        'status',        'refused_indeterminate_retention',
        'publish_state', v_state,
        'source_period', v_period
      );
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.br_receita_retained_periods() rp
       WHERE rp.source_period = v_period
    ) INTO v_retained;

    IF v_retained THEN
      RETURN jsonb_build_object(
        'status',        'refused_retained_generation',
        'publish_state', v_state,
        'source_period', v_period
      );
    END IF;
  END IF;

  v_name := public.br_receita_run_partition_name(p_snapshot_run_id);

  IF to_regclass('public.' || quote_ident(v_name)) IS NULL THEN
    RETURN jsonb_build_object('status', 'already_absent', 'partition', v_name);
  END IF;

  EXECUTE format('DROP TABLE public.%I', v_name);

  RETURN jsonb_build_object(
    'status',        'dropped',
    'partition',     v_name,
    'publish_state', v_state,
    'source_period', v_period
  );
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Repeated same-period republish — an OPERATIONAL STORAGE PREFLIGHT
--
-- A same-period republish is ALLOWED, and nothing here restricts the first one:
-- run B republishes period N, run A is demoted to `superseded`, and A's rows stay
-- because a batch pinned to A still reads them (§ 3).
--
-- 🔴 The cost of that correctness is cumulative. Every additional same-period
-- republish leaves ANOTHER full national partition behind — ~29 GB each — and none
-- of them may be reclaimed while period N is still a retained generation. Two
-- republishes of one month is 3 national partitions of that month alone.
--
-- So the SECOND same-period republish stops being automatic. When the target period
-- already carries one `published` run AND at least one `superseded` run whose
-- storage is physically present, this returns
-- REPEATED_SAME_PERIOD_REPUBLISH_REQUIRES_STORAGE_REVIEW and the load does not
-- start on its own.
--
-- What this deliberately does NOT do:
--
--   · it does not delete a superseded retained run to make room. Retention (§ 3) is
--     the only thing that removes storage, and it refuses both retained generations;
--   · it does not infer whether any batch is ACTIVELY pinned to those runs. This
--     repository has no authoritative live-pin registry, and inventing one would be
--     guessing dressed as a fact;
--   · it does not forbid the republish. It withholds the AUTOMATIC start, which is
--     a decision a human takes with the disk numbers in front of them.
--
-- 🔴 PHYSICALLY present, not merely recorded: a run counts only when its partition
-- relation actually exists. A run row whose storage was already dropped occupies no
-- disk, and counting it would refuse a republish for space nobody is using.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.br_receita_same_period_republish_storage_check(
  p_source_period text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_published  int;
  v_superseded int;
BEGIN
  IF p_source_period IS NULL OR p_source_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  SELECT
    coalesce(count(*) FILTER (WHERE r.publish_state = 'published'), 0),
    coalesce(count(*) FILTER (WHERE r.publish_state = 'superseded'), 0)
    INTO v_published, v_superseded
    FROM public.source_snapshot_runs r
   WHERE r.source_key     = 'br_receita_cnpj_dados_abertos'
     AND r.country_code   = 'BR'
     AND r.source_period  = p_source_period
     AND r.publish_state IN ('published', 'superseded')
     AND to_regclass(
           'public.' || quote_ident(public.br_receita_run_partition_name(r.id))
         ) IS NOT NULL;

  IF v_published >= 1 AND v_superseded >= 1 THEN
    RETURN jsonb_build_object(
      'status',          'requires_storage_review',
      'code',            'REPEATED_SAME_PERIOD_REPUBLISH_REQUIRES_STORAGE_REVIEW',
      'source_period',   p_source_period,
      'published_runs',  v_published,
      'superseded_runs', v_superseded
    );
  END IF;

  RETURN jsonb_build_object(
    'status',          'ok',
    'source_period',   p_source_period,
    'published_runs',  v_published,
    'superseded_runs', v_superseded
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.br_receita_run_partition_name(uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.br_receita_begin_run_partition(uuid)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.br_receita_build_run_partition_indexes(uuid)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.br_receita_attach_run_partition(uuid)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.br_receita_retained_periods()                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.br_receita_drop_run_partition(uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.br_receita_same_period_republish_storage_check(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.br_receita_run_partition_name(uuid)          TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.br_receita_begin_run_partition(uuid)         TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.br_receita_build_run_partition_indexes(uuid) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.br_receita_attach_run_partition(uuid)        TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.br_receita_retained_periods()                TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.br_receita_drop_run_partition(uuid)          TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.br_receita_same_period_republish_storage_check(text) TO postgres, service_role;

COMMIT;
