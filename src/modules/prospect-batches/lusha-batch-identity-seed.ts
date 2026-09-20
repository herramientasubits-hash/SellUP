/**
 * lusha-batch-identity-seed.ts — la SIEMBRA de la guarda de identidad de lote,
 * extraída del llamador para poder ejercitarla.
 *
 * ── 🔴 Por qué existe este módulo ───────────────────────────────────────────
 *
 * La contención del doble conteo entre proveedores NO vive en la aritmética.
 * La unión de identidades del agregado no puede reconocer a la misma empresa
 * cuando cada pierna la nombra en su espacio (`candidate:<uuid>` de Apollo,
 * identidad de empresa de Lusha), y el techo de filas únicas tampoco la ve
 * cuando el lote tiene además filas incompletas que lo elevan.
 *
 * Quien la reconoce es `admitByBatchIdentity`, que compara DOMINIO, LinkedIn e
 * identidad fiscal —ejes comparables entre proveedores— contra lo que el lote YA
 * contiene. Y para eso alguien tiene que LEER el lote: esa lectura es esto.
 *
 * Estaba escrita en línea dentro de la acción, junto a la sesión de Supabase y
 * a media docena de pasos con I/O, así que la única forma de probarla era
 * prepararla a mano desde el test — es decir, no probarla. Aquí es una función
 * con sus dependencias inyectadas, y la acción la invoca.
 *
 * ── 🔴 Fail-OPEN declarado, y por qué no se cambia ──────────────────────────
 *
 * Si la lectura falla, la siembra es `null` y la guarda NO actúa. Es deliberado:
 * una consulta caída no puede convertirse en «esta empresa ya existía» y
 * descartar candidatas legítimas. La consecuencia —que en ese camino la
 * deduplicación entre proveedores NO está protegida— se DECLARA en el resultado
 * en vez de quedarse implícita, para que quien lea una corrida sepa si la guarda
 * pudo actuar.
 *
 * Puro salvo la dependencia inyectada: sin cliente propio, sin env, sin reloj.
 */

import type { loadBatchIdentityRegistry } from '@/server/prospect-batches/batch-identity-registry-store';

type BatchIdentitySeedOutcome = Awaited<ReturnType<typeof loadBatchIdentityRegistry>>;

export type LushaBatchIdentitySeedResult = {
  /** Lo que se pasa a la pierna. `null` ⇒ la guarda no podrá actuar. */
  readonly seed: BatchIdentitySeedOutcome | null;
  /** El lote que se leyó, o `null` si no había ninguno que leer. */
  readonly seedBatchId: string | null;
  /**
   * 🔴 ¿Pudo la guarda de identidad de lote actuar en esta corrida?
   *
   * `false` cuando no había lote (nada que proteger todavía) o cuando la lectura
   * falló. En el segundo caso la deduplicación entre proveedores NO está
   * protegida y el conteo no puede declararse exacto por esa vía.
   */
  readonly guardArmed: boolean;
  /** `true` sólo cuando la lectura lanzó. Distinto de «no había lote». */
  readonly loadFailed: boolean;
};

export type ResolveLushaBatchIdentitySeedInput = {
  /** Lote que la capa gratuita materializó, si lo hubo. */
  readonly prePaidBatchId: string | null;
  /**
   * 🔴 El lote CANÓNICO de la cascada. Manda sobre el anterior: dentro ya están
   * las empresas que Apollo escribió, y sembrar sólo desde el gratuito dejaría a
   * Lusha admitiendo una que Apollo ya puso en el mismo lote.
   */
  readonly waterfallCanonicalBatchId?: string | null;
  /** La lectura real. Se inyecta para poder ejercitar también su fallo. */
  readonly loadRegistry: (batchId: string) => Promise<BatchIdentitySeedOutcome>;
};

export async function resolveLushaBatchIdentitySeed(
  input: ResolveLushaBatchIdentitySeedInput,
): Promise<LushaBatchIdentitySeedResult> {
  const seedBatchId = input.prePaidBatchId ?? input.waterfallCanonicalBatchId ?? null;

  if (seedBatchId === null) {
    // Sin lote no hay nada que leer, y eso NO es un fallo: es una corrida que
    // todavía no ha escrito nada. La guarda no está armada porque no hace falta.
    return { seed: null, seedBatchId: null, guardArmed: false, loadFailed: false };
  }

  try {
    const seed = await input.loadRegistry(seedBatchId);
    return { seed, seedBatchId, guardArmed: true, loadFailed: false };
  } catch {
    // 🔴 Fail-OPEN: la corrida sigue, y lo declara.
    return { seed: null, seedBatchId, guardArmed: false, loadFailed: true };
  }
}

/** Bloque para la metadata de la corrida. Sin PII y sin ids de empresa. */
export function toLushaBatchIdentitySeedMetadata(
  result: LushaBatchIdentitySeedResult,
): Record<string, unknown> {
  return {
    seed_batch_id: result.seedBatchId,
    guard_armed: result.guardArmed,
    load_failed: result.loadFailed,
    seeded_count: result.seed?.seededCount ?? 0,
    degraded: result.seed?.degraded ?? false,
    // 🔴 La afirmación que importa, dicha en la fila y no sólo en el comentario:
    // sin guarda armada, la deduplicación ENTRE PROVEEDORES no está protegida.
    cross_provider_dedupe_protected: result.guardArmed && result.seed?.degraded !== true,
  };
}
