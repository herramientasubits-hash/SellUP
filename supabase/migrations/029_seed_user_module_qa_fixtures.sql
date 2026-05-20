-- =============================================================================
-- QA FIXTURES — Módulo de Gestión de Usuarios
-- =============================================================================
-- SOLO PARA DESARROLLO / QA. Datos ficticios para validar UI.
-- Los usuarios tienen correos @ubits.co ficticios y NO pueden iniciar sesión
-- con Google OAuth real (no tienen tokens OAuth válidos).
-- Para rollback: DELETE FROM internal_users WHERE email LIKE '%qa@ubits.co';
--               DELETE FROM auth.users WHERE email LIKE '%qa@ubits.co';
-- =============================================================================

DO $$
DECLARE
    -- Roles
    r_admin    UUID;
    r_manager  UUID;
    r_lead     UUID;
    r_seller   UUID;

    -- Auth user IDs (fijos para reproducibilidad)
    au_admin       UUID := 'a0000001-0000-0000-0000-000000000001';
    au_mgr1        UUID := 'a0000001-0000-0000-0000-000000000002';
    au_mgr2        UUID := 'a0000001-0000-0000-0000-000000000003';
    au_lead1       UUID := 'a0000001-0000-0000-0000-000000000004';
    au_lead2       UUID := 'a0000001-0000-0000-0000-000000000005';
    au_lead3       UUID := 'a0000001-0000-0000-0000-000000000006';
    au_seller1     UUID := 'a0000001-0000-0000-0000-000000000007';
    au_seller2     UUID := 'a0000001-0000-0000-0000-000000000008';
    au_seller3     UUID := 'a0000001-0000-0000-0000-000000000009';
    au_seller4     UUID := 'a0000001-0000-0000-0000-000000000010';
    au_seller5     UUID := 'a0000001-0000-0000-0000-000000000011';
    au_seller6     UUID := 'a0000001-0000-0000-0000-000000000012';
    au_pending1    UUID := 'a0000001-0000-0000-0000-000000000013';
    au_pending2    UUID := 'a0000001-0000-0000-0000-000000000014';
    au_suspended1  UUID := 'a0000001-0000-0000-0000-000000000015';
    au_rejected1   UUID := 'a0000001-0000-0000-0000-000000000016';

    -- Internal user IDs
    iu_admin       UUID;
    iu_mgr1        UUID;
    iu_mgr2        UUID;
    iu_lead1       UUID;
    iu_lead2       UUID;
    iu_lead3       UUID;

    -- Group IDs
    g_colombia    UUID;
    g_manufactura UUID;
    g_textiles    UUID;
    g_tecnologia  UUID;
    g_mexico      UUID;
    g_enterprise  UUID;

BEGIN

-- ------------------------------------------------------------------
-- 0. Limpiar fixtures anteriores (idempotente)
-- ------------------------------------------------------------------
DELETE FROM user_preapprovals  WHERE email LIKE '%qa@ubits.co';
DELETE FROM internal_users     WHERE email LIKE '%qa@ubits.co';
DELETE FROM auth.users         WHERE email LIKE '%qa@ubits.co';
DELETE FROM organization_groups WHERE name LIKE '%(QA)';

-- ------------------------------------------------------------------
-- 1. Roles
-- ------------------------------------------------------------------
SELECT id INTO r_admin   FROM roles WHERE key = 'admin';
SELECT id INTO r_manager FROM roles WHERE key = 'commercial_manager';
SELECT id INTO r_lead    FROM roles WHERE key = 'commercial_lead';
SELECT id INTO r_seller  FROM roles WHERE key = 'seller_bd';

