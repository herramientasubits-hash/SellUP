-- ============================================================
-- Migration 050: Seed ChileCompra en source_catalog_connections
-- ============================================================
-- Registra ChileCompra / Mercado Público como fuente piloto.
-- Requiere ticket API (gratuito, por email en Mercado Público).
-- catalog_key = 'cl_chilecompra' permite resolución por metadata->catalog_key.
-- El secreto se guarda como 'sellup_source_chilecompra_ticket' en Vault.
-- La credencial real NUNCA se almacena aquí.
-- Hito 16AI.4.
-- ============================================================

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
    'chilecompra_chile',
    'ChileCompra / Mercado Público',
    'CL',
    'api_key',
    TRUE,
    'missing',
    'not_tested',
    'sellup_source_chilecompra_ticket',
    '{
        "source_provider": "chilecompra_chile",
        "source_type": "structured_procurement",
        "source_mode": "pilot",
        "catalog_key": "cl_chilecompra",
        "credential_label": "Ticket ChileCompra",
        "credential_env_fallback": "CHILECOMPRA_API_TICKET"
    }'::jsonb
)
ON CONFLICT (source_key) DO NOTHING;
