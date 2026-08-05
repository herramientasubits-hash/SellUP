/**
 * wizard-persistence-readiness-deps.ts — la sonda REAL de esquema.
 *
 * A1-APOLLO-PERSISTENCE-READINESS-4 · § 6.
 *
 * Única costura de I/O del preflight de persistencia. Toda la decisión vive en
 * el núcleo puro (`prospect-candidate-persistence-readiness.ts`); aquí sólo se
 * hace la lectura y se traduce el error.
 *
 * Por qué una lectura real y no una comprobación del archivo de migración:
 *   el fallo de LIVE-QA-2 fue `PGRST204` — la columna podía existir en el SQL
 *   del repo y NO existir para PostgREST. Un preflight que mire el repo, la
 *   lista de migraciones o un flag no habría visto nada. Lo único que prueba
 *   que la escritura va a funcionar es preguntárselo a la misma capa que hará la
 *   escritura, con la misma caché de esquema.
 *
 * Coste: un `select identity_key ... limit 1`. Sin writes, sin RPC, sin
 * proveedores, sin créditos.
 *
 * Server-only.
 */

import {
  toPersistenceReadinessProbeFromResponse,
  type PersistenceReadinessProbe,
  PROSPECT_CANDIDATE_IDENTITY_COLUMN,
} from '@/server/agents/prospecting-toolkit/prospect-candidate-persistence-readiness';

/**
 * Mínimo de la interfaz de Supabase que la sonda necesita. Tipado a mano para
 * que los tests inyecten un doble sin arrastrar el cliente entero.
 *
 * La respuesta se declara `unknown` a propósito (A1-APOLLO-PERSISTENCE-REVIEW-FIX-1
 * § 1): tipar aquí `{ error: unknown }` afirmaría en el tipo justo lo que la sonda
 * tiene que VERIFICAR en tiempo de ejecución, y dejaría fuera del sistema de tipos
 * las respuestas malformadas que son la razón de existir de esta comprobación.
 */
export type PersistenceReadinessDbClient = {
  from: (table: string) => {
    select: (columns: string) => {
      limit: (count: number) => Promise<unknown>;
    };
  };
};

/**
 * Comprueba que `prospect_candidates.identity_key` es legible por la misma capa
 * que después escribirá el candidato.
 *
 * Nunca lanza: una excepción de red o un cliente roto se traducen a
 * `probe_failed`, que bloquea igual que la ausencia de la columna. «No se pudo
 * comprobar» no es «está bien».
 *
 * La respuesta se pasa ENTERA al clasificador, no sólo su `error`: la
 * disponibilidad exige la forma real de una lectura correcta, así que una
 * respuesta truncada o inesperada bloquea en vez de autorizar gasto (§ 1).
 */
export async function probeProspectCandidatePersistenceReadiness(
  client: PersistenceReadinessDbClient,
): Promise<PersistenceReadinessProbe> {
  try {
    const response = await client
      .from('prospect_candidates')
      .select(PROSPECT_CANDIDATE_IDENTITY_COLUMN)
      .limit(1);
    return toPersistenceReadinessProbeFromResponse(response);
  } catch {
    return { status: 'probe_failed' };
  }
}
