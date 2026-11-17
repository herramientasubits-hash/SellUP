-- ============================================================
-- 168 — Comentarios y alertas sobre empresas y contactos
-- ============================================================
-- ⚠️ NO APLICADA EN PRODUCCIÓN. Se aplica sólo con autorización explícita de la
-- dueña, después del merge. Mientras no esté aplicada, la app esconde la
-- función (la tabla no existe ⇒ «no disponible»), no falla.
--
-- Feedback de los vendedores (17-11): «llamé y el número no existe», «el
-- LinkedIn es de otra persona», «el número de empleados está mal»… Hoy sólo
-- hay un campo «Notas» de texto libre que se pisa al editar, sin autor ni
-- fecha, y nadie se entera. Esta tabla guarda cada comentario como un mensaje:
--
--   · sobre qué es: una empresa (account_id) y, si aplica, uno de sus
--     contactos (contact_id);
--   · el dato al que apunta (field_key: teléfono, LinkedIn, web, empleados,
--     industria…) y una foto del valor que tenía (field_value, p. ej. el
--     número reportado), para que el comentario siga teniendo sentido aunque
--     el dato cambie después;
--   · tipo: «note» (constancia) o «alert» (alguien tiene que verlo);
--   · motivo rápido opcional (reason) para los atajos del teléfono;
--   · autor y fecha. El texto NO se edita: queda la trazabilidad.
--   · una alerta se cierra con «Resuelto» (quién, cuándo y qué hizo).
--
-- Qué NO hace:
--   · No toca `contacts`, `contact_phones` ni ningún teléfono: reportar «el
--     número no existe» crea la alerta y la ficha lo marca a la vista, pero no
--     cambia el estado del teléfono (eso tiene sus propios escritores
--     auditados; queda para una fase posterior).
--   · No escribe en HubSpot ni llama proveedores.
--   · No toca filas existentes.
--
-- Acceso: igual que 163 y 165, sólo el servidor con la llave de servicio. La
-- app comprueba ANTES el alcance comercial del registro (la empresa o el
-- contacto deben estar en el alcance de quien pide, con «Ver como…» incluido)
-- y pone el autor desde la sesión. Ni `anon` ni `authenticated` leen ni
-- escriben directo.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.record_comments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id      uuid        NULL REFERENCES public.contacts(id) ON DELETE CASCADE,

  field_key       text        NOT NULL DEFAULT 'general'
    CONSTRAINT record_comments_field_key_check
    CHECK (field_key IN (
      'general', 'phone', 'email', 'linkedin', 'job_title',
      'website', 'employees', 'industry', 'country', 'tax_id', 'owner', 'other'
    )),
  field_value     text        NULL
    CONSTRAINT record_comments_field_value_len CHECK (field_value IS NULL OR char_length(field_value) <= 500),

  kind            text        NOT NULL DEFAULT 'note'
    CONSTRAINT record_comments_kind_check CHECK (kind IN ('note', 'alert')),
  reason          text        NULL
    CONSTRAINT record_comments_reason_check
    CHECK (reason IS NULL OR reason IN ('phone_not_exists', 'phone_no_answer', 'phone_wrong_person')),

  body            text        NOT NULL
    CONSTRAINT record_comments_body_len CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),

  author_id       uuid        NOT NULL REFERENCES public.internal_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),

  resolved_at     timestamptz NULL,
  resolved_by     uuid        NULL REFERENCES public.internal_users(id),
  resolution_note text        NULL
    CONSTRAINT record_comments_resolution_len CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),

  -- Sólo una alerta se resuelve, y «resuelta» lleva quién y cuándo juntos.
  CONSTRAINT record_comments_resolution_shape CHECK (
    (resolved_at IS NULL AND resolved_by IS NULL AND resolution_note IS NULL)
    OR (kind = 'alert' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);

COMMENT ON TABLE public.record_comments IS
  '168: comentarios y alertas sobre una empresa o un contacto, asociados a un dato (teléfono, LinkedIn, empleados…). Sólo servidor; el texto no se edita.';

-- El comentario de un contacto va SIEMPRE con la empresa de ese contacto (el
-- alcance se decide por la empresa). Se fija aquí, no se confía en quien llama.
CREATE OR REPLACE FUNCTION public.record_comments_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_account uuid;
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    SELECT c.account_id INTO v_account FROM public.contacts c WHERE c.id = NEW.contact_id;
    IF v_account IS NULL THEN
      RAISE EXCEPTION 'record_comments: el contacto % no existe', NEW.contact_id;
    END IF;
    NEW.account_id := v_account;
  END IF;
  NEW.body := btrim(NEW.body);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_comments_before_insert ON public.record_comments;
CREATE TRIGGER record_comments_before_insert
  BEFORE INSERT ON public.record_comments
  FOR EACH ROW EXECUTE FUNCTION public.record_comments_before_insert();

-- Trazabilidad: después de creado, sólo cambia la resolución.
CREATE OR REPLACE FUNCTION public.record_comments_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
     OR NEW.field_key IS DISTINCT FROM OLD.field_key
     OR NEW.field_value IS DISTINCT FROM OLD.field_value
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.author_id IS DISTINCT FROM OLD.author_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'record_comments: un comentario no se edita; sólo se resuelve';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_comments_before_update ON public.record_comments;
CREATE TRIGGER record_comments_before_update
  BEFORE UPDATE ON public.record_comments
  FOR EACH ROW EXECUTE FUNCTION public.record_comments_before_update();

CREATE INDEX IF NOT EXISTS idx_record_comments_account_created
  ON public.record_comments (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_record_comments_contact_created
  ON public.record_comments (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_record_comments_open_alerts
  ON public.record_comments (created_at DESC)
  WHERE kind = 'alert' AND resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_record_comments_created
  ON public.record_comments (created_at DESC);

ALTER TABLE public.record_comments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.record_comments FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.record_comments_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_comments_before_update() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "service_role full access" ON public.record_comments;
CREATE POLICY "service_role full access"
  ON public.record_comments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
