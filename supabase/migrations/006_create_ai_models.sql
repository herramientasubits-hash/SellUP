-- Tabla de modelos de IA
-- Modelos disponibles por proveedor

CREATE TABLE IF NOT EXISTS ai_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'inactive' CHECK (
        status IN ('active', 'inactive', 'not_configured', 'error')
    ),
    is_selectable BOOLEAN NOT NULL DEFAULT true,
    context_window_tokens INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider_id, key)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_models_status ON ai_models(status);
CREATE INDEX IF NOT EXISTS idx_ai_models_key ON ai_models(key);

-- Seed de modelos iniciales (sin tarifas)
INSERT INTO ai_models (provider_id, key, name, description, status, is_selectable, context_window_tokens)
SELECT 
    id,
    'gpt-4o',
    'GPT-4o',
    'Modelo multimodal más reciente de OpenAI',
    'inactive',
    true,
    128000
FROM ai_providers WHERE key = 'openai'
ON CONFLICT (provider_id, key) DO NOTHING;

INSERT INTO ai_models (provider_id, key, name, description, status, is_selectable, context_window_tokens)
SELECT 
    id,
    'gpt-4-turbo',
    'GPT-4 Turbo',
    'Versión optimizada de GPT-4 con menor latencia',
    'inactive',
    true,
    128000
FROM ai_providers WHERE key = 'openai'
ON CONFLICT (provider_id, key) DO NOTHING;

INSERT INTO ai_models (provider_id, key, name, description, status, is_selectable, context_window_tokens)
SELECT 
    id,
    'gemini-2.0-flash',
    'Gemini 2.0 Flash',
    'Modelo rápido de Google Gemini',
    'inactive',
    true,
    1000000
FROM ai_providers WHERE key = 'google'
ON CONFLICT (provider_id, key) DO NOTHING;

INSERT INTO ai_models (provider_id, key, name, description, status, is_selectable, context_window_tokens)
SELECT 
    id,
    'gemini-1.5-pro',
    'Gemini 1.5 Pro',
    'Modelo avanzado de Google Gemini con mayor capacidad',
    'inactive',
    true,
    2000000
FROM ai_providers WHERE key = 'google'
ON CONFLICT (provider_id, key) DO NOTHING;

INSERT INTO ai_models (provider_id, key, name, description, status, is_selectable, context_window_tokens)
SELECT 
    id,
    'claude-3-5-sonnet',
    'Claude 3.5 Sonnet',
    'Modelo equilibrado de Anthropic',
    'inactive',
    true,
    200000
FROM ai_providers WHERE key = 'anthropic'
ON CONFLICT (provider_id, key) DO NOTHING;

INSERT INTO ai_models (provider_id, key, name, description, status, is_selectable, context_window_tokens)
SELECT 
    id,
    'claude-3-opus',
    'Claude 3 Opus',
    'Modelo más capaz de Anthropic',
    'inactive',
    true,
    200000
FROM ai_providers WHERE key = 'anthropic'
ON CONFLICT (provider_id, key) DO NOTHING;

-- Función para obtener modelos por proveedor
CREATE OR REPLACE FUNCTION get_ai_models_by_provider(p_provider_id UUID)
RETURNS TABLE(
    id UUID,
    provider_id UUID,
    key TEXT,
    name TEXT,
    description TEXT,
    status TEXT,
    is_selectable BOOLEAN,
    context_window_tokens INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
    SELECT id, provider_id, key, name, description, status, is_selectable, context_window_tokens, created_at, updated_at 
    FROM ai_models WHERE provider_id = p_provider_id ORDER BY name;
$$ LANGUAGE sql STABLE;

-- Función para obtener modelo por ID
CREATE OR REPLACE FUNCTION get_ai_model_by_id(p_model_id UUID)
RETURNS TABLE(
    id UUID,
    provider_id UUID,
    key TEXT,
    name TEXT,
    description TEXT,
    status TEXT,
    is_selectable BOOLEAN,
    context_window_tokens INTEGER,
    provider_name TEXT
) AS $$
    SELECT 
        m.id, m.provider_id, m.key, m.name, m.description, m.status, 
        m.is_selectable, m.context_window_tokens, p.name as provider_name
    FROM ai_models m
    JOIN ai_providers p ON m.provider_id = p.id
    WHERE m.id = p_model_id;
$$ LANGUAGE sql STABLE;