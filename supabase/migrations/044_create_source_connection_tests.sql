-- ============================================================
-- Migration 044: Historial de pruebas de conexión de fuentes
-- ============================================================
-- Crea la tabla source_connection_tests para persistir
-- el resultado auditado de cada prueba de conexión iniciada
-- por un usuario interno activo.
-- ============================================================

-- ── 1. Tabla ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS source_connection_tests (
    id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identificación de la fuente
    source_key                      TEXT        NOT NULL,
    source_name_snapshot            TEXT        NULL,
    source_country_codes_snapshot   TEXT[]      NULL,
    source_type_snapshot            TEXT        NULL,
    source_operational_status_snapshot TEXT     NULL,

    -- Snapshot del usuario que ejecutó la prueba
    tested_by_user_id               UUID        NULL,
    tested_by_email_snapshot        TEXT        NULL,

    -- Resultado de la prueba
    strategy                        TEXT        NOT NULL
        CHECK (strategy IN (
            'http_get',
            'http_head',
            'partial_download_head',
            'requires_credentials',
            'manual_only',
            'validation_input_required',
            'not_supported'
        )),
    status                          TEXT        NOT NULL
        CHECK (status IN (
            'success',
            'failed',
            'blocked',
            'requires_credentials',
            'input_required',
            'not_supported'
        )),
    http_status                     INTEGER     NULL
        CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
    response_time_ms                INTEGER     NULL
        CHECK (response_time_ms IS NULL OR response_time_ms >= 0),

    -- URL sanitizada (sin query params sensibles)
    tested_url                      TEXT        NULL
        CHECK (tested_url IS NULL OR length(tested_url) <= 2000),

    -- Metadatos de respuesta
    content_type                    TEXT        NULL,
    content_length                  BIGINT      NULL
        CHECK (content_length IS NULL OR content_length >= 0),

    -- Diagnóstico
    error_code                      TEXT        NOT NULL
        CHECK (error_code IN (
            'OK',
            'HTTP_403_FORBIDDEN',
            'HTTP_404_NOT_FOUND',
            'HTTP_429_RATE_LIMITED',
            'HTTP_5XX',
            'TIMEOUT',
            'DNS_ERROR',
            'SSL_ERROR',
            'CAPTCHA_OR_BOT_PROTECTION',
            'CREDENTIALS_REQUIRED',
            'INPUT_REQUIRED',
            'UNSUPPORTED_SOURCE_TYPE',
            'INVALID_RESPONSE_SHAPE',
            'LARGE_DOWNLOAD_SKIPPED',
            'UNKNOWN_ERROR'
        )),
    error_message_sanitized         TEXT        NULL
        CHECK (error_message_sanitized IS NULL OR length(error_message_sanitized) <= 500),
    recommendation                  TEXT        NULL,

    -- Metadata adicional sanitizada
    metadata                        JSONB       NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),

    -- Timestamps
    checked_at                      TIMESTAMPTZ NOT NULL,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Índices ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_source_connection_tests_source_key
    ON source_connection_tests (source_key);

CREATE INDEX IF NOT EXISTS idx_source_connection_tests_tested_by_user_id
    ON source_connection_tests (tested_by_user_id);

CREATE INDEX IF NOT EXISTS idx_source_connection_tests_checked_at
    ON source_connection_tests (checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_connection_tests_source_key_checked_at
    ON source_connection_tests (source_key, checked_at DESC);

-- ── 3. RLS ────────────────────────────────────────────────────

ALTER TABLE source_connection_tests ENABLE ROW LEVEL SECURITY;

-- SELECT: usuarios internos activos pueden leer el historial
CREATE POLICY "active_users_can_read_source_connection_tests"
    ON source_connection_tests FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

-- INSERT: usuarios internos activos pueden insertar resultados
CREATE POLICY "active_users_can_insert_source_connection_tests"
    ON source_connection_tests FOR INSERT
    TO authenticated
    WITH CHECK (has_active_access(auth.uid()));

-- UPDATE: no permitido (registro inmutable de auditoría)
-- DELETE: no permitido (registro inmutable de auditoría)
-- No se crean políticas permisivas para UPDATE ni DELETE.

-- ── 4. Comentarios ────────────────────────────────────────────

COMMENT ON TABLE source_connection_tests IS
    'Historial auditado de pruebas de conexión a fuentes del catálogo. Registro inmutable: no se permite UPDATE ni DELETE.';

COMMENT ON COLUMN source_connection_tests.tested_url IS
    'URL sanitizada: query params sensibles redactados, máximo 2000 caracteres.';

COMMENT ON COLUMN source_connection_tests.error_message_sanitized IS
    'Mensaje de error truncado y sanitizado a 500 caracteres máximo.';

COMMENT ON COLUMN source_connection_tests.metadata IS
    'Metadata adicional sanitizada: sin body, html, headers ni valores sensibles.';
