-- Tabla de grupos organizacionales.
-- Estructura independiente de la jerarquía manager_id.
-- manager_id → quién reporta a quién (jerarquía de personas)
-- group_id   → a qué unidad organizacional pertenece (estructura de la empresa)
-- Máximo 3 niveles: depth 0 = raíz, 1 = hijo, 2 = nieto.

CREATE TABLE IF NOT EXISTS organization_groups (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT         NOT NULL,
    description     TEXT,
    parent_group_id UUID         REFERENCES organization_groups(id) ON DELETE SET NULL,
    depth           INT          NOT NULL DEFAULT 0,
    created_by      UUID         REFERENCES internal_users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Un grupo no puede ser padre de sí mismo
ALTER TABLE organization_groups
    ADD CONSTRAINT chk_org_group_no_self_parent
    CHECK (parent_group_id IS NULL OR parent_group_id <> id);

-- Profundidad máxima 2 (= 3 niveles: 0, 1, 2)
ALTER TABLE organization_groups
    ADD CONSTRAINT chk_org_group_max_depth
    CHECK (depth >= 0 AND depth <= 2);

-- Trigger: calcula depth automáticamente en insert/update del parent
CREATE OR REPLACE FUNCTION fn_set_org_group_depth()
RETURNS TRIGGER AS $$
DECLARE
    v_parent_depth INT;
BEGIN
    IF NEW.parent_group_id IS NULL THEN
        NEW.depth := 0;
    ELSE
        SELECT depth INTO v_parent_depth
        FROM organization_groups
        WHERE id = NEW.parent_group_id;

        IF v_parent_depth IS NULL THEN
            RAISE EXCEPTION 'El grupo padre no existe.';
        END IF;

        IF v_parent_depth >= 2 THEN
            RAISE EXCEPTION 'No se puede crear el grupo: se superaría el máximo de 3 niveles.';
        END IF;

        NEW.depth := v_parent_depth + 1;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_org_group_depth
    BEFORE INSERT OR UPDATE OF parent_group_id
    ON organization_groups
    FOR EACH ROW EXECUTE FUNCTION fn_set_org_group_depth();

CREATE INDEX IF NOT EXISTS idx_org_groups_parent ON organization_groups(parent_group_id);
CREATE INDEX IF NOT EXISTS idx_org_groups_depth  ON organization_groups(depth);
