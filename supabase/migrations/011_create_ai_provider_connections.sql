-- Tabla de conexiones de proveedores de IA
-- Almacena referencias a secretos en Vault y estados de conexión

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

-- Índices
CREATE INDEX IF NOT EXISTS idx_ai_provider_connections_provider ON ai_provider_connections(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_provider_connections_status ON ai_provider_connections(connection_status);

-- Función para actualizar timestamp automáticamente
CREATE OR REPLACE FUNCTION update_ai_provider_connection_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger
CREATE TRIGGER trigger_update_ai_provider_connection_timestamp
    BEFORE UPDATE ON ai_provider_connections
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_provider_connection_timestamp();

-- Habilitar RLS
ALTER TABLE ai_provider_connections ENABLE ROW LEVEL SECURITY;

-- Política de lectura para administradores
CREATE POLICY "Admin can read ai_provider_connections" ON ai_provider_connections
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM internal_users
            WHERE internal_users.auth_user_id = auth.uid()
            AND internal_users.access_status = 'active'
            AND internal_users.role = 'Administrador'
        )
    );

-- Política de escritura para administradores (a través de funciones)
CREATE POLICY "Admin can manage ai_provider_connections" ON ai_provider_connections
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM internal_users
            WHERE internal_users.auth_user_id = auth.uid()
            AND internal_users.access_status = 'active'
            AND internal_users.role = 'Administrador'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM internal_users
            WHERE internal_users.auth_user_id = auth.uid()
            AND internal_users.access_status = 'active'
            AND internal_users.role = 'Administrador'
        )
    );