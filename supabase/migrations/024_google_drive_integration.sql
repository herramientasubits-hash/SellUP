-- ============================================================
-- Migration 022: Google Drive Integration (per-user)
--
-- Arquitectura: cada usuario activo conecta su propio Drive.
-- No es una integración global de Admin.
--
-- Tablas:
--   user_drive_connections  — estado de conexión por usuario
--   user_drive_audit        — eventos de auditoría por usuario
--
-- RLS:
--   - Cada usuario activo solo puede leer/escribir su propia fila.
--   - Escrituras server-side usan admin client (sin política de inserción pública).
--
-- Funciones:
--   get_drive_connection_stats() — resumen agregado para System Status
-- ============================================================

-- -------------------------------------------------------
-- Tabla: user_drive_connections
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_drive_connections (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  internal_user_id      UUID        NOT NULL UNIQUE REFERENCES internal_users(id) ON DELETE CASCADE,
  vault_secret_id       UUID,
  credentials_status    TEXT        NOT NULL DEFAULT 'missing'
                          CHECK (credentials_status IN ('missing', 'stored')),
  connection_status     TEXT        NOT NULL DEFAULT 'not_connected'
                          CHECK (connection_status IN ('not_connected', 'connected', 'error', 'disconnected')),
  drive_folder_id       TEXT,
  drive_folder_name     TEXT,
  connected_at          TIMESTAMPTZ,
  last_tested_at        TIMESTAMPTZ,
  last_connection_error TEXT,
  disconnected_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_drive_connections IS
  'Estado de conexión de Google Drive por usuario. Un registro por usuario.';

-- -------------------------------------------------------
-- Tabla: user_drive_audit
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_drive_audit (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  internal_user_id  UUID        NOT NULL REFERENCES internal_users(id) ON DELETE CASCADE,
  event_type        TEXT        NOT NULL CHECK (event_type IN (
                      'drive_oauth_started',
                      'drive_oauth_connected',
                      'drive_oauth_failed',
                      'drive_connection_tested',
                      'drive_connection_succeeded',
                      'drive_connection_failed',
                      'drive_folder_created',
                      'drive_disconnected'
                    )),
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_drive_audit IS
  'Auditoría de eventos de Google Drive por usuario. No contiene tokens ni credenciales.';

-- -------------------------------------------------------
-- RLS: user_drive_connections
-- -------------------------------------------------------
ALTER TABLE user_drive_connections ENABLE ROW LEVEL SECURITY;

-- Cada usuario activo solo puede leer su propio registro
CREATE POLICY "drive_connections_select_own"
  ON user_drive_connections
  FOR SELECT
  USING (
    internal_user_id = (
      SELECT id FROM internal_users
      WHERE auth_user_id = auth.uid()
        AND access_status = 'active'
      LIMIT 1
    )
  );

-- Escritura solo server-side (admin client) — sin política de INSERT/UPDATE/DELETE pública.

-- -------------------------------------------------------
-- RLS: user_drive_audit
-- -------------------------------------------------------
ALTER TABLE user_drive_audit ENABLE ROW LEVEL SECURITY;

-- Cada usuario activo solo puede leer su propio audit
CREATE POLICY "drive_audit_select_own"
  ON user_drive_audit
  FOR SELECT
  USING (
    internal_user_id = (
      SELECT id FROM internal_users
      WHERE auth_user_id = auth.uid()
        AND access_status = 'active'
      LIMIT 1
    )
  );

-- -------------------------------------------------------
-- Función: get_drive_connection_stats
-- Usada en System Status para resumen agregado (admin).
-- SECURITY DEFINER para eludir RLS.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION get_drive_connection_stats()
RETURNS TABLE(
  total_connected     BIGINT,
  total_disconnected  BIGINT,
  total_error         BIGINT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE connection_status = 'connected')                              AS total_connected,
    COUNT(*) FILTER (WHERE connection_status IN ('not_connected', 'disconnected'))        AS total_disconnected,
    COUNT(*) FILTER (WHERE connection_status = 'error')                                  AS total_error
  FROM user_drive_connections;
$$;

COMMENT ON FUNCTION get_drive_connection_stats() IS
  'Resumen agregado de conexiones Drive para System Status. No expone datos individuales.';
