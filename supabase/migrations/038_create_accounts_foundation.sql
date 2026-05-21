-- ============================================================
-- Migration 038: Foundation de Cuentas / Prospectos
-- ============================================================
-- Crea las tablas accounts y account_audit con RLS,
-- índices y trigger de updated_at.
-- Preparada para integrarse con prospect_batches, Agente 1,
-- HubSpot, Apollo y Lusha en migraciones futuras.
-- ============================================================

-- ── 1. Tabla accounts ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS accounts (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  TEXT        NOT NULL,
    legal_name            TEXT        NULL,
    normalized_name       TEXT        NULL,
    website               TEXT        NULL,
    domain                TEXT        NULL,
    country               TEXT        NULL,
    country_code          TEXT        NULL,
    city                  TEXT        NULL,
    region                TEXT        NULL,
    industry              TEXT        NULL,
    company_size          TEXT        NULL,
    tax_identifier        TEXT        NULL,
    tax_identifier_type   TEXT        NULL
        CHECK (tax_identifier_type IN (
            'NIT', 'RFC', 'RUT', 'RUC', 'CUIT', 'CNPJ',
            'RNC', 'RTN', 'cedula_juridica', 'other'
        )),
    source                TEXT        NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'agent_1', 'hubspot', 'apollo', 'imported', 'other')),
    pipeline_status       TEXT        NOT NULL DEFAULT 'new'
        CHECK (pipeline_status IN (
            'new', 'ready_for_research', 'research_in_progress',
            'ready_for_outreach', 'archived'
        )),
    pipeline_substatus    TEXT        NULL,
    owner_id              UUID        NULL REFERENCES internal_users(id),
    created_by            UUID        NULL REFERENCES internal_users(id),
    updated_by            UUID        NULL REFERENCES internal_users(id),
    hubspot_company_id    TEXT        NULL,
    metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
    notes                 TEXT        NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at           TIMESTAMPTZ NULL,
    archived_by           UUID        NULL REFERENCES internal_users(id)
);

-- ── 2. Tabla account_audit ───────────────────────────────────

CREATE TABLE IF NOT EXISTS account_audit (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    actor_user_id   UUID        NULL REFERENCES internal_users(id),
    action_type     TEXT        NOT NULL
        CHECK (action_type IN (
            'account_created', 'account_updated', 'account_status_changed',
            'account_archived', 'account_owner_changed'
        )),
    details         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. Trigger updated_at en accounts ────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accounts_set_updated_at ON accounts;
CREATE TRIGGER accounts_set_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 4. Índices ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_accounts_name
    ON accounts (name);

CREATE INDEX IF NOT EXISTS idx_accounts_normalized_name
    ON accounts (normalized_name)
    WHERE normalized_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_domain
    ON accounts (domain)
    WHERE domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_country_code
    ON accounts (country_code)
    WHERE country_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_industry
    ON accounts (industry)
    WHERE industry IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_pipeline_status
    ON accounts (pipeline_status);

CREATE INDEX IF NOT EXISTS idx_accounts_owner_id
    ON accounts (owner_id)
    WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_hubspot_company_id
    ON accounts (hubspot_company_id)
    WHERE hubspot_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_tax_identifier
    ON accounts (tax_identifier, tax_identifier_type)
    WHERE tax_identifier IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_created_at
    ON accounts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_accounts_archived_at
    ON accounts (archived_at)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_account_audit_account_id
    ON account_audit (account_id);

CREATE INDEX IF NOT EXISTS idx_account_audit_created_at
    ON account_audit (created_at DESC);

-- ── 5. RLS ────────────────────────────────────────────────────

ALTER TABLE accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_audit  ENABLE ROW LEVEL SECURITY;

-- accounts: lectura para usuarios activos
CREATE POLICY "active_users_can_read_accounts"
    ON accounts FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

-- accounts: insertar para usuarios activos
CREATE POLICY "active_users_can_insert_accounts"
    ON accounts FOR INSERT
    TO authenticated
    WITH CHECK (has_active_access(auth.uid()));

-- accounts: actualizar para usuarios activos (archivar incluido)
CREATE POLICY "active_users_can_update_accounts"
    ON accounts FOR UPDATE
    TO authenticated
    USING  (has_active_access(auth.uid()))
    WITH CHECK (has_active_access(auth.uid()));

-- account_audit: lectura para usuarios activos
CREATE POLICY "active_users_can_read_account_audit"
    ON account_audit FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

-- account_audit: insertar para usuarios activos
CREATE POLICY "active_users_can_insert_account_audit"
    ON account_audit FOR INSERT
    TO authenticated
    WITH CHECK (has_active_access(auth.uid()));

-- ── 6. Comentarios de tabla ───────────────────────────────────

COMMENT ON TABLE accounts IS
    'Entidad central de cuentas/prospectos. Preparada para prospect_batches, Agente 1, HubSpot y enriquecimiento.';

COMMENT ON TABLE account_audit IS
    'Registro de auditoría de cambios en cuentas.';