-- ------------------------------------------------------------------
-- 2. Fake auth.users (no tienen credenciales reales)
-- ------------------------------------------------------------------
INSERT INTO auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    created_at, updated_at,
    raw_user_meta_data, raw_app_meta_data,
    is_super_admin, is_sso_user
)
VALUES
    (au_admin,      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin.qa@ubits.co',           '', NOW(), NOW(), NOW(), '{"full_name":"Admin QA"}'::jsonb,               '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_mgr1,       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'maria.garcia.qa@ubits.co',    '', NOW(), NOW(), NOW(), '{"full_name":"María García QA"}'::jsonb,         '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_mgr2,       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'javier.lopez.qa@ubits.co',    '', NOW(), NOW(), NOW(), '{"full_name":"Javier López QA"}'::jsonb,         '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_lead1,      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana.torres.qa@ubits.co',      '', NOW(), NOW(), NOW(), '{"full_name":"Ana Torres QA"}'::jsonb,           '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_lead2,      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carlos.ruiz.qa@ubits.co',     '', NOW(), NOW(), NOW(), '{"full_name":"Carlos Ruiz QA"}'::jsonb,          '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_lead3,      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'diana.vargas.qa@ubits.co',    '', NOW(), NOW(), NOW(), '{"full_name":"Diana Vargas QA"}'::jsonb,         '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_seller1,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'luis.martinez.qa@ubits.co',   '', NOW(), NOW(), NOW(), '{"full_name":"Luis Martínez QA"}'::jsonb,        '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_seller2,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sofia.hernandez.qa@ubits.co', '', NOW(), NOW(), NOW(), '{"full_name":"Sofía Hernández QA"}'::jsonb,      '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_seller3,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'miguel.castillo.qa@ubits.co', '', NOW(), NOW(), NOW(), '{"full_name":"Miguel Castillo QA"}'::jsonb,      '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_seller4,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'camila.flores.qa@ubits.co',   '', NOW(), NOW(), NOW(), '{"full_name":"Camila Flores QA"}'::jsonb,        '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_seller5,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'andres.romero.qa@ubits.co',   '', NOW(), NOW(), NOW(), '{"full_name":"Andrés Romero QA"}'::jsonb,        '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_seller6,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'isabela.mendez.qa@ubits.co',  '', NOW(), NOW(), NOW(), '{"full_name":"Isabela Méndez QA"}'::jsonb,       '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_pending1,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pedro.sanchez.qa@ubits.co',   '', NOW(), NOW(), NOW(), '{"full_name":"Pedro Sánchez QA"}'::jsonb,        '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_pending2,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'laura.jimenez.qa@ubits.co',   '', NOW(), NOW(), NOW(), '{"full_name":"Laura Jiménez QA"}'::jsonb,        '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_suspended1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'roberto.silva.qa@ubits.co',   '', NOW(), NOW(), NOW(), '{"full_name":"Roberto Silva QA"}'::jsonb,        '{"provider":"google","providers":["google"]}'::jsonb, false, false),
    (au_rejected1,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'valentina.cruz.qa@ubits.co',  '', NOW(), NOW(), NOW(), '{"full_name":"Valentina Cruz QA"}'::jsonb,       '{"provider":"google","providers":["google"]}'::jsonb, false, false)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------
-- 3. internal_users activos — Admin primero (se usará como approved_by)
-- ------------------------------------------------------------------
INSERT INTO internal_users (auth_user_id, email, full_name, access_status, role_id, approved_at)
VALUES (au_admin, 'admin.qa@ubits.co', 'Admin QA', 'active', r_admin, NOW())
RETURNING id INTO iu_admin;

-- Managers
INSERT INTO internal_users (auth_user_id, email, full_name, access_status, role_id, manager_id, approved_at, approved_by)
VALUES (au_mgr1, 'maria.garcia.qa@ubits.co', 'María García QA', 'active', r_manager, NULL, NOW(), iu_admin)
RETURNING id INTO iu_mgr1;

INSERT INTO internal_users (auth_user_id, email, full_name, access_status, role_id, manager_id, approved_at, approved_by)
VALUES (au_mgr2, 'javier.lopez.qa@ubits.co', 'Javier López QA', 'active', r_manager, NULL, NOW(), iu_admin)
RETURNING id INTO iu_mgr2;

-- Líderes (reportan a managers)
INSERT INTO internal_users (auth_user_id, email, full_name, access_status, role_id, manager_id, approved_at, approved_by)
VALUES (au_lead1, 'ana.torres.qa@ubits.co', 'Ana Torres QA', 'active', r_lead, iu_mgr1, NOW(), iu_admin)
RETURNING id INTO iu_lead1;

INSERT INTO internal_users (auth_user_id, email, full_name, access_status, role_id, manager_id, approved_at, approved_by)
VALUES (au_lead2, 'carlos.ruiz.qa@ubits.co', 'Carlos Ruiz QA', 'active', r_lead, iu_mgr1, NOW(), iu_admin)
RETURNING id INTO iu_lead2;

INSERT INTO internal_users (auth_user_id, email, full_name, access_status, role_id, manager_id, approved_at, approved_by)
VALUES (au_lead3, 'diana.vargas.qa@ubits.co', 'Diana Vargas QA', 'active', r_lead, iu_mgr2, NOW(), iu_admin)
RETURNING id INTO iu_lead3;

-- Vendedores (reportan a líderes)
INSERT INTO internal_users (auth_user_id, email, full_name, access_status, role_id, manager_id, approved_at, approved_by)
VALUES
    (au_seller1, 'luis.martinez.qa@ubits.co',   'Luis Martínez QA',   'active', r_seller, iu_lead1, NOW(), iu_admin),
    (au_seller2, 'sofia.hernandez.qa@ubits.co',  'Sofía Hernández QA', 'active', r_seller, iu_lead1, NOW(), iu_admin),
    (au_seller3, 'miguel.castillo.qa@ubits.co',  'Miguel Castillo QA', 'active', r_seller, iu_lead2, NOW(), iu_admin),
    (au_seller4, 'camila.flores.qa@ubits.co',    'Camila Flores QA',   'active', r_seller, iu_lead2, NOW(), iu_admin),
    (au_seller5, 'andres.romero.qa@ubits.co',    'Andrés Romero QA',   'active', r_seller, iu_lead3, NOW(), iu_admin),
    (au_seller6, 'isabela.mendez.qa@ubits.co',   'Isabela Méndez QA',  'active', r_seller, iu_lead3, NOW(), iu_admin);

-- Pendientes de aprobación
INSERT INTO internal_users (auth_user_id, email, full_name, access_status, role_id, requested_at)
VALUES
    (au_pending1, 'pedro.sanchez.qa@ubits.co', 'Pedro Sánchez QA',  'pending_approval', NULL, NOW() - INTERVAL '2 days'),
    (au_pending2, 'laura.jimenez.qa@ubits.co', 'Laura Jiménez QA', 'pending_approval', NULL, NOW() - INTERVAL '1 day');

-- Suspendido
INSERT INTO internal_users (auth_user_id, email, full_name, access_status, role_id, manager_id, approved_at, suspended_at, suspended_by)
VALUES (au_suspended1, 'roberto.silva.qa@ubits.co', 'Roberto Silva QA', 'suspended', r_seller, iu_lead1, NOW() - INTERVAL '10 days', NOW() - INTERVAL '2 days', iu_admin);

-- Rechazado
INSERT INTO internal_users (auth_user_id, email, full_name, access_status, role_id, rejected_at, rejected_by)
VALUES (au_rejected1, 'valentina.cruz.qa@ubits.co', 'Valentina Cruz QA', 'rejected', NULL, NOW() - INTERVAL '3 days', iu_admin);

-- ------------------------------------------------------------------
-- 4. Grupos organizacionales
-- ------------------------------------------------------------------
INSERT INTO organization_groups (name, description, parent_group_id, created_by)
VALUES ('Colombia (QA)', 'Operación Colombia', NULL, iu_admin)
RETURNING id INTO g_colombia;

INSERT INTO organization_groups (name, description, parent_group_id, created_by)
VALUES ('Manufactura (QA)', 'Vertical de manufactura', g_colombia, iu_admin)
RETURNING id INTO g_manufactura;

INSERT INTO organization_groups (name, description, parent_group_id, created_by)
VALUES ('Textiles (QA)', 'Subvertical textil', g_manufactura, iu_admin)
RETURNING id INTO g_textiles;

INSERT INTO organization_groups (name, description, parent_group_id, created_by)
VALUES ('Tecnología (QA)', 'Vertical de tecnología', g_colombia, iu_admin)
RETURNING id INTO g_tecnologia;

INSERT INTO organization_groups (name, description, parent_group_id, created_by)
VALUES ('México (QA)', 'Operación México', NULL, iu_admin)
RETURNING id INTO g_mexico;

INSERT INTO organization_groups (name, description, parent_group_id, created_by)
VALUES ('Enterprise (QA)', 'Cuentas enterprise', g_mexico, iu_admin)
RETURNING id INTO g_enterprise;

-- ------------------------------------------------------------------
-- 5. Asignar grupos a usuarios activos
-- ------------------------------------------------------------------
UPDATE internal_users SET group_id = g_textiles   WHERE email IN ('ana.torres.qa@ubits.co', 'luis.martinez.qa@ubits.co', 'sofia.hernandez.qa@ubits.co');
UPDATE internal_users SET group_id = g_manufactura WHERE email IN ('carlos.ruiz.qa@ubits.co', 'miguel.castillo.qa@ubits.co', 'camila.flores.qa@ubits.co');
UPDATE internal_users SET group_id = g_enterprise  WHERE email IN ('diana.vargas.qa@ubits.co', 'andres.romero.qa@ubits.co', 'isabela.mendez.qa@ubits.co');
UPDATE internal_users SET group_id = g_colombia    WHERE email = 'maria.garcia.qa@ubits.co';
UPDATE internal_users SET group_id = g_mexico      WHERE email = 'javier.lopez.qa@ubits.co';
-- Admin sin grupo y 2 vendedores sin grupo (para probar sección "Sin grupo asignado")

-- ------------------------------------------------------------------
-- 6. Preautorizaciones pendientes (sin auth.users, aún no han hecho login)
-- ------------------------------------------------------------------
INSERT INTO user_preapprovals (email, full_name, role_id, manager_id, group_id, status, created_by, notes)
VALUES
    ('felipe.herrera.qa@ubits.co', 'Felipe Herrera QA', r_lead,   iu_mgr1, g_tecnologia, 'pending_claim', iu_admin, 'Nuevo líder para equipo Colombia Tecnología'),
    ('natalia.moreno.qa@ubits.co', 'Natalia Moreno QA', r_seller, iu_lead1, g_textiles,  'pending_claim', iu_admin, 'Refuerzo para equipo Textiles');

END $$;
