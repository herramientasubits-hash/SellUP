-- ============================================================
-- Migration 047: Source Catalog Connections
-- ============================================================
-- Crea la tabla source_catalog_connections para gestionar el
-- estado de conexión y referencia de credenciales (via Vault)
-- de fuentes del catálogo que requieren autenticación.
--
-- Las credenciales reales NUNCA se guardan aquí.
-- Solo se almacena vault_secret_name (nombre del secreto en Vault).
-- El secreto descifrado solo se lee server-side via get_vault_secret_decrypted.
-- ============================================================

-- ── 1. Tabla ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS source_catalog_connections (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identificador único de la fuente (ej: 'denue_mexico', 'socrata_colombia')
    source_key                  TEXT        UNIQUE NOT NULL,

    -- Snapshot del nombre de la fuente al momento de conexión
    source_name_snapshot        TEXT        NULL,

    -- Código de país ISO 3166-1 alpha-2 (ej: 'MX', 'CO')
    country_code                TEXT        NULL,

    -- Tipo de autenticación requerida
    auth_type                   TEXT        NOT NULL DEFAULT 'none'
        CHECK (auth_type IN ('none', 'api_key', 'bearer_token', 'oauth2')),

    -- ¿La fuente requiere credenciales para funcionar?
    requires_credentials        BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Estado de las credenciales en Vault
    credentials_status          TEXT        NOT NULL DEFAULT 'not_required'
        CHECK (credentials_status IN ('missing', 'stored', 'not_required')),

    -- Estado general de la conexión
    connection_status           TEXT        NOT NULL DEFAULT 'not_applicable'
        CHECK (connection_status IN (
            'not_tested',
            'connected',
            'error',
            'disconnected',
            'not_applicable'
        )),

    -- Referencia al secreto en Vault (nunca el valor real)
    vault_secret_id             UUID        NULL,
    vault_secret_name           TEXT        NULL,

    -- Resultado del último test de conexión
    last_tested_at              TIMESTAMPTZ NULL,
    last_tested_by              UUID        NULL REFERENCES public.internal_users(id),
    last_test_status            TEXT        NULL
        CHECK (last_test_status IS NULL OR last_test_status IN ('success', 'failed', 'auth_error')),
    last_test_http_status       INTEGER     NULL,
    last_test_response_time_ms  INTEGER     NULL,
    last_connection_error       TEXT        NULL,

    -- Registro de conexión exitosa
    connected_at                TIMESTAMPTZ NULL,
    connected_by                UUID        NULL REFERENCES public.internal_users(id),

    -- Metadata adicional (provider info, catalog keys, etc.)
    metadata                    JSONB       NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),

    -- Timestamps
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Índices ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_source_catalog_connections_source_key
    ON source_catalog_connections (source_key);

CREATE INDEX IF NOT EXISTS idx_source_catalog_connections_country_code
    ON source_catalog_connections (country_code);

CREATE INDEX IF NOT EXISTS idx_source_catalog_connections_connection_status
    ON source_catalog_connections (connection_status);

-- ── 3. Updated_at automático ──────────────────────────────────

CREATE OR REPLACE FUNCTION update_source_catalog_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_source_catalog_connections_updated_at
    BEFORE UPDATE ON source_catalog_connections
    FOR EACH ROW
    EXECUTE FUNCTION update_source_catalog_connections_updated_at();

-- ── 4. RLS ────────────────────────────────────────────────────

ALTER TABLE source_catalog_connections ENABLE ROW LEVEL SECURITY;

-- SELECT: usuarios internos activos pueden leer
CREATE POLICY "active_users_can_read_source_catalog_connections"
    ON source_catalog_connections FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

-- INSERT: solo admins activos pueden insertar
CREATE POLICY "admins_can_insert_source_catalog_connections"
    ON source_catalog_connections FOR INSERT
    TO authenticated
    WITH CHECK (is_admin_user(auth.uid()));

-- UPDATE: solo admins activos pueden actualizar
CREATE POLICY "admins_can_update_source_catalog_connections"
    ON source_catalog_connections FOR UPDATE
    TO authenticated
    USING (is_admin_user(auth.uid()));

-- DELETE: nadie puede eliminar (registro de referencia permanente)
-- No se crea política permisiva para DELETE.

-- ── 5. Seeds mínimos ──────────────────────────────────────────

-- DENUE México — requiere API key en Vault
INSERT INTO source_catalog_connections (
    source_key,
    source_name_snapshot,
    country_code,
    auth_type,
    requires_credentials,
    credentials_status,
    connection_status,
    vault_secret_name,
    metadata
) VALUES (
    'denue_mexico',
    'DENUE México',
    'MX',
    'api_key',
    TRUE,
    'missing',
    'not_tested',
    'sellup_source_denue_mexico_token',
    '{
        "source_provider": "denue_mexico",
        "source_type": "structured_registry",
        "source_mode": "pilot",
        "catalog_key": "mx_denue"
    }'::jsonb
)
ON CONFLICT (source_key) DO NOTHING;

-- Socrata Colombia — no requiere credenciales
INSERT INTO source_catalog_connections (
    source_key,
    source_name_snapshot,
    country_code,
    auth_type,
    requires_credentials,
    credentials_status,
    connection_status,
    vault_secret_name,
    metadata
) VALUES (
    'socrata_colombia',
    'Socrata Colombia',
    'CO',
    'none',
    FALSE,
    'not_required',
    'not_applicable',
    NULL,
    '{
        "source_provider": "socrata_colombia",
        "source_type": "structured_registry",
        "source_mode": "pilot",
        "catalog_key": "co_rues"
    }'::jsonb
)
ON CONFLICT (source_key) DO NOTHING;

-- ── 6. Comentarios ────────────────────────────────────────────

COMMENT ON TABLE source_catalog_connections IS
    'Estado de conexión y referencia de credenciales (via Vault) para fuentes del catálogo. Las credenciales reales NUNCA se almacenan aquí.';

COMMENT ON COLUMN source_catalog_connections.vault_secret_name IS
    'Nombre del secreto en Supabase Vault. El valor descifrado solo se lee server-side via get_vault_secret_decrypted(). NUNCA almacenar el valor real del secreto en esta tabla.';

COMMENT ON COLUMN source_catalog_connections.vault_secret_id IS
    'UUID del secreto en vault.secrets una vez que la credencial fue guardada con upsert_vault_secret().';
