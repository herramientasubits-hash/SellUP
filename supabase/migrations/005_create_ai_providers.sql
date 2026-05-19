-- Tabla de proveedores de IA
-- Catálogo administrable de proveedores de IA

CREATE TABLE IF NOT EXISTS ai_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'not_configured' CHECK (
        status IN ('active', 'inactive', 'not_configured', 'error')
    ),
    is_available_for_selection BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed de proveedores iniciales
INSERT INTO ai_providers (key, name, description, status, is_available_for_selection) VALUES
    ('openai', 'OpenAI', 'Proveedor de modelos GPT (ChatGPT, GPT-4)', 'inactive', true),
    ('google', 'Google Gemini', 'Proveedor de modelos Gemini de Google', 'inactive', true),
    ('anthropic', 'Claude', 'Proveedor de modelos Claude de Anthropic', 'inactive', true)
ON CONFLICT (key) DO NOTHING;

-- Índice para búsquedas
CREATE INDEX IF NOT EXISTS idx_ai_providers_key ON ai_providers(key);
CREATE INDEX IF NOT EXISTS idx_ai_providers_status ON ai_providers(status);

-- Función para obtener proveedor por key
CREATE OR REPLACE FUNCTION get_ai_provider_by_key(p_key TEXT)
RETURNS TABLE(
    id UUID,
    key TEXT,
    name TEXT,
    description TEXT,
    status TEXT,
    is_available_for_selection BOOLEAN
) AS $$
    SELECT id, key, name, description, status, is_available_for_selection 
    FROM ai_providers WHERE key = p_key;
$$ LANGUAGE sql STABLE;

-- Función para obtener todos los proveedores
CREATE OR REPLACE FUNCTION get_all_ai_providers()
RETURNS TABLE(
    id UUID,
    key TEXT,
    name TEXT,
    description TEXT,
    status TEXT,
    is_available_for_selection BOOLEAN,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
    SELECT id, key, name, description, status, is_available_for_selection, created_at, updated_at 
    FROM ai_providers ORDER BY name;
$$ LANGUAGE sql STABLE;

-- Función para contar modelos por proveedor
CREATE OR REPLACE FUNCTION count_ai_models_by_provider(p_provider_id UUID)
RETURNS INTEGER AS $$
    SELECT COUNT(*)::INTEGER FROM ai_models WHERE provider_id = p_provider_id;
$$ LANGUAGE sql STABLE;