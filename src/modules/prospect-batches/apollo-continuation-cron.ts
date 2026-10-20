/**
 * apollo-continuation-cron.ts — puerta y selección del cron de continuaciones
 * de Apollo (AGENT1-AUDIT-WS1).
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * `/api/cron/apollo-round-continuation` nunca corrió en Producción: el proxy no
 * lo excluía de la protección de sesión y Vercel Cron no manda cookie, así que
 * cada disparo recibía 307 → /login antes del handler. Al abrirlo en el proxy,
 * el cron empezaría a reanudar corridas —y la cascada posterior puede llamar a
 * Lusha— el mismo día del despliegue. Por eso la reanudación queda detrás de una
 * bandera APAGADA por defecto: abrir el proxy no enciende ningún gasto.
 *
 * ── Un trabajo por invocación ────────────────────────────────────────────────
 *
 * El reclamo (`claim_apollo_round_continuation_jobs`) suma un intento a TODOS
 * los trabajos que toma. Si el cron toma tres y la función muere en el segundo,
 * el tercero pierde un intento sin haber corrido. El cron elige aquí UN lote
 * reclamable y le pasa ese lote al conductor con `limit: 1`, que es el mismo
 * camino que ya usa la continuación en sesión.
 */

import { isEnvFlagEnabled } from '@/lib/env-flag-parser';

export const AGENT1_APOLLO_CRON_CONTINUATION_FLAG = 'ENABLE_AGENT1_APOLLO_CRON_CONTINUATION';

/**
 * ¿Reanuda el cron diario continuaciones de Apollo?
 *
 * 🔴 Fail-closed y por defecto APAGADA: sólo el token exacto `true` la enciende.
 * Apagada, el cron responde sin tocar la base (ni el barrido de corridas
 * trabadas, que sigue corriendo cuando alguien abre el Centro de procesos).
 */
export function isAgent1ApolloCronContinuationEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isEnvFlagEnabled(env[AGENT1_APOLLO_CRON_CONTINUATION_FLAG]);
}

const CONTINUATION_JOBS_TABLE = 'apollo_round_continuation_jobs';

type PickRowsResult = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

/** Superficie mínima del cliente: el admin real la cumple y una prueba también. */
export type ContinuationPickClient = {
  from(table: string): {
    select(columns: string): {
      or(filter: string): {
        order(column: string, options: { ascending: boolean }): { limit(count: number): PickRowsResult };
      };
    };
  };
};

/**
 * El lote del PRÓXIMO trabajo que el reclamo tomaría, o `null` si no hay.
 *
 * Replica la elegibilidad de la migración 139 (pendiente con su espera vencida,
 * o en proceso con el lease caducado) y su orden (`created_at` ascendente). Si
 * entre esta lectura y el reclamo otro proceso se lo queda, el reclamo vuelve
 * vacío y no pasa nada: la lectura sólo elige, el reclamo sigue siendo la
 * única puerta atómica.
 */
export async function pickNextClaimableContinuationBatchId(
  client: ContinuationPickClient,
  nowIso: string = new Date().toISOString(),
): Promise<string | null> {
  const { data, error } = await client
    .from(CONTINUATION_JOBS_TABLE)
    .select('batch_id')
    .or(
      `and(status.eq.pending,next_retry_at.lte.${nowIso}),and(status.eq.processing,lease_expires_at.lt.${nowIso})`,
    )
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`apollo_continuation_pick_failed: ${error.message}`);
  const first = Array.isArray(data) ? (data[0] as { batch_id?: unknown } | undefined) : undefined;
  return typeof first?.batch_id === 'string' && first.batch_id.length > 0 ? first.batch_id : null;
}
