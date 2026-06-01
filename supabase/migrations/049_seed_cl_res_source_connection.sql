-- ============================================================
-- Migration 049: Seed RES Chile en source_catalog_connections
-- ============================================================
-- Agrega la entrada de datos.gob.cl / RES Chile como fuente piloto.
-- Sin credencial requerida — acceso público CKAN.
-- catalog_key = 'cl_res' permite la resolución por metadata->catalog_key
-- que ya implementa getSourceConnectionRecord.
-- Hito 16AH.3.
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
    'datos_gob_cl',
    'RES Chile / datos.gob.cl',
    'CL',
    'none',
    FALSE,
    'not_required',
    'not_applicable',
    NULL,
    '{
        "source_provider": "datos_gob_cl",
        "source_type": "structured_registry",
        "source_mode": "pilot",
        "catalog_key": "cl_res",
        "dataset": "Registro de Empresas y Sociedades",
        "dataset_id": "363edd60-4919-4ff1-b85f-f8e14d61285a",
        "resource_id": "71c8e355-226a-461e-809a-870c2275a178"
    }'::jsonb
)
ON CONFLICT (source_key) DO NOTHING;
