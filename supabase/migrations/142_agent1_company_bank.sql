-- 142_agent1_company_bank.sql
--
-- AGENT1-COMPANY-BANK-FOUNDATION-1 — el BANCO de empresas del Agente 1.
--
-- APPLIED IN PRODUCTION: NO. (Este encabezado se escribe al autorar el PR y NO es
-- evidencia: comprobar siempre contra Produccion por el MCP numerado. Ver
-- docs/agent1/COMPANY_BANK_DESIGN.md y feedback sobre cabeceras que mienten.)
--
-- Que es: la empresa que un proveedor de pago (o una fuente) ya encontro y que
-- NO se entrego a ningun vendedor queda aqui, SIN dueno, para que la siguiente
-- busqueda del mismo pais x macro industria la tome ANTES de volver a pagar.
--
-- Por que una tabla aparte y no `prospect_candidates` con otro status:
--   * un candidato `needs_review` es VISIBLE para todos (listas, KPIs, cola de
--     revision) y BLOQUEA a los demas (reclamo global, novedad, exclusion de
--     Apollo, memoria negativa). Un banco dentro de esa tabla se bloquearia a si
--     mismo y se filtraria a pantalla;
--   * `prospect_candidates.batch_id` es NOT NULL: no existe «candidato sin lote»;
--   * la macro industria no es una columna tipada del candidato.
--
-- Invariantes:
--   * Una empresa SIN dueno NO ocupa reclamos globales (agent1_company_identity_claims):
--     el reclamo se hace al ASIGNAR, con el candidato ya dentro del lote del vendedor.
--   * Una empresa que hoy tiene un reclamo activo NO entra al banco (ya es de alguien).
--   * Cada senal de identidad es unica entre las filas ACTIVAS (banked/reserved):
--     la misma empresa no puede estar dos veces en el banco. Mismas claves que los
--     reclamos globales (fiscal / domain / provider_entity / linkedin).
--   * Caducidad: toda fila lleva `expires_at`. Una fila caducada NO se entrega; se
--     marca `expired` de forma perezosa al sacar (sin cron: el plan de Vercel solo
--     admite dos).
--   * Reserva con plazo: sacar = `reserved` por `reserved_until`; si el proceso muere,
--     la fila vuelve a ser elegible sola (sin limpieza manual).
--   * Solo `service_role`. Ningun vendedor lee ni escribe el banco.
--
-- Esta migracion NO se conecta a nada: no cambia ninguna funcion ni tabla existente.
-- Sin migraciones previas que alterar; depende de `prospect_batches`,
-- `prospect_candidates` (FK, ON DELETE SET NULL) y de la 140 (consulta de reclamos).

CREATE TABLE IF NOT EXISTS public.agent1_company_bank (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  country_code             text        NOT NULL
    CONSTRAINT agent1_company_bank_country_check
    CHECK (country_code ~ '^[A-Z]{2}$'),

  -- La clave canonica de la macro industria (`resolveMacroIndustryKey`). Abierta a
  -- proposito (el catalogo macro crece por migracion de catalogo, no por esta tabla);
  -- el formato si se valida.
  macro_industry_key       text        NOT NULL
    CONSTRAINT agent1_company_bank_macro_check
    CHECK (macro_industry_key ~ '^[a-z][a-z0-9_]{1,63}$'),

  -- 'ready' = completa y aceptable para el objetivo; 'to_complete' = le falta algun
  -- dato (tamano, industria, LinkedIn...) y completarla puede costar creditos.
  tier                     text        NOT NULL
    CONSTRAINT agent1_company_bank_tier_check
    CHECK (tier IN ('ready', 'to_complete')),

  status                   text        NOT NULL DEFAULT 'banked'
    CONSTRAINT agent1_company_bank_status_check
    CHECK (status IN ('banked', 'reserved', 'assigned', 'expired', 'invalidated')),

  -- Quien la encontro. Vocabulario CERRADO: una fuente nueva llega con su migracion.
  source_provider          text        NOT NULL
    CONSTRAINT agent1_company_bank_source_provider_check
    CHECK (source_provider IN ('apollo', 'lusha', 'tavily', 'free_source')),

  -- Senales de identidad: EXACTAMENTE las claves de los reclamos globales (140), para
  -- que el banco y los reclamos hablen el mismo idioma. Al menos una.
  claim_fiscal             text        NULL
    CONSTRAINT agent1_company_bank_fiscal_not_blank
    CHECK (claim_fiscal IS NULL OR btrim(claim_fiscal) <> ''),
  claim_domain             text        NULL
    CONSTRAINT agent1_company_bank_domain_not_blank
    CHECK (claim_domain IS NULL OR btrim(claim_domain) <> ''),
  claim_provider_entity    text        NULL
    CONSTRAINT agent1_company_bank_provider_entity_not_blank
    CHECK (claim_provider_entity IS NULL OR btrim(claim_provider_entity) <> ''),
  claim_linkedin           text        NULL
    CONSTRAINT agent1_company_bank_linkedin_not_blank
    CHECK (claim_linkedin IS NULL OR btrim(claim_linkedin) <> ''),

  CONSTRAINT agent1_company_bank_identity_signal_present
    CHECK (
      claim_fiscal IS NOT NULL
      OR claim_domain IS NOT NULL
      OR claim_provider_entity IS NOT NULL
      OR claim_linkedin IS NOT NULL
    ),

  -- Lo necesario para reconstruir el candidato (nombre, sitio, tamano, industria,
  -- rastro de proveniencia, banderas). Acotado: un banco sin tope de fila no escala.
  payload                  jsonb       NOT NULL
    CONSTRAINT agent1_company_bank_payload_object
    CHECK (jsonb_typeof(payload) = 'object')
    CONSTRAINT agent1_company_bank_payload_size
    CHECK (pg_column_size(payload) <= 16384),

  missing_fields           text[]      NOT NULL DEFAULT '{}',

  CONSTRAINT agent1_company_bank_tier_matches_missing
    CHECK (
      (tier = 'ready' AND cardinality(missing_fields) = 0)
      OR (tier = 'to_complete' AND cardinality(missing_fields) > 0)
    ),

  source_batch_id          uuid        NULL
    REFERENCES public.prospect_batches(id) ON DELETE SET NULL,

  banked_at                timestamptz NOT NULL DEFAULT now(),
  expires_at               timestamptz NOT NULL,

  CONSTRAINT agent1_company_bank_expiry_after_deposit
    CHECK (expires_at > banked_at),

  -- Reserva de una extraccion en curso.
  draw_id                  uuid        NULL,
  reserved_until           timestamptz NULL,

  CONSTRAINT agent1_company_bank_reserved_has_draw
    CHECK (status <> 'reserved' OR (draw_id IS NOT NULL AND reserved_until IS NOT NULL)),

  -- Asignacion. batch/candidate pueden quedar NULL si despues se borran (SET NULL);
  -- `assigned_at` es la prueba durable.
  assigned_at              timestamptz NULL,
  assigned_batch_id        uuid        NULL
    REFERENCES public.prospect_batches(id) ON DELETE SET NULL,
  assigned_candidate_id    uuid        NULL
    REFERENCES public.prospect_candidates(id) ON DELETE SET NULL,

  CONSTRAINT agent1_company_bank_assigned_has_timestamp
    CHECK (status <> 'assigned' OR assigned_at IS NOT NULL),

  invalidated_reason       text        NULL,

  CONSTRAINT agent1_company_bank_invalidated_has_reason
    CHECK (status <> 'invalidated' OR (invalidated_reason IS NOT NULL AND btrim(invalidated_reason) <> ''))
);

-- Unicidad POR SENAL entre filas activas. Nunca combinada: igual que los reclamos,
-- dos senales distintas de la misma empresa son dos restricciones independientes.
CREATE UNIQUE INDEX IF NOT EXISTS agent1_company_bank_active_fiscal_key
  ON public.agent1_company_bank (claim_fiscal)
  WHERE claim_fiscal IS NOT NULL AND status IN ('banked', 'reserved');

CREATE UNIQUE INDEX IF NOT EXISTS agent1_company_bank_active_domain_key
  ON public.agent1_company_bank (claim_domain)
  WHERE claim_domain IS NOT NULL AND status IN ('banked', 'reserved');

CREATE UNIQUE INDEX IF NOT EXISTS agent1_company_bank_active_provider_entity_key
  ON public.agent1_company_bank (claim_provider_entity)
  WHERE claim_provider_entity IS NOT NULL AND status IN ('banked', 'reserved');

CREATE UNIQUE INDEX IF NOT EXISTS agent1_company_bank_active_linkedin_key
  ON public.agent1_company_bank (claim_linkedin)
  WHERE claim_linkedin IS NOT NULL AND status IN ('banked', 'reserved');

-- Camino caliente: sacar del pais x macro, primero las listas y las mas antiguas.
CREATE INDEX IF NOT EXISTS agent1_company_bank_draw_idx
  ON public.agent1_company_bank (country_code, macro_industry_key, tier, banked_at, id)
  WHERE status = 'banked';

-- Recuperar reservas cuyo proceso murio.
CREATE INDEX IF NOT EXISTS agent1_company_bank_reserved_idx
  ON public.agent1_company_bank (country_code, macro_industry_key, reserved_until)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS agent1_company_bank_draw_id_idx
  ON public.agent1_company_bank (draw_id)
  WHERE draw_id IS NOT NULL;

COMMENT ON TABLE public.agent1_company_bank IS
  'AGENT1-COMPANY-BANK-FOUNDATION-1 — empresas ya encontradas por un proveedor o fuente que NO se entregaron a ningun vendedor, sin dueno, por pais x macro industria. La siguiente busqueda las toma antes de pagar de nuevo. No es visible para vendedores, no ocupa reclamos globales hasta ASIGNARSE, caduca (expires_at) y se reserva con plazo al sacar. Service-role only.';

COMMENT ON COLUMN public.agent1_company_bank.claim_domain IS
  'Clave de reclamo `domain` EXACTA (la misma que agent1_company_identity_claims). Solo presente cuando la empresa no tiene identidad fiscal, como en deriveGlobalIdentityClaims.';

COMMENT ON COLUMN public.agent1_company_bank.payload IS
  'Campos minimos para reconstruir el candidato al asignarlo. Acotado a 16 KiB. Puede incluir el perfil comprado: ver docs/agent1/COMPANY_BANK_DESIGN.md (terminos del proveedor) ANTES de activar el deposito en Produccion.';

-- ─── Transiciones e inmutabilidad ───────────────────────────────────────────────
--
-- Se FIJA lo inmutable (como la 123) y se RECHAZA una transicion ilegal: el banco solo
-- lo escriben las funciones de abajo, y una transicion fuera del grafo es un defecto,
-- no un dato.

CREATE OR REPLACE FUNCTION public.agent1_company_bank_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  NEW.id                    := OLD.id;
  NEW.country_code          := OLD.country_code;
  NEW.macro_industry_key    := OLD.macro_industry_key;
  NEW.tier                  := OLD.tier;
  NEW.source_provider       := OLD.source_provider;
  NEW.claim_fiscal          := OLD.claim_fiscal;
  NEW.claim_domain          := OLD.claim_domain;
  NEW.claim_provider_entity := OLD.claim_provider_entity;
  NEW.claim_linkedin        := OLD.claim_linkedin;
  NEW.payload               := OLD.payload;
  NEW.missing_fields        := OLD.missing_fields;
  NEW.source_batch_id       := OLD.source_batch_id;
  NEW.banked_at             := OLD.banked_at;
  NEW.expires_at            := OLD.expires_at;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'banked'   AND NEW.status IN ('reserved', 'expired', 'invalidated'))
      OR (OLD.status = 'reserved' AND NEW.status IN ('banked', 'assigned', 'invalidated', 'expired'))
    ) THEN
      RAISE EXCEPTION 'agent1_company_bank: transicion ilegal % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status IN ('assigned', 'expired', 'invalidated') THEN
    RAISE EXCEPTION 'agent1_company_bank: la fila ya esta en un estado final (%)', OLD.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.agent1_company_bank_guard_update() IS
  'AGENT1-COMPANY-BANK-FOUNDATION-1 — fija las columnas de identidad/contenido del banco y solo permite el grafo banked -> reserved -> assigned | banked | invalidated | expired (y banked -> expired | invalidated). Los estados finales no se tocan.';

DROP TRIGGER IF EXISTS agent1_company_bank_guard_update_trg ON public.agent1_company_bank;
CREATE TRIGGER agent1_company_bank_guard_update_trg
  BEFORE UPDATE ON public.agent1_company_bank
  FOR EACH ROW EXECUTE FUNCTION public.agent1_company_bank_guard_update();

-- ─── Depositar ──────────────────────────────────────────────────────────────────
--
-- p_items: [{ countryCode, macroIndustryKey, tier, sourceProvider,
--             claims: [{type, key}], payload, missingFields: [text],
--             sourceBatchId?: uuid, ttlDays?: int }]
-- Cada elemento va en su propio sub-bloque: uno malo no tumba a los demas.
-- Devuelve contadores; NUNCA lanza por un elemento.

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
  'AGENT1-COMPANY-BANK-FOUNDATION-1 — deposita empresas sin dueno. Salta (y cuenta) las que ya tienen un reclamo global activo, las que ya estan en el banco y las invalidas; nunca lanza por un elemento.';

-- ─── Sacar ──────────────────────────────────────────────────────────────────────
--
-- Reserva hasta p_limit empresas del pais x macro, las mas antiguas primero (se usan
-- antes de caducar), listas antes que por completar. FOR UPDATE SKIP LOCKED: dos
-- vendedores a la vez nunca reciben la misma fila. Una reserva vencida vuelve a ser
-- elegible. Marca como caducadas (perezosamente, acotado) las vencidas del mismo
-- pais x macro.

CREATE OR REPLACE FUNCTION public.agent1_bank_draw(
  p_country_code        text,
  p_macro_industry_key  text,
  p_limit               int,
  p_draw_id             uuid,
  p_reserve_seconds     int    DEFAULT 300,
  p_tiers               text[] DEFAULT ARRAY['ready']
)
RETURNS TABLE (
  id               uuid,
  tier             text,
  source_provider  text,
  claims           jsonb,
  payload          jsonb,
  missing_fields   text[],
  source_batch_id  uuid,
  banked_at        timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_limit    int := LEAST(GREATEST(COALESCE(p_limit, 0), 0), 50);
  v_reserve  int := LEAST(GREATEST(COALESCE(p_reserve_seconds, 300), 30), 3600);
BEGIN
  IF v_limit = 0 OR p_draw_id IS NULL THEN
    RETURN;
  END IF;

  -- Caducidad perezosa, acotada y sin bloquear a nadie.
  UPDATE public.agent1_company_bank b
     SET status = 'expired'
   WHERE b.id IN (
     SELECT x.id
       FROM public.agent1_company_bank x
      WHERE x.country_code = p_country_code
        AND x.macro_industry_key = p_macro_industry_key
        AND x.status IN ('banked', 'reserved')
        AND x.expires_at <= now()
        AND (x.status = 'banked' OR x.reserved_until < now())
      LIMIT 200
      FOR UPDATE SKIP LOCKED
   );

  RETURN QUERY
  WITH picked AS (
    SELECT x.id
      FROM public.agent1_company_bank x
     WHERE x.country_code = p_country_code
       AND x.macro_industry_key = p_macro_industry_key
       AND x.tier = ANY (p_tiers)
       AND x.expires_at > now()
       AND (
         x.status = 'banked'
         OR (x.status = 'reserved' AND x.reserved_until < now())
       )
     ORDER BY (x.tier = 'ready') DESC, x.banked_at ASC, x.id ASC
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.agent1_company_bank b
       SET status = 'reserved',
           draw_id = p_draw_id,
           reserved_until = now() + make_interval(secs => v_reserve)
      FROM picked
     WHERE b.id = picked.id
    RETURNING b.id, b.tier, b.source_provider, b.claim_fiscal, b.claim_domain,
              b.claim_provider_entity, b.claim_linkedin, b.payload, b.missing_fields,
              b.source_batch_id, b.banked_at
  )
  SELECT u.id, u.tier, u.source_provider,
         (
           SELECT COALESCE(jsonb_agg(jsonb_build_object('type', t.ctype, 'key', t.ckey)), '[]'::jsonb)
             FROM (VALUES
               ('fiscal',          u.claim_fiscal),
               ('domain',          u.claim_domain),
               ('provider_entity', u.claim_provider_entity),
               ('linkedin',        u.claim_linkedin)
             ) AS t(ctype, ckey)
            WHERE t.ckey IS NOT NULL
         ) AS claims,
         u.payload, u.missing_fields, u.source_batch_id, u.banked_at
    FROM upd u
   ORDER BY (u.tier = 'ready') DESC, u.banked_at ASC, u.id ASC;
END;
$fn$;

COMMENT ON FUNCTION public.agent1_bank_draw(text, text, int, uuid, int, text[]) IS
  'AGENT1-COMPANY-BANK-FOUNDATION-1 — reserva hasta p_limit (max 50) empresas del pais x macro con SKIP LOCKED. Las mas antiguas primero, listas antes que por completar. Una reserva vencida vuelve a ser elegible; una fila caducada nunca se entrega.';

-- ─── Cerrar la extraccion ───────────────────────────────────────────────────────
--
-- p_outcomes: [{ id, outcome: 'assigned'|'invalidated'|'released',
--                batchId?, candidateId?, reason? }]
-- Solo toca filas `reserved` de ESTA extraccion: si la reserva vencio y otro la
-- tomo, el resultado se IGNORA (se cuenta como `ignored`), nunca pisa al otro.

CREATE OR REPLACE FUNCTION public.agent1_bank_settle(p_draw_id uuid, p_outcomes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_out       jsonb;
  v_id        uuid;
  v_outcome   text;
  v_rows      int;
  v_assigned  int := 0;
  v_invalid   int := 0;
  v_released  int := 0;
  v_ignored   int := 0;
BEGIN
  IF p_draw_id IS NULL OR p_outcomes IS NULL OR jsonb_typeof(p_outcomes) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  FOR v_out IN SELECT * FROM jsonb_array_elements(p_outcomes)
  LOOP
    BEGIN
      v_id := (v_out->>'id')::uuid;
      v_outcome := v_out->>'outcome';

      IF v_outcome = 'assigned' THEN
        UPDATE public.agent1_company_bank
           SET status = 'assigned',
               assigned_at = clock_timestamp(),
               assigned_batch_id = NULLIF(v_out->>'batchId', '')::uuid,
               assigned_candidate_id = NULLIF(v_out->>'candidateId', '')::uuid,
               draw_id = NULL,
               reserved_until = NULL
         WHERE id = v_id AND draw_id = p_draw_id AND status = 'reserved';
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows = 1 THEN v_assigned := v_assigned + 1; ELSE v_ignored := v_ignored + 1; END IF;

      ELSIF v_outcome = 'invalidated' THEN
        UPDATE public.agent1_company_bank
           SET status = 'invalidated',
               invalidated_reason = COALESCE(NULLIF(btrim(v_out->>'reason'), ''), 'unspecified'),
               draw_id = NULL,
               reserved_until = NULL
         WHERE id = v_id AND draw_id = p_draw_id AND status = 'reserved';
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows = 1 THEN v_invalid := v_invalid + 1; ELSE v_ignored := v_ignored + 1; END IF;

      ELSIF v_outcome = 'released' THEN
        UPDATE public.agent1_company_bank
           SET status = 'banked',
               draw_id = NULL,
               reserved_until = NULL
         WHERE id = v_id AND draw_id = p_draw_id AND status = 'reserved';
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows = 1 THEN v_released := v_released + 1; ELSE v_ignored := v_ignored + 1; END IF;

      ELSE
        v_ignored := v_ignored + 1;
      END IF;
    EXCEPTION
      WHEN check_violation OR invalid_text_representation OR foreign_key_violation THEN
        v_ignored := v_ignored + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ok',
    'assigned', v_assigned,
    'invalidated', v_invalid,
    'released', v_released,
    'ignored', v_ignored
  );
END;
$fn$;

COMMENT ON FUNCTION public.agent1_bank_settle(uuid, jsonb) IS
  'AGENT1-COMPANY-BANK-FOUNDATION-1 — cierra una extraccion: assigned | invalidated | released. Solo toca filas reservadas por ESTA extraccion; lo demas se ignora.';

-- ─── Seguridad: solo service_role ───────────────────────────────────────────────

ALTER TABLE public.agent1_company_bank ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'agent1_company_bank'
      AND policyname = 'service_role_all_agent1_company_bank'
  ) THEN
    CREATE POLICY "service_role_all_agent1_company_bank"
      ON public.agent1_company_bank FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'agent1_company_bank' AND c.relkind = 'r'
  ) THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.agent1_company_bank FROM PUBLIC';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.agent1_company_bank FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.agent1_company_bank FROM authenticated';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent1_company_bank TO service_role';
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.agent1_bank_deposit(jsonb)',
    'public.agent1_bank_draw(text, text, int, uuid, int, text[])',
    'public.agent1_bank_settle(uuid, jsonb)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', v_fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
    END IF;
  END LOOP;
END $$;
