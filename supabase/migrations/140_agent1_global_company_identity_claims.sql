-- ============================================================================
-- Migration 140: AGENT1-GLOBAL-COMPANY-IDENTITY-CLAIMS-1 — una empresa ya
-- propuesta en SellUp deja de contar para OTRO vendedor.
-- ============================================================================
--
-- QUÉ CIERRA, DICHO COMO DEFECTO
-- ------------------------------
--
-- La migración 126 (CUT-3B4) hizo atómica la admisión DENTRO de un mismo lote:
-- dos escritores del MISMO lote ya no pueden insertar la misma empresa dos
-- veces. Su propio encabezado lo declara explícito: «El ámbito es UN LOTE. No
-- hay época global ni cerrojo global: la actividad del lote A no puede caducar
-- una decisión del lote B.»
--
-- Eso deja EXACTAMENTE la carrera que esta migración cierra:
--
--     Vendedor A corre el mago → lote A
--     Vendedor B corre el mago, a la vez, en OTRO lote → lote B
--     Apollo (o Lusha) devuelve la MISMA empresa a los dos
--     Las dos admisiones son válidas contra SU lote: ninguna valla las ve
--     Los dos vendedores reciben la misma empresa
--
-- La única defensa que existía contra esto era `buildNoveltyIndex`
-- (`novelty-checker.ts`): una lectura NO atómica (SELECT-luego-decide, sin
-- cerrojo) que además EXPIRA — pasado el cooldown (30/90 días) una empresa que
-- sigue activa y sin resolver en el lote de OTRO vendedor vuelve a poder
-- proponerse. Decisión de producto 2026-09-28: mientras una empresa siga
-- siendo una propuesta VIVA en SellUp (para cualquier vendedor), no puede
-- contar para ningún otro — sin fecha de caducidad.
--
--
-- LO QUE ESTA MIGRACIÓN NO ES
-- ---------------------------
--
-- 🔴 NO es una segunda autoridad de identidad. No compara nombres, no decide
-- TIER, no normaliza nada por cuenta propia: eso sigue siendo, entero y sin
-- copia, `company-identity-evidence.ts` (la evidencia) y
-- `global-identity-claims.ts` (qué señal se reclama y con qué precedencia).
-- Esta migración sólo da la garantía que ninguna de las dos, escritas en
-- TypeScript, puede dar por sí solas: que DOS transacciones concurrentes no
-- puedan reclamar la MISMA señal a la vez.
--
-- 🔴 NO repite el error que 126 ya rechazó (`UNIQUE(domain)` sobre
-- `prospect_candidates`): dos personas jurídicas distintas —NIT
-- 800111222 y NIT 900333444— pueden compartir dominio de grupo legítimamente.
-- Por eso el dominio SÓLO se reclama como señal exclusiva cuando la empresa NO
-- tiene identidad fiscal conocida (la misma precedencia que TIER 1 > TIER 2 ya
-- usa dentro de un lote). Con identidad fiscal, el dominio no se reclama en
-- exclusiva: la fiscal ya identifica a la persona jurídica sin ambigüedad.
--
--
-- EL MECANISMO — RECLAMOS POR SEÑAL, ÍNDICE ÚNICO PARCIAL
-- ---------------------------------------------------------------------------
--
-- Cada candidato admitido reclama de 1 a 3 señales (fiscal-o-dominio, id de
-- proveedor, LinkedIn de empresa — las que la fuente haya dado). Cada reclamo
-- es una fila. El índice único parcial `(claim_type, claim_key) WHERE
-- released_at IS NULL` es lo que hace el cierre ATÓMICO: si dos transacciones
-- intentan insertar el mismo `(claim_type, claim_key)` activo a la vez,
-- PostgreSQL serializa sobre esa clave concreta —y SÓLO esa clave: una empresa
-- en México y otra en Chile jamás se bloquean entre sí— y la segunda inserción
-- lanza `unique_violation`. `claim_company_identities` (función de abajo)
-- atrapa esa excepción POR CANDIDATO, con `SAVEPOINT` implícito de PL/pgSQL:
-- el candidato que pierde la carrera no persiste NINGUNO de sus reclamos, y el
-- llamador lo sabe por el resultado, no por adivinar.
--
-- La liberación es un DISPARADOR sobre `prospect_candidates.status`, no una
-- llamada que cada sitio de escritura tenga que recordar hacer: en cuanto un
-- candidato pasa a `discarded` o `duplicate` (los DOS estados que
-- `BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES` ya excluye de «ocupa el lote»),
-- sus reclamos activos se liberan solos y la empresa vuelve a estar
-- disponible. Ningún camino de escritura presente o futuro puede olvidarlo.

-- ═══════════════════════════════════════════════════════════════════
-- 1. agent1_company_identity_claims
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.agent1_company_identity_claims (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vocabulario CERRADO: cada tipo es una autoridad de evidencia DISTINTA
  -- (`company-identity-evidence.ts`). Nunca se combinan en una sola clave.
  claim_type    text        NOT NULL
    CONSTRAINT agent1_company_identity_claims_type_check
    CHECK (claim_type IN ('fiscal', 'domain', 'provider_entity', 'linkedin')),

  -- El valor YA resuelto por TypeScript (p. ej. `CO:900123456`,
  -- `acme.com`, `lusha:12345`). Esta migración no lo normaliza ni lo entiende:
  -- sólo lo compara byte a byte contra otras filas del MISMO tipo.
  claim_key     text        NOT NULL
    CONSTRAINT agent1_company_identity_claims_key_not_blank
    CHECK (btrim(claim_key) <> ''),

  candidate_id  uuid        NOT NULL REFERENCES public.prospect_candidates(id),
  batch_id      uuid        NOT NULL REFERENCES public.prospect_batches(id),

  claimed_at    timestamptz NOT NULL DEFAULT now(),
  -- `NULL` ⇒ reclamo ACTIVO (ocupa la señal). No-nulo ⇒ liberado: la empresa
  -- volvió a estar disponible para otro vendedor.
  released_at   timestamptz NULL
);

-- La garantía real: una señal activa sólo puede tener UN dueño a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS agent1_company_identity_claims_active_key
  ON public.agent1_company_identity_claims (claim_type, claim_key)
  WHERE released_at IS NULL;

-- Soporta el disparador de liberación: «todos los reclamos activos de ESTE
-- candidato», sin recorrer la tabla entera.
CREATE INDEX IF NOT EXISTS agent1_company_identity_claims_candidate_idx
  ON public.agent1_company_identity_claims (candidate_id)
  WHERE released_at IS NULL;

COMMENT ON TABLE public.agent1_company_identity_claims IS
  'AGENT1-GLOBAL-COMPANY-IDENTITY-CLAIMS-1 — quién ocupa, en TODO SellUp (no sólo en un lote), cada señal de identidad de empresa (fiscal, dominio sin fiscal conocida, id de proveedor, LinkedIn). El índice único parcial por (claim_type, claim_key) WHERE released_at IS NULL es la atomicidad: dos vendedores no pueden reclamar la misma señal a la vez. Se libera SOLO por disparador cuando el candidato dueño pasa a discarded/duplicate. No es una segunda autoridad de identidad: la política de qué reclamar vive en TypeScript (global-identity-claims.ts).';

-- ═══════════════════════════════════════════════════════════════════
-- 2. Liberación automática — disparador sobre prospect_candidates.status
-- ═══════════════════════════════════════════════════════════════════

-- 🔴 SECURITY DEFINER, y no es un descuido (AGENT1-CLAIMS-RELEASE-TRIGGER-DEFINER-1).
-- Los vendedores descartan con su cliente de SESIÓN (`discardCandidate`,
-- rol `authenticated`), y la tabla de reclamos sólo tiene política para
-- `service_role`. En SECURITY INVOKER el UPDATE de abajo afectaba 0 filas SIN
-- error: la empresa descartada quedaba bloqueada para siempre. Medido contra
-- PostgreSQL real antes de aplicar nada (global-identity-claims-postgres).
--
-- Es seguro correrlo con el rol del dueño: sólo toca los reclamos de `NEW.id`,
-- sólo para marcarlos liberados, el `search_path` está fijado, y una función
-- `RETURNS trigger` no se puede invocar a mano.
CREATE OR REPLACE FUNCTION public.agent1_release_company_identity_claims()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  IF NEW.status IN ('discarded', 'duplicate') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.agent1_company_identity_claims
       SET released_at = now()
     WHERE candidate_id = NEW.id
       AND released_at IS NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.agent1_release_company_identity_claims() IS
  'AGENT1-GLOBAL-COMPANY-IDENTITY-CLAIMS-1 — libera los reclamos globales de un candidato en cuanto su status pasa a discarded o duplicate. Vive en un disparador, no en cada sitio de escritura, para que ningún camino presente o futuro pueda olvidar liberar. No reclama de vuelta si el candidato vuelve a un status activo: eso lo decide la siguiente propuesta, como cualquier candidato nuevo.';

DROP TRIGGER IF EXISTS agent1_release_company_identity_claims_trigger
  ON public.prospect_candidates;

CREATE TRIGGER agent1_release_company_identity_claims_trigger
  AFTER UPDATE OF status ON public.prospect_candidates
  FOR EACH ROW
  EXECUTE FUNCTION public.agent1_release_company_identity_claims();

-- ═══════════════════════════════════════════════════════════════════
-- 3. claim_company_identities — el ÚNICO punto de escritura de la tabla
-- ═══════════════════════════════════════════════════════════════════
--
-- Entrada: un array de candidatos YA insertados en `prospect_candidates`, cada
-- uno con la lista de reclamos que TypeScript ya decidió (tipo + clave, sin
-- interpretar nada aquí). Por candidato, en un bloque con manejo de excepción
-- —`SAVEPOINT` implícito de PL/pgSQL—: si CUALQUIERA de sus reclamos choca con
-- uno activo de OTRO candidato, NINGUNO de sus reclamos persiste, y ese
-- candidato pasa a `status='duplicate', duplicate_status='exact_duplicate'`
-- con la traza en `metadata.global_identity_claim_conflict`. Si ninguno choca,
-- sus reclamos quedan activos y el candidato no se toca.
--
-- Un candidato sin reclamos (sin ninguna señal fuerte) simplemente no reclama
-- nada y no puede chocar: se admite igual que hoy.

CREATE OR REPLACE FUNCTION public.claim_company_identities(
  p_candidates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_candidate       jsonb;
  v_claim           jsonb;
  v_candidate_id    uuid;
  v_batch_id        uuid;
  v_now             timestamptz := clock_timestamp();
  v_holder          record;
  v_claimed_ids     jsonb := '[]'::jsonb;
  v_conflicted      jsonb := '[]'::jsonb;
BEGIN
  IF p_candidates IS NULL OR jsonb_typeof(p_candidates) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

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

    BEGIN
      FOR v_claim IN SELECT * FROM jsonb_array_elements(v_candidate->'claims')
      LOOP
        INSERT INTO public.agent1_company_identity_claims
          (claim_type, claim_key, candidate_id, batch_id, claimed_at)
        VALUES (
          v_claim->>'type',
          v_claim->>'key',
          v_candidate_id,
          v_batch_id,
          v_now
        );
      END LOOP;

      v_claimed_ids := v_claimed_ids || jsonb_build_array(v_candidate_id);

    EXCEPTION WHEN unique_violation THEN
      -- Todo lo que este candidato alcanzó a insertar en este bloque se
      -- deshace solo: PL/pgSQL abre un SAVEPOINT implícito al entrar al
      -- bloque y lo revierte al capturar la excepción. Ningún otro candidato
      -- de este mismo lote se ve afectado.
      --
      -- Quién ya tiene la señal, sólo para dejar traza — nunca decide nada.
      SELECT candidate_id, batch_id
        INTO v_holder
        FROM public.agent1_company_identity_claims c
        JOIN jsonb_array_elements(v_candidate->'claims') claim
          ON c.claim_type = claim->>'type' AND c.claim_key = claim->>'key'
       WHERE c.released_at IS NULL
       LIMIT 1;

      UPDATE public.prospect_candidates
         SET status = 'duplicate',
             duplicate_status = 'exact_duplicate',
             metadata = metadata || jsonb_build_object(
               'global_identity_claim_conflict', jsonb_build_object(
                 'held_by_candidate_id', v_holder.candidate_id,
                 'held_by_batch_id', v_holder.batch_id,
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
  'AGENT1-GLOBAL-COMPANY-IDENTITY-CLAIMS-1. Reclama, por candidato ya insertado, las señales de identidad que TypeScript decidió (fiscal-o-dominio, proveedor, LinkedIn); un choque contra un reclamo activo de OTRO candidato revierte SOLO los reclamos de ese candidato (SAVEPOINT implícito) y lo marca duplicate. No contiene política de identidad: qué reclamar y con qué precedencia vive en global-identity-claims.ts.';

-- ═══════════════════════════════════════════════════════════════════
-- 4. GRANTS — estado final declarativo
-- ═══════════════════════════════════════════════════════════════════
--
-- Apollo/Tavily Y Lusha reclaman con el cliente ADMINISTRATIVO (`service_role`):
-- la única política es la suya, y la sesión de un vendedor no lee ni escribe
-- reclamos. `authenticated` conserva el GRANT de tabla y de EXECUTE sólo porque
-- el disparador de liberación corre bajo su UPDATE; sin política, no ve filas.
-- `anon` y `PUBLIC` quedan fuera.

ALTER TABLE public.agent1_company_identity_claims ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'agent1_company_identity_claims'
       AND policyname = 'service_role_all_agent1_company_identity_claims'
  ) THEN
    CREATE POLICY "service_role_all_agent1_company_identity_claims"
      ON public.agent1_company_identity_claims
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.agent1_company_identity_claims FROM PUBLIC';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.agent1_company_identity_claims FROM anon';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.agent1_company_identity_claims FROM authenticated';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.agent1_company_identity_claims FROM service_role';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.agent1_company_identity_claims TO authenticated, service_role';
END $$;

-- La función del disparador es SECURITY DEFINER: nadie debe poder invocarla
-- a mano. Disparar un trigger no exige EXECUTE, así que revocarlo no le quita
-- nada al descarte (lo prueba global-identity-claims-postgres § 1).
REVOKE ALL ON FUNCTION public.agent1_release_company_identity_claims() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent1_release_company_identity_claims() FROM anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.claim_company_identities(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_company_identities(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_company_identities(jsonb)
  TO postgres, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 5. Recarga explícita de la caché de esquema de PostgREST
-- ═══════════════════════════════════════════════════════════════════
--
-- Mismo precedente que 105/126: sin esto, aplicar la migración puede no
-- bastar para que PostgREST sirva la función nueva de inmediato.

NOTIFY pgrst, 'reload schema';
