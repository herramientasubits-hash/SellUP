-- Migración 131: la proyección post-aprobación pasa a PRODUCIR el estado `stale` de HubSpot
-- (Agente 2 · AGENT2-POST-APPROVAL-REVEAL-STALE-PRODUCER-FINAL-CUT)
--
-- ═══════════════════════════════════════════════════════════════════
-- EL DEFECTO, DICHO COMO UN HECHO SOBRE EL ESQUEMA
-- ═══════════════════════════════════════════════════════════════════
--
-- La 128 escribe `public.contacts.phone`. No contiene las palabras `stale`, `hubspot_sync` ni
-- `stale_source`: ni una vez. Así que un contacto VINCULADO y `synced` al que se le revela un
-- teléfono después de su aprobación acaba con el número guardado aquí, con HubSpot conservando el
-- anterior —o ninguno— y con su propia ficha diciendo que está al día. La ficha no se equivoca por
-- un error de lógica: no hay ninguna sentencia en el esquema que pudiera cambiarla.
--
-- CUT-3A construyó la autoridad de esa transición y CUT-3C le añadió la PROCEDENCIA, con un
-- vocabulario cerrado de cuatro miembros. Uno de ellos, `reveal`, quedó declarado y SIN ningún
-- llamador: la propia cabecera de CUT-3C lo dice. Ésta es la sentencia que lo escribe.
--
-- ═══════════════════════════════════════════════════════════════════
-- POR QUÉ DENTRO DE LA MISMA TRANSACCIÓN
-- ═══════════════════════════════════════════════════════════════════
--
-- Una segunda escritura desde la aplicación, después de la RPC, dejaría una ventana en la que el
-- teléfono ya está guardado y el estado durable todavía dice `synced`. Esa ventana ES el defecto,
-- sólo más corta. Aquí el UPDATE del escalar y el veredicto sobre él son la misma transacción: un
-- rollback se lleva los dos.
--
-- CERO red. Desde SQL no hay ninguna: no se llama a `http`, ni a `pg_net`, ni a `net.`. Enviar
-- algo a HubSpot sigue siendo una FASE POSTERIOR AL COMMIT, en la aplicación, detrás de la bandera
-- de CUT-3C, y su fallo no puede deshacer nada de lo que esta función escribió.
--
-- ═══════════════════════════════════════════════════════════════════
-- QUÉ RAZÓN PUEDE PRODUCIR ESTA FUNCIÓN, Y POR QUÉ LA OTRA ES IMPOSIBLE
-- ═══════════════════════════════════════════════════════════════════
--
-- El paso 10 escribe `phone` bajo DOS guardas simultáneas: el escalar tenía que estar en NULL bajo
-- el lock (`NULLIF(BTRIM(COALESCE(v_contact.phone,'')),'') IS NULL`) y el principal electo tiene
-- que ser una fila que ESTA transacción insertó. Y el valor escrito es
-- `COALESCE(display_phone, normalized_phone)` de una fila cuya elección exige
-- `normalized_phone IS NOT NULL`, así que NO puede ser NULL.
--
-- De ahí que la única transición posible sobre el escalar sea NULL → VALOR:
--
--   * VALOR → VALOR es inalcanzable: la primera guarda lo excluye;
--   * VALOR → NULL es inalcanzable: el valor escrito nunca es NULL, y esta función no contiene
--     ningún `SET phone = NULL`;
--   * `mobile_phone` NO se toca (4O-E4.1 intacta), así que tampoco puede caer por ese lado.
--
-- Sobre el SALIENTE (`mobile_phone ?? phone`) eso deja exactamente dos desenlaces: si el móvil
-- tapaba el escalar el saliente NO cambia y no se marca nada; si no lo tapaba, el saliente pasa de
-- ausente a presente y la razón derivada es `phone_changed`.
--
-- ⇒ `phone_removed` es INALCANZABLE desde esta función. No se excluye por convenio: la autoridad
--   la derivaría igual si el saliente cayera, y no cae. La suite lo prueba en negativo.
--
-- ═══════════════════════════════════════════════════════════════════
-- ORDEN DE DEPENDENCIA (lo impone el número, no el alfabeto)
-- ═══════════════════════════════════════════════════════════════════
--
--   1. 129_agent2_contact_hubspot_stale_completeness.sql   `hubspot_outbound_phone`
--   2. 130_agent2_contact_hubspot_stale_source.sql          la autoridad de CUATRO args
--   3. 131_agent2_post_approval_reveal_stale_producer.sql   ESTE archivo
--
-- 129 < 130 < 131: el orden de aplicación es el NUMÉRICO, el mismo que ya gobierna las 128
-- migraciones anteriores. Antes de la canonicalización lo daba una propiedad accidental del
-- alfabeto (`contact` < `post` en ASCII); ahora lo da el prefijo, que es una garantía más
-- fuerte. Este archivo llama a la firma de CUATRO argumentos, que la 130 crea y cuya versión de
-- TRES borra: si se aplicara antes, la llamada no resolvería.
--
-- ═══════════════════════════════════════════════════════════════════
-- NUMERADA, Y NO APLICADA EN NINGUNA PARTE
-- ═══════════════════════════════════════════════════════════════════
--
--   APPLIED IN PRODUCTION: NO
--   APPLIED REMOTE:        NO
--   LOCAL ONLY:            YES   (sólo el arnés PostgreSQL local la aplica)
--
-- AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 la canonicalizó junto con la 129, la 130 y la
-- 132, con la disputa de numeración 125/126/127 ya cerrada en `main` y el techo desplegable en
-- la 128. Al empezar por `\d{3}_` este archivo entra en la secuencia desplegable y DENTRO de
-- las guardas de techo, que filtran exactamente ese patrón: ya no queda ningún fichero de
-- migración fuera del radar. Numerar NO la aplica — las tres líneas de estado siguen siendo la
-- verdad, y aplicarla en remoto exige autorización explícita de la dueña.
--
-- ═══════════════════════════════════════════════════════════════════
-- IDEMPOTENTE, ADITIVO, REVERSIBLE
-- ═══════════════════════════════════════════════════════════════════
--
-- Un solo `CREATE OR REPLACE FUNCTION`. Cero DDL: ninguna tabla, columna, índice, trigger o
-- policy. Deshacerlo es volver a aplicar la 128.
--
-- ⚠️ GENERADO. El cuerpo es el de la 128 con los CINCO splices declarados en
-- `scripts/local/build-final-reveal-migration.mjs`, y
-- `post-approval-reveal-stale-producer-final.test.ts` los re-deriva y compara byte a byte. No
-- editar a mano: edítese el generador.

CREATE OR REPLACE FUNCTION public.project_approved_candidate_phones_onto_contact(
  p_candidate_id    uuid,
  p_contact_id      uuid,
  p_scalar_fallback jsonb,
  p_actor_id        uuid,
  p_now             timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  -- 112 / 115 / 116 rankings, verbatim. A second ranking over the same vocabulary is how the
  -- candidate and the official collection end up electing different primaries for one person.
  c_type_ranking   text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];
  c_source_ranking text[] := ARRAY[
    'apollo:reveal', 'lusha:reveal', 'apollo_cache:cache', 'apollo:search'
  ];

  -- The ONLY candidate status this function acts on. `pending_review` belongs to 116 and
  -- `duplicate` to 117; acting on either from here would be running an approval or a merge
  -- without its own guards.
  c_projectable    text[] := ARRAY['approved'];

  v_candidate      RECORD;
  v_contact        RECORD;
  v_account_id     uuid;
  v_person_id      text;

  v_fb_provider    text;
  v_fb_mode        text;
  v_fb_norm        text;
  v_fb_display     text;
  v_fb_key         text;
  v_fb_type        text;
  v_fb_event       text;
  v_fb_phone_id    uuid;
  v_scalar_fb      text    := 'absent';

  v_live_rows      integer := 0;
  v_seen           integer := 0;
  v_inserted       integer := 0;
  v_reused         integer := 0;
  v_skipped        integer := 0;
  v_src_seen       integer := 0;
  v_src_inserted   integer := 0;
  v_src_reused     integer := 0;

  v_existing_primary uuid;
  v_primary_id     uuid;
  v_primary_key    text;
  v_primary_new    boolean := false;
  v_primary        RECORD;
  v_src            RECORD;
  v_scalar         text;
  v_scalar_type    text;
  v_scalar_source  text;
  v_scalar_raw     text;
  v_scalar_at      timestamptz;
  v_scalar_basis   text;
  v_scalar_synced  boolean := false;
  v_rows           integer := 0;
  v_inserted_ids   uuid[]  := ARRAY[]::uuid[];

  -- FINAL CUT — el teléfono SALIENTE (`mobile_phone ?? phone`) que HubSpot conoce, capturado
  -- bajo el lock del contacto y ANTES de que esta transacción escriba una sola columna. Es el
  -- único momento en que ese valor existe: después del paso 10 la fila ya lleva el nuevo.
  v_hs_prev_out    text;
  -- FINAL CUT — veredicto MECÁNICO de la autoridad de CUT-3A/CUT-3C, sin PII. `not_evaluated`
  -- hasta que se consulta: un camino que devolvió antes de proyectar no evaluó nada, y decir
  -- `no_outbound_change` ahí afirmaría una comparación que nadie hizo.
  v_hs_decision    text    := 'not_evaluated';
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- Step 0 — validation. Fail closed BEFORE any write.
  -- ═══════════════════════════════════════════════════════════════

  IF p_candidate_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'candidate_id_missing');
  END IF;

  IF p_contact_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'contact_id_missing');
  END IF;

  IF p_now IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'now_missing');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1 — lock the candidate. FIRST statement that touches a row.
  -- ═══════════════════════════════════════════════════════════════
  -- Everything below is decided on a snapshot this lock protects, never on the pre-call read
  -- the server action did.

  SELECT c.id,
         c.status,
         c.phone,
         c.matched_contacts_id,
         c.enrichment_run_id,
         c.apollo_person_id,
         c.source,
         c.source_contact_id,
         c.phone_processing_basis
    INTO v_candidate
  FROM public.contact_enrichment_candidates c
  WHERE c.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'candidate_not_found', 'detail', 'candidate_missing');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2 — the candidate must be APPROVED, under the lock.
  -- ═══════════════════════════════════════════════════════════════

  IF NOT (v_candidate.status = ANY (c_projectable)) THEN
    RETURN jsonb_build_object(
      'status', 'candidate_not_projectable',
      'detail', 'candidate_status_not_approved'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 — the IDOR guard: the destination is the SERVER's link.
  -- ═══════════════════════════════════════════════════════════════
  -- 116 wrote `matched_contacts_id` to the contact it created, inside the approval transaction.
  -- The caller's id is a confirmation of that value, never a choice of destination.

  IF v_candidate.matched_contacts_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'contact_link_missing',
      'detail', 'candidate_has_no_matched_contact'
    );
  END IF;

  IF v_candidate.matched_contacts_id IS DISTINCT FROM p_contact_id THEN
    RETURN jsonb_build_object(
      'status', 'contact_link_mismatch',
      'detail', 'contact_id_is_not_matched_contact'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 4 — PERSON suppression, re-checked UNDER the lock (4O-E3 / 113).
  -- ═══════════════════════════════════════════════════════════════
  -- 113's key resolution, statement for statement, exactly as 116 and 117 do it. No person id
  -- or no account means there is no key to match, and that limit is NOT turned into a block by
  -- inference — and no matching by phone, e-mail, name or LinkedIn is added here either.

  SELECT r.account_id INTO v_account_id
  FROM public.contact_enrichment_runs r
  WHERE r.id = v_candidate.enrichment_run_id;

  v_person_id := COALESCE(
    public.phone_reveal_normalized_apollo_person_id(v_candidate.apollo_person_id),
    CASE WHEN v_candidate.source = 'apollo'
      THEN public.phone_reveal_normalized_apollo_person_id(v_candidate.source_contact_id)
    END
  );

  IF v_person_id IS NOT NULL
     AND v_account_id IS NOT NULL
     AND public.phone_reveal_person_suppression_exists(v_person_id, v_account_id) THEN
    -- Fail closed with NOTHING written. An erasure that commits inside this window must win.
    RETURN jsonb_build_object(
      'status',       'person_suppressed',
      'candidate_id', p_candidate_id,
      'contact_id',   NULL,
      'detail',       'person_suppression_tombstone'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 5 — lock the contact, in the position 115/116/117 take it.
  -- ═══════════════════════════════════════════════════════════════

  SELECT ct.id, ct.account_id, ct.phone, ct.mobile_phone, ct.archived_at
    INTO v_contact
  FROM public.contacts ct
  WHERE ct.id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'contact_not_found', 'detail', 'contact_missing');
  END IF;

  -- `matched_contacts_id` is a FK with no account clause. The account is re-asserted here so a
  -- candidate whose run belongs to one account can never write onto another account's contact.
  IF v_account_id IS NOT NULL AND v_contact.account_id IS DISTINCT FROM v_account_id THEN
    RETURN jsonb_build_object('status', 'contact_mismatch', 'detail', 'contact_account_mismatch');
  END IF;

  IF v_contact.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'contact_not_projectable',
      'detail', 'contact_archived'
    );
  END IF;

  -- FINAL CUT — el saliente ANTERIOR, bajo el lock que el paso 5 acaba de tomar y antes de la
  -- primera escritura de esta transacción. Mismo sitio y misma llamada que el paso 5 de la 117
  -- y el paso 1 de la 115 en CUT-3A/CUT-3C: una sola autoridad calcula el saliente, aquí y allí.
  v_hs_prev_out := public.hubspot_outbound_phone(v_contact.phone, v_contact.mobile_phone);

  -- ═══════════════════════════════════════════════════════════════
  -- Step 6 — the legacy shape this function refuses.
  -- ═══════════════════════════════════════════════════════════════
  -- Scalar SET with an empty official collection is 117's bootstrap case. See the header: it is
  -- refused here rather than answered a second time, with NOTHING written.

  SELECT COUNT(*) INTO v_live_rows
  FROM public.contact_phones op
  WHERE op.contact_id = p_contact_id
    AND op.suppressed_at IS NULL;

  IF NULLIF(BTRIM(COALESCE(v_contact.phone, '')), '') IS NOT NULL AND v_live_rows = 0 THEN
    RETURN jsonb_build_object(
      'status',       'scalar_incumbent_unprojectable',
      'candidate_id', p_candidate_id,
      'contact_id',   p_contact_id,
      'detail',       'legacy_scalar_without_official_collection'
    );
  END IF;

  -- The incumbent primary is read BEFORE anything is inserted: layer 1 of the header depends on
  -- knowing whether the contact already had one, and after step 7 that is no longer knowable.
  SELECT op.id INTO v_existing_primary
  FROM public.contact_phones op
  WHERE op.contact_id = p_contact_id
    AND op.is_primary
    AND op.suppressed_at IS NULL
  LIMIT 1;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 7 — promote the LIVE candidate collection, additively.
  -- ═══════════════════════════════════════════════════════════════
  -- 116's step 6, with one difference: `RETURNING id` is collected, because the scalar rule of
  -- this function needs to know which rows are NEW.

  SELECT COUNT(*) INTO v_seen
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id;

  SELECT COUNT(*) INTO v_skipped
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id
    AND p.suppressed_at IS NOT NULL;

  WITH promoted AS (
    INSERT INTO public.contact_phones (
      contact_id, normalized_phone, display_phone, dedupe_key,
      phone_type, phone_status, is_primary, first_seen_at, last_seen_at
    )
    SELECT p_contact_id,
           p.normalized_phone,
           p.display_phone,
           p.dedupe_key,
           p.phone_type,
           p.phone_status,
           false,
           p.first_seen_at,
           p.last_seen_at
    FROM public.contact_enrichment_candidate_phones p
    WHERE p.candidate_id = p_candidate_id
      AND p.suppressed_at IS NULL
    ORDER BY p.dedupe_key
    ON CONFLICT (contact_id, dedupe_key) DO NOTHING
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_inserted_ids FROM promoted;

  v_inserted := COALESCE(array_length(v_inserted_ids, 1), 0);

  SELECT GREATEST(COUNT(*) - v_inserted, 0) INTO v_reused
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id
    AND p.suppressed_at IS NULL;

  -- ── Provenance ────────────────────────────────────────────────
  -- 116's step 6 provenance block, verbatim, including the `v1:promoted:` namespace: the SAME
  -- paid observation promoted by the approval and re-promoted here collapses onto ONE source row
  -- because the key is deterministic and operation-derived. That is what makes re-running this
  -- function free of duplicate provenance.

  SELECT COUNT(*) INTO v_src_seen
  FROM public.contact_enrichment_candidate_phone_sources s
  JOIN public.contact_enrichment_candidate_phones p ON p.id = s.candidate_phone_id
  WHERE p.candidate_id = p_candidate_id
    AND p.suppressed_at IS NULL;

  WITH promoted_sources AS (
    INSERT INTO public.contact_phone_sources (
      contact_phone_id, provider, acquisition_mode,
      raw_provider_type, raw_provider_status,
      waterfall_run_id, reservation_id, provider_usage_log_id,
      candidate_phone_id, source_event_key, observed_at
    )
    SELECT op.id,
           s.provider,
           s.acquisition_mode,
           s.raw_provider_type,
           s.raw_provider_status,
           s.waterfall_run_id,
           s.reservation_id,
           s.provider_usage_log_id,
           s.candidate_phone_id,
           'v1:promoted:' || s.source_event_key,
           s.observed_at
    FROM public.contact_enrichment_candidate_phone_sources s
    JOIN public.contact_enrichment_candidate_phones cp ON cp.id = s.candidate_phone_id
    JOIN public.contact_phones op
      ON op.contact_id = p_contact_id
     AND op.dedupe_key = cp.dedupe_key
     AND op.suppressed_at IS NULL
    WHERE cp.candidate_id = p_candidate_id
      AND cp.suppressed_at IS NULL
    ORDER BY op.id, s.source_event_key
    ON CONFLICT (contact_phone_id, source_event_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_src_inserted FROM promoted_sources;

  v_src_reused := GREATEST(v_src_seen - v_src_inserted, 0);

  -- ═══════════════════════════════════════════════════════════════
  -- Step 8 — the scalar-only candidate.
  -- ═══════════════════════════════════════════════════════════════
  -- 116's step 7, unchanged in substance: only when the collection produced NOTHING live, and
  -- only when the provenance inverted unambiguously in the caller's PURE builder
  -- (`buildCandidateScalarFallback`) — the same builder 116 and 117 use. The vocabularies are
  -- re-validated here and never trusted from the payload.

  IF v_inserted = 0 AND v_reused = 0 THEN
    IF p_scalar_fallback IS NULL OR jsonb_typeof(p_scalar_fallback) <> 'object' THEN
      v_scalar_fb := CASE
        WHEN NULLIF(BTRIM(COALESCE(v_candidate.phone, '')), '') IS NULL THEN 'absent'
        ELSE 'unrepresentable'
      END;
    ELSE
      v_fb_provider := p_scalar_fallback ->> 'provider';
      v_fb_mode     := p_scalar_fallback ->> 'acquisition_mode';
      v_fb_norm     := NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'normalized_phone', '')), '');
      v_fb_display  := NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'display_phone', '')), '');
      v_fb_key      := NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'dedupe_key', '')), '');
      v_fb_type     := p_scalar_fallback ->> 'phone_type';
      v_fb_event    := NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'source_event_key', '')), '');

      IF v_fb_provider IS NULL
         OR NOT (v_fb_provider = ANY (ARRAY['apollo', 'lusha', 'apollo_cache', 'manual', 'unknown']))
         OR v_fb_mode IS NULL
         OR NOT (v_fb_mode = ANY (ARRAY['search', 'reveal', 'waterfall', 'cache', 'manual']))
         OR v_fb_norm IS NULL
         OR v_fb_key IS NULL
         OR v_fb_event IS NULL THEN
        v_scalar_fb := 'unrepresentable';
      ELSE
        IF v_fb_type IS NOT NULL AND NOT (v_fb_type = ANY (c_type_ranking)) THEN
          v_fb_type := NULL;
        END IF;

        INSERT INTO public.contact_phones (
          contact_id, normalized_phone, display_phone, dedupe_key,
          phone_type, phone_status, is_primary, first_seen_at, last_seen_at
        )
        VALUES (
          p_contact_id, v_fb_norm, COALESCE(v_fb_display, v_fb_norm), v_fb_key,
          v_fb_type, 'unknown', false, p_now, p_now
        )
        ON CONFLICT (contact_id, dedupe_key) DO NOTHING
        RETURNING id INTO v_fb_phone_id;

        IF v_fb_phone_id IS NULL THEN
          -- A live row or a tombstone already holds this key. Never resurrected, never counted.
          v_scalar_fb := 'unrepresentable';
        ELSE
          v_inserted     := v_inserted + 1;
          v_seen         := v_seen + 1;
          v_inserted_ids := v_inserted_ids || v_fb_phone_id;

          INSERT INTO public.contact_phone_sources (
            contact_phone_id, provider, acquisition_mode,
            raw_provider_type, source_event_key, observed_at
          )
          VALUES (
            v_fb_phone_id, v_fb_provider, v_fb_mode,
            NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'raw_provider_type', '')), ''),
            'v1:promoted:' || v_fb_event,
            p_now
          )
          ON CONFLICT (contact_phone_id, source_event_key) DO NOTHING;

          GET DIAGNOSTICS v_rows = ROW_COUNT;
          v_src_inserted := v_src_inserted + v_rows;
          v_src_seen     := v_src_seen + 1;
          v_scalar_fb    := 'promoted';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 9 — elect a primary ONLY when the contact has none.
  -- ═══════════════════════════════════════════════════════════════
  -- Layer 1 of the header. An incumbent live primary is kept exactly as it is: this is a
  -- projection, not a repriorisation, and a candidate arriving with a `personal_mobile` does not
  -- displace a `work` line somebody already chose.

  IF v_existing_primary IS NOT NULL THEN
    SELECT op.id, op.dedupe_key INTO v_primary
    FROM public.contact_phones op
    WHERE op.id = v_existing_primary;
    v_primary_id  := v_primary.id;
    v_primary_key := v_primary.dedupe_key;
  ELSE
    -- The candidate's OWN live primary first — the reveal persistence or the operator already
    -- made that choice on the staging row — then 115/116's shared ranking, rung for rung, with
    -- `dedupe_key` as the total tie-break so physical row order never participates.
    SELECT op.id, op.dedupe_key INTO v_primary
    FROM public.contact_enrichment_candidate_phones cp
    JOIN public.contact_phones op
      ON op.contact_id = p_contact_id
     AND op.dedupe_key = cp.dedupe_key
    WHERE cp.candidate_id = p_candidate_id
      AND cp.is_primary
      AND cp.suppressed_at IS NULL
      AND op.suppressed_at IS NULL
      AND op.normalized_phone IS NOT NULL
      AND op.phone_status <> 'invalid'
    LIMIT 1;

    IF FOUND THEN
      v_primary_id  := v_primary.id;
      v_primary_key := v_primary.dedupe_key;
    ELSE
      SELECT p.id, p.dedupe_key INTO v_primary
      FROM public.contact_phones p
      WHERE p.contact_id = p_contact_id
        AND p.suppressed_at IS NULL
        AND p.normalized_phone IS NOT NULL
        AND p.phone_status <> 'invalid'
      ORDER BY
        CASE WHEN EXISTS (
          SELECT 1 FROM public.contact_phone_sources s
          WHERE s.contact_phone_id = p.id
            AND s.suppressed_at IS NULL
            AND s.provider = 'manual'
        ) THEN 0 ELSE 1 END,
        COALESCE(array_position(c_type_ranking, p.phone_type),
                 array_length(c_type_ranking, 1) + 1),
        CASE p.phone_status WHEN 'valid' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END,
        COALESCE((
          SELECT MIN(COALESCE(
                   array_position(c_source_ranking, s.provider || ':' || s.acquisition_mode),
                   array_length(c_source_ranking, 1) + 1))
          FROM public.contact_phone_sources s
          WHERE s.contact_phone_id = p.id
            AND s.suppressed_at IS NULL
        ), array_length(c_source_ranking, 1) + 1),
        p.last_seen_at DESC,
        p.dedupe_key ASC
      LIMIT 1;

      IF FOUND THEN
        v_primary_id  := v_primary.id;
        v_primary_key := v_primary.dedupe_key;
      END IF;
    END IF;

    IF v_primary_id IS NOT NULL THEN
      -- Demote first, promote second: `contact_phones_one_primary_idx` does not tolerate two
      -- primaries even for one statement, and this order needs no window.
      UPDATE public.contact_phones
         SET is_primary = false
       WHERE contact_id = p_contact_id
         AND is_primary
         AND id <> v_primary_id;

      UPDATE public.contact_phones
         SET is_primary = true
       WHERE id = v_primary_id
         AND NOT is_primary;
    END IF;
  END IF;

  v_primary_new := v_primary_id IS NOT NULL AND v_primary_id = ANY (v_inserted_ids);

  -- ═══════════════════════════════════════════════════════════════
  -- Step 10 — project the legacy scalar tuple, under BOTH guards.
  -- ═══════════════════════════════════════════════════════════════
  -- Layer 2 of the header: the scalar is written only when it was NULL under this lock AND the
  -- elected primary is a row THIS transaction inserted. Anything else leaves `phone`,
  -- `phone_type`, `phone_source`, `phone_raw_type`, `phone_revealed_at` and
  -- `phone_processing_basis` exactly as they were.
  --
  -- `mobile_phone` is NOT in this UPDATE and must not be — MOBILE_PHONE_PROVENANCE_PENDING
  -- (4O-E4.1) stands. `phone_confidence` is never written: it stays the dead column 4O-E4 found.

  IF v_primary_new AND NULLIF(BTRIM(COALESCE(v_contact.phone, '')), '') IS NULL THEN
    SELECT p.display_phone, p.normalized_phone, p.phone_type INTO v_primary
    FROM public.contact_phones p
    WHERE p.id = v_primary_id;

    v_scalar      := COALESCE(v_primary.display_phone, v_primary.normalized_phone);
    v_scalar_type := v_primary.phone_type;

    -- Provenance from the most SPECIFIC LIVE source of the elected row, 115/116's comparator
    -- verbatim. A scalar must never assert a provenance that has been withdrawn.
    SELECT s.provider, s.acquisition_mode, s.raw_provider_type, s.observed_at INTO v_src
    FROM public.contact_phone_sources s
    WHERE s.contact_phone_id = v_primary_id
      AND s.suppressed_at IS NULL
    ORDER BY
      COALESCE(array_position(c_source_ranking, s.provider || ':' || s.acquisition_mode),
               array_length(c_source_ranking, 1) + 1),
      s.observed_at DESC,
      s.id ASC
    LIMIT 1;

    IF FOUND THEN
      -- 112's mapping, verbatim.
      v_scalar_source := CASE
        WHEN v_src.provider = 'apollo_cache'                                THEN 'apollo_cache'
        WHEN v_src.provider = 'lusha'                                       THEN 'lusha_reveal'
        WHEN v_src.provider = 'apollo' AND v_src.acquisition_mode
               IN ('reveal', 'waterfall')                                   THEN 'apollo_reveal'
        WHEN v_src.provider = 'apollo' AND v_src.acquisition_mode = 'search' THEN 'apollo_search'
        WHEN v_src.provider = 'manual'                                      THEN 'manual'
        ELSE 'unknown'
      END;
      v_scalar_raw := v_src.raw_provider_type;
      v_scalar_at  := v_src.observed_at;
    ELSE
      v_scalar_source := 'unknown';
    END IF;

    -- The lawful basis of the operation that produced this number, carried from the candidate's
    -- own reveal record. 116 takes it from the approval payload because at that moment the
    -- reveal had already happened; here the reveal happened AFTER the approval, so the candidate
    -- column is the only place the basis exists. NULL is left as NULL — never invented.
    v_scalar_basis := NULLIF(BTRIM(COALESCE(v_candidate.phone_processing_basis, '')), '');

    UPDATE public.contacts
       SET phone                  = v_scalar,
           phone_type             = v_scalar_type,
           phone_source           = v_scalar_source,
           phone_raw_type         = v_scalar_raw,
           phone_revealed_at      = v_scalar_at,
           phone_processing_basis = COALESCE(v_scalar_basis, phone_processing_basis),
           updated_by             = COALESCE(p_actor_id, updated_by)
     WHERE id = p_contact_id
       AND (
         phone IS DISTINCT FROM v_scalar
         OR phone_type IS DISTINCT FROM v_scalar_type
         OR phone_source IS DISTINCT FROM v_scalar_source
         OR phone_raw_type IS DISTINCT FROM v_scalar_raw
         OR phone_revealed_at IS DISTINCT FROM v_scalar_at
       );

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_scalar_synced := v_rows > 0;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 10b — FINAL CUT: el estado durable de HubSpot, en ESTA transacción.
  -- ═══════════════════════════════════════════════════════════════
  -- Si el paso 10 movió el teléfono SALIENTE de un contacto vinculado cuyo estado durable
  -- decía `synced`, ese estado ya es falso: SellUp tiene un número que HubSpot no ha visto.
  -- La transición se escribe AQUÍ, en la misma transacción que la causó, y un rollback se
  -- lleva el número y el veredicto sobre él juntos.
  --
  -- Se llama SIEMPRE, no sólo cuando el paso 10 escribió. La autoridad compara el saliente de
  -- AHORA con el que se capturó bajo el lock y devuelve `no_outbound_change` sin escribir nada
  -- cuando no se movió — que es el caso normal de una reconciliación repetida y el de un
  -- `mobile_phone` que tapa el escalar. Condicionarla al paso 10 metería aquí una SEGUNDA
  -- respuesta a «¿cambió el saliente?», capaz de contradecir a la primera.
  --
  -- El cuarto argumento es `reveal`, y no es una etiqueta descriptiva: es lo que autoriza al
  -- ejecutor automático de CUT-3C a enviar este pendiente sin que nadie lo pulse. Viaja con el
  -- HECHO, dentro de la transacción que lo produce, porque una autorización que el ejecutor
  -- recibiera como parámetro dependería de que cada camino futuro se acordara de pasarla.
  -- `reveal` estaba declarado en el vocabulario CERRADO de CUT-3C y hasta ahora no lo escribía
  -- ningún llamador; ésta es la sentencia que lo escribe.
  --
  -- CERO red: es un UPDATE de metadata dentro de SQL. Enviar algo a HubSpot sigue siendo una
  -- fase POSTERIOR al COMMIT, en la aplicación, y sigue estando detrás de su propia bandera.
  v_hs_decision := public.mark_contact_hubspot_sync_stale_for_phone(
    p_contact_id, v_hs_prev_out, p_now, 'reveal'
  );

  -- ═══════════════════════════════════════════════════════════════
  -- Step 11 — the envelope.
  -- ═══════════════════════════════════════════════════════════════
  -- Counts, booleans, opaque ids and a `dedupe_key` — a SHA-256 by 114's design and never the
  -- number. NO phone number, NO display form, NO name, NO e-mail leaves this function.

  RETURN jsonb_build_object(
    'status',                    'projected',
    'candidate_id',              p_candidate_id,
    'contact_id',                p_contact_id,
    'phones_seen',               v_seen,
    'phones_inserted',           v_inserted,
    'phones_reused',             v_reused,
    'phones_skipped_suppressed', v_skipped,
    'sources_inserted',          v_src_inserted,
    'sources_reused',            v_src_reused,
    'primary_dedupe_key',        v_primary_key,
    'primary_elected_now',       v_primary_new,
    'scalar_synced',             v_scalar_synced,
    'scalar_fallback',           v_scalar_fb,
    -- FINAL CUT — veredicto MECÁNICO y sin PII: `marked`, `reason_corrected`,
    -- `source_corrected`, `already_pending`, `not_linked`, `no_durable_state`,
    -- `no_outbound_change`, `not_previously_synced`, `contact_not_found`, `invalid_source`,
    -- `invalid_input` o `not_evaluated`. No dice cuál es el número: dice si HubSpot quedó
    -- reclamando estar al día cuando ya no lo está.
    'hubspot_sync_transition',   v_hs_decision
  );
END;
$function$;

COMMENT ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) IS
  'AGENT2-POST-APPROVAL-REVEAL-STALE-PRODUCER-FINAL-CUT — la 128, re-emitida para que la proyeccion del telefono revelado PRODUZCA ademas el estado durable de HubSpot. Cuerpo de la 128 byte a byte salvo CINCO splices declarados: lee contacts.mobile_phone en el paso 5, captura el SALIENTE anterior (mobile_phone ?? phone) bajo el lock y antes de la primera escritura, llama en un paso 10b a LA autoridad compartida mark_contact_hubspot_sync_stale_for_phone con procedencia reveal, y devuelve su veredicto en el sobre como hubspot_sync_transition. La transicion es ATOMICA con la proyeccion del escalar: misma transaccion, y un rollback se lleva el numero y el veredicto juntos — una segunda escritura desde la aplicacion dejaria una ventana con el telefono guardado y la ficha diciendo synced, que es el defecto que este corte elimina. La autoridad se invoca SIEMPRE y no solo cuando el paso 10 escribio, porque ella misma compara el saliente y devuelve no_outbound_change sin escribir nada: condicionarla seria una SEGUNDA respuesta a la misma pregunta. reveal es el miembro que CUT-3C declaro sin llamador y que autoriza al PATCH automatico a salir; privacy sigue siendo inexportable y esta funcion no puede escribirlo. Solo phone_changed es alcanzable desde aqui: el paso 10 exige escalar NULL bajo el lock y principal recien insertado con normalized_phone NO NULO, asi que VALOR->VALOR y VALOR->NULL son imposibles y phone_removed no puede derivarse. NUNCA toca mobile_phone (4O-E4.1) y NUNCA escribe phone_confidence. NO llama a HubSpot, NO alcanza ninguna red (ni http, ni pg_net, ni net.), NO llama a ningun proveedor, NO reserva ni gasta un credito y NO escribe usage log, reserva ni corrida. Todo lo demas de la 128 se conserva intacto: el lock candidato -> contacto -> telefonos, la revalidacion de approved bajo el lock, el guard IDOR contra matched_contacts_id, la re-comprobacion de supresion POR PERSONA, el rechazo de la forma legacy escalar-con-coleccion-vacia, la eleccion de principal solo cuando el contacto no tenia, y el sobre sin PII.';

-- ═══════════════════════════════════════════════════════════════════
-- Privilegios: se RE-EMITEN, no se asumen
-- ═══════════════════════════════════════════════════════════════════
--
-- `CREATE OR REPLACE` conserva los privilegios existentes, así que estas cuatro sentencias son
-- redundantes cuando la 128 ya está aplicada. Se re-emiten porque este archivo tiene que ser
-- correcto TAMBIÉN cuando se aplica sobre una base donde la 128 no llegó a aplicarse: en ese caso
-- `CREATE OR REPLACE` crea la función desde cero y PostgreSQL le concede EXECUTE a PUBLIC. Una
-- función que ESCRIBE sobre un contacto oficial alcanzable con la clave anon es el defecto, con
-- independencia de que RLS rechazara después cada sentencia. Mismo patrón de cuatro sentencias que
-- 112, 113, 115, 116, 117 y la 128.

REVOKE ALL ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) FROM anon;

REVOKE ALL ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) TO postgres, service_role;
