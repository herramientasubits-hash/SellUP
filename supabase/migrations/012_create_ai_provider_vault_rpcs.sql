-- Funciones RPC para gestión segura de credenciales de proveedores IA
-- Estas funciones usan SECURITY DEFINER para ejecutar con privilegios elevados

-- Función para crear secreto en Vault
CREATE OR REPLACE FUNCTION create_ai_provider_secret(
    p_provider_key TEXT,
    p_api_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    secret_name TEXT;
    secret_id UUID;
BEGIN
    -- Validar que el usuario es administrador
    IF NOT EXISTS (
        SELECT 1 FROM internal_users
        WHERE internal_users.auth_user_id = auth.uid()
        AND internal_users.access_status = 'active'
        AND internal_users.role = 'Administrador'
    ) THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    -- Construir nombre único para el secreto
    secret_name := 'ai_provider_' || p_provider_key || '_api_key';

    -- Crear secreto en Vault
    INSERT INTO vault.secrets (name, secret, description)
    VALUES (
        secret_name,
        p_api_key,
        'API key para proveedor de IA: ' || p_provider_key
    )
    RETURNING id INTO secret_id;

    RETURN secret_id;
END;
$$;

-- Función para actualizar secreto en Vault
CREATE OR REPLACE FUNCTION update_ai_provider_secret(
    p_provider_key TEXT,
    p_new_api_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    secret_name TEXT;
    secret_id UUID;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM internal_users
        WHERE internal_users.auth_user_id = auth.uid()
        AND internal_users.access_status = 'active'
        AND internal_users.role = 'Administrador'
    ) THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    secret_name := 'ai_provider_' || p_provider_key || '_api_key';

    -- Obtener ID del secreto existente
    SELECT id INTO secret_id
    FROM vault.secrets
    WHERE name = secret_name;

    IF secret_id IS NOT NULL THEN
        -- Actualizar secreto existente
        UPDATE vault.secrets
        SET secret = p_new_api_key, updated_at = NOW()
        WHERE id = secret_id;
    ELSE
        -- Crear nuevo secreto si no existe
        INSERT INTO vault.secrets (name, secret, description)
        VALUES (
            secret_name,
            p_new_api_key,
            'API key para proveedor de IA: ' || p_provider_key
        )
        RETURNING id INTO secret_id;
    END IF;

    RETURN secret_id;
END;
$$;

-- Función para obtener secreto descifrado (solo para pruebas de conexión)
CREATE OR REPLACE FUNCTION get_ai_provider_secret(
    p_provider_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    secret_name TEXT;
    api_key TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM internal_users
        WHERE internal_users.auth_user_id = auth.uid()
        AND internal_users.access_status = 'active'
        AND internal_users.role = 'Administrador'
    ) THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    secret_name := 'ai_provider_' || p_provider_key || '_api_key';

    SELECT decrypted_secret INTO api_key
    FROM vault.decrypted_secrets
    WHERE name = secret_name
    LIMIT 1;

    RETURN api_key;
END;
$$;

-- Función para eliminar secreto de Vault
CREATE OR REPLACE FUNCTION delete_ai_provider_secret(
    p_provider_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    secret_name TEXT;
    deleted_count INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM internal_users
        WHERE internal_users.auth_user_id = auth.uid()
        AND internal_users.access_status = 'active'
        AND internal_users.role = 'Administrador'
    ) THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    secret_name := 'ai_provider_' || p_provider_key || '_api_key';

    DELETE FROM vault.secrets
    WHERE name = secret_name;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count > 0;
END;
$$;

-- Función para verificar si existe secreto
CREATE OR REPLACE FUNCTION has_ai_provider_secret(
    p_provider_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    secret_name TEXT;
    exists_flag BOOLEAN;
BEGIN
    secret_name := 'ai_provider_' || p_provider_key || '_api_key';

    SELECT EXISTS(SELECT 1 FROM vault.secrets WHERE name = secret_name) INTO exists_flag;

    RETURN exists_flag;
END;
$$;

-- Tabla de auditoría para eventos de proveedores IA
CREATE TABLE IF NOT EXISTS ai_provider_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    provider_id UUID REFERENCES ai_providers(id),
    user_id UUID REFERENCES internal_users(id),
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para auditoría
CREATE INDEX IF NOT EXISTS idx_ai_provider_audit_created ON ai_provider_audit(created_at DESC);

-- Habilitar RLS en auditoría
ALTER TABLE ai_provider_audit ENABLE ROW LEVEL SECURITY;

-- Política de lectura para auditoría
CREATE POLICY "Admin can read ai_provider_audit" ON ai_provider_audit
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

-- Función para registrar auditoría
CREATE OR REPLACE FUNCTION log_ai_provider_audit(
    p_event_type TEXT,
    p_provider_id UUID,
    p_details JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    current_user_id UUID;
BEGIN
    SELECT id INTO current_user_id
    FROM internal_users
    WHERE auth_user_id = auth.uid()
    LIMIT 1;

    INSERT INTO ai_provider_audit (event_type, provider_id, user_id, details)
    VALUES (p_event_type, p_provider_id, current_user_id, p_details);
END;
$$;