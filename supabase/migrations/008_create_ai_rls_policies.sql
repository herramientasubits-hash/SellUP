-- Políticas RLS para tablas de configuración de IA

-- Habilitar RLS
ALTER TABLE ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_model_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_active_config ENABLE ROW LEVEL SECURITY;

-- ==========================
-- AI Providers
-- ==========================

-- Todos pueden leer proveedores
CREATE POLICY "Anyone can read ai_providers" ON ai_providers
    FOR SELECT USING (true);

-- Solo admins pueden modificar proveedores
CREATE POLICY "Admins can manage ai_providers" ON ai_providers
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM internal_users iu
            JOIN roles r ON iu.role_id = r.id
            WHERE iu.auth_user_id = auth.uid()
            AND iu.access_status = 'active'
            AND r.key = 'admin'
        )
    );

-- ==========================
-- AI Models
-- ==========================

-- Todos pueden leer modelos
CREATE POLICY "Anyone can read ai_models" ON ai_models
    FOR SELECT USING (true);

-- Solo admins pueden modificar modelos
CREATE POLICY "Admins can manage ai_models" ON ai_models
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM internal_users iu
            JOIN roles r ON iu.role_id = r.id
            WHERE iu.auth_user_id = auth.uid()
            AND iu.access_status = 'active'
            AND r.key = 'admin'
        )
    );

-- ==========================
-- AI Model Pricing
-- ==========================

-- Solo admins pueden leer precios (información sensible)
CREATE POLICY "Admins can read ai_model_pricing" ON ai_model_pricing
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM internal_users iu
            JOIN roles r ON iu.role_id = r.id
            WHERE iu.auth_user_id = auth.uid()
            AND iu.access_status = 'active'
            AND r.key = 'admin'
        )
    );

-- Solo admins pueden modificar precios
CREATE POLICY "Admins can manage ai_model_pricing" ON ai_model_pricing
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM internal_users iu
            JOIN roles r ON iu.role_id = r.id
            WHERE iu.auth_user_id = auth.uid()
            AND iu.access_status = 'active'
            AND r.key = 'admin'
        )
    );

-- ==========================
-- AI Active Config
-- ==========================

-- Solo admins pueden leer configuración activa
CREATE POLICY "Admins can read ai_active_config" ON ai_active_config
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM internal_users iu
            JOIN roles r ON iu.role_id = r.id
            WHERE iu.auth_user_id = auth.uid()
            AND iu.access_status = 'active'
            AND r.key = 'admin'
        )
    );

-- Solo admins pueden modificar configuración activa
CREATE POLICY "Admins can manage ai_active_config" ON ai_active_config
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM internal_users iu
            JOIN roles r ON iu.role_id = r.id
            WHERE iu.auth_user_id = auth.uid()
            AND iu.access_status = 'active'
            AND r.key = 'admin'
        )
    );