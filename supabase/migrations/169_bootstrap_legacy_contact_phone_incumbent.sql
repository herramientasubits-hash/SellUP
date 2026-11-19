-- 169 — El teléfono que ya tenía un contacto «legacy» entra a su colección oficial, para que un
--       número revelado DESPUÉS de aprobar pueda llegar al contacto
--       (AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE, Bryan 19-11).
--
-- EL PROBLEMA. Un contacto aprobado cuyo teléfono vino de HubSpot (o se escribió a mano antes de
-- la colección) tiene `contacts.phone` lleno y CERO filas en `contact_phones`. La proyección
-- post-aprobación (128/131, `project_approved_candidate_phones_onto_contact`) rechaza esa forma
-- con `scalar_incumbent_unprojectable` SIN escribir nada: el número que se acaba de pagar en
-- Apollo / Lusha («Buscar más números», reveal desde la ficha) se queda en el candidato y no llega
-- ni al contacto ni a HubSpot. La 128 dejó la decisión abierta como
-- HISTORICAL_MANUAL_NULL_PROVENANCE_PENDING: ¿con qué procedencia entra ese número viejo?
--
-- LA DECISIÓN (Bryan, 19-11): entra como `legacy_incumbent`:
--   * proveedor `unknown` — es la verdad: SellUp no sabe quién lo trajo (HubSpot, una persona…);
--     NO se inventa `manual` ni un proveedor;
--   * modo `manual` — no lo trajo ninguna operación de proveedor de SellUp;
--   * `source_event_key = 'v1:legacy_incumbent:<contact_id>'` — legible en una auditoría,
--     determinista (idempotente) y sin datos personales.
--   Consecuencias: un borrado de Apollo o de Lusha (DSAR acotado a un proveedor) NO lo alcanza
--   (115 retira sólo las fuentes de ese proveedor); un borrado de la PERSONA sí retira la fila de
--   la colección, y el escalar sigue protegido como hasta hoy por su propia procedencia (115,
--   `scalar_guarded_by_provenance`).
--
-- QUÉ HACE, en UNA transacción:
--   1. bloquea el contacto (mismo orden que 112/115/116/117/128: el contacto antes que la
--      colección; aquí no se toca el candidato);
--   2. exige que no esté archivado, que `contacts.phone` bajo el lock sea EXACTAMENTE el número que
--      el llamador normalizó (si alguien lo cambió entretanto: `stale`, nada escrito) y que el
--      contacto no tenga ninguna fila VIVA en `contact_phones`;
--   3. inserta la fila canónica como PRINCIPAL (es el número que ya muestra el contacto: así la
--      colección y el escalar no se contradicen) con su procedencia `legacy_incumbent`.
--      `ON CONFLICT (contact_id, dedupe_key) DO NOTHING`: una lápida con esa clave NUNCA revive.
--
-- QUÉ NO HACE: no toca `contacts.phone` ni ningún escalar (la regla 164 se respeta: el número de
-- HubSpot sigue siendo el principal), no toca `mobile_phone` (4O-E4.1), no llama a proveedores,
-- no gasta créditos, no escribe usage logs ni reservas, y no sale a HubSpot. SECURITY INVOKER:
-- corre bajo el techo de privilegios de la 114 (no puede borrar una fila de teléfono).
--
-- Después, el llamador (TypeScript) vuelve a correr UNA vez la proyección 128/131, que ahora sí
-- encuentra una colección y agrega el número revelado como secundario.

CREATE OR REPLACE FUNCTION public.bootstrap_legacy_contact_phone_incumbent(
  p_contact_id       uuid,
  p_observed_phone   text,
  p_normalized_phone text,
  p_display_phone    text,
  p_dedupe_key       text,
  p_phone_type       text,
  p_now              timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_type_ranking CONSTANT text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];
  v_contact   record;
  v_live_rows integer;
  v_phone_id  uuid;
  v_type      text;
  v_observed  timestamptz;
BEGIN
  IF p_contact_id IS NULL
     OR NULLIF(BTRIM(COALESCE(p_observed_phone, '')), '') IS NULL
     OR NULLIF(BTRIM(COALESCE(p_normalized_phone, '')), '') IS NULL
     OR NULLIF(BTRIM(COALESCE(p_dedupe_key, '')), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  SELECT c.id, c.phone, c.archived_at, c.phone_revealed_at
    INTO v_contact
  FROM public.contacts c
  WHERE c.id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'contact_not_found');
  END IF;
  IF v_contact.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'contact_archived');
  END IF;
  IF NULLIF(BTRIM(COALESCE(v_contact.phone, '')), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'no_scalar');
  END IF;
  IF BTRIM(v_contact.phone) IS DISTINCT FROM BTRIM(p_observed_phone) THEN
    -- El número cambió entre la lectura del llamador y este lock.
    RETURN jsonb_build_object('status', 'stale');
  END IF;

  SELECT COUNT(*) INTO v_live_rows
  FROM public.contact_phones op
  WHERE op.contact_id = p_contact_id
    AND op.suppressed_at IS NULL;

  IF v_live_rows > 0 THEN
    RETURN jsonb_build_object('status', 'collection_present');
  END IF;

  v_type := NULLIF(BTRIM(COALESCE(p_phone_type, '')), '');
  IF v_type IS NOT NULL AND NOT (v_type = ANY (c_type_ranking)) THEN
    v_type := NULL;
  END IF;
  -- La observación es la del propio número cuando la tiene; si no, ahora.
  v_observed := COALESCE(v_contact.phone_revealed_at, p_now, now());

  INSERT INTO public.contact_phones (
    contact_id, normalized_phone, display_phone, dedupe_key,
    phone_type, phone_status, is_primary, first_seen_at, last_seen_at
  )
  VALUES (
    p_contact_id,
    BTRIM(p_normalized_phone),
    COALESCE(NULLIF(BTRIM(COALESCE(p_display_phone, '')), ''), BTRIM(p_normalized_phone)),
    BTRIM(p_dedupe_key),
    v_type,
    'unknown',
    true,
    v_observed,
    v_observed
  )
  ON CONFLICT (contact_id, dedupe_key) DO NOTHING
  RETURNING id INTO v_phone_id;

  IF v_phone_id IS NULL THEN
    -- Una lápida ya tiene esa clave: nunca se resucita.
    RETURN jsonb_build_object('status', 'tombstoned');
  END IF;

  INSERT INTO public.contact_phone_sources (
    contact_phone_id, provider, acquisition_mode, source_event_key, observed_at
  )
  VALUES (
    v_phone_id, 'unknown', 'manual', 'v1:legacy_incumbent:' || p_contact_id::text, v_observed
  )
  ON CONFLICT (contact_phone_id, source_event_key) DO NOTHING;

  RETURN jsonb_build_object(
    'status',     'bootstrapped',
    'contact_id', p_contact_id,
    'dedupe_key', BTRIM(p_dedupe_key)
  );
END;
$$;

COMMENT ON FUNCTION public.bootstrap_legacy_contact_phone_incumbent(
  uuid, text, text, text, text, text, timestamptz
) IS
  'AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE (169) — closes HISTORICAL_MANUAL_NULL_PROVENANCE_PENDING for the post-approval projection: a LEGACY official contact (contacts.phone set, zero live contact_phones) gets its scalar bootstrapped into the collection as the PRIMARY row, with provenance legacy_incumbent = (provider unknown, acquisition_mode manual, source_event_key v1:legacy_incumbent:<contact_id>). Locks the contact; refuses archived contacts, a scalar that changed since the caller read it (stale) and contacts that already own a live collection; a tombstone with the same dedupe_key is never resurrected (ON CONFLICT DO NOTHING). Never writes contacts.phone or any scalar (164 stays authoritative), never touches mobile_phone, calls no provider, spends no credit and reaches no HubSpot. SECURITY INVOKER under 114''s privilege ceiling. Returns a status and a SHA-256 dedupe key, never a number. Service-role only.';

REVOKE ALL ON FUNCTION public.bootstrap_legacy_contact_phone_incumbent(
  uuid, text, text, text, text, text, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_legacy_contact_phone_incumbent(
  uuid, text, text, text, text, text, timestamptz
) FROM anon;
REVOKE ALL ON FUNCTION public.bootstrap_legacy_contact_phone_incumbent(
  uuid, text, text, text, text, text, timestamptz
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_legacy_contact_phone_incumbent(
  uuid, text, text, text, text, text, timestamptz
) TO service_role;
