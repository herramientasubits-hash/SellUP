-- ============================================================================
-- Migration 152: AGENT1-CLAIMS-IDENTITY-DOMAIN-CROSSCHECK-1 — «una empresa, un
-- vendedor» también cuando un vendedor la tiene por NIT y otro por dominio.
-- ============================================================================
--
-- APPLIED IN PRODUCTION: NO. (Este encabezado se escribe al autorar el PR y NO es
-- evidencia: comprobar siempre contra Producción por el MCP numerado antes de
-- decidir nada. Ver reference_migration_applied_header_is_not_evidence.)
--
-- Depende de 140 (agent1_company_identity_claims, claim_company_identities) y de
-- 142 (agent1_bank_deposit). No hay redefiniciones posteriores de ninguna de las
-- dos funciones antes de esta migración.
--
--
-- QUÉ CIERRA, DICHO COMO DEFECTO
-- ------------------------------
--
-- 1. 🔴 La 140 reclama la identidad fiscal SI la hay y, SI NO, el dominio. Con el
--    índice único (claim_type, claim_key):
--
--        Vendedor A (Apollo, sin NIT)          → reclama domain:acme.com.co
--        Vendedor B (Tavily/Claude, con NIT)   → reclama fiscal:CO:900123456
--
--    Dos claves distintas: el índice no ve nada y la MISMA empresa queda para los
--    dos. El depósito del banco (142) tenía el mismo hueco.
--
--    Ahora cada reclamo guarda el dominio y el LinkedIn de IDENTIDAD de su
--    candidato (`identity_domain`, `identity_linkedin`), los mande o no como
--    reclamo exclusivo. Bajo un cerrojo transaccional POR SEÑAL, un reclamo ACTIVO
--    de OTRO candidato con el mismo dominio/LinkedIn es choque — SALVO que los dos
--    tengan identidad fiscal y sea DISTINTA (filiales del mismo grupo con NIT
--    propio: TIER 0, global-identity-claims.ts). El índice único sigue siendo la
--    garantía de lo exclusivo; el cruce es lo que el índice no puede expresar
--    (una excepción que depende de otra fila).
--
-- 2. Un candidato que vuelve a reclamar (el rescate devuelve el id en
--    `idempotent` y reclama otra vez; una promoción de NIT re-reclama la fila)
--    chocaba con SU PROPIO reclamo activo: `unique_violation` contra sí mismo y la
--    fila válida acababa `duplicate`. Un reclamo activo del MISMO candidato cuenta
--    ahora como ya reclamado.
--
-- 3. Un lote ARCHIVADO conservaba sus reclamos para siempre: la empresa quedaba
--    apartada sin que nadie la viera. Al archivar (archived_at NULL → no-NULL) se
--    liberan los reclamos activos de sus candidatos que NO pasaron a cuenta.
--
-- 4. La perdedora de una carrera quedaba `duplicate` + `exact_duplicate` igual que
--    una empresa que ya existe en SellUp/HubSpot, y la regla 3 de novedad la
--    saltaba para siempre aunque la ganadora la descartara después. La marca
--    `metadata.global_identity_claim_conflict` (que ya existía) gana el campo
--    `signal`; `buildNoveltyIndex` mira si el dueño SIGUE teniendo reclamos activos
--    y, si no, la regla 3 ya no la cuenta. `duplicate_status` NO cambia de
--    vocabulario (lo leen muchas pantallas y la CHECK de 040).
--
--
-- COMPATIBILIDAD HACIA ATRÁS
-- --------------------------
--
--   · `claim_company_identities(jsonb)` conserva su firma: los campos nuevos
--     (`identityDomain`, `identityLinkedIn`) son OPCIONALES dentro de cada
--     candidato. Un llamador anterior a esta migración sigue funcionando; para él
--     el dominio de identidad cae al de su reclamo `domain`, si lo trae.
--   · `agent1_bank_deposit(jsonb)` igual: firma intacta, `identityDomain` /
--     `identityLinkedIn` opcionales con la misma caída.
--   · Los reclamos ya guardados no se reescriben: sólo se RELLENA `identity_domain`
--     de los reclamos fiscales activos (abajo, § 1b) para que el cruce los vea.
--   · El resultado de la función gana claves, no pierde ninguna.
--
--
-- LO QUE ESTA MIGRACIÓN NO ES
-- ---------------------------
--
-- 🔴 Sigue sin ser una autoridad de identidad: el dominio y el LinkedIn llegan YA
-- normalizados por TypeScript (`normalizeIdentityDomain`, `normalizeLinkedinUrl`).
-- La única normalización en SQL es el relleno ÚNICO de § 1b sobre filas ya
-- guardadas, documentado allí.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Columnas de cruce
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.agent1_company_identity_claims
  ADD COLUMN IF NOT EXISTS identity_domain text NULL;

ALTER TABLE public.agent1_company_identity_claims
  ADD COLUMN IF NOT EXISTS identity_linkedin text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agent1_company_identity_claims_identity_domain_not_blank'
  ) THEN
    ALTER TABLE public.agent1_company_identity_claims
      ADD CONSTRAINT agent1_company_identity_claims_identity_domain_not_blank
      CHECK (identity_domain IS NULL OR btrim(identity_domain) <> '');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agent1_company_identity_claims_identity_linkedin_not_blank'
  ) THEN
    ALTER TABLE public.agent1_company_identity_claims
      ADD CONSTRAINT agent1_company_identity_claims_identity_linkedin_not_blank
      CHECK (identity_linkedin IS NULL OR btrim(identity_linkedin) <> '');
  END IF;
END $$;

-- El cruce busca «reclamos activos con este dominio/LinkedIn»; sin índice sería
-- un recorrido de la tabla por candidato.
CREATE INDEX IF NOT EXISTS agent1_company_identity_claims_active_identity_domain_idx
  ON public.agent1_company_identity_claims (identity_domain)
  WHERE released_at IS NULL AND identity_domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent1_company_identity_claims_active_identity_linkedin_idx
  ON public.agent1_company_identity_claims (identity_linkedin)
  WHERE released_at IS NULL AND identity_linkedin IS NOT NULL;

-- El disparador de archivo (§ 4) libera por lote.
CREATE INDEX IF NOT EXISTS agent1_company_identity_claims_active_batch_idx
  ON public.agent1_company_identity_claims (batch_id)
  WHERE released_at IS NULL;

COMMENT ON COLUMN public.agent1_company_identity_claims.identity_domain IS
  'AGENT1-CLAIMS-IDENTITY-DOMAIN-CROSSCHECK-1 (152) — dominio de IDENTIDAD del candidato dueño (normalizeIdentityDomain), lo haya reclamado en exclusiva o no. Señal de cruce: un reclamo activo de otro candidato con el mismo dominio es choque salvo identidad fiscal distinta en los dos.';

COMMENT ON COLUMN public.agent1_company_identity_claims.identity_linkedin IS
  'AGENT1-CLAIMS-IDENTITY-DOMAIN-CROSSCHECK-1 (152) — LinkedIn de empresa del candidato dueño. Misma regla de cruce que identity_domain.';

-- ─── 1b. Relleno ÚNICO de los reclamos fiscales activos ─────────────────────────
--
-- Un candidato con NIT reclamó `fiscal` y NO el dominio (140): sin este relleno
-- el cruce no lo vería y el hueco seguiría abierto para todo lo ya reclamado.
--
-- Es la ÚNICA normalización de dominio en SQL y es deliberadamente MÁS estrecha
-- que la de TypeScript: minúsculas, sin `www`/`wwwN`/`wwN`, con forma de host, y
-- fuera los hosts compartidos de `shared-hosts.ts` (copia CONGELADA para este
-- relleno, no una segunda lista viva). Lo que no encaja se queda NULL: un relleno
-- de menos sólo deja ese reclamo como estaba antes de la 152; uno de más crearía
-- choques falsos. Idempotente (`identity_domain IS NULL`).
UPDATE public.agent1_company_identity_claims c
   SET identity_domain = src.dom
  FROM (
    SELECT pc.id AS candidate_id,
           regexp_replace(lower(btrim(pc.domain)), '^(www[0-9]*|ww[0-9]+)\.', '') AS dom
      FROM public.prospect_candidates pc
     WHERE pc.domain IS NOT NULL
  ) src
 WHERE c.candidate_id = src.candidate_id
   AND c.claim_type = 'fiscal'
   AND c.released_at IS NULL
   AND c.identity_domain IS NULL
   AND src.dom ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
   AND NOT EXISTS (
     SELECT 1
       FROM unnest(ARRAY[
         'facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
         'youtube.com', 'youtu.be', 'linkedin.com', 'lnkd.in', 'whatsapp.com', 'wa.me', 'wa.link',
         'pinterest.com', 'threads.net', 't.me', 'telegram.me',
         'bit.ly', 'tinyurl.com', 'goo.gl', 'ow.ly', 'linktr.ee', 'linkin.bio', 'beacons.ai',
         'google.com', 'business.site', 'negocio.site', 'g.page',
         'blogspot.com', 'blogger.com', 'wordpress.com', 'wixsite.com', 'wix.com', 'weebly.com',
         'jimdo.com', 'jimdofree.com', 'site123.me', 'webnode.com', 'webnode.es', 'godaddysites.com',
         'carrd.co', 'es.tl', 'square.site', 'mystrikingly.com', 'strikingly.com',
         'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com',
         'icloud.com'
       ]) AS shared(host)
      WHERE src.dom = shared.host OR src.dom LIKE '%.' || shared.host
   )
   -- AUDIT-HARDENING-1 — el portal nacional del Estado aloja a todos los
   -- ministerios como rutas (`gob.pe/minsa`): no es la identidad de ninguno
   -- (`national-portal-entity.ts`). Coincidencia EXACTA: `minsa.gob.pe` sí vale.
   AND src.dom NOT IN ('gob.pe', 'gob.mx', 'argentina.gob.ar', 'gub.uy', 'gob.ec');

-- ═══════════════════════════════════════════════════════════════════
-- 2. Cruce: ¿otro candidato activo tiene ya este dominio / LinkedIn?
-- ═══════════════════════════════════════════════════════════════════
--
-- Devuelve el PRIMER dueño que choca (o nada). Un dueño NO choca cuando los dos
-- lados tienen identidad fiscal y es distinta: filiales del mismo grupo.
--
-- Un reclamo anterior a esta migración no tiene `identity_domain` /
-- `identity_linkedin`: para él cuenta su propio reclamo exclusivo `domain` /
-- `linkedin` con la misma clave (y el relleno de § 1b para los fiscales).
--
-- SECURITY INVOKER: corre con el rol del llamador (service_role en la práctica),
-- igual que claim_company_identities.

CREATE OR REPLACE FUNCTION public.agent1_identity_crosscheck_holder(
  p_candidate_id      uuid,
  p_fiscal_key        text,
  p_identity_domain   text,
  p_identity_linkedin text
)
RETURNS TABLE (holder_candidate_id uuid, holder_batch_id uuid, signal text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT c.candidate_id, c.batch_id, s.signal
    FROM (VALUES
      ('identity_domain', NULLIF(btrim(p_identity_domain), '')),
      ('identity_linkedin', NULLIF(btrim(p_identity_linkedin), ''))
    ) AS s(signal, value)
    JOIN public.agent1_company_identity_claims c
      ON c.released_at IS NULL
     AND s.value IS NOT NULL
     AND (
       (s.signal = 'identity_domain'
         AND (c.identity_domain = s.value OR (c.claim_type = 'domain' AND c.claim_key = s.value)))
       OR (s.signal = 'identity_linkedin'
         AND (c.identity_linkedin = s.value OR (c.claim_type = 'linkedin' AND c.claim_key = s.value)))
     )
   WHERE (p_candidate_id IS NULL OR c.candidate_id <> p_candidate_id)
     -- La excepción TIER 0: los dos con fiscal, y distinta.
     AND NOT (
       NULLIF(btrim(p_fiscal_key), '') IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM public.agent1_company_identity_claims f
          WHERE f.candidate_id = c.candidate_id
            AND f.claim_type = 'fiscal'
            AND f.released_at IS NULL
            AND f.claim_key <> btrim(p_fiscal_key)
       )
     )
   ORDER BY c.claimed_at, c.id
   LIMIT 1;
$fn$;

COMMENT ON FUNCTION public.agent1_identity_crosscheck_holder(uuid, text, text, text) IS
  'AGENT1-CLAIMS-IDENTITY-DOMAIN-CROSSCHECK-1 (152) — primer reclamo ACTIVO de otro candidato con el mismo dominio/LinkedIn de identidad, salvo identidad fiscal distinta en los dos lados (TIER 0). Sólo lectura; el llamador toma antes el cerrojo de la señal.';

-- ═══════════════════════════════════════════════════════════════════
-- 3. Cerrojos por señal, en orden total
-- ═══════════════════════════════════════════════════════════════════
--
-- Dos transacciones que reclaman el mismo dominio se SERIALIZAN: la segunda
-- espera a que la primera confirme y su consulta de cruce ya ve los reclamos de
-- la primera (READ COMMITTED: cada sentencia toma una foto nueva).
--
-- Se toman TODOS los cerrojos de la llamada al principio y ordenados por su clave
-- numérica: una llamada con varios candidatos acumula cerrojos, y tomarlos en el
-- orden de llegada permitiría que dos llamadas se esperaran en cruz.

CREATE OR REPLACE FUNCTION public.agent1_identity_crosscheck_lock(p_signals text[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_key bigint;
BEGIN
  FOR v_key IN
    SELECT DISTINCT hashtextextended('agent1_identity_claim:' || s, 0)
      FROM unnest(COALESCE(p_signals, '{}'::text[])) AS s
     WHERE s IS NOT NULL AND btrim(s) <> ''
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_key);
  END LOOP;
END;
$fn$;

COMMENT ON FUNCTION public.agent1_identity_crosscheck_lock(text[]) IS
  'AGENT1-CLAIMS-IDENTITY-DOMAIN-CROSSCHECK-1 (152) — toma, en orden total por clave, los cerrojos transaccionales de las señales de cruce (dom:<dominio>, li:<linkedin>). Se liberan solos al terminar la transacción.';

-- ═══════════════════════════════════════════════════════════════════
-- 4. claim_company_identities — misma firma, cruce + reclamo propio
-- ═══════════════════════════════════════════════════════════════════
--
-- Por candidato, en un bloque con SAVEPOINT implícito (igual que 140):
--   1. cruce por dominio/LinkedIn de identidad (§ 2) → choque ⇒ perdedora;
--   2. cada reclamo exclusivo: si ESTE candidato ya lo tiene activo, se salta
--      (antes chocaba consigo mismo); si no, se inserta — `unique_violation` ⇒
--      perdedora;
--   3. la perdedora no persiste NINGUNO de sus reclamos nuevos y queda
--      `duplicate` + `exact_duplicate` con `metadata.global_identity_claim_conflict`
--      (ahora con `signal`).

CREATE OR REPLACE FUNCTION public.claim_company_identities(
  p_candidates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_candidate         jsonb;
  v_claim             jsonb;
  v_candidate_id      uuid;
  v_batch_id          uuid;
  v_now               timestamptz := clock_timestamp();
  v_fiscal            text;
  v_identity_domain   text;
  v_identity_linkedin text;
  v_holder_candidate  uuid;
  v_holder_batch      uuid;
  v_signal            text;
  v_cross             record;
  v_signals           text[] := '{}'::text[];
  v_claimed_ids       jsonb := '[]'::jsonb;
  v_conflicted        jsonb := '[]'::jsonb;
BEGIN
  IF p_candidates IS NULL OR jsonb_typeof(p_candidates) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  -- Cerrojos de TODA la llamada, antes de tocar nada (§ 3).
  SELECT COALESCE(array_agg(sig), '{}'::text[])
    INTO v_signals
    FROM (
      SELECT 'dom:' || COALESCE(
               NULLIF(btrim(e->>'identityDomain'), ''),
               (SELECT NULLIF(btrim(cl->>'key'), '')
                  FROM jsonb_array_elements(COALESCE(e->'claims', '[]'::jsonb)) cl
                 WHERE cl->>'type' = 'domain' LIMIT 1)
             ) AS sig
        FROM jsonb_array_elements(p_candidates) e
      UNION ALL
      SELECT 'li:' || COALESCE(
               NULLIF(btrim(e->>'identityLinkedIn'), ''),
               (SELECT NULLIF(btrim(cl->>'key'), '')
                  FROM jsonb_array_elements(COALESCE(e->'claims', '[]'::jsonb)) cl
                 WHERE cl->>'type' = 'linkedin' LIMIT 1)
             )
        FROM jsonb_array_elements(p_candidates) e
    ) s
   WHERE sig IS NOT NULL;
  PERFORM public.agent1_identity_crosscheck_lock(v_signals);

  FOR v_candidate IN SELECT * FROM jsonb_array_elements(p_candidates)
  LOOP
    v_candidate_id := (v_candidate->>'candidateId')::uuid;
    v_batch_id := (v_candidate->>'batchId')::uuid;

    IF v_candidate_id IS NULL OR v_batch_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Candidato sin ninguna señal fuerte: nada que reclamar, nada que chocar.
    IF v_candidate->'claims' IS NULL OR jsonb_array_length(v_candidate->'claims') = 0 THEN
      CONTINUE;
    END IF;

    v_fiscal := NULL;
    v_identity_domain := NULLIF(btrim(v_candidate->>'identityDomain'), '');
    v_identity_linkedin := NULLIF(btrim(v_candidate->>'identityLinkedIn'), '');
    v_holder_candidate := NULL;
    v_holder_batch := NULL;
    v_signal := NULL;

    FOR v_claim IN SELECT * FROM jsonb_array_elements(v_candidate->'claims')
    LOOP
      IF v_claim->>'type' = 'fiscal' THEN
        v_fiscal := NULLIF(btrim(v_claim->>'key'), '');
      ELSIF v_claim->>'type' = 'domain' AND v_identity_domain IS NULL THEN
        v_identity_domain := NULLIF(btrim(v_claim->>'key'), '');
      ELSIF v_claim->>'type' = 'linkedin' AND v_identity_linkedin IS NULL THEN
        v_identity_linkedin := NULLIF(btrim(v_claim->>'key'), '');
      END IF;
    END LOOP;

    BEGIN
      SELECT * INTO v_cross
        FROM public.agent1_identity_crosscheck_holder(
          v_candidate_id, v_fiscal, v_identity_domain, v_identity_linkedin
        );
      IF FOUND THEN
        v_holder_candidate := v_cross.holder_candidate_id;
        v_holder_batch := v_cross.holder_batch_id;
        v_signal := v_cross.signal;
        RAISE EXCEPTION 'agent1 identity crosscheck conflict' USING ERRCODE = 'unique_violation';
      END IF;

      FOR v_claim IN SELECT * FROM jsonb_array_elements(v_candidate->'claims')
      LOOP
        -- Su propio reclamo activo ya cuenta: volver a reclamar no es un choque.
        IF EXISTS (
          SELECT 1
            FROM public.agent1_company_identity_claims own
           WHERE own.claim_type = v_claim->>'type'
             AND own.claim_key = v_claim->>'key'
             AND own.candidate_id = v_candidate_id
             AND own.released_at IS NULL
        ) THEN
          CONTINUE;
        END IF;

        INSERT INTO public.agent1_company_identity_claims
          (claim_type, claim_key, candidate_id, batch_id, claimed_at,
           identity_domain, identity_linkedin)
        VALUES (
          v_claim->>'type',
          v_claim->>'key',
          v_candidate_id,
          v_batch_id,
          v_now,
          v_identity_domain,
          v_identity_linkedin
        );
      END LOOP;

      v_claimed_ids := v_claimed_ids || jsonb_build_array(v_candidate_id);

    EXCEPTION WHEN unique_violation THEN
      -- Lo que este candidato alcanzó a insertar en el bloque se deshace solo
      -- (SAVEPOINT implícito). Sus reclamos ANTERIORES, si los tenía, no se tocan
      -- aquí: los libera el disparador de 140 al pasar a `duplicate`.
      IF v_holder_candidate IS NULL THEN
        SELECT c.candidate_id, c.batch_id
          INTO v_holder_candidate, v_holder_batch
          FROM public.agent1_company_identity_claims c
          JOIN jsonb_array_elements(v_candidate->'claims') claim
            ON c.claim_type = claim->>'type' AND c.claim_key = claim->>'key'
         WHERE c.released_at IS NULL
           AND c.candidate_id <> v_candidate_id
         LIMIT 1;
        v_signal := 'exclusive_claim';
      END IF;

      UPDATE public.prospect_candidates
         SET status = 'duplicate',
             duplicate_status = 'exact_duplicate',
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
               'global_identity_claim_conflict', jsonb_build_object(
                 'held_by_candidate_id', v_holder_candidate,
                 'held_by_batch_id', v_holder_batch,
                 'signal', v_signal,
                 'detected_at', v_now
               )
             )
       WHERE id = v_candidate_id;

      v_conflicted := v_conflicted || jsonb_build_array(v_candidate_id);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ok',
    'claimed_candidate_ids', v_claimed_ids,
    'claimed_elsewhere_candidate_ids', v_conflicted
  );
END;
$fn$;

COMMENT ON FUNCTION public.claim_company_identities(jsonb) IS
  'AGENT1-GLOBAL-COMPANY-IDENTITY-CLAIMS-1 + AGENT1-CLAIMS-IDENTITY-DOMAIN-CROSSCHECK-1 (152). Reclama, por candidato ya insertado, las señales que TypeScript decidió; además cruza el dominio/LinkedIn de identidad (identityDomain/identityLinkedIn, opcionales) contra los reclamos activos de otros candidatos bajo cerrojo, con la excepción de identidad fiscal distinta en los dos lados. Un reclamo activo del MISMO candidato cuenta como ya reclamado. Un choque revierte SOLO los reclamos nuevos de ese candidato y lo marca duplicate (metadata.global_identity_claim_conflict con signal). No contiene política de identidad.';

-- ═══════════════════════════════════════════════════════════════════
-- 5. agent1_bank_deposit — misma firma, mismo cruce
-- ═══════════════════════════════════════════════════════════════════
--
-- Idéntica a la 142 salvo el «¿ya es de alguien?»: además de las claves
-- exclusivas, un reclamo activo con el mismo dominio/LinkedIn de identidad (sin
-- la excepción de fiscal distinta) deja la empresa fuera del banco.

CREATE OR REPLACE FUNCTION public.agent1_bank_deposit(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_item              jsonb;
  v_claim             jsonb;
  v_fiscal            text;
  v_domain            text;
  v_provider_entity   text;
  v_linkedin          text;
  v_identity_domain   text;
  v_identity_linkedin text;
  v_signals           text[] := '{}'::text[];
  v_now               timestamptz := clock_timestamp();
  v_ttl_days          int;
  v_missing           text[];
  v_deposited         int := 0;
  v_skipped_claimed   int := 0;
  v_skipped_in_bank   int := 0;
  v_skipped_invalid   int := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  -- Mismos cerrojos que el reclamo: un depósito y un reclamo de la misma empresa
  -- no se cruzan sin verse.
  SELECT COALESCE(array_agg(sig), '{}'::text[])
    INTO v_signals
    FROM (
      SELECT 'dom:' || COALESCE(
               NULLIF(btrim(e->>'identityDomain'), ''),
               (SELECT NULLIF(btrim(cl->>'key'), '')
                  FROM jsonb_array_elements(COALESCE(e->'claims', '[]'::jsonb)) cl
                 WHERE cl->>'type' = 'domain' LIMIT 1)
             ) AS sig
        FROM jsonb_array_elements(p_items) e
      UNION ALL
      SELECT 'li:' || COALESCE(
               NULLIF(btrim(e->>'identityLinkedIn'), ''),
               (SELECT NULLIF(btrim(cl->>'key'), '')
                  FROM jsonb_array_elements(COALESCE(e->'claims', '[]'::jsonb)) cl
                 WHERE cl->>'type' = 'linkedin' LIMIT 1)
             )
        FROM jsonb_array_elements(p_items) e
    ) s
   WHERE sig IS NOT NULL;
  PERFORM public.agent1_identity_crosscheck_lock(v_signals);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_fiscal := NULL;
      v_domain := NULL;
      v_provider_entity := NULL;
      v_linkedin := NULL;

      FOR v_claim IN SELECT * FROM jsonb_array_elements(COALESCE(v_item->'claims', '[]'::jsonb))
      LOOP
        CASE v_claim->>'type'
          WHEN 'fiscal'          THEN v_fiscal := NULLIF(btrim(v_claim->>'key'), '');
          WHEN 'domain'          THEN v_domain := NULLIF(btrim(v_claim->>'key'), '');
          WHEN 'provider_entity' THEN v_provider_entity := NULLIF(btrim(v_claim->>'key'), '');
          WHEN 'linkedin'        THEN v_linkedin := NULLIF(btrim(v_claim->>'key'), '');
          ELSE NULL;
        END CASE;
      END LOOP;

      v_identity_domain := COALESCE(NULLIF(btrim(v_item->>'identityDomain'), ''), v_domain);
      v_identity_linkedin := COALESCE(NULLIF(btrim(v_item->>'identityLinkedIn'), ''), v_linkedin);

      -- Ya es de alguien: no entra al banco.
      IF EXISTS (
        SELECT 1
          FROM public.agent1_company_identity_claims c
         WHERE c.released_at IS NULL
           AND (
             (c.claim_type = 'fiscal'          AND c.claim_key = v_fiscal)
             OR (c.claim_type = 'domain'       AND c.claim_key = v_domain)
             OR (c.claim_type = 'provider_entity' AND c.claim_key = v_provider_entity)
             OR (c.claim_type = 'linkedin'     AND c.claim_key = v_linkedin)
           )
      ) OR EXISTS (
        SELECT 1
          FROM public.agent1_identity_crosscheck_holder(
            NULL, v_fiscal, v_identity_domain, v_identity_linkedin
          )
      ) THEN
        v_skipped_claimed := v_skipped_claimed + 1;
        CONTINUE;
      END IF;

      v_ttl_days := LEAST(GREATEST(COALESCE((v_item->>'ttlDays')::int, 60), 1), 180);

      SELECT COALESCE(array_agg(m), '{}'::text[])
        INTO v_missing
        FROM jsonb_array_elements_text(COALESCE(v_item->'missingFields', '[]'::jsonb)) AS m;

      INSERT INTO public.agent1_company_bank (
        country_code, macro_industry_key, tier, source_provider,
        claim_fiscal, claim_domain, claim_provider_entity, claim_linkedin,
        payload, missing_fields, source_batch_id, banked_at, expires_at
      ) VALUES (
        v_item->>'countryCode',
        v_item->>'macroIndustryKey',
        v_item->>'tier',
        v_item->>'sourceProvider',
        v_fiscal, v_domain, v_provider_entity, v_linkedin,
        v_item->'payload',
        v_missing,
        NULLIF(v_item->>'sourceBatchId', '')::uuid,
        v_now,
        v_now + make_interval(days => v_ttl_days)
      );

      v_deposited := v_deposited + 1;
    EXCEPTION
      WHEN unique_violation THEN
        v_skipped_in_bank := v_skipped_in_bank + 1;
      WHEN check_violation OR not_null_violation OR invalid_text_representation
           OR foreign_key_violation OR numeric_value_out_of_range THEN
        v_skipped_invalid := v_skipped_invalid + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ok',
    'deposited', v_deposited,
    'skipped_claimed', v_skipped_claimed,
    'skipped_in_bank', v_skipped_in_bank,
    'skipped_invalid', v_skipped_invalid
  );
END;
$fn$;

COMMENT ON FUNCTION public.agent1_bank_deposit(jsonb) IS
  'AGENT1-COMPANY-BANK-FOUNDATION-1 + AGENT1-CLAIMS-IDENTITY-DOMAIN-CROSSCHECK-1 (152) — deposita empresas sin dueno. Salta (y cuenta) las que ya tienen un reclamo global activo (por clave exclusiva o por el cruce de dominio/LinkedIn de identidad), las que ya estan en el banco y las invalidas; nunca lanza por un elemento.';

-- ═══════════════════════════════════════════════════════════════════
-- 6. Lote archivado ⇒ sus reclamos se liberan
-- ═══════════════════════════════════════════════════════════════════
--
-- 🔴 SECURITY DEFINER por la misma razón que el disparador de 140: se archiva con
-- el cliente de SESIÓN (`archiveProspectBatch`, rol `authenticated`) y la tabla de
-- reclamos sólo tiene política para `service_role`; en INVOKER el UPDATE afectaría
-- 0 filas SIN error. Sólo toca reclamos de ESE lote y sólo para liberarlos.
--
-- Lo que ya pasó a cuenta (`converted_to_account`) conserva su reclamo: es una
-- empresa de SellUp, no una propuesta abandonada. Desarchivar NO vuelve a
-- reclamar (igual que 140 con un candidato que vuelve a un estado vivo).

CREATE OR REPLACE FUNCTION public.agent1_release_claims_of_archived_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    UPDATE public.agent1_company_identity_claims c
       SET released_at = now()
     WHERE c.batch_id = NEW.id
       AND c.released_at IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.prospect_candidates pc
          WHERE pc.id = c.candidate_id
            AND pc.status = 'converted_to_account'
       );
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.agent1_release_claims_of_archived_batch() IS
  'AGENT1-CLAIMS-IDENTITY-DOMAIN-CROSSCHECK-1 (152) — al archivar un lote (archived_at NULL → no-NULL) libera los reclamos globales activos de sus candidatos que no pasaron a cuenta. Disparador, no llamada: ningún camino de archivo puede olvidarlo.';

DROP TRIGGER IF EXISTS agent1_release_claims_of_archived_batch_trigger
  ON public.prospect_batches;

CREATE TRIGGER agent1_release_claims_of_archived_batch_trigger
  AFTER UPDATE OF archived_at ON public.prospect_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.agent1_release_claims_of_archived_batch();

-- ═══════════════════════════════════════════════════════════════════
-- 7. GRANTS — estado final declarativo
-- ═══════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.agent1_release_claims_of_archived_batch() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent1_release_claims_of_archived_batch() FROM anon, authenticated, service_role;

-- Los ayudantes del reclamo siguen exactamente los permisos de la función que los
-- usa (140 § 4): service_role y authenticated, nunca anon ni PUBLIC.
REVOKE ALL ON FUNCTION public.agent1_identity_crosscheck_holder(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent1_identity_crosscheck_holder(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.agent1_identity_crosscheck_holder(uuid, text, text, text)
  TO postgres, authenticated, service_role;

REVOKE ALL ON FUNCTION public.agent1_identity_crosscheck_lock(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent1_identity_crosscheck_lock(text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.agent1_identity_crosscheck_lock(text[])
  TO postgres, authenticated, service_role;

REVOKE ALL ON FUNCTION public.claim_company_identities(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_company_identities(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_company_identities(jsonb)
  TO postgres, authenticated, service_role;

-- El banco sigue siendo sólo de service_role (142).
REVOKE ALL ON FUNCTION public.agent1_bank_deposit(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.agent1_bank_deposit(jsonb) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.agent1_bank_deposit(jsonb) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.agent1_bank_deposit(jsonb) TO service_role';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 8. Recarga explícita de la caché de esquema de PostgREST
-- ═══════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';
