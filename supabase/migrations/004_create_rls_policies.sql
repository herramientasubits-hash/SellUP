-- Políticas RLS para tablas de acceso y roles
-- Solo usuarios activos con rol de admin pueden gestionar usuarios

-- Habilitar RLS en todas las tablas relevantes
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_audit ENABLE ROW LEVEL SECURITY;

-- ============================================
-- POLÍTICAS PARA ROLES
-- ============================================

-- Todos pueden leer roles (necesario para UI)
CREATE POLICY "Anyone can read roles" ON roles
    FOR SELECT USING (true);

-- Solo admins pueden modificar roles (MVP: no permitir modificación)
CREATE POLICY "Only admins can manage roles" ON roles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM internal_users iu
            JOIN roles r ON iu.role_id = r.id
            WHERE iu.auth_user_id = auth.uid()
            AND iu.access_status = 'active'
            AND r.key = 'admin'
        )
    );

-- ============================================
-- POLÍTICAS PARA INTERNAL_USERS
-- ============================================

-- Usuarios pueden leer su propio registro
CREATE POLICY "Users can read own record" ON internal_users
    FOR SELECT USING (auth_user_id = auth.uid());

-- Admins pueden leer todos los usuarios internos
CREATE POLICY "Admins can read all internal users" ON internal_users
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM internal_users iu
            JOIN roles r ON iu.role_id = r.id
            WHERE iu.auth_user_id = auth.uid()
            AND iu.access_status = 'active'
            AND r.key = 'admin'
        )
    );

--Solo admins pueden hacer INSERT (para bootstrapping inicial)
CREATE POLICY "Admins can insert internal users" ON internal_users
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM internal_users iu
            JOIN roles r ON iu.role_id = r.id
            WHERE iu.auth_user_id = auth.uid()
            AND iu.access_status = 'active'
            AND r.key = 'admin'
        )
    );

-- Solo admins pueden hacer UPDATE (gestión de usuarios)
CREATE POLICY "Admins can update internal users" ON internal_users
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM internal_users iu
            JOIN roles r ON iu.role_id = r.id
            WHERE iu.auth_user_id = auth.uid()
            AND iu.access_status = 'active'
            AND r.key = 'admin'
        )
    );

-- Nadie puede eliminar usuarios internos (auditoría)
CREATE POLICY "No delete on internal users" ON internal_users
    FOR DELETE USING (false);

-- ============================================
-- POLÍTICAS PARA ACCESS_AUDIT
-- ============================================

-- Usuarios pueden leer su propio historial
CREATE POLICY "Users can read own audit history" ON access_audit
    FOR SELECT USING (
        target_user_id IN (
            SELECT id FROM internal_users WHERE auth_user_id = auth.uid()
        )
    );

-- Admins pueden leer toda la auditoría
CREATE POLICY "Admins can read all audit" ON access_audit
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM internal_users iu
            JOIN roles r ON iu.role_id = r.id
            WHERE iu.auth_user_id = auth.uid()
            AND iu.access_status = 'active'
            AND r.key = 'admin'
        )
    );

-- Solo admins pueden insertar registros de auditoría
CREATE POLICY "Admins can insert audit" ON access_audit
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM internal_users iu
            JOIN roles r ON iu.role_id = r.id
            WHERE iu.auth_user_id = auth.uid()
            AND iu.access_status = 'active'
            AND r.key = 'admin'
        )
    );

-- Nadie puede modificar o eliminar auditoría
CREATE POLICY "No update on audit" ON access_audit
    FOR UPDATE USING (false);

CREATE POLICY "No delete on audit" ON access_audit
    FOR DELETE USING (false);