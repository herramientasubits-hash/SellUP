-- Tabla de conexiones de proveedores de IA (solo estructura, sin políticas RLS duplicadas)

CREATE TABLE IF NOT EXISTS ai_provider_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
    vault_secret_id UUID,
    credentials_status TEXT NOT NULL DEFAULT 'missing' CHECK (
        credentials_status IN ('missing', 'stored')
    ),
    connection_status TEXT NOT NULL DEFAULT 'not_configured' CHECK (
        connection_status IN ('not_configured', 'not_tested', 'connected', 'error', 'disconnected')
    ),
    last_tested_at TIMESTAMPTZ,
    last_tested_by UUID REFERENCES internal_users(id),
    last_connection_error TEXT,
    connected_at TIMESTAMPTZ,
    connected_by UUID REFERENCES internal_users(id),
    disconnected_at TIMESTAMPTZ,
    disconnected_by UUID REFERENCES internal_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_connections_provider ON ai_provider_connections(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_provider_connections_status ON ai_provider_connections(connection_status);

-- Insertar registros para los proveedores existentes
INSERT INTO ai_provider_connections (provider_id, credentials_status, connection_status)
SELECT id, 'missing', 'not_configured'
FROM ai_providers
ON CONFLICT (provider_id) DO NOTHING;