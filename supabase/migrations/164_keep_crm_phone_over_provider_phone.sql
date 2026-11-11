-- 164 — El teléfono que vino de HubSpot (o que escribió una persona) no se reemplaza
--       por el de Apollo / Lusha.
--
-- Feedback de un líder comercial (11-11): «se actualiza el [número] de Apollo o Lusha que
-- trae el sistema y cambia automáticamente el número de HubSpot; sería bueno una casilla
-- más que diga número Apollo o Lusha para que no se cambie en la casilla de teléfono.
-- Puede que el de Apollo o Lusha esté mal».
--
-- Por qué pasaba:
--   · Candidatos: el de HubSpot vive en `contact_enrichment_candidates.phone`, SIN
--     procedencia de proveedor (`enrichment_metadata.phone` ausente). Revelar con Apollo
--     (RPC 120 `persist_candidate_apollo_phone_reveal_result`), Lusha / waterfall
--     (`persist_candidate_lusha_phone_reveal_result`), «Buscar más números» (RPC 122) y
--     varios caminos en TypeScript (caché, webhook, recovery) escriben `phone = <número del
--     proveedor>` sin mirar lo que había.
--   · Contactos oficiales: la aprobación (RPC 116 `approve_contact_candidate_with_phones`)
--     crea el contacto con el número del candidato y, si la colección tiene principal (el de
--     Apollo / Lusha), hace `UPDATE contacts SET phone = <principal>`.
--
-- Arreglo: en vez de reescribir cuatro funciones de 11–36 mil caracteres y cada camino en
-- TypeScript, UNA regla en la base, en el único punto por donde pasan todos: un trigger
-- BEFORE UPDATE OF phone en cada tabla. El número del proveedor NO se pierde: sigue en su
-- colección (`contact_enrichment_candidate_phones` / `contact_phones`, con su procedencia),
-- y la UI lo muestra aparte como «Teléfono Apollo / Lusha».
--
-- Qué NO bloquea:
--   · Dejar el teléfono vacío sin un reveal de por medio: es la supresión (no contactar /
--     privacidad), que debe poder borrar el número.
--   · Un número de proveedor que reemplaza a otro de proveedor (comportamiento de siempre).
--   · Una edición manual de un contacto oficial (`phone_source` manual o vacío).
--   · Insertar: sólo actúa en UPDATE.
--
-- Sin cambios de esquema ni de datos: sólo dos funciones y dos triggers. Reversible con
-- `DROP TRIGGER … ; DROP FUNCTION …`.

-- ═══════════════════════════════════════════════════════════════
-- 1. Candidatos
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.keep_crm_phone_on_candidate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Sólo protege un número que NO trae procedencia de proveedor (HubSpot / manual).
  IF btrim(COALESCE(OLD.phone, '')) = '' THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(COALESCE(OLD.enrichment_metadata, '{}'::jsonb) -> 'phone') = 'object' THEN
    RETURN NEW;
  END IF;
  IF NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;
  -- Vaciarlo sin un reveal de por medio es la supresión: se permite.
  IF btrim(COALESCE(NEW.phone, '')) = ''
     AND NEW.phone_reveal_status IS NOT DISTINCT FROM OLD.phone_reveal_status THEN
    RETURN NEW;
  END IF;

  -- Un proveedor intentó reemplazarlo: se conserva el de HubSpot y su (falta de)
  -- procedencia. El número del proveedor queda en la colección del candidato y, para que
  -- quien lo reveló lo vea sin permisos extra, en `enrichment_metadata.provider_phone`
  -- («Teléfono Apollo / Lusha» en la UI).
  IF btrim(COALESCE(NEW.phone, '')) <> '' THEN
    NEW.enrichment_metadata := (COALESCE(NEW.enrichment_metadata, '{}'::jsonb) - 'phone')
      || jsonb_build_object(
           'provider_phone',
           CASE
             WHEN jsonb_typeof(NEW.enrichment_metadata -> 'phone') = 'object'
               THEN (NEW.enrichment_metadata -> 'phone') || jsonb_build_object('number', NEW.phone)
             ELSE jsonb_build_object('number', NEW.phone)
           END
         );
  ELSIF jsonb_typeof(COALESCE(NEW.enrichment_metadata, '{}'::jsonb) -> 'phone') IS NOT NULL THEN
    NEW.enrichment_metadata := NEW.enrichment_metadata - 'phone';
  END IF;
  NEW.phone := OLD.phone;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.keep_crm_phone_on_candidate() IS
  '164: el teléfono sin procedencia de proveedor (HubSpot/manual) no se reemplaza por uno de Apollo/Lusha; ése queda en contact_enrichment_candidate_phones.';

DROP TRIGGER IF EXISTS keep_crm_phone_on_candidate ON public.contact_enrichment_candidates;
CREATE TRIGGER keep_crm_phone_on_candidate
  BEFORE UPDATE OF phone ON public.contact_enrichment_candidates
  FOR EACH ROW
  EXECUTE FUNCTION public.keep_crm_phone_on_candidate();

-- ═══════════════════════════════════════════════════════════════
-- 2. Contactos oficiales
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.keep_crm_phone_on_contact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  -- Valores de `phone_source` que dicen «lo trajo un proveedor» (094 + 116).
  c_provider_sources CONSTANT text[] := ARRAY[
    'apollo_search', 'apollo_reveal', 'apollo_cache', 'lusha_reveal', 'provider_payload', 'unknown'
  ];
BEGIN
  IF btrim(COALESCE(OLD.phone, '')) = '' THEN
    RETURN NEW;
  END IF;
  -- El número actual ya es de un proveedor: puede reemplazarlo otro proveedor.
  IF COALESCE(OLD.phone_source, '') = ANY (c_provider_sources) THEN
    RETURN NEW;
  END IF;
  IF btrim(COALESCE(NEW.phone, '')) = '' OR NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;
  -- Una edición de una persona (manual / sin procedencia) sí cambia el número.
  IF NOT (COALESCE(NEW.phone_source, '') = ANY (c_provider_sources)) THEN
    RETURN NEW;
  END IF;

  -- El del proveedor queda en `contact_phones` y en `metadata.provider_phone`
  -- («Teléfono Apollo / Lusha» en la UI).
  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
    'provider_phone',
    jsonb_strip_nulls(jsonb_build_object(
      'number',      NEW.phone,
      'type',        NEW.phone_type,
      'source',      NEW.phone_source,
      'observed_at', NEW.phone_revealed_at
    ))
  );
  NEW.phone             := OLD.phone;
  NEW.phone_type        := OLD.phone_type;
  NEW.phone_source      := OLD.phone_source;
  NEW.phone_raw_type    := OLD.phone_raw_type;
  NEW.phone_revealed_at := OLD.phone_revealed_at;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.keep_crm_phone_on_contact() IS
  '164: el teléfono de HubSpot/manual de un contacto no se reemplaza por uno de Apollo/Lusha; ése queda en contact_phones.';

DROP TRIGGER IF EXISTS keep_crm_phone_on_contact ON public.contacts;
CREATE TRIGGER keep_crm_phone_on_contact
  BEFORE UPDATE OF phone ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.keep_crm_phone_on_contact();
