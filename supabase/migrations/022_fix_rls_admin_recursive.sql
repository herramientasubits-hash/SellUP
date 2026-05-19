-- Fix: las políticas RLS en internal_users hacían una sub-consulta recursiva
-- a la misma tabla, lo que causa que admins no puedan ver usuarios pendientes.
-- Solución: función SECURITY DEFINER que verifica si un auth_user_id es admin,
-- sin pasar por RLS (evita la recursión).

CREATE OR REPLACE FUNCTION is_admin_user(p_auth_user_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS(
        SELECT 1 FROM internal_users iu
        JOIN roles r ON iu.role_id = r.id
        WHERE iu.auth_user_id = p_auth_user_id
        AND iu.access_status = 'active'
        AND r.key = 'admin'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Reemplazar políticas recursivas con la función SECURITY DEFINER

DROP POLICY IF EXISTS "Admins can read all internal users" ON internal_users;
CREATE POLICY "Admins can read all internal users" ON internal_users
    FOR SELECT USING (is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Admins can insert internal users" ON internal_users;
CREATE POLICY "Admins can insert internal users" ON internal_users
    FOR INSERT WITH CHECK (is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Admins can update internal users" ON internal_users;
CREATE POLICY "Admins can update internal users" ON internal_users
    FOR UPDATE USING (is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Only admins can manage roles" ON roles;
CREATE POLICY "Only admins can manage roles" ON roles
    FOR ALL USING (is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Admins can read all audit" ON access_audit;
CREATE POLICY "Admins can read all audit" ON access_audit
    FOR SELECT USING (is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Admins can insert audit" ON access_audit;
CREATE POLICY "Admins can insert audit" ON access_audit
    FOR INSERT WITH CHECK (is_admin_user(auth.uid()));
