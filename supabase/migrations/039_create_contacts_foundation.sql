-- ============================================================
-- Migration 039: Foundation de Contactos
-- ============================================================
-- Crea las tablas contacts y contact_audit con RLS,
-- índices y trigger de updated_at.
-- Preparada para HubSpot, Apollo, Lusha, Agente 1 y agentes futuros.
-- Depende de: 038_create_accounts_foundation.sql
-- ============================================================

-- ── 1. Tabla contacts ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

    -- Identidad
    first_name          TEXT        NULL,
    last_name           TEXT        NULL,
    full_name           TEXT        NOT NULL,
    email               TEXT        NULL,
    phone               TEXT        NULL,
    mobile_phone        TEXT        NULL,
    linkedin_url        TEXT        NULL,

    -- Cargo y función
    job_title           TEXT        NULL,
    department          TEXT        NULL,
    seniority           TEXT        NULL
        CHECK (seniority IN (
            'c_level', 'vp', 'director', 'manager',
            'individual_contributor', 'unknown'
        )),
    role_in_account     TEXT        NULL
        CHECK (role_in_account IN (
            'decision_maker', 'economic_buyer', 'champion', 'influencer',
            'evaluator', 'technical_stakeholder', 'hr_leader', 'learning_leader',
            'procurement', 'unknown'
        )),

    -- Estado
    contact_status      TEXT        NOT NULL DEFAULT 'active'
        CHECK (contact_status IN (
            'active', 'inactive', 'left_company', 'do_not_contact', 'archived'
        )),

    -- Fuente
    source              TEXT        NOT NULL DEFAULT 'manual'
        CHECK (source IN (
            'manual', 'hubspot', 'apollo', 'lusha', 'agent_1', 'imported', 'other'
        )),

    -- Integraciones externas
    hubspot_contact_id  TEXT        NULL,

    -- Calidad de datos
    email_confidence    TEXT        NULL
        CHECK (email_confidence IN ('unknown', 'low', 'medium', 'high', 'verified')),
    phone_confidence    TEXT        NULL
        CHECK (phone_confidence IN ('unknown', 'low', 'medium', 'high', 'verified')),

    -- Flags
    is_primary          BOOLEAN     NOT NULL DEFAULT false,

    -- Contexto libre
    notes               TEXT        NULL,
    metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb,

    -- Auditoría de usuarios
    created_by          UUID        NULL REFERENCES internal_users(id),
    updated_by          UUID        NULL REFERENCES internal_users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at         TIMESTAMPTZ NULL,
    archived_by         UUID        NULL REFERENCES internal_users(id)
);

-- ── 2. Tabla contact_audit ────────────────────────────────────

CREATE TABLE IF NOT EXISTS contact_audit (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      UUID        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    actor_user_id   UUID        NULL REFERENCES internal_users(id),
    action_type     TEXT        NOT NULL
        CHECK (action_type IN (
            'contact_created', 'contact_updated', 'contact_status_changed',
            'contact_archived', 'contact_primary_changed', 'contact_role_changed'
        )),
    details         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. Trigger updated_at ─────────────────────────────────────

-- Reutiliza set_updated_at() ya definida en migración 038.
-- Si por alguna razón no existe, la creamos aquí.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contacts_set_updated_at ON contacts;
CREATE TRIGGER contacts_set_updated_at
    BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 4. Índices ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_contacts_account_id
    ON contacts (account_id);

CREATE INDEX IF NOT EXISTS idx_contacts_email
    ON contacts (email)
    WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_full_name
    ON contacts (full_name);

CREATE INDEX IF NOT EXISTS idx_contacts_contact_status
    ON contacts (contact_status);

CREATE INDEX IF NOT EXISTS idx_contacts_role_in_account
    ON contacts (role_in_account)
    WHERE role_in_account IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_source
    ON contacts (source);

CREATE INDEX IF NOT EXISTS idx_contacts_hubspot_contact_id
    ON contacts (hubspot_contact_id)
    WHERE hubspot_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_created_at
    ON contacts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contacts_is_primary
    ON contacts (account_id, is_primary)
    WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_contact_audit_contact_id
    ON contact_audit (contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_audit_account_id
    ON contact_audit (account_id);

CREATE INDEX IF NOT EXISTS idx_contact_audit_created_at
    ON contact_audit (created_at DESC);

-- ── 5. RLS ────────────────────────────────────────────────────

ALTER TABLE contacts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_audit  ENABLE ROW LEVEL SECURITY;

-- contacts: lectura para usuarios activos
CREATE POLICY "active_users_can_read_contacts"
    ON contacts FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

-- contacts: insertar para usuarios activos
CREATE POLICY "active_users_can_insert_contacts"
    ON contacts FOR INSERT
    TO authenticated
    WITH CHECK (has_active_access(auth.uid()));

-- contacts: actualizar para usuarios activos
CREATE POLICY "active_users_can_update_contacts"
    ON contacts FOR UPDATE
    TO authenticated
    USING  (has_active_access(auth.uid()))
    WITH CHECK (has_active_access(auth.uid()));

-- contact_audit: lectura para usuarios activos
CREATE POLICY "active_users_can_read_contact_audit"
    ON contact_audit FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

-- contact_audit: insertar para usuarios activos
CREATE POLICY "active_users_can_insert_contact_audit"
    ON contact_audit FOR INSERT
    TO authenticated
    WITH CHECK (has_active_access(auth.uid()));

-- ── 6. Comentarios ───────────────────────────────────────────

COMMENT ON TABLE contacts IS
    'Contactos vinculados a cuentas. Preparada para HubSpot, Apollo, Lusha y Agente 1.';

COMMENT ON TABLE contact_audit IS
    'Registro de auditoría de cambios en contactos.';
