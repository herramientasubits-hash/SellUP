-- Rol «Growth»: el equipo que prospecta EN MASA.
--
-- SellUp separa dos formas de prospectar:
--   · Vendedor / BD: agrega empresas a mano y busca los contactos de las suyas.
--   · Growth: búsquedas con IA por lotes, importación de archivos y
--     enriquecimiento masivo; revisa y aprueba lo que esas búsquedas traen.
--
-- Solo agrega la fila al catálogo de roles (migración 001). No cambia tablas ni
-- políticas: las reglas de qué puede hacer cada rol viven en el servidor
-- (src/modules/access/capabilities.ts) detrás de ENABLE_ROLE_CAPABILITIES, que
-- se enciende después de asignar el rol a quien corresponda.

INSERT INTO roles (key, name, description) VALUES
    ('growth', 'Growth', 'Prospección masiva: búsquedas con IA por lotes, importación de archivos y enriquecimiento masivo')
ON CONFLICT (key) DO NOTHING;
