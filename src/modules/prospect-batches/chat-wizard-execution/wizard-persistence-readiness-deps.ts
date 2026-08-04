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
  toPersistenceReadinessProbe,
  type PersistenceReadinessProbe,
  PROSPECT_CANDIDATE_IDENTITY_COLUMN,
} from '@/server/agents/prospecting-toolkit/prospect-candidate-persistence-readiness';

/**
 * Mínimo de la interfaz de Supabase que la sonda necesita. Tipado a mano para
 * que los tests inyecten un doble sin arrastrar el cliente entero.
 */
export type PersistenceReadinessDbClient = {
  from: (table: string) => {
    select: (columns: string) => {
      limit: (count: number) => Promise<{ error: unknown }>;
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
 */
export async function probeProspectCandidatePersistenceReadiness(
  client: PersistenceReadinessDbClient,
): Promise<PersistenceReadinessProbe> {
  try {
    const { error } = await client
      .from('prospect_candidates')
      .select(PROSPECT_CANDIDATE_IDENTITY_COLUMN)
      .limit(1);
    return toPersistenceReadinessProbe(error);
  } catch {
    return { status: 'probe_failed' };
  }
}
