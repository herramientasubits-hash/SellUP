-- Rol «Growth»: un vendedor más que, además, prospecta EN MASA (dueña 28-10).
--
-- Growth ve y trabaja lo suyo igual que un vendedor (alcance propio, revisa sus
-- candidatas, busca contactos). Lo único que tiene de más: la búsqueda masiva
-- («Muchas empresas por criterios») e importar archivos. Revisar cualquier
-- candidata sigue siendo sólo de admin.
--
-- Solo agrega la fila al catálogo de roles (migración 001): desde ese momento se
-- puede elegir en Configuración › Usuarios al invitar a alguien o al cambiarle el
-- rol. No cambia tablas ni políticas: las reglas viven en el servidor
-- (src/modules/access/capabilities.ts) detrás de ENABLE_ROLE_CAPABILITIES.

INSERT INTO roles (key, name, description) VALUES
    ('growth', 'Growth', 'Vendedor que además prospecta en masa: búsqueda masiva e importación de archivos')
ON CONFLICT (key) DO NOTHING;
