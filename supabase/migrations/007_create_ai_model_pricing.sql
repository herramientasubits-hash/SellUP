-- Tabla de tarifas por modelo
-- Registro histórico de tarifas input/output

CREATE TABLE IF NOT EXISTS ai_model_pricing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID NOT NULL REFERENCES ai_models(id) ON DELETE CASCADE,
    input_cost_per_million_tokens DECIMAL(10, 4) NOT NULL,
    output_cost_per_million_tokens DECIMAL(10, 4) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to TIMESTAMPTZ,
    is_current BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES internal_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_ai_model_pricing_model ON ai_model_pricing(model_id);
CREATE INDEX IF NOT EXISTS idx_ai_model_pricing_current ON ai_model_pricing(model_id, is_current) WHERE is_current = true;

-- Tabla de configuración activa de IA
CREATE TABLE IF NOT EXISTS ai_active_config (
    id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
    active_provider_id UUID REFERENCES ai_providers(id),
    active_model_id UUID REFERENCES ai_models(id),
    updated_by UUID REFERENCES internal_users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Función para obtener tarifa vigente de un modelo
CREATE OR REPLACE FUNCTION get_current_pricing(p_model_id UUID)
RETURNS TABLE(
    id UUID,
    model_id UUID,
    input_cost_per_million_tokens DECIMAL,
    output_cost_per_million_tokens DECIMAL,
    currency TEXT,
    effective_from TIMESTAMPTZ
) AS $$
    SELECT id, model_id, input_cost_per_million_tokens, output_cost_per_million_tokens, currency, effective_from
    FROM ai_model_pricing
    WHERE model_id = p_model_id AND is_current = true
    ORDER BY effective_from DESC
    LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Función para obtener la configuración activa
CREATE OR REPLACE FUNCTION get_ai_active_config()
RETURNS TABLE(
    active_provider_id UUID,
    active_model_id UUID,
    provider_name TEXT,
    model_name TEXT,
    updated_at TIMESTAMPTZ
) AS $$
    SELECT 
        c.active_provider_id,
        c.active_model_id,
        p.name as provider_name,
        m.name as model_name,
        c.updated_at
    FROM ai_active_config c
    LEFT JOIN ai_providers p ON c.active_provider_id = p.id
    LEFT JOIN ai_models m ON c.active_model_id = m.id
    WHERE c.id = '00000000-0000-0000-0000-000000000001'::uuid;
$$ LANGUAGE sql STABLE;

-- Función para obtener proveedores con sus modelos
CREATE OR REPLACE FUNCTION get_providers_with_models()
RETURNS TABLE(
    provider_id UUID,
    provider_name TEXT,
    provider_key TEXT,
    provider_status TEXT,
    model_id UUID,
    model_name TEXT,
    model_key TEXT,
    model_status TEXT
) AS $$
    SELECT 
        p.id as provider_id,
        p.name as provider_name,
        p.key as provider_key,
        p.status as provider_status,
        m.id as model_id,
        m.name as model_name,
        m.key as model_key,
        m.status as model_status
    FROM ai_providers p
    LEFT JOIN ai_models m ON p.id = m.provider_id
    ORDER BY p.name, m.name;
$$ LANGUAGE sql STABLE;

-- Función para actualizar la configuración activa
CREATE OR REPLACE FUNCTION set_ai_active_config(
    p_provider_id UUID,
    p_model_id UUID,
    p_updated_by UUID
)
RETURNS VOID AS $$
BEGIN
    UPDATE ai_active_config
    SET active_provider_id = p_provider_id,
        active_model_id = p_model_id,
        updated_by = p_updated_by,
        updated_at = NOW()
    WHERE id = '00000000-0000-0000-0000-000000000001'::uuid;
END;
$$ LANGUAGE plpgsql;