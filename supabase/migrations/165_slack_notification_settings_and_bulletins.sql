-- 165 — Avisos de Slack configurables por rol y por persona, boletines e historial.
--
-- La dueña (11-11) pidió:
--   1. En Configuración, activar o desactivar cada aviso que manda el bot de
--      SellUp en Slack, por rol y por persona (la persona puede tener su propia
--      regla, que gana sobre la de su rol).
--   2. Un boletín gráfico para cada persona con sus reportes en cascada
--      (diario, semanal, mensual o trimestral; puede tener varios), con vista
--      previa y el historial de los enviados.
--   3. Arreglo: el aviso «usuario pendiente de aprobación» llevaba a una pestaña
--      que no existe (`/settings/users?tab=pending`).
--
-- Escribe y lee sólo el servidor con la llave de servicio (mismo patrón que la
-- 163): ni `anon` ni `authenticated` tienen acceso directo. La pantalla de
-- Configuración comprueba que quien entra sea administrador.
-- No toca filas existentes salvo redefinir la función del aviso de pendientes.

-- ─── 1. Reglas de avisos ─────────────────────────────────────────────────────
-- Una fila = «este aviso, para este rol (o esta persona), está encendido o apagado».
-- Sin fila, vale el valor por defecto del código (src/modules/notifications/notification-catalog.ts).
CREATE TABLE IF NOT EXISTS public.slack_notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('role', 'user')),
  -- role: la clave del rol (`seller_bd`…); user: el id de internal_users.
  scope_id TEXT NOT NULL,
  notification_key TEXT NOT NULL CHECK (char_length(notification_key) BETWEEN 1 AND 64),
  enabled BOOLEAN NOT NULL,
  updated_by UUID REFERENCES public.internal_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, notification_key)
);

CREATE INDEX IF NOT EXISTS idx_slack_notification_settings_scope
  ON public.slack_notification_settings (scope_type, scope_id);

ALTER TABLE public.slack_notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.slack_notification_settings;
CREATE POLICY "service_role full access"
  ON public.slack_notification_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 2. Historial de boletines ───────────────────────────────────────────────
-- Un boletín enviado (o intentado) a una persona por un período. Guarda los
-- datos con los que se armó (`model`) para volver a verlo igual en el historial.
CREATE TABLE IF NOT EXISTS public.slack_bulletin_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES public.internal_users(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'not_in_slack')),
  model JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  triggered_by UUID REFERENCES public.internal_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un boletín automático por persona, frecuencia y período (los reenvíos manuales
-- desde la vista previa llevan `triggered_by` y no chocan con el automático).
CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_bulletin_deliveries_auto
  ON public.slack_bulletin_deliveries (recipient_user_id, frequency, period_start)
  WHERE triggered_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_slack_bulletin_deliveries_recent
  ON public.slack_bulletin_deliveries (created_at DESC);

ALTER TABLE public.slack_bulletin_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.slack_bulletin_deliveries;
CREATE POLICY "service_role full access"
  ON public.slack_bulletin_deliveries
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 3. Aviso de usuario pendiente: enlace a la pestaña que existe ───────────
CREATE OR REPLACE FUNCTION public.notify_admins_of_pending_user(p_pending_user_id uuid, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_admin_ids UUID[];
BEGIN
    SELECT ARRAY_AGG(u.id)
    INTO v_admin_ids
    FROM internal_users u
    JOIN roles r ON u.role_id = r.id
    WHERE u.access_status = 'active'
      AND r.key = 'admin';

    IF v_admin_ids IS NULL OR ARRAY_LENGTH(v_admin_ids, 1) = 0 THEN
        RETURN;
    END IF;

    PERFORM create_notifications_for_recipients(
        v_admin_ids,
        'user_pending_approval',
        'Nuevo usuario pendiente de aprobación',
        p_email || ' solicitó acceso a SellUp y requiere revisión.',
        'Revisar usuarios',
        '/settings/users?tab=usuarios&filter=pending',
        'internal_user',
        p_pending_user_id
    );
END;
$function$;
