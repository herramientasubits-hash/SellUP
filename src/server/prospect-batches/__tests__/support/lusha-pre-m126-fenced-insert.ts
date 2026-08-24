/**
 * AGENT1-CUT3B4-CORRECCIÓN — cómo se modela «la 126 no está aplicada» en pruebas.
 *
 * `PersistLushaPendingReviewDeps.insertCandidatesFenced` es OBLIGATORIA. Lo era ya
 * en intención, pero mientras el tipo llevó un `?` el núcleo tenía un `else` que
 * escribía sin valla por el solo hecho de que nadie inyectara la dependencia: un
 * desvío ESTRUCTURAL, ajeno al esquema, que aplicar la migración no cerraba. La
 * ausencia de una dependencia inyectada NO es prueba de que falte una función en
 * la base, y no puede autorizar una escritura sin valla.
 *
 * Una prueba que quiera el comportamiento anterior a B4 inyecta ESTO: una valla
 * que responde exactamente lo que responde la base cuando la función no existe.
 * Así el camino legado se ejercita por su ÚNICA puerta legítima —
 * `capability_absent`— y no por un hueco en el grafo de dependencias.
 *
 * 🔴 No usar para modelar averías. Una lectura caída, un lote invisible o una
 * valla que desaparece a mitad de vuelo son fallos CERRADOS, no compatibilidad.
 */

import type { FencedCandidateInsertResult } from '@/server/prospect-batches/batch-identity-fence';

export async function preM126FencedInsert(): Promise<FencedCandidateInsertResult> {
  return { status: 'capability_absent' };
}

/**
 * El `rpc` que un cliente de Supabase presenta cuando la 126 NO está aplicada.
 *
 * 🔴 Un doble que simplemente OMITE `rpc` no modela eso: modela un cliente no
 * soportado, y desde la corrección de este corte eso degrada CERRADO en vez de
 * abrir la ruta anterior a B4 —porque la forma de un objeto de JavaScript no
 * puede ser prueba sobre el esquema de la base—. Los dobles que quieran el
 * comportamiento legado montan ESTO, que es lo que responde PostgREST de verdad.
 */
export async function preM126Rpc(): Promise<{ data: null; error: { code: string; message: string } }> {
  return {
    data: null,
    error: {
      code: 'PGRST202',
      message: 'Could not find the function public.read_batch_identity_snapshot in the schema cache',
    },
  };
}
