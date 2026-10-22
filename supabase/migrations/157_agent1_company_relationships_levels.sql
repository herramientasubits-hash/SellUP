-- ═══════════════════════════════════════════════════════════════════
-- 157 — Árbol de empresa de varios niveles (Agente 1, FASE C; dueña 22-10)
-- ═══════════════════════════════════════════════════════════════════
--
-- POR QUÉ
--
-- La 148 guarda una fila por empresa del árbol, toda colgada de la empresa de
-- partida. Los grupos grandes tienen más niveles (Grupo Bimbo → Bimbo Bakeries
-- USA → Entenmann's) y esa jerarquía se perdía: el lote era una lista plana.
--
-- QUÉ HACE
--
--   1. parent_name: de qué empresa del grupo depende directamente (lo dice
--      Claude con su fuente; NULL = de la empresa de partida).
--   2. parent_relationship_id + depth: cuando se busca el árbol de una filial
--      desde el lote («Buscar su árbol»), las filas del árbol nuevo quedan
--      ligadas a la fila de esa filial en el árbol de arriba, un nivel más abajo.
--      Como mucho 4 niveles.
--   3. Índice por parent_relationship_id.
--
-- QUÉ NO HACE
--
--   * NO cambia filas existentes (las columnas nuevas nacen NULL / 1).
--   * NO toca RLS ni las políticas de la 148, ni candidatos, lotes, reclamos,
--     presupuesto o HubSpot.
--
-- Reversible:
--   DROP INDEX IF EXISTS public.idx_agent1_company_relationships_parent;
--   ALTER TABLE public.agent1_company_relationships
--     DROP COLUMN IF EXISTS parent_relationship_id,
--     DROP COLUMN IF EXISTS parent_name,
--     DROP COLUMN IF EXISTS depth;

ALTER TABLE public.agent1_company_relationships
    ADD COLUMN IF NOT EXISTS parent_name TEXT NULL,
    ADD COLUMN IF NOT EXISTS parent_relationship_id UUID NULL
        REFERENCES public.agent1_company_relationships(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS depth SMALLINT NOT NULL DEFAULT 1
        CONSTRAINT agent1_company_relationships_depth_check CHECK (depth BETWEEN 1 AND 4);

COMMENT ON COLUMN public.agent1_company_relationships.parent_name IS
    'Empresa del grupo de la que depende directamente (según la fuente). NULL = de la empresa de partida.';
COMMENT ON COLUMN public.agent1_company_relationships.parent_relationship_id IS
    'Fila del árbol de arriba cuando este árbol se buscó desde una filial («Buscar su árbol»).';
COMMENT ON COLUMN public.agent1_company_relationships.depth IS
    'Nivel del árbol: 1 = búsqueda directa; 2+ = árbol de una filial buscado desde otro árbol.';

CREATE INDEX IF NOT EXISTS idx_agent1_company_relationships_parent
    ON public.agent1_company_relationships (parent_relationship_id)
    WHERE parent_relationship_id IS NOT NULL;
