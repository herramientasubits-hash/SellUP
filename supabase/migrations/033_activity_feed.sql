-- ============================================================
-- 033: Feed de actividad de plataforma
-- ============================================================
-- Agrega función recursiva para obtener todos los subordinados
-- de un manager en el organigrama (árbol jerárquico).
-- Usada por getPlatformActivity para filtrar actividad según
-- el nivel de acceso del usuario autenticado.
-- ============================================================

CREATE OR REPLACE FUNCTION get_subordinate_ids(p_manager_id UUID)
RETURNS TABLE(user_id UUID) AS $$
WITH RECURSIVE subordinates AS (
  SELECT id AS user_id
  FROM internal_users
  WHERE manager_id = p_manager_id
  UNION ALL
  SELECT iu.id
  FROM internal_users iu
  INNER JOIN subordinates s ON iu.manager_id = s.user_id
)
SELECT user_id FROM subordinates;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Índice de soporte para la consulta recursiva
CREATE INDEX IF NOT EXISTS idx_internal_users_manager_id
  ON internal_users (manager_id)
  WHERE manager_id IS NOT NULL;
