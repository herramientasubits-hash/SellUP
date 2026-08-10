-- Migration 113: person-level phone suppression re-checked INSIDE the persistence
-- transaction (AGENT2A-PHONE-REVEAL-4O-E3)
--
-- ── QUÉ DEFECTO CIERRA ─────────────────────────────────────────────
--
-- Las migraciones 110 y 111 ya vuelven a comprobar, bajo el lock del candidato, los
-- tombstones de los NÚMEROS que trae el evento. Eso deja fuera el caso que importa:
-- una DSAR borra una PERSONA, y lo que tombstonea son los números que la colección
-- YA tenía. Un número que el proveedor no había devuelto nunca no tiene tombstone
-- que emparejar, así que la comprobación por número lo deja pasar y la persona
-- borrada vuelve a tener teléfono visible minutos después de la supresión.
--
-- La comprobación POR PERSONA sí existía, pero solo en TypeScript
-- (`evaluateInFlightPhoneSuppression`), y allí se lee ANTES de la llamada al
-- proveedor y FUERA del lock. Entre esa lectura y el COMMIT de la persistencia caben
-- la respuesta del proveedor y una DSAR entera. Esta migración mueve la comprobación
-- DENTRO de la transacción que persiste el resultado, que es el único sitio donde
-- puede ser una garantía y no una carrera ganada por casualidad.
--
-- ── QUÉ NO CAMBIA ──────────────────────────────────────────────────
--
--   * la FIRMA de las dos funciones es idéntica — mismo nombre, mismos parámetros,
--     mismo tipo de retorno—, así que ningún llamador cambia y PostgREST no queda
--     con dos sobrecargas ambiguas;
--   * el sobre de respuesta no gana ni pierde claves: el veredicto nuevo reutiliza
--     el `status = 'suppressed'` que las dos funciones ya devolvían;
--   * la política terminal (`error` + `blocked_suppressed`), el aborto de la
--     corrida y la liquidación de la reserva siguen siendo de 4O-E1, en TypeScript;
--   * el COSTO REAL no se toca: esta función no escribe usage logs, ni reservas, ni
--     filas de corrida. Retiene el NÚMERO, nunca el cargo ya incurrido;
--   * no se crea ningún modelo de supresión nuevo. La clave es la que el tombstone
--     duradero ya usa: (apollo, provider_person_id, account_id) en
--     `phone_reveal_cache`. El modelo de supresión A NIVEL DE CANDIDATO sigue
--     pendiente y NO se introduce aquí.
--
-- ── POR QUÉ SE VUELVEN A DECLARAR ENTERAS ──────────────────────────
--
-- `CREATE OR REPLACE FUNCTION` sustituye el cuerpo completo: no existe forma de
-- parchear unas líneas. Para que la restatement no pueda divergir de lo que hoy
-- corre en Producción, este archivo NO se escribió a mano — se DERIVA del SQL real
-- de la 110 y la 111 aplicando tres ediciones literales por función, y la suite
-- estática de E3 vuelve a derivarlo y compara byte a byte con este archivo.
--
-- Las migraciones 110 y 111 NO se modifican: siguen en disco tal cual se aplicaron.
--
-- ── SEGURIDAD ──────────────────────────────────────────────────────
--
-- Todo lo que se crea aquí es SECURITY INVOKER con `search_path` fijado, sin SQL
-- dinámico y con EXECUTE solo para `service_role`. Los dos helpers nuevos leen —
-- no escriben— y el techo de privilegios de la migración 109 sigue aplicando.
--
-- Esta migración NO: activa ningún flag, llama a ningún proveedor, mueve un crédito,
-- escribe HubSpot, crea contactos, hace backfill ni inserta una sola fila.
--
-- APPLIED IN PRODUCTION: NO — pendiente de autorización explícita.

-- ── 1. Validador del id de persona Apollo ──────────────────────────
--
-- Espejo EXACTO de `normalizeApolloPersonId` (src/server/integrations/apollo-person-id.ts):
-- recorta, rechaza el espacio de ids de otros proveedores (Lusha `v1.<token>`) y exige
-- la forma ObjectId de 24 hex. Devuelve el valor RECORTADO conservando mayúsculas,
-- igual que el TypeScript, porque la caché guarda el id tal cual se escribió.
--
-- Existe como función y no inline para que las dos restatements la compartan y para
-- que una suite pueda ejecutarla contra los mismos casos que el validador de TS.

CREATE OR REPLACE FUNCTION public.phone_reveal_normalized_apollo_person_id(
  p_value text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_value IS NULL                        THEN NULL
    WHEN btrim(p_value) = ''                    THEN NULL
    WHEN lower(btrim(p_value)) LIKE 'v1.%'      THEN NULL
    WHEN btrim(p_value) ~ '^[0-9a-fA-F]{24}$'   THEN btrim(p_value)
    ELSE NULL
  END;
$fn$;

COMMENT ON FUNCTION public.phone_reveal_normalized_apollo_person_id(text) IS
  'AGENT2A-PHONE-REVEAL-4O-E3 — normalizes/validates an Apollo person id (MongoDB ObjectId, 24 hex) exactly like normalizeApolloPersonId in TypeScript: trims, rejects other providers id spaces (Lusha v1.<token>) and returns NULL for anything else. Used by the in-transaction person-level suppression re-check so the SQL and the TypeScript guard resolve the SAME key. Pure, reads nothing, writes nothing.';

REVOKE ALL ON FUNCTION public.phone_reveal_normalized_apollo_person_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phone_reveal_normalized_apollo_person_id(text) FROM anon;
REVOKE ALL ON FUNCTION public.phone_reveal_normalized_apollo_person_id(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.phone_reveal_normalized_apollo_person_id(text) TO postgres, service_role;

-- ── 2. ¿Hay tombstone POR PERSONA para (apollo, persona, cuenta)? ───
--
-- Espejo EXACTO de `readPhoneCacheSuppression` + `evaluatePhoneCacheSuppressionState`
-- (phone-cache-store.ts / phone-cache-core.ts): misma tabla, mismas tres columnas de
-- la clave y el mismo criterio — `suppressed_at` no nulo ⇒ suprimido. El país NO entra
-- en la clave, igual que en el guard: una supresión bloquea a esa persona en esa cuenta
-- aunque el país del candidato cambie o se desconozca.
--
-- STABLE y no IMMUTABLE porque lee una tabla. Dentro de la transacción de persistencia
-- eso es justo lo que hace falta: la lectura ocurre en el mismo instante lógico que la
-- escritura que autoriza o bloquea.

CREATE OR REPLACE FUNCTION public.phone_reveal_person_suppression_exists(
  p_provider_person_id text,
  p_account_id         uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.phone_reveal_cache c
    WHERE c.provider           = 'apollo'
      AND c.provider_person_id = p_provider_person_id
      AND c.account_id         = p_account_id
      AND c.suppressed_at IS NOT NULL
  );
$fn$;

COMMENT ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) IS
  'AGENT2A-PHONE-REVEAL-4O-E3 — true when a DSAR/suppression tombstone exists in phone_reveal_cache for (apollo, provider_person_id, account_id). Same key and same criterion as the TypeScript guard (readPhoneCacheSuppression + evaluatePhoneCacheSuppressionState); country is deliberately not part of the key. Read-only: it creates no suppression state and it is not a new suppression model — it reads the durable one that already exists. Called from inside the persistence transactions of migrations 110/111 (restated by this migration) so a suppression committed after the pre-call guard cannot be outrun. Service-role only.';

REVOKE ALL ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) TO postgres, service_role;

-- ── 3. Restatement de la migración 110 ─────────────────────────────
--
-- Cuerpo IDÉNTICO al de la 110 salvo las tres ediciones descritas arriba. Los
-- COMMENT y los GRANT de la 110 siguen vigentes: `CREATE OR REPLACE` conserva el
-- comentario y los privilegios de la función cuando la firma no cambia. Se vuelven a
-- declarar igualmente al final, para que el estado final de esta migración sea
-- explícito y no herede nada por omisión.

