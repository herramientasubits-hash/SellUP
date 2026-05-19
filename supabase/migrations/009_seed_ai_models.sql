-- Limpiar modelos existentes
DELETE FROM ai_models;

-- ============================================
-- OPENAI Models
-- ============================================
INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'o4-mini', 'o4-mini', 'Modelo pequeño de OpenAI Reasoning', 'inactive', 200000
FROM ai_providers WHERE key = 'openai';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'gpt-4.1', 'GPT-4.1', 'Modelo reasoning de OpenAI', 'inactive', 200000
FROM ai_providers WHERE key = 'openai';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'gpt-4.1-mini', 'GPT-4.1 Mini', 'Modelo mini de OpenAI', 'inactive', 200000
FROM ai_providers WHERE key = 'openai';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'gpt-4o', 'GPT-4o', 'Modelo multimodal avanzado', 'inactive', 128000
FROM ai_providers WHERE key = 'openai';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'gpt-4o-mini', 'GPT-4o Mini', 'Modelo multimodal rápido', 'inactive', 128000
FROM ai_providers WHERE key = 'openai';

-- ============================================
-- GOOGLE GEMINI Models (incluyendo 3.0 y 3.1 más recientes)
-- ============================================
INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'gemini-3.1-pro', 'Gemini 3.1 Pro', 'Modelo más potente de Google con reasoning avanzado y modoエージェント', 'inactive', 2000000
FROM ai_providers WHERE key = 'google';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'gemini-3.1-flash', 'Gemini 3.1 Flash', 'Modelo rápido de última generación de Google', 'inactive', 1000000
FROM ai_providers WHERE key = 'google';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'gemini-3.0-pro', 'Gemini 3.0 Pro', 'Modelo pro de Gemini 3.0', 'inactive', 2000000
FROM ai_providers WHERE key = 'google';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'gemini-3.0-flash', 'Gemini 3.0 Flash', 'Modelo flash de Gemini 3.0', 'inactive', 1000000
FROM ai_providers WHERE key = 'google';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'gemini-2.5-pro', 'Gemini 2.5 Pro', 'Modelo pro de Gemini 2.5', 'inactive', 2000000
FROM ai_providers WHERE key = 'google';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'gemini-2.5-flash', 'Gemini 2.5 Flash', 'Modelo flash de Gemini 2.5', 'inactive', 1000000
FROM ai_providers WHERE key = 'google';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'gemini-2.0-pro', 'Gemini 2.0 Pro', 'Modelo pro de Gemini 2.0', 'inactive', 2000000
FROM ai_providers WHERE key = 'google';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'gemini-2.0-flash', 'Gemini 2.0 Flash', 'Modelo rápido de Gemini 2.0', 'inactive', 1000000
FROM ai_providers WHERE key = 'google';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'gemini-1.5-pro', 'Gemini 1.5 Pro', 'Modelo pro de Gemini 1.5', 'inactive', 2000000
FROM ai_providers WHERE key = 'google';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'gemini-1.5-flash-8b', 'Gemini 1.5 Flash 8B', 'Modelo flash ligero de Gemini', 'inactive', 1000000
FROM ai_providers WHERE key = 'google';

-- ============================================
-- ANTHROPIC CLAUDE Models
-- ============================================
INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'claude-sonnet-4-20250514', 'Claude Sonnet 4 (May 2026)', 'Modelo equilibrado más reciente de Anthropic', 'inactive', 200000
FROM ai_providers WHERE key = 'anthropic';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet', 'Modelo Sonnet anterior', 'inactive', 200000
FROM ai_providers WHERE key = 'anthropic';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'claude-3-5-haiku-20241022', 'Claude 3.5 Haiku', 'Modelo rápido de Anthropic', 'inactive', 200000
FROM ai_providers WHERE key = 'anthropic';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'claude-3-opus-20240229', 'Claude 3 Opus', 'Modelo más capaz de Anthropic', 'inactive', 200000
FROM ai_providers WHERE key = 'anthropic';

INSERT INTO ai_models (provider_id, key, name, description, status, context_window_tokens)
SELECT id, 'claude-3-sonnet-20240229', 'Claude 3 Sonnet', 'Modelo equilibrado de Claude 3', 'inactive', 200000
FROM ai_providers WHERE key = 'anthropic';