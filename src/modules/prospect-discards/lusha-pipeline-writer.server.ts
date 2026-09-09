// AGENT1-LUSHA-DISCARD-TRACEABILITY-1 — persistencia BEST-EFFORT y ADITIVA de
// las empresas que la pierna Lusha evaluó y que NO acabaron como candidato
// visible del lote.
//
// Sigue el patrón CONCEPTUAL del escritor de Apollo (`pipeline-writer.server.ts`)
// —mismo aislamiento, mismo «nunca lanza», misma clave de idempotencia— pero es
// un módulo APARTE y no lo modifica.
//
// Lo que NO hace, por construcción:
//   · cero llamadas a proveedor: sólo lee lo que la corrida ya tiene en memoria.
//   · cero lectura/escritura de presupuesto, créditos o cuotas.
//   · nunca escribe `prospect_candidates`, `prospect_batches` ni tabla alguna
//     que no sea `prospect_discarded_dispositions`.
//   · NUNCA lanza: cualquier fallo se captura y se reporta en el resumen.
//
// ─── 🔴 Por qué `ignoreDuplicates: true` y no un UPSERT ───────────────────────
//
// Apollo y Lusha COMPARTEN `batch_id`. La clave de idempotencia de la tabla es
// `(batch_id, source_key)`, así que una empresa que Apollo ya descartó y que
// Lusha vuelve a encontrar COLISIONA con la fila de Apollo.
//
// `ON CONFLICT DO UPDATE` —lo que hace el escritor de Apollo, correctamente,
// porque ahí el único autor posible es Apollo— convertiría a Lusha en el
// reescritor del veredicto de la pierna anterior: un
// `ownership_domain_rejected` de Apollo pasaría a leerse como
// `sellup_duplicate` de Lusha, y la traza de POR QUÉ Apollo la descartó se
// perdería para siempre. Sobrevive el PRIMER veredicto: `ON CONFLICT DO
// NOTHING`. Las colisiones no se ocultan — se cuentan en `conflicts`.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { computeDiscardDispositionSourceKey } from './mapping';
import type { DiscardDispositionCode } from './types';

/**
 * Lo que este escritor necesita de UN descarte. Tipo ESTRUCTURAL a propósito:
 * declarado aquí y no importado de la pierna Lusha, para que este módulo no
 * tenga ninguna dependencia de import hacia el pipeline del proveedor.
 *
 * `disposition` y `reasonCode` llegan YA resueltos por la taxonomía pura
 * (`resolveLushaDiscardDisposition`), aplicada en el punto donde la corrida
 * tomó la decisión. Este módulo no reinterpreta veredictos: los escribe.
 */
export interface LushaDiscardRecordLike {
  name: string;
  domain: string | null;
  providerCompanyId: string | null;
  linkedinUrl: string | null;
  industry: string | null;
  countryCode: string | null;
  disposition: DiscardDispositionCode;
  reasonCode: string | null;
  reasonDetail: string | null;
  /** Rama/página de la corrida que trajo a esta empresa. Identifica el origen. */
  roundOrigin: string | null;
  evidence: Record<string, unknown>;
}

/**
 * 🔴 AGENT1-HARDENING-CUT-4 — la costura mínima que hace este módulo probable.
 *
 * `getAdminClient()` construye el cliente desde `process.env`, así que la única
 * forma de probar la escritura era `mock.module('@supabase/supabase-js')`. En
 * Node 24 esa vía DEJÓ de funcionar: `options.namedExports` está deprecado y el
 * mock no se aplica, de modo que el cliente REAL sale a la red y toda aserción
 * de idempotencia se cae con `fetch failed`. Una prueba que depende de una API
 * experimental que cambia entre versiones de Node no puede ser el guardián de
 * un invariante de escritura.
 *
 * Por eso el cliente se puede INYECTAR. Ausente ⇒ exactamente el de antes.
 * No cambia el comportamiento en producción: ningún llamador la pasa.
 */
export type LushaDiscardWriterClientFactory = () => {
  from: (table: string) => {
    upsert: (
      payload: Record<string, unknown>[],
      options: { onConflict: string; ignoreDuplicates: boolean },
    ) => { select: (columns: string) => Promise<{ data: unknown; error: { message: string } | null }> };
  };
};

export interface PersistLushaRejectedDispositionsInput {
  batchId: string;
  /**
   * Contexto de la BÚSQUEDA — el único país/industria disponible sin hilar
   * campos crudos del proveedor por el núcleo. Se usa como respaldo cuando el
   * registro no trae país/industria propios; nunca los sobrescribe.
   */
  requestedCountryCode: string | null;
  requestedIndustry: string | null;
  records: readonly LushaDiscardRecordLike[];
  /** Sólo pruebas. Ausente ⇒ el cliente administrador real. */
  clientFactory?: LushaDiscardWriterClientFactory;
}

export interface PersistLushaRejectedDispositionsResult {
  /** Filas ÚNICAS que se intentaron escribir (post-deduplicación del payload). */
  attempted: number;
  /** Filas que la base confirmó como NUEVAS. */
  persisted: number;
  /**
   * Filas que ya existían con esa `(batch_id, source_key)` — típicamente
   * escritas antes por la pierna Apollo del MISMO lote. No son errores y NO se
   * alteraron: su veredicto original sigue intacto.
   */
  conflicts: number;
  /** Filas perdidas por un fallo de la base. */
  failed: number;
  errors: string[];
  /** Registros descartados por no traer nombre utilizable. */
  skippedWithoutName: number;
  /** Duplicados colapsados DENTRO del payload (ganó el primero). */
  dedupedWithinPayload: number;
  /**
   * `true` cuando la base no devolvió los ids insertados y por tanto
   * `persisted`/`conflicts` NO se pudieron medir. Se declara en vez de
   * rellenarse: afirmar «0 conflictos» sin haberlos contado sería inventar.
   */
  persistedIndeterminate: boolean;
}

/** El nombre del proveedor tal como lo acepta el CHECK de la migración 138. */
export const LUSHA_DISCARD_SOURCE_PRIMARY = 'lusha' as const;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

function emptyResult(): PersistLushaRejectedDispositionsResult {
  return {
    attempted: 0,
    persisted: 0,
    conflicts: 0,
    failed: 0,
    errors: [],
    skippedWithoutName: 0,
    dedupedWithinPayload: 0,
    persistedIndeterminate: false,
  };
}

/**
 * Escribe una fila por empresa descartada. NUNCA lanza.
 *
 * Idempotente por `(batch_id, source_key)` y NO destructiva: una segunda
 * corrida sobre el mismo lote —o la coincidencia con una fila de Apollo— no
 * duplica ni sobrescribe nada.
 */
export async function persistLushaRejectedDispositions(
  input: PersistLushaRejectedDispositionsInput,
): Promise<PersistLushaRejectedDispositionsResult> {
  const result = emptyResult();

  try {
    // ── Deduplicación DENTRO del payload. Gana el PRIMERO ──────────────────
    //
    // `UNIQUE (batch_id, source_key)` sólo protege entre llamadas: dos filas
    // con la misma `source_key` en un mismo comando hacen fallar el comando
    // entero en Postgres, y con él las filas legítimas. El orden de entrada es
    // el de la corrida, así que la primera es la del desenlace más temprano.
    const bySourceKey = new Map<string, { row: LushaDiscardRecordLike; sourceKey: string }>();
    for (const record of input.records) {
      const name = record.name?.trim();
      if (!name) {
        // Sin nombre no hay nada que mostrar ni auditar, y `name` es NOT NULL.
        result.skippedWithoutName += 1;
        continue;
      }
      const sourceKey = computeDiscardDispositionSourceKey({
        domain: record.domain,
        providerIdentifier: record.providerCompanyId,
        name,
      });
      if (bySourceKey.has(sourceKey)) {
        result.dedupedWithinPayload += 1;
        continue;
      }
      bySourceKey.set(sourceKey, { row: { ...record, name }, sourceKey });
    }

    const uniqueRows = [...bySourceKey.values()];
    result.attempted = uniqueRows.length;
    if (uniqueRows.length === 0) return result;

    const payload = uniqueRows.map(({ row, sourceKey }) => ({
      batch_id: input.batchId,
      provider_identifier: row.providerCompanyId,
      source_key: sourceKey,
      name: row.name,
      domain: row.domain,
      country_code: row.countryCode ?? input.requestedCountryCode,
      industry: row.industry ?? input.requestedIndustry,
      source_primary: LUSHA_DISCARD_SOURCE_PRIMARY,
      round_origin: row.roundOrigin,
      disposition: row.disposition,
      reason_code: row.reasonCode,
      reason_detail: row.reasonDetail,
      evidence: {
        ...row.evidence,
        requested_country_code: input.requestedCountryCode,
        requested_industry: input.requestedIndustry,
      },
    }));

    const supabase = (input.clientFactory ?? getAdminClient)();
    const { data, error } = await supabase
      .from('prospect_discarded_dispositions')
      .upsert(payload, {
        onConflict: 'batch_id,source_key',
        // 🔴 DO NOTHING. Ver la cabecera: Apollo comparte `batch_id` y su
        // veredicto no se puede reescribir desde aquí.
        ignoreDuplicates: true,
      })
      .select('id');

    if (error) {
      result.failed = uniqueRows.length;
      result.errors.push(error.message);
      console.error(
        '[prospect-discards] persistLushaRejectedDispositions upsert failed (non-critical):',
        error,
      );
      return result;
    }

    if (Array.isArray(data)) {
      result.persisted = data.length;
      // Con DO NOTHING, `.select()` sólo devuelve lo REALMENTE insertado: lo
      // que falta son colisiones con una fila que ya estaba (Apollo, u otra
      // corrida sobre el mismo lote).
      result.conflicts = Math.max(0, uniqueRows.length - data.length);
      return result;
    }

    result.persistedIndeterminate = true;
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.failed = result.attempted;
    result.errors.push(message);
    console.error(
      '[prospect-discards] persistLushaRejectedDispositions failed (non-critical):',
      err,
    );
    return result;
  }
}