CREATE OR REPLACE FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  -- ── Identity of the operation ────────────────────────────────────
  p_candidate_id                     uuid,
  -- Apollo async id this callback claims to be for. Compared, under the lock, against
  -- `contact_enrichment_candidates.phone_reveal_request_id` — the very column the webhook
  -- looked the candidate up by — so a callback for a SUPERSEDED reveal cannot land on a
  -- candidate that has since started a new one. NULL from the recovery poll, whose id
  -- lives in `provider_usage_logs.metadata.apollo_trace`, not on the candidate row: there
  -- the in-flight status check below is the whole guard, which is the same condition the
  -- poll already required before spending the call.
  p_expected_request_id              text,
  p_reveal_phase                     text,          -- 'webhook' | 'recovery_poll'
  p_observed_at                      timestamptz,

  -- ── The collection (validated recordsets, never arbitrary columns) ──
  p_phones                           jsonb,
  p_sources                          jsonb,
  -- Primary candidates IN ORDER OF PREFERENCE, each carrying the terminal triple the pure
  -- layer computed FOR THAT KEY (`resolvePrimaryPhoneForCandidate`). Pairing the key with
  -- its own scalar is what makes divergence between the collection's primary and the
  -- candidate's scalar structurally impossible: whichever key this function elects, it
  -- writes THAT key's number, never another's.
  p_primary_candidates               jsonb,

  -- ── Legacy fallback: what the pre-4O-C path would have written ───
  p_legacy_phone                     text,
  p_legacy_phone_type                text,
  p_legacy_raw_type                  text,
  -- The dedupe key OF that fallback number. Needed because the fallback is only safe
  -- to write if the number behind it is not itself a tombstone: without this key the
  -- function cannot tell, and the one path that reaches the fallback — no eligible
  -- primary — is exactly the path where a suppressed number would slip back into the
  -- visible field. See step 3.
  p_legacy_dedupe_key                text,

  -- ── Terminal `revealed` state (one typed parameter per column) ───
  p_phone_reveal_status              text,
  p_phone_reveal_provider            text,
  p_phone_revealed_at                timestamptz,
  p_phone_reveal_completed_at        timestamptz,
  -- Written by the webhook only; NULL leaves the column untouched (the recovery poll never
  -- received a callback, and claiming it did would be a lie about how the phone arrived).
  p_phone_reveal_webhook_received_at timestamptz,
  -- Written by the recovery poll only; NULL leaves the column untouched.
  p_phone_reveal_last_checked_at     timestamptz,
  -- ALWAYS written, and NULL is a VALUE here, not an absence: Apollo frequently reports no
  -- credit figure, and `phone_reveal_cost_source` is what distinguishes "not reported" from
  -- "nobody has looked".
  p_phone_reveal_cost_credits        integer,
  p_phone_reveal_cost_source         text,          -- 'reported' | 'unknown'
  -- ALWAYS written. On this path it is NULL by definition; the function refuses anything
  -- else rather than letting an error code ride along with a success.
  p_phone_reveal_error_code          text,
  -- Recovery preserves the existing basis; NULL leaves the column untouched.
  p_phone_processing_basis           text,
  -- Only ever SET, never cleared: NULL leaves the column untouched, exactly as the
  -- `if (patch.apollo_person_id)` guard in both callers does today.
  p_apollo_person_id                 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  -- Type priority, IDENTICAL to CANDIDATE_PHONE_TYPE_RANKING in phone-collection-core.ts.
  -- If these two lists diverged, a refreshed row would end up with a different aggregated
  -- type than the pure layer computed for the same observations.
  c_type_ranking      text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];
  -- Same closed set as TERMINAL_STATUSES in phone-reveal-webhook-core.ts.
  c_terminal_statuses text[] := ARRAY['revealed', 'no_phone_found', 'error'];

  v_candidate         record;
  v_row               record;
  v_src               record;
  v_pref              record;

  v_incoming_count    integer := 0;
  v_distinct_count    integer := 0;
  v_suppressed_count  integer := 0;
  v_viable_preference integer := 0;
  v_legacy_suppressed boolean := false;
  -- AGENT2A-PHONE-REVEAL-4O-E3 — clave de la supresión POR PERSONA, resuelta bajo el lock.
  v_person_id         text    := NULL;
  v_account_id        uuid    := NULL;
  v_existing_live     integer := 0;
  v_inserted_count    integer := 0;
  v_updated_count     integer := 0;
  v_source_count      integer := 0;
  v_affected          integer := 0;

  v_phone_id          uuid;
  v_primary_key       text := NULL;
  v_primary_id        uuid := NULL;
  v_scalar            text := NULL;
  v_meta_type         text := NULL;
  v_meta_raw_type     text := NULL;
  v_phone_meta        jsonb;
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- Step 0 — shape validation. Fail-closed, and BEFORE any write.
  -- ═══════════════════════════════════════════════════════════════
  -- Every rejection below returns with zero rows touched. Validating after the first insert
  -- would mean relying on the rollback for something a check can prevent outright.

  IF p_candidate_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'candidate_id_missing');
  END IF;

  IF p_reveal_phase IS NULL OR p_reveal_phase NOT IN ('webhook', 'recovery_poll') THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'reveal_phase_unknown');
  END IF;

  IF p_observed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'observed_at_missing');
  END IF;

  -- This function is the `revealed` path and nothing else (see SCOPE above).
  IF p_phone_reveal_status IS DISTINCT FROM 'revealed' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'status_not_revealed');
  END IF;

  IF p_phone_reveal_error_code IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'error_code_not_null');
  END IF;

  IF p_phone_reveal_provider IS DISTINCT FROM 'apollo' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'provider_not_apollo');
  END IF;

  IF p_phone_reveal_cost_source IS NULL
     OR p_phone_reveal_cost_source NOT IN ('reported', 'unknown') THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'cost_source_unknown');
  END IF;

  IF p_phone_revealed_at IS NULL OR p_phone_reveal_completed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'terminal_timestamps_missing');
  END IF;

  -- Exactly one of the two phase-specific timestamps, matching the two callers: the webhook
  -- stamps `webhook_received_at`, the poll stamps `last_checked_at`. Both, or neither, would
  -- describe an operation that did not happen.
  IF (p_phone_reveal_webhook_received_at IS NOT NULL)
     = (p_phone_reveal_last_checked_at IS NOT NULL) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phase_timestamps_inconsistent');
  END IF;

  IF p_legacy_phone IS NULL OR LENGTH(BTRIM(p_legacy_phone)) = 0 THEN
    -- The legacy scalar is the floor: this path exists because Apollo delivered a phone.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legacy_phone_missing');
  END IF;

  IF p_legacy_dedupe_key IS NULL OR LENGTH(BTRIM(p_legacy_dedupe_key)) = 0 THEN
    -- Without it the tombstone check on the fallback (step 3) cannot run, and a missing
    -- privacy check must never be silently skipped.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legacy_dedupe_key_missing');
  END IF;

  IF p_phones IS NULL
     OR jsonb_typeof(p_phones) <> 'array'
     OR jsonb_array_length(p_phones) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phones_empty');
  END IF;

  IF p_sources IS NULL OR jsonb_typeof(p_sources) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'sources_invalid');
  END IF;

  IF p_primary_candidates IS NULL OR jsonb_typeof(p_primary_candidates) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'primary_candidates_invalid');
  END IF;

  -- Every element of the three arrays must be an OBJECT. `jsonb_to_recordset` raises on a
  -- scalar element, and a raise here would report as an infrastructure failure rather than
  -- as the malformed input it is.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_phones) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_sources) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_primary_candidates) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'collection_element_not_object');
  END IF;

  -- ── Per-row validation of the canonical collection ──────────────
  -- The vocabularies are re-checked here even though migration 109 has CHECK constraints
  -- for both: hitting the constraint would raise and roll back, which is correct but
  -- reports as an infrastructure failure. A caller sending a bad status deserves
  -- `invalid_input`, not a rollback that looks like the database broke.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_phones) AS x(
      dedupe_key       text,
      normalized_phone text,
      display_phone    text,
      phone_type       text,
      phone_status     text,
      first_seen_at    timestamptz,
      last_seen_at     timestamptz
    )
    WHERE x.dedupe_key IS NULL
       OR LENGTH(BTRIM(x.dedupe_key)) = 0
       OR x.phone_status IS NULL
       OR x.phone_status NOT IN ('valid', 'invalid', 'unknown')
       OR (x.phone_type IS NOT NULL AND NOT (x.phone_type = ANY (c_type_ranking)))
       OR x.first_seen_at IS NULL
       OR x.last_seen_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phone_row_invalid');
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT x.dedupe_key)
    INTO v_incoming_count, v_distinct_count
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text);

  IF v_incoming_count <> v_distinct_count THEN
    -- `mergeCandidatePhoneInputs` already collapses one key into one row. Two rows sharing a
    -- key would mean the pure layer and this function disagree about what a phone IS.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phone_key_duplicated');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_sources) AS s(
      dedupe_key       text,
      provider         text,
      acquisition_mode text,
      source_event_key text,
      observed_at      timestamptz
    )
    WHERE s.dedupe_key IS NULL
       OR LENGTH(BTRIM(s.dedupe_key)) = 0
       OR s.provider IS NULL
       OR s.provider NOT IN ('apollo', 'lusha', 'apollo_cache', 'manual', 'unknown')
       OR s.acquisition_mode IS NULL
       OR s.acquisition_mode NOT IN ('search', 'reveal', 'waterfall', 'cache', 'manual')
       OR s.source_event_key IS NULL
       OR LENGTH(BTRIM(s.source_event_key)) = 0
       OR s.observed_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'source_row_invalid');
  END IF;

  -- Every provenance row must belong to a phone in THIS payload. A source pointing at a key
  -- that is not being written is provenance for nothing.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_sources) AS s(dedupe_key text)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
      WHERE x.dedupe_key = s.dedupe_key
    )
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'source_key_orphan');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_primary_candidates) AS e(item)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
      dedupe_key text, phone text, phone_type text, raw_type text
    )
    WHERE r.dedupe_key IS NULL
       OR LENGTH(BTRIM(r.dedupe_key)) = 0
       OR r.phone IS NULL
       OR LENGTH(BTRIM(r.phone)) = 0
       OR r.phone_type IS NULL
       OR NOT (r.phone_type = ANY (c_type_ranking))
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'primary_candidate_invalid');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1 — LOCK the candidate.
  -- ═══════════════════════════════════════════════════════════════
  -- This is the serialization point for the whole subsystem. The webhook and the recovery
  -- poll can genuinely race — a callback arriving while the cron is polling the same
  -- candidate — and without this lock both would read "in flight", both would elect a
  -- primary, and the loser would either duplicate provenance or fight the single-primary
  -- index. Every check that follows is deliberately AFTER it, so nothing is decided on a
  -- snapshot that a concurrent transaction can invalidate.

  SELECT c.id,
         c.enrichment_metadata,
         c.phone_reveal_status,
         c.phone_reveal_request_id,
         -- AGENT2A-PHONE-REVEAL-4O-E3 — columnas con las que se resuelve la clave de la
         -- supresión POR PERSONA sin salir de la transacción ni del lock.
         c.enrichment_run_id,
         c.apollo_person_id,
         c.source,
         c.source_contact_id
    INTO v_candidate
  FROM public.contact_enrichment_candidates c
  WHERE c.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'candidate_not_eligible', 'detail', 'candidate_not_found');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2 — is this event still the one that owns the candidate?
  -- ═══════════════════════════════════════════════════════════════

  IF v_candidate.phone_reveal_status = ANY (c_terminal_statuses) THEN
    IF p_expected_request_id IS NOT NULL
       AND v_candidate.phone_reveal_status = 'revealed'
       AND v_candidate.phone_reveal_request_id IS NOT DISTINCT FROM p_expected_request_id THEN
      -- The SAME event already committed — a concurrent caller won the lock and did exactly
      -- this work. Rewriting it would be pointless; reporting failure would be false. The
      -- honest answer is that the desired state is already in place.
      RETURN jsonb_build_object(
        'status',                   'idempotent',
        'inserted_phone_count',     0,
        'updated_phone_count',      0,
        'inserted_source_count',    0,
        'suppressed_skipped_count', 0,
        'primary_dedupe_key',       NULL,
        'primary_set',              EXISTS (
          SELECT 1 FROM public.contact_enrichment_candidate_phones p
          WHERE p.candidate_id = p_candidate_id AND p.is_primary
        ),
        'candidate_terminalized',   true
      );
    END IF;
    -- A DIFFERENT terminal state, or a terminal state this event cannot claim. Writing over
    -- it would overwrite a conclusion somebody else reached.
    RETURN jsonb_build_object('status', 'stale_event', 'detail', 'candidate_already_terminal');
  END IF;

  IF p_expected_request_id IS NOT NULL
     AND v_candidate.phone_reveal_request_id IS DISTINCT FROM p_expected_request_id THEN
    -- The candidate has moved on to another reveal request. This callback is late mail for
    -- an address that no longer exists.
    RETURN jsonb_build_object('status', 'stale_event', 'detail', 'request_id_superseded');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2b — PERSON-level suppression, re-checked UNDER the lock (4O-E3).
  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 re-checks the tombstones of the NUMBERS this event carries, and on its own
  -- that is not enough. A DSAR erases a PERSON: what it tombstoned are the numbers the
  -- collection ALREADY held. A number this provider had never returned before has no
  -- tombstone to match, so the number-level check waves it through — and the person
  -- whose data was erased ends up with a live phone again, minutes after the erasure.
  --
  -- The TypeScript guard (`evaluateInFlightPhoneSuppression`) reads exactly this state,
  -- but it reads it BEFORE the provider call and OUTSIDE this lock, so a suppression
  -- that commits in between is invisible to it. Reading it HERE puts the check inside
  -- the very transaction that would otherwise persist the result:
  --
  --   * erasure commits first  ⇒ this SELECT sees the tombstone ⇒ nothing is written;
  --   * this transaction first ⇒ the erasure that follows takes this same candidate
  --     lock and tombstones what was written (migration 112).
  --
  -- Both orderings end suppressed, which is the property the pre-call guard alone could
  -- not provide. The DSAR writes the cache tombstone BEFORE it propagates to the
  -- collection (`phone-cache-suppression-actions.ts`), so neither interleaving of those
  -- two writes leaves a window either.
  --
  -- The key is the one the durable tombstone ALREADY uses — (apollo, person, account)
  -- in `phone_reveal_cache` — so no new suppression model is introduced here and the
  -- candidate-level model stays deferred. Country is deliberately NOT part of the key:
  -- an erasure blocks that person in that account even if the candidate country changes.
  --
  -- No person id or no account means there is no key to match. That is the guard
  -- `not_evaluable` limit and it is NOT turned into a block by inference: no matching by
  -- phone, email, name or LinkedIn happens here or anywhere else.
  --
  -- The provider was already called and already charged by the time this runs. This step
  -- withholds the NUMBER, never the cost: no usage log, reservation or waterfall row is
  -- written from inside this function, so the spend survives exactly as it was recorded.

  SELECT r.account_id
    INTO v_account_id
  FROM public.contact_enrichment_runs r
  WHERE r.id = v_candidate.enrichment_run_id;

  v_person_id := COALESCE(
    -- 1. el id que este mismo evento acaba de confirmar para la persona;
    public.phone_reveal_normalized_apollo_person_id(p_apollo_person_id),
    -- 2. la columna del candidato (migración 098);
    public.phone_reveal_normalized_apollo_person_id(v_candidate.apollo_person_id),
    -- 3. `source_contact_id` SOLO si el candidato es de origen Apollo.
    CASE WHEN v_candidate.source = 'apollo'
      THEN public.phone_reveal_normalized_apollo_person_id(v_candidate.source_contact_id)
    END
  );

  IF v_person_id IS NOT NULL
     AND v_account_id IS NOT NULL
     AND public.phone_reveal_person_suppression_exists(v_person_id, v_account_id) THEN
    -- Fail closed with NOTHING written and WITHOUT terminalizing the candidate, exactly
    -- like the number-level verdict below. The terminal trace (`error` +
    -- `blocked_suppressed`), the run abort and the reservation settlement belong to the
    -- 4O-E1 policy in the TypeScript layer and are NOT duplicated in SQL.
    RETURN jsonb_build_object(
      'status',                   'suppressed',
      'inserted_phone_count',     0,
      'updated_phone_count',      0,
      'inserted_source_count',    0,
      'suppressed_skipped_count', 0,
      'primary_dedupe_key',       NULL,
      'primary_set',              false,
      'candidate_terminalized',   false
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 — tombstones, re-checked UNDER the lock.
  -- ═══════════════════════════════════════════════════════════════
  -- The TypeScript layer cannot own this check: it reads before the lock, and a suppression
  -- committed in that window would be invisible to it. Here the read is inside the
  -- serialized region, and the ON CONFLICT clauses below carry the same condition again so
  -- the guarantee survives even if this count were somehow wrong.

  SELECT COUNT(*) INTO v_suppressed_count
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_enrichment_candidate_phones e
    ON e.candidate_id = p_candidate_id
   AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NOT NULL;

  -- ── Would the LEGACY FALLBACK resurrect a suppressed number? ────
  --
  -- The fallback is only reached when no preference key turns out to be electable. On that
  -- path the scalar becomes `p_legacy_phone` — and if the row behind THAT number is a
  -- tombstone, the suppressed number lands straight back in the visible field. Which is the
  -- precise failure the tombstone exists to prevent, arriving through the one door that
  -- does not consult it.
  --
  -- So both halves are computed BEFORE any write: whether the fallback number is suppressed,
  -- and whether any preference key survives to keep the fallback from being needed.
  SELECT EXISTS (
    SELECT 1 FROM public.contact_enrichment_candidate_phones e
    WHERE e.candidate_id = p_candidate_id
      AND e.dedupe_key = p_legacy_dedupe_key
      AND e.suppressed_at IS NOT NULL
  ) INTO v_legacy_suppressed;

  SELECT COUNT(*) INTO v_viable_preference
  FROM jsonb_array_elements(p_primary_candidates) AS e(item)
  CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
    dedupe_key text, phone text, phone_type text, raw_type text
  )
  WHERE NOT EXISTS (
    SELECT 1 FROM public.contact_enrichment_candidate_phones ex
    WHERE ex.candidate_id = p_candidate_id
      AND ex.dedupe_key = r.dedupe_key
      AND ex.suppressed_at IS NOT NULL
  );

  IF v_legacy_suppressed AND v_viable_preference = 0 THEN
    -- Nothing electable survives AND the fallback is a tombstone. Fail closed with nothing
    -- written and — the part that matters — WITHOUT terminalizing the candidate: a
    -- `revealed` row here would have to carry some number, and the only one left is one
    -- that was erased.
    --
    -- This subsumes the simpler "every number in the payload is a tombstone" case, since the
    -- legacy number is always one of the payload's numbers.
    --
    -- DECLARED LIMIT: a permanent tombstone makes this poll repeat and count as `failed` on
    -- every sweep, always at 0 credits, until an operator intervenes. That is chosen over
    -- putting an erased number back in front of a user.
    RETURN jsonb_build_object(
      'status',                   'suppressed',
      'inserted_phone_count',     0,
      'updated_phone_count',      0,
      'inserted_source_count',    0,
      'suppressed_skipped_count', v_suppressed_count,
      'primary_dedupe_key',       NULL,
      'primary_set',              false,
      'candidate_terminalized',   false
    );
  END IF;

  -- How many of the survivors already exist. Counted BEFORE the writes so that
  -- inserted/updated are facts rather than an interpretation of `xmax`.
  SELECT COUNT(*) INTO v_existing_live
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_enrichment_candidate_phones e
    ON e.candidate_id = p_candidate_id
   AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NULL;

  v_updated_count := v_existing_live;
  v_inserted_count := v_incoming_count - v_suppressed_count - v_existing_live;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 4 — canonical phones: insert new, refresh known.
  -- ═══════════════════════════════════════════════════════════════
  -- `is_primary` is false for every write here and elected in step 6. Promoting during the
  -- insert would collide with the single-primary partial index while the previous primary
  -- is still standing.

  FOR v_row IN
    SELECT x.dedupe_key,
           x.normalized_phone,
           x.display_phone,
           x.phone_type,
           x.phone_status,
           x.first_seen_at,
           x.last_seen_at
    FROM jsonb_to_recordset(p_phones) AS x(
      dedupe_key       text,
      normalized_phone text,
      display_phone    text,
      phone_type       text,
      phone_status     text,
      first_seen_at    timestamptz,
      last_seen_at     timestamptz
    )
  LOOP
    -- Reset per iteration: `RETURNING … INTO` on a row the tombstone guard skipped must
    -- leave NULL here, not the id of the previous phone.
    v_phone_id := NULL;

    INSERT INTO public.contact_enrichment_candidate_phones AS t (
      candidate_id, normalized_phone, display_phone, dedupe_key,
      phone_type, phone_status, is_primary, first_seen_at, last_seen_at
    ) VALUES (
      p_candidate_id, v_row.normalized_phone, v_row.display_phone, v_row.dedupe_key,
      v_row.phone_type, v_row.phone_status, false, v_row.first_seen_at, v_row.last_seen_at
    )
    ON CONFLICT (candidate_id, dedupe_key) DO UPDATE
      SET
        -- `aggregateCandidatePhoneStatus`, mirrored: a provider that fails to verify a
        -- number is reporting its own coverage, so `invalid` never demotes a `valid`.
        phone_status = CASE
          WHEN 'valid' IN (t.phone_status, excluded.phone_status) THEN 'valid'
          WHEN t.phone_status = 'invalid'
               AND excluded.phone_status IN ('invalid', 'unknown') THEN 'invalid'
          WHEN excluded.phone_status = 'invalid'
               AND t.phone_status IN ('invalid', 'unknown') THEN 'invalid'
          ELSE 'unknown'
        END,
        -- `aggregateCandidatePhoneType`, mirrored: the better-ranked of the two wins, and
        -- every raw type stays intact in the provenance rows regardless.
        phone_type = CASE
          WHEN t.phone_type IS NULL THEN COALESCE(excluded.phone_type, 'unknown')
          WHEN COALESCE(array_position(c_type_ranking, t.phone_type),
                        array_length(c_type_ranking, 1) + 1)
               <= COALESCE(array_position(c_type_ranking,
                                          COALESCE(excluded.phone_type, 'unknown')),
                           array_length(c_type_ranking, 1) + 1)
            THEN t.phone_type
          ELSE COALESCE(excluded.phone_type, 'unknown')
        END,
        -- `first_seen_at` is deliberately untouched: it is the first time the number was
        -- seen, and seeing it again does not change that.
        last_seen_at = p_observed_at
      -- The tombstone guard, restated where it is enforced rather than merely intended.
      -- Without it a tombstoned row would be handed back its number and its type by this
      -- very UPDATE, and migration 109's `..._tombstone_is_empty` CHECK would then reject
      -- the statement — turning a privacy rule into a rollback. Skipping the row keeps the
      -- rule as a rule.
      WHERE t.suppressed_at IS NULL
    RETURNING t.id INTO v_phone_id;

    -- A tombstoned row returns nothing: no provenance, no primary, no trace of the
    -- observation. Recording that a suppressed person was seen again is still recording it.
    IF v_phone_id IS NULL THEN
      CONTINUE;
    END IF;

    -- ═════════════════════════════════════════════════════════════
    -- Step 5 — provenance: append-only and idempotent.
    -- ═════════════════════════════════════════════════════════════
    -- ON CONFLICT DO NOTHING on (candidate_phone_id, source_event_key). Reprocessing the
    -- same callback recognises the same observation instead of appending a second row, and
    -- no UPDATE is needed — which matters, because migration 109 does not grant one.

    FOR v_src IN
      SELECT s.provider,
             s.acquisition_mode,
             s.raw_provider_type,
             s.raw_provider_status,
             s.waterfall_run_id,
             s.reservation_id,
             s.provider_usage_log_id,
             s.source_event_key,
             s.observed_at
      FROM jsonb_to_recordset(p_sources) AS s(
        dedupe_key            text,
        provider              text,
        acquisition_mode      text,
        raw_provider_type     text,
        raw_provider_status   text,
        waterfall_run_id      uuid,
        reservation_id        uuid,
        provider_usage_log_id uuid,
        source_event_key      text,
        observed_at           timestamptz
      )
      WHERE s.dedupe_key = v_row.dedupe_key
    LOOP
      INSERT INTO public.contact_enrichment_candidate_phone_sources (
        candidate_phone_id, provider, acquisition_mode, raw_provider_type,
        raw_provider_status, waterfall_run_id, reservation_id, provider_usage_log_id,
        source_event_key, observed_at
      ) VALUES (
        v_phone_id, v_src.provider, v_src.acquisition_mode, v_src.raw_provider_type,
        v_src.raw_provider_status, v_src.waterfall_run_id, v_src.reservation_id,
        v_src.provider_usage_log_id, v_src.source_event_key, v_src.observed_at
      )
      ON CONFLICT (candidate_phone_id, source_event_key) DO NOTHING;

      GET DIAGNOSTICS v_affected = ROW_COUNT;
      v_source_count := v_source_count + v_affected;
    END LOOP;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 6 — elect exactly one primary.
  -- ═══════════════════════════════════════════════════════════════
  -- The ORDER is the pure layer's decision (`buildPrimaryPreference`, whose first entry is
  -- the number the pre-4O-C path would have written, so the visible phone does not change
  -- for reasons nobody asked for). What this function decides is only ELIGIBILITY, and it
  -- decides it from the rows as they now stand: alive, numbered, not asserted invalid —
  -- the three conditions of migration 109's `..._primary_requires_live_number` CHECK, so a
  -- key this loop accepts can never be one the database would then reject.

  FOR v_pref IN
    SELECT r.dedupe_key, r.phone, r.phone_type, r.raw_type
    FROM jsonb_array_elements(p_primary_candidates) WITH ORDINALITY AS e(item, ord)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
      dedupe_key text, phone text, phone_type text, raw_type text
    )
    ORDER BY e.ord
  LOOP
    SELECT p.id INTO v_primary_id
    FROM public.contact_enrichment_candidate_phones p
    WHERE p.candidate_id = p_candidate_id
      AND p.dedupe_key = v_pref.dedupe_key
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid';

    IF v_primary_id IS NOT NULL THEN
      v_primary_key   := v_pref.dedupe_key;
      -- The scalar and its metadata come from the SAME entry as the elected key. This is
      -- the whole reason the triple travels with the key.
      v_scalar        := v_pref.phone;
      v_meta_type     := v_pref.phone_type;
      v_meta_raw_type := v_pref.raw_type;
      EXIT;
    END IF;
  END LOOP;

  IF v_primary_id IS NOT NULL THEN
    -- Demote first, promote second. The partial unique index does not tolerate two
    -- primaries even for an instant, and doing it in this order needs no window.
    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = false
     WHERE candidate_id = p_candidate_id
       AND is_primary
       AND id <> v_primary_id;

    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = true
     WHERE id = v_primary_id
       AND NOT is_primary;
  ELSE
    -- No preference from THIS event qualifies. The primary that was already there is left
    -- alone: nothing better turned up, and clearing it would leave the candidate with no
    -- primary without anyone having asked for that. The scalar then keeps the legacy
    -- behaviour, byte-for-byte what the caller wrote before 4O-C.
    SELECT p.dedupe_key INTO v_primary_key
    FROM public.contact_enrichment_candidate_phones p
    WHERE p.candidate_id = p_candidate_id AND p.is_primary;

    v_scalar        := p_legacy_phone;
    v_meta_type     := p_legacy_phone_type;
    v_meta_raw_type := p_legacy_raw_type;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 7 — the candidate: scalar phone plus terminal state.
  -- ═══════════════════════════════════════════════════════════════
  -- Same transaction as everything above, so the forbidden state — a visible phone with an
  -- incomplete collection — cannot be observed even for the duration of a query.

  v_phone_meta := jsonb_build_object(
    'number',   v_scalar,
    'type',     v_meta_type,
    'source',   'apollo_reveal',
    'raw_type', v_meta_raw_type
  );

  UPDATE public.contact_enrichment_candidates
     SET phone = v_scalar,
         -- Shallow merge of the single `phone` key, exactly as the callers'
         -- `{...candidate.enrichmentMetadata, phone: phoneMetadata}` does — except read
         -- from the LOCKED row, so a concurrent metadata write cannot be clobbered by a
         -- stale copy.
         enrichment_metadata = jsonb_set(
           COALESCE(enrichment_metadata, '{}'::jsonb), '{phone}', v_phone_meta, true
         ),
         phone_reveal_status              = p_phone_reveal_status,
         phone_reveal_provider            = p_phone_reveal_provider,
         phone_revealed_at                = p_phone_revealed_at,
         phone_reveal_completed_at        = p_phone_reveal_completed_at,
         -- COALESCE, not assignment: a NULL here means "this phase does not write this
         -- column", and overwriting it would erase the other phase's evidence.
         phone_reveal_webhook_received_at =
           COALESCE(p_phone_reveal_webhook_received_at, phone_reveal_webhook_received_at),
         phone_reveal_last_checked_at     =
           COALESCE(p_phone_reveal_last_checked_at, phone_reveal_last_checked_at),
         phone_reveal_cost_credits        = p_phone_reveal_cost_credits,
         phone_reveal_cost_source         = p_phone_reveal_cost_source,
         phone_reveal_error_code          = p_phone_reveal_error_code,
         phone_processing_basis           =
           COALESCE(p_phone_processing_basis, phone_processing_basis),
         apollo_person_id                 =
           COALESCE(p_apollo_person_id, apollo_person_id)
   WHERE id = p_candidate_id;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    -- Unreachable while the row is locked; raised rather than reported because it would
    -- mean the lock did not hold, and continuing would leave a collection with no terminal
    -- state. The message names the operation, never a value.
    RAISE EXCEPTION 'persist_candidate_apollo_phone_reveal_result: candidate terminal update did not affect exactly one row';
  END IF;

  RETURN jsonb_build_object(
    'status',                   'persisted',
    'inserted_phone_count',     v_inserted_count,
    'updated_phone_count',      v_updated_count,
    'inserted_source_count',    v_source_count,
    'suppressed_skipped_count', v_suppressed_count,
    'primary_dedupe_key',       v_primary_key,
    'primary_set',              v_primary_id IS NOT NULL,
    'candidate_terminalized',   true
  );
END $$;

-- ── 4. Restatement de la migración 111 ─────────────────────────────
--
-- Mismas tres ediciones, con una diferencia deliberada: Lusha no entrega ningún id
-- de persona Apollo, así que la clave sale del candidato — que es el MISMO sujeto que
-- la DSAR borró. Un id Lusha nunca puede convertirse en clave: el validador lo rechaza.

CREATE OR REPLACE FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  -- ── Identity of the operation ────────────────────────────────────
  p_candidate_id                  uuid,
  -- The `phone_reveal_status` the caller observed when it loaded the candidate and
  -- decided this leg was authorized. Compared, under the lock, against the live row.
  -- See "THE OWNERSHIP TOKEN IS THE STATUS" above.
  p_expected_phone_reveal_status  text,
  p_observed_at                   timestamptz,

  -- ── The collection (validated recordsets, never arbitrary columns) ──
  p_phones                        jsonb,
  p_sources                       jsonb,
  -- Primary candidates IN ORDER OF PREFERENCE, each carrying the terminal triple the
  -- pure layer computed FOR THAT KEY. Pairing the key with its own scalar is what makes
  -- divergence between the collection's primary and the candidate's scalar structurally
  -- impossible: whichever key this function elects, it writes THAT key's number.
  p_primary_candidates            jsonb,

  -- ── Legacy fallback: what the pre-4O-D path would have written ───
  p_legacy_phone                  text,
  p_legacy_phone_type             text,
  p_legacy_raw_type               text,
  -- The dedupe key OF that fallback number. Needed because the fallback is only safe to
  -- write if the number behind it is not itself a tombstone.
  p_legacy_dedupe_key             text,

  -- ── Terminal `revealed` state (one typed parameter per column) ───
  p_phone_reveal_status           text,          -- must be 'revealed'
  p_phone_reveal_provider         text,          -- must be 'lusha'
  -- ALWAYS written, and NULL is a VALUE here, not an absence: Lusha issues no tracking
  -- id, and writing the NULL is what CLEARS a previous provider's orphan id instead of
  -- leaving it next to `phone_reveal_provider = 'lusha'`.
  p_phone_reveal_request_id       text,
  p_phone_revealed_at             timestamptz,
  p_phone_reveal_completed_at     timestamptz,
  p_phone_revealed_by             uuid,
  -- ALWAYS written, and NULL is a VALUE: a response may report no figure, and
  -- `phone_reveal_cost_source` is what distinguishes "not reported" from "nobody looked".
  p_phone_reveal_cost_credits     integer,
  p_phone_reveal_cost_source      text,          -- 'reported' | 'assumed_cap' | 'unknown'
  -- ALWAYS written. On this path it is NULL by definition; the function refuses anything
  -- else rather than letting an error code ride along with a success.
  p_phone_reveal_error_code       text,
  p_phone_reveal_attempt_count    integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  -- Type priority, IDENTICAL to CANDIDATE_PHONE_TYPE_RANKING in phone-collection-core.ts
  -- and to migration 110's copy. If these lists diverged, a refreshed row would end up
  -- with a different aggregated type than the pure layer computed for the same
  -- observations, and the incumbent comparison below would rank on a different scale.
  c_type_ranking       text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];

  v_candidate          record;
  v_row                record;
  v_src                record;
  v_pref               record;

  v_incoming_count     integer := 0;
  v_distinct_count     integer := 0;
  v_suppressed_count   integer := 0;
  v_viable_preference  integer := 0;
  v_legacy_suppressed  boolean := false;
  -- AGENT2A-PHONE-REVEAL-4O-E3 — clave de la supresión POR PERSONA, resuelta bajo el lock.
  v_person_id          text    := NULL;
  v_account_id         uuid    := NULL;
  v_has_live_primary   boolean := false;
  v_existing_live      integer := 0;
  v_inserted_count     integer := 0;
  v_updated_count      integer := 0;
  v_source_count       integer := 0;
  v_affected           integer := 0;

  v_phone_id           uuid;
  v_chosen_id          uuid    := NULL;
  v_chosen_key         text    := NULL;
  v_chosen_phone       text    := NULL;
  v_chosen_type        text    := NULL;
  v_chosen_raw_type    text    := NULL;
  v_chosen_rank        integer := NULL;
  v_chosen_status_rank integer := NULL;

  -- Scalars and NOT a record on purpose: a `SELECT … INTO record` that matches no row
  -- leaves a record whose field access is legal but whose emptiness is easy to misread.
  -- Four plainly-typed NULLs make "there is no incumbent" a value, not a shape.
  v_inc_id             uuid    := NULL;
  v_inc_key            text    := NULL;
  v_inc_rank           integer := NULL;
  v_inc_status_rank    integer := NULL;

  v_primary_id         uuid    := NULL;
  v_primary_key        text    := NULL;
  v_scalar_updated     boolean := false;
  v_scalar             text    := NULL;
  v_meta_type          text    := NULL;
  v_meta_raw_type      text    := NULL;
  v_phone_meta         jsonb;
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- Step 0 — shape validation. Fail-closed, and BEFORE any write.
  -- ═══════════════════════════════════════════════════════════════
  -- Every rejection below returns with zero rows touched. Validating after the first
  -- insert would mean relying on the rollback for something a check can prevent outright.

  IF p_candidate_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'candidate_id_missing');
  END IF;

  IF p_expected_phone_reveal_status IS NULL
     OR LENGTH(BTRIM(p_expected_phone_reveal_status)) = 0 THEN
    -- Without the token there is no ownership check, and a missing ownership check must
    -- never be silently skipped.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'expected_status_missing');
  END IF;

  IF p_observed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'observed_at_missing');
  END IF;

  -- This function is the `revealed` path of ONE provider and nothing else (see SCOPE).
  IF p_phone_reveal_status IS DISTINCT FROM 'revealed' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'status_not_revealed');
  END IF;

  IF p_phone_reveal_provider IS DISTINCT FROM 'lusha' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'provider_not_lusha');
  END IF;

  IF p_phone_reveal_error_code IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'error_code_not_null');
  END IF;

  IF p_phone_reveal_cost_source IS NULL
     OR p_phone_reveal_cost_source NOT IN ('reported', 'assumed_cap', 'unknown') THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'cost_source_unknown');
  END IF;

  IF p_phone_revealed_at IS NULL OR p_phone_reveal_completed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'terminal_timestamps_missing');
  END IF;

  IF p_phone_revealed_by IS NULL THEN
    -- The actor is audit evidence for a paid operation, not an optional label.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'revealed_by_missing');
  END IF;

  IF p_phone_reveal_attempt_count IS NULL OR p_phone_reveal_attempt_count < 1 THEN
    -- This path only exists because an attempt was made; a count below 1 would deny it.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'attempt_count_invalid');
  END IF;

  IF p_legacy_phone IS NULL OR LENGTH(BTRIM(p_legacy_phone)) = 0 THEN
    -- The legacy scalar is the floor: this path exists because Lusha delivered a phone.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legacy_phone_missing');
  END IF;

  IF p_legacy_phone_type IS NULL OR NOT (p_legacy_phone_type = ANY (c_type_ranking)) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legacy_phone_type_invalid');
  END IF;

  IF p_legacy_dedupe_key IS NULL OR LENGTH(BTRIM(p_legacy_dedupe_key)) = 0 THEN
    -- Without it the tombstone check on the fallback (step 3) cannot run, and a missing
    -- privacy check must never be silently skipped.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legacy_dedupe_key_missing');
  END IF;

  IF p_phones IS NULL
     OR jsonb_typeof(p_phones) <> 'array'
     OR jsonb_array_length(p_phones) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phones_empty');
  END IF;

  IF p_sources IS NULL OR jsonb_typeof(p_sources) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'sources_invalid');
  END IF;

  IF p_primary_candidates IS NULL OR jsonb_typeof(p_primary_candidates) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'primary_candidates_invalid');
  END IF;

  -- Every element of the three arrays must be an OBJECT. `jsonb_to_recordset` raises on a
  -- scalar element, and a raise here would report as an infrastructure failure rather than
  -- as the malformed input it is.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_phones) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_sources) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_primary_candidates) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'collection_element_not_object');
  END IF;

  -- ── Per-row validation of the canonical collection ──────────────
  -- The vocabularies are re-checked here even though migration 109 has CHECK constraints
  -- for both: hitting the constraint would raise and roll back, which is correct but
  -- reports as an infrastructure failure. A caller sending a bad status deserves
  -- `invalid_input`, not a rollback that looks like the database broke.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_phones) AS x(
      dedupe_key       text,
      normalized_phone text,
      display_phone    text,
      phone_type       text,
      phone_status     text,
      first_seen_at    timestamptz,
      last_seen_at     timestamptz
    )
    WHERE x.dedupe_key IS NULL
       OR LENGTH(BTRIM(x.dedupe_key)) = 0
       OR x.phone_status IS NULL
       OR x.phone_status NOT IN ('valid', 'invalid', 'unknown')
       OR (x.phone_type IS NOT NULL AND NOT (x.phone_type = ANY (c_type_ranking)))
       OR x.first_seen_at IS NULL
       OR x.last_seen_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phone_row_invalid');
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT x.dedupe_key)
    INTO v_incoming_count, v_distinct_count
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text);

  IF v_incoming_count <> v_distinct_count THEN
    -- `mergeCandidatePhoneInputs` already collapses one key into one row. Two rows sharing
    -- a key would mean the pure layer and this function disagree about what a phone IS.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phone_key_duplicated');
  END IF;

  -- Provenance must be LUSHA provenance, acquired as a paid reveal. This is the Lusha
  -- writer: accepting another provider here would let one path write evidence about a
  -- provider it never called.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_sources) AS s(
      dedupe_key       text,
      provider         text,
      acquisition_mode text,
      source_event_key text,
      observed_at      timestamptz
    )
    WHERE s.dedupe_key IS NULL
       OR LENGTH(BTRIM(s.dedupe_key)) = 0
       OR s.provider IS DISTINCT FROM 'lusha'
       OR s.acquisition_mode IS DISTINCT FROM 'reveal'
       OR s.source_event_key IS NULL
       OR LENGTH(BTRIM(s.source_event_key)) = 0
       OR s.observed_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'source_row_invalid');
  END IF;

  -- Every provenance row must belong to a phone in THIS payload. A source pointing at a
  -- key that is not being written is provenance for nothing.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_sources) AS s(dedupe_key text)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
      WHERE x.dedupe_key = s.dedupe_key
    )
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'source_key_orphan');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_primary_candidates) AS e(item)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
      dedupe_key text, phone text, phone_type text, raw_type text
    )
    WHERE r.dedupe_key IS NULL
       OR LENGTH(BTRIM(r.dedupe_key)) = 0
       OR r.phone IS NULL
       OR LENGTH(BTRIM(r.phone)) = 0
       OR r.phone_type IS NULL
       OR NOT (r.phone_type = ANY (c_type_ranking))
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'primary_candidate_invalid');
  END IF;

  -- Every preference key must be one of the payload's phones. A preference for a key that
  -- is not being written could promote a row this event never observed.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_primary_candidates) AS r(dedupe_key text)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
      WHERE x.dedupe_key = r.dedupe_key
    )
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'primary_candidate_orphan');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1 — LOCK the candidate.
  -- ═══════════════════════════════════════════════════════════════
  -- The serialization point. Two triggers can genuinely reach the same candidate — the
  -- waterfall continuation runs best-effort from the webhook, the recovery cron and the
  -- manual L3 review — and although the run-level `claimLushaAttempt` is already atomic,
  -- a lock here is what makes the DATA write serialize too. Every check that follows is
  -- deliberately AFTER it, so nothing is decided on a snapshot a concurrent transaction
  -- can invalidate.

  SELECT c.id,
         c.enrichment_metadata,
         c.phone_reveal_status,
         c.phone_reveal_provider,
         -- AGENT2A-PHONE-REVEAL-4O-E3 — columnas con las que se resuelve la clave de la
         -- supresión POR PERSONA sin salir de la transacción ni del lock.
         c.enrichment_run_id,
         c.apollo_person_id,
         c.source,
         c.source_contact_id
    INTO v_candidate
  FROM public.contact_enrichment_candidates c
  WHERE c.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'candidate_not_eligible', 'detail', 'candidate_not_found');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2 — is this event still the one that owns the candidate?
  -- ═══════════════════════════════════════════════════════════════

  IF v_candidate.phone_reveal_status = 'revealed'
     AND v_candidate.phone_reveal_provider = 'lusha' THEN
    -- Already closed as a Lusha reveal: a concurrent caller won the lock and did exactly
    -- this work. Rewriting it would be pointless; reporting failure would be false. The
    -- honest answer is that the desired state is already in place.
    RETURN jsonb_build_object(
      'status',                   'idempotent',
      'inserted_phone_count',     0,
      'updated_phone_count',      0,
      'inserted_source_count',    0,
      'suppressed_skipped_count', 0,
      'primary_dedupe_key',       NULL,
      'primary_set',              EXISTS (
        SELECT 1 FROM public.contact_enrichment_candidate_phones p
        WHERE p.candidate_id = p_candidate_id AND p.is_primary
      ),
      'candidate_scalar_updated', false,
      'candidate_terminalized',   true
    );
  END IF;

  IF v_candidate.phone_reveal_status IS DISTINCT FROM p_expected_phone_reveal_status THEN
    -- The candidate is no longer in the state that authorized this leg. Writing over it
    -- would overwrite a conclusion somebody else reached.
    RETURN jsonb_build_object('status', 'stale_event', 'detail', 'expected_status_superseded');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2b — PERSON-level suppression, re-checked UNDER the lock (4O-E3).
  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 re-checks the tombstones of the NUMBERS this event carries, and on its own
  -- that is not enough. A DSAR erases a PERSON: what it tombstoned are the numbers the
  -- collection ALREADY held. A number this provider had never returned before has no
  -- tombstone to match, so the number-level check waves it through — and the person
  -- whose data was erased ends up with a live phone again, minutes after the erasure.
  --
  -- The TypeScript guard (`evaluateInFlightPhoneSuppression`) reads exactly this state,
  -- but it reads it BEFORE the provider call and OUTSIDE this lock, so a suppression
  -- that commits in between is invisible to it. Reading it HERE puts the check inside
  -- the very transaction that would otherwise persist the result:
  --
  --   * erasure commits first  ⇒ this SELECT sees the tombstone ⇒ nothing is written;
  --   * this transaction first ⇒ the erasure that follows takes this same candidate
  --     lock and tombstones what was written (migration 112).
  --
  -- Both orderings end suppressed, which is the property the pre-call guard alone could
  -- not provide. The DSAR writes the cache tombstone BEFORE it propagates to the
  -- collection (`phone-cache-suppression-actions.ts`), so neither interleaving of those
  -- two writes leaves a window either.
  --
  -- The key is the one the durable tombstone ALREADY uses — (apollo, person, account)
  -- in `phone_reveal_cache` — so no new suppression model is introduced here and the
  -- candidate-level model stays deferred. Country is deliberately NOT part of the key:
  -- an erasure blocks that person in that account even if the candidate country changes.
  --
  -- No person id or no account means there is no key to match. That is the guard
  -- `not_evaluable` limit and it is NOT turned into a block by inference: no matching by
  -- phone, email, name or LinkedIn happens here or anywhere else.
  --
  -- The provider was already called and already charged by the time this runs. This step
  -- withholds the NUMBER, never the cost: no usage log, reservation or waterfall row is
  -- written from inside this function, so the spend survives exactly as it was recorded.

  SELECT r.account_id
    INTO v_account_id
  FROM public.contact_enrichment_runs r
  WHERE r.id = v_candidate.enrichment_run_id;

  v_person_id := COALESCE(
    -- 1. la columna del candidato (migración 098);
    public.phone_reveal_normalized_apollo_person_id(v_candidate.apollo_person_id),
    -- 2. `source_contact_id` SOLO si el candidato es de origen Apollo.
    CASE WHEN v_candidate.source = 'apollo'
      THEN public.phone_reveal_normalized_apollo_person_id(v_candidate.source_contact_id)
    END
  );

  IF v_person_id IS NOT NULL
     AND v_account_id IS NOT NULL
     AND public.phone_reveal_person_suppression_exists(v_person_id, v_account_id) THEN
    -- Fail closed with NOTHING written and WITHOUT terminalizing the candidate, exactly
    -- like the number-level verdict below. The terminal trace (`error` +
    -- `blocked_suppressed`), the run abort and the reservation settlement belong to the
    -- 4O-E1 policy in the TypeScript layer and are NOT duplicated in SQL.
    RETURN jsonb_build_object(
      'status',                   'suppressed',
      'inserted_phone_count',     0,
      'updated_phone_count',      0,
      'inserted_source_count',    0,
      'suppressed_skipped_count', 0,
      'primary_dedupe_key',       NULL,
      'primary_set',              false,
      'candidate_scalar_updated', false,
      'candidate_terminalized',   false
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 — tombstones, re-checked UNDER the lock.
  -- ═══════════════════════════════════════════════════════════════
  -- The TypeScript layer cannot own this check: it reads before the lock, and a suppression
  -- committed in that window would be invisible to it. Here the read is inside the
  -- serialized region, and the ON CONFLICT clauses below carry the same condition again so
  -- the guarantee survives even if this count were somehow wrong.

  SELECT COUNT(*) INTO v_suppressed_count
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_enrichment_candidate_phones e
    ON e.candidate_id = p_candidate_id
   AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NOT NULL;

  SELECT EXISTS (
    SELECT 1 FROM public.contact_enrichment_candidate_phones e
    WHERE e.candidate_id = p_candidate_id
      AND e.dedupe_key = p_legacy_dedupe_key
      AND e.suppressed_at IS NOT NULL
  ) INTO v_legacy_suppressed;

  SELECT COUNT(*) INTO v_viable_preference
  FROM jsonb_array_elements(p_primary_candidates) AS e(item)
  CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
    dedupe_key text, phone text, phone_type text, raw_type text
  )
  WHERE NOT EXISTS (
    SELECT 1 FROM public.contact_enrichment_candidate_phones ex
    WHERE ex.candidate_id = p_candidate_id
      AND ex.dedupe_key = r.dedupe_key
      AND ex.suppressed_at IS NOT NULL
  );

  -- A live primary already standing means the visible scalar does NOT depend on the legacy
  -- fallback, so a tombstoned legacy number cannot reach the visible field through it.
  SELECT EXISTS (
    SELECT 1 FROM public.contact_enrichment_candidate_phones e
    WHERE e.candidate_id = p_candidate_id
      AND e.is_primary
      AND e.suppressed_at IS NULL
  ) INTO v_has_live_primary;

  IF v_legacy_suppressed AND v_viable_preference = 0 AND NOT v_has_live_primary THEN
    -- Nothing electable survives, the fallback is a tombstone, and there is no standing
    -- primary to fall back on. Fail closed with nothing written and — the part that matters
    -- — WITHOUT terminalizing the candidate: a `revealed` row here would have to carry some
    -- number, and the only one left is one that was erased.
    --
    -- This subsumes the simpler "every number in the payload is a tombstone" case, since the
    -- legacy number is always one of the payload's numbers.
    --
    -- DECLARED LIMIT, identical to migration 110's: a permanent tombstone makes the leg
    -- resolve as unterminalized on every retry, always at whatever the provider already
    -- charged, until an operator intervenes. That is chosen over putting an erased number
    -- back in front of a user. The general suppression terminal policy is NOT resolved here.
    RETURN jsonb_build_object(
      'status',                   'suppressed',
      'inserted_phone_count',     0,
      'updated_phone_count',      0,
      'inserted_source_count',    0,
      'suppressed_skipped_count', v_suppressed_count,
      'primary_dedupe_key',       NULL,
      'primary_set',              false,
      'candidate_scalar_updated', false,
      'candidate_terminalized',   false
    );
  END IF;

  -- How many of the survivors already exist. Counted BEFORE the writes so that
  -- inserted/updated are facts rather than an interpretation of `xmax`.
  SELECT COUNT(*) INTO v_existing_live
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_enrichment_candidate_phones e
    ON e.candidate_id = p_candidate_id
   AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NULL;

  v_updated_count := v_existing_live;
  v_inserted_count := v_incoming_count - v_suppressed_count - v_existing_live;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 4 — canonical phones: insert new, refresh known.
  -- ═══════════════════════════════════════════════════════════════
  -- `is_primary` is false for every INSERT here and elected in step 6. Promoting during the
  -- insert would collide with the single-primary partial index while the previous primary is
  -- still standing. The ON CONFLICT branch does NOT touch `is_primary`, so a row that was
  -- already primary and shows up again in this payload keeps its designation until step 6
  -- decides otherwise.

  FOR v_row IN
    SELECT x.dedupe_key,
           x.normalized_phone,
           x.display_phone,
           x.phone_type,
           x.phone_status,
           x.first_seen_at,
           x.last_seen_at
    FROM jsonb_to_recordset(p_phones) AS x(
      dedupe_key       text,
      normalized_phone text,
      display_phone    text,
      phone_type       text,
      phone_status     text,
      first_seen_at    timestamptz,
      last_seen_at     timestamptz
    )
  LOOP
    -- Reset per iteration: `RETURNING … INTO` on a row the tombstone guard skipped must
    -- leave NULL here, not the id of the previous phone.
    v_phone_id := NULL;

    INSERT INTO public.contact_enrichment_candidate_phones AS t (
      candidate_id, normalized_phone, display_phone, dedupe_key,
      phone_type, phone_status, is_primary, first_seen_at, last_seen_at
    ) VALUES (
      p_candidate_id, v_row.normalized_phone, v_row.display_phone, v_row.dedupe_key,
      v_row.phone_type, v_row.phone_status, false, v_row.first_seen_at, v_row.last_seen_at
    )
    ON CONFLICT (candidate_id, dedupe_key) DO UPDATE
      SET
        -- `aggregateCandidatePhoneStatus`, mirrored: a provider that fails to verify a
        -- number is reporting its own coverage, so `invalid` never demotes a `valid`. This
        -- is what lets a number the other provider confirmed keep its `valid` when Lusha —
        -- which reports no per-number status at all — observes it again as `unknown`.
        phone_status = CASE
          WHEN 'valid' IN (t.phone_status, excluded.phone_status) THEN 'valid'
          WHEN t.phone_status = 'invalid'
               AND excluded.phone_status IN ('invalid', 'unknown') THEN 'invalid'
          WHEN excluded.phone_status = 'invalid'
               AND t.phone_status IN ('invalid', 'unknown') THEN 'invalid'
          ELSE 'unknown'
        END,
        -- `aggregateCandidatePhoneType`, mirrored: the better-ranked of the two wins, and
        -- every raw type stays intact in the provenance rows regardless.
        phone_type = CASE
          WHEN t.phone_type IS NULL THEN COALESCE(excluded.phone_type, 'unknown')
          WHEN COALESCE(array_position(c_type_ranking, t.phone_type),
                        array_length(c_type_ranking, 1) + 1)
               <= COALESCE(array_position(c_type_ranking,
                                          COALESCE(excluded.phone_type, 'unknown')),
                           array_length(c_type_ranking, 1) + 1)
            THEN t.phone_type
          ELSE COALESCE(excluded.phone_type, 'unknown')
        END,
        -- `first_seen_at` is deliberately untouched: it is the first time the number was
        -- seen, and seeing it again does not change that.
        last_seen_at = p_observed_at
      -- The tombstone guard, restated where it is enforced rather than merely intended.
      -- Without it a tombstoned row would be handed back its number and its type by this
      -- very UPDATE, and migration 109's `..._tombstone_is_empty` CHECK would then reject
      -- the statement — turning a privacy rule into a rollback.
      WHERE t.suppressed_at IS NULL
    RETURNING t.id INTO v_phone_id;

    -- A tombstoned row returns nothing: no provenance, no primary, no trace of the
    -- observation. Recording that a suppressed person was seen again is still recording it.
    IF v_phone_id IS NULL THEN
      CONTINUE;
    END IF;

    -- ═════════════════════════════════════════════════════════════
    -- Step 5 — provenance: append-only and idempotent.
    -- ═════════════════════════════════════════════════════════════
    -- ON CONFLICT DO NOTHING on (candidate_phone_id, source_event_key). Reprocessing the
    -- same response recognises the same observation instead of appending a second row, and
    -- no UPDATE is needed — which matters, because migration 109 does not grant one.
    --
    -- This is also where the cross-provider guarantee materialises: the same number seen by
    -- both providers is ONE canonical row with TWO provenance rows, because the keys differ
    -- by provider and neither overwrites the other.

    FOR v_src IN
      SELECT s.provider,
             s.acquisition_mode,
             s.raw_provider_type,
             s.raw_provider_status,
             s.waterfall_run_id,
             s.reservation_id,
             s.provider_usage_log_id,
             s.source_event_key,
             s.observed_at
      FROM jsonb_to_recordset(p_sources) AS s(
        dedupe_key            text,
        provider              text,
        acquisition_mode      text,
        raw_provider_type     text,
        raw_provider_status   text,
        waterfall_run_id      uuid,
        reservation_id        uuid,
        provider_usage_log_id uuid,
        source_event_key      text,
        observed_at           timestamptz
      )
      WHERE s.dedupe_key = v_row.dedupe_key
    LOOP
      INSERT INTO public.contact_enrichment_candidate_phone_sources (
        candidate_phone_id, provider, acquisition_mode, raw_provider_type,
        raw_provider_status, waterfall_run_id, reservation_id, provider_usage_log_id,
        source_event_key, observed_at
      ) VALUES (
        v_phone_id, v_src.provider, v_src.acquisition_mode, v_src.raw_provider_type,
        v_src.raw_provider_status, v_src.waterfall_run_id, v_src.reservation_id,
        v_src.provider_usage_log_id, v_src.source_event_key, v_src.observed_at
      )
      ON CONFLICT (candidate_phone_id, source_event_key) DO NOTHING;

      GET DIAGNOSTICS v_affected = ROW_COUNT;
      v_source_count := v_source_count + v_affected;
    END LOOP;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 6 — elect exactly one primary, never a worse one.
  -- ═══════════════════════════════════════════════════════════════
  -- The ORDER is the pure layer's decision. What this function decides is ELIGIBILITY —
  -- from the rows as they NOW stand: alive, numbered, not asserted invalid, which are the
  -- three conditions of migration 109's `..._primary_requires_live_number` CHECK, so a key
  -- this loop accepts can never be one the database would then reject — and, unlike
  -- migration 110, whether the winner actually IMPROVES on the incumbent.

  FOR v_pref IN
    SELECT r.dedupe_key, r.phone, r.phone_type, r.raw_type
    FROM jsonb_array_elements(p_primary_candidates) WITH ORDINALITY AS e(item, ord)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
      dedupe_key text, phone text, phone_type text, raw_type text
    )
    ORDER BY e.ord
  LOOP
    SELECT p.id,
           COALESCE(array_position(c_type_ranking, COALESCE(p.phone_type, 'unknown')),
                    array_length(c_type_ranking, 1) + 1),
           CASE p.phone_status WHEN 'valid' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END
      INTO v_chosen_id, v_chosen_rank, v_chosen_status_rank
    FROM public.contact_enrichment_candidate_phones p
    WHERE p.candidate_id = p_candidate_id
      AND p.dedupe_key = v_pref.dedupe_key
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid';

    IF v_chosen_id IS NOT NULL THEN
      v_chosen_key      := v_pref.dedupe_key;
      -- The scalar and its metadata come from the SAME entry as the elected key. This is
      -- the whole reason the triple travels with the key.
      v_chosen_phone    := v_pref.phone;
      v_chosen_type     := v_pref.phone_type;
      v_chosen_raw_type := v_pref.raw_type;
      EXIT;
    END IF;
  END LOOP;

  -- The live incumbent, read AFTER the upserts so its aggregated type is the current one.
  SELECT p.id,
         p.dedupe_key,
         COALESCE(array_position(c_type_ranking, COALESCE(p.phone_type, 'unknown')),
                  array_length(c_type_ranking, 1) + 1),
         CASE p.phone_status WHEN 'valid' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END
    INTO v_inc_id, v_inc_key, v_inc_rank, v_inc_status_rank
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id
    AND p.is_primary
    AND p.suppressed_at IS NULL;

  IF v_chosen_id IS NOT NULL THEN
    IF v_inc_id IS NOT NULL
       AND v_inc_id <> v_chosen_id
       AND (v_chosen_rank, v_chosen_status_rank) >= (v_inc_rank, v_inc_status_rank) THEN
      -- The incumbent is as good or better. It KEEPS the designation, and the visible
      -- fields are left exactly as they are: they already describe that number, with its
      -- own provenance. Relabelling it as this provider's reveal, or replacing it with a
      -- worse number, are both changes nobody asked for.
      v_primary_id     := v_inc_id;
      v_primary_key    := v_inc_key;
      v_scalar_updated := false;
    ELSE
      -- A strict improvement (or there was no incumbent, or the incumbent IS this key).
      v_primary_id      := v_chosen_id;
      v_primary_key     := v_chosen_key;
      v_scalar_updated  := true;
      v_scalar          := v_chosen_phone;
      v_meta_type       := v_chosen_type;
      v_meta_raw_type   := v_chosen_raw_type;
    END IF;
  ELSIF v_inc_id IS NOT NULL THEN
    -- Nothing from this response qualifies, but a primary is already standing. It is kept
    -- and the visible fields are left alone — the coherent reading, and the one that cannot
    -- put a worse number in front of a user.
    v_primary_id     := v_inc_id;
    v_primary_key    := v_inc_key;
    v_scalar_updated := false;
  ELSE
    -- No primary at all: neither this response nor the table has an electable number. The
    -- scalar keeps the LEGACY behaviour, byte-for-byte what the caller wrote before 4O-D.
    -- The collection is left without a primary, which is the honest reading of a number
    -- that migration 109's CHECK will not let be one.
    v_primary_id     := NULL;
    v_primary_key    := NULL;
    v_scalar_updated := true;
    v_scalar         := p_legacy_phone;
    v_meta_type      := p_legacy_phone_type;
    v_meta_raw_type  := p_legacy_raw_type;
  END IF;

  IF v_primary_id IS NOT NULL THEN
    -- Demote first, promote second. The partial unique index does not tolerate two
    -- primaries even for an instant, and doing it in this order needs no window. Both
    -- statements are no-ops when the incumbent already IS the elected row.
    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = false
     WHERE candidate_id = p_candidate_id
       AND is_primary
       AND id <> v_primary_id;

    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = true
     WHERE id = v_primary_id
       AND NOT is_primary;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 7 — the candidate: scalar phone plus terminal state.
  -- ═══════════════════════════════════════════════════════════════
  -- Same transaction as everything above, so the forbidden state — a visible phone with an
  -- incomplete collection — cannot be observed even for the duration of a query.
  --
  -- `phone` and `enrichment_metadata` are written ONLY when this response's number won.
  -- When the incumbent was retained they are conditionally skipped by the CASE below
  -- rather than by a second statement, so there is still exactly one UPDATE and one
  -- ROW_COUNT to verify.

  v_phone_meta := jsonb_build_object(
    'number',   v_scalar,
    'type',     v_meta_type,
    'source',   'lusha_reveal',
    'raw_type', v_meta_raw_type
  );

  UPDATE public.contact_enrichment_candidates
     SET phone = CASE WHEN v_scalar_updated THEN v_scalar ELSE phone END,
         -- Shallow merge of the single `phone` key, exactly as the caller's
         -- `{...candidate.enrichmentMetadata, phone: phoneMetadata}` does — except read
         -- from the LOCKED row, so a concurrent metadata write cannot be clobbered by a
         -- stale copy.
         enrichment_metadata = CASE
           WHEN v_scalar_updated THEN jsonb_set(
             COALESCE(enrichment_metadata, '{}'::jsonb), '{phone}', v_phone_meta, true
           )
           ELSE enrichment_metadata
         END,
         phone_reveal_status        = p_phone_reveal_status,
         phone_reveal_provider      = p_phone_reveal_provider,
         -- Written unconditionally, NULL included: that NULL is what clears a previous
         -- provider's orphan correlation id off a row whose provider is now `lusha`.
         phone_reveal_request_id    = p_phone_reveal_request_id,
         phone_revealed_at          = p_phone_revealed_at,
         phone_reveal_completed_at  = p_phone_reveal_completed_at,
         phone_revealed_by          = p_phone_revealed_by,
         phone_reveal_cost_credits  = p_phone_reveal_cost_credits,
         phone_reveal_cost_source   = p_phone_reveal_cost_source,
         phone_reveal_error_code    = p_phone_reveal_error_code,
         phone_reveal_attempt_count = p_phone_reveal_attempt_count
   WHERE id = p_candidate_id;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    -- Unreachable while the row is locked; raised rather than reported because it would
    -- mean the lock did not hold, and continuing would leave a collection with no terminal
    -- state. The message names the operation, never a value.
    RAISE EXCEPTION 'persist_candidate_lusha_phone_reveal_result: candidate terminal update did not affect exactly one row';
  END IF;

  RETURN jsonb_build_object(
    'status',                   'persisted',
    'inserted_phone_count',     v_inserted_count,
    'updated_phone_count',      v_updated_count,
    'inserted_source_count',    v_source_count,
    'suppressed_skipped_count', v_suppressed_count,
    'primary_dedupe_key',       v_primary_key,
    'primary_set',              v_primary_id IS NOT NULL,
    'candidate_scalar_updated', v_scalar_updated,
    'candidate_terminalized',   true
  );
END $$;

-- ── 5. Estado final de privilegios, declarado explícitamente ───────
--
-- `CREATE OR REPLACE` conserva los privilegios existentes, así que este bloque no
-- CAMBIA nada hoy: existe para que el estado final quede escrito en la propia
-- migración y no dependa de leer la 110 y la 111 para saber quién puede ejecutar.

REVOKE ALL ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) FROM anon;

REVOKE ALL ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) FROM anon;

REVOKE ALL ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) TO postgres, service_role;
