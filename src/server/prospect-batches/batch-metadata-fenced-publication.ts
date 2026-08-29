/**
 * batch-metadata-fenced-publication.ts — la publicación DURABLE de metadata que
 * sólo se conoce DESPUÉS de que el writer escribió sus filas, hecha sin abrir una
 * escritura ciega sobre `prospect_batches.metadata`.
 *
 * AGENT1-LOCAL-CUT9B-LUSHA-ACCEPTANCE-DURABLE-PUBLICATION §§ C, D, E, O.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * CUT-8 llevó `accepted_for_target` a la metadata durable por una costura que
 * sólo existe en el writer GENÉRICO (`candidate-writer`): éste publica su
 * metadata DESPUÉS de escribir los candidatos, así que puede esparcir en esa
 * misma escritura un bloque que depende del resultado. La superficie Lusha tiene
 * su propio núcleo, y ahí el orden es el contrario:
 *
 *     reserveBatch (INSERT con metadata)  →  insertCandidates  →  return
 *                  ↑ única escritura                            ↑ aquí se sabe
 *                    de metadata                                  la aceptación
 *
 * Es decir: cuando la metadata se publica todavía no existe una sola fila, y
 * cuando la aceptación existe ya no queda ninguna escritura. Por eso la corrida
 * mixta de Lusha terminaba con la aceptación correcta en la acción y en la UI, y
 * AUSENTE en `prospect_batches.metadata`.
 *
 * ── Por qué no vale un UPDATE a secas ────────────────────────────────────────
 *
 * 🔴 La salida obvia —releer `metadata`, esparcir la clave nueva y hacer
 * `.update({metadata}).eq('id', batchId)`— es una escritura CIEGA: entre la
 * lectura y la escritura otro escritor legítimo del MISMO lote puede publicar lo
 * suyo, y este UPDATE lo pisaría con una foto vieja. Es la actualización perdida
 * de manual, y en esta superficie no es hipotética: la mitad gratuita y la de
 * pago comparten lote desde CUT9A.
 *
 * ── El fence, con la autoridad que YA existe ─────────────────────────────────
 *
 * No se acuña un protocolo Lusha. La versión del lote es `identity_epoch`, la
 * que CUT-3B4 (M126) estableció y la que la escritura vallada de candidatos ya
 * comprueba y avanza. Aquí se usa como token de COMPARE-AND-SWAP:
 *
 *     UPDATE prospect_batches
 *        SET metadata = <compuesta>
 *      WHERE id = :batchId AND identity_epoch = :expectedEpoch
 *
 * Cero filas afectadas ⇒ alguien avanzó el lote ⇒ `stale` ⇒ NO se sobrescribe
 * nada. Fallo CERRADO en la ESCRITURA, que es donde importa.
 *
 * 🔴 `stale` no lanza y no convierte una corrida pagada en un error: los
 * candidatos ya son durables y el proveedor ya cobró. Devolver un fallo aquí le
 * ofrecería a la persona un reintento que volvería a gastar — el mismo
 * razonamiento que gobierna la liquidación y la fila de uso en esta ruta. Se
 * DICE (estado devuelto + telemetría) y ahí se detiene.
 *
 * ── M126 sin aplicar ─────────────────────────────────────────────────────────
 *
 * La migración 126 se entrega SIN aplicar, así que `identity_epoch` puede no
 * existir. Este módulo NO depende de ella:
 *
 *   · época conocida            → CAS sobre `identity_epoch` (ruta vallada);
 *   · ausencia PROBADA por la
 *     base (42883 / PGRST202)   → ruta ANTERIOR a B4, exactamente la misma forma
 *                                 de escritura que `candidate-writer` y que el
 *                                 sellado terminal de CUT-8B ya hacen hoy;
 *   · cualquier otro `null`     → NO se escribe. Una avería de lectura no puede
 *                                 autorizar una escritura sin valla.
 *
 * 🔴 La tercera regla es la corrección de CUT-3B4 aplicada aquí: «sin época» NO
 * es «sin migración». Quien combina las tres señales es
 * `isProvenFenceCapabilityAbsent`, nunca este módulo por su cuenta.
 *
 * ── Lo que este módulo NO hace ───────────────────────────────────────────────
 *
 * No calcula aceptación. No sabe de objetivos, de huecos, de proveedores ni de
 * candidatos. Recibe un bloque de claves YA resuelto y YA serializado por su
 * autoridad, y sólo decide cómo convive con lo que la fila ya tenía y bajo qué
 * valla se escribe.
 */

import {
  isProvenFenceCapabilityAbsent,
  type FenceCapabilityEvidence,
} from './batch-identity-fenced-persistence';

/** La columna que hace de versión del lote. La de M126, no una nueva. */
export const BATCH_IDENTITY_EPOCH_COLUMN = 'identity_epoch';

/**
 * Compone la metadata a publicar.
 *
 * 🔴 Es una SUSTITUCIÓN de claves de primer nivel, no un `metadata || ...` de
 * Postgres ni un merge profundo. La diferencia importa: un merge recursivo podría
 * fusionar dos versiones del MISMO bloque y publicar un híbrido que ninguna
 * corrida produjo. La clave que este corte publica gana entera; las demás se
 * conservan intactas. Es el mismo criterio con el que `candidate-writer` compone
 * su `finalMetadata` y con el que CUT-8B compone su sellado terminal.
 *
 * 🔴 `current` se RELEE de la fila y no se reconstruye desde la petición: el
 * lote lleva procedencia que esta capa no conoce —enrutado del proveedor,
 * facturación, taxonomía, telemetría de ramas, identidad de lote— y
 * reconstruirla aquí la publicaría a medias en cuanto alguien añadiera una clave
 * allí sin acordarse de este archivo.
 *
 * Una `current` ilegible (nula, array, escalar) se trata como AUSENCIA y no como
 * error: el bloque publicado es verdad de esta corrida y no puede perderse porque
 * la fila traiga una forma inesperada.
 */
export function composeFencedBatchMetadata(
  current: unknown,
  published: Record<string, unknown> | null,
): Record<string, unknown> {
  const base =
    typeof current === 'object' && current !== null && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  if (published === null) return { ...base };
  return { ...base, ...published };
}

/** Bajo qué régimen se escribe, decidido por el ESQUEMA y no por una preferencia. */
export type BatchMetadataFencePlan =
  /** M126 activa: CAS sobre la época que el lote tiene AHORA. */
  | { mode: 'fenced'; expectedEpoch: number }
  /** Ausencia de la valla PROBADA por la base. Ruta anterior a B4, tal cual. */
  | { mode: 'legacy_unfenced' }
  /** Ni época ni prueba de ausencia: avería. NO se escribe. */
  | { mode: 'unavailable' };

/**
 * Decide el régimen de escritura.
 *
 * `epochAfterWrite` es la época que el lote tiene DESPUÉS de que el writer
 * escribiera sus filas —la que devuelve la transacción vallada—, no la que leyó
 * antes de escribir. Declarar la de antes daría `stale` siempre: el propio writer
 * acaba de avanzarla.
 *
 * 🔴 La conjunción de la ausencia PROBADA no se reescribe aquí: se delega en
 * `isProvenFenceCapabilityAbsent`. Escribir `epoch === null` a secas convertiría
 * una lectura caída en una escritura sin valla, que es la dirección equivocada de
 * la degradación y el defecto que la CORRECCIÓN de CUT-3B4 cerró.
 */
export function decideBatchMetadataFencePlan(input: {
  epochAfterWrite: number | null;
  evidence: FenceCapabilityEvidence;
}): BatchMetadataFencePlan {
  if (input.epochAfterWrite !== null && Number.isFinite(input.epochAfterWrite)) {
    return { mode: 'fenced', expectedEpoch: Math.trunc(input.epochAfterWrite) };
  }
  if (isProvenFenceCapabilityAbsent(input.evidence)) return { mode: 'legacy_unfenced' };
  return { mode: 'unavailable' };
}

/** Desenlace de la publicación. Ninguno lanza; todos se dicen. */
export type BatchMetadataPublicationResult =
  | { status: 'published'; fenced: boolean }
  /** Otro escritor avanzó el lote entre la lectura y el CAS. CERO sobrescritura. */
  | { status: 'stale' }
  /** El lote no existe o la RLS no lo deja ver. CERO sobrescritura. */
  | { status: 'batch_not_found' }
  /** Sin época y sin prueba de ausencia de la valla. CERO sobrescritura. */
  | { status: 'skipped_unavailable' }
  /** Fallo REAL de la base. CERO sobrescritura garantizada por la propia base. */
  | { status: 'failed'; code: string };

export type BatchMetadataDbError = { code?: string; message?: string };

type UpdateTerminal = Promise<{
  data: { id: string }[] | null;
  error: BatchMetadataDbError | null;
}>;

/** Cliente mínimo, inyectable. Sólo lo que esta publicación necesita. */
export interface BatchMetadataPublicationDbClient {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): Promise<{
          data: { metadata?: unknown } | null;
          error: BatchMetadataDbError | null;
        }>;
      };
    };
    update(patch: Record<string, unknown>): {
      eq(
        column: string,
        value: string,
      ): {
        /** El segundo `eq` es la VALLA: `identity_epoch = expectedEpoch`. */
        eq(column: string, value: number): { select(columns: string): UpdateTerminal };
        select(columns: string): UpdateTerminal;
      };
    };
  };
}

/**
 * Publica el bloque en la metadata del lote, bajo el régimen que decide el
 * esquema. Nunca lanza: cada desenlace tiene nombre.
 *
 * 🔴 UNA lectura y UNA escritura, sobre el lote CANÓNICO que el llamador pasa por
 * id. No hay `ORDER BY created_at DESC`, no hay búsqueda por nombre y no hay
 * «último lote»: este módulo no sabe encontrar lotes, sólo escribir en el que le
 * dan.
 */
export async function publishFencedBatchMetadata(
  client: BatchMetadataPublicationDbClient,
  input: {
    batchId: string;
    plan: BatchMetadataFencePlan;
    published: Record<string, unknown> | null;
  },
): Promise<BatchMetadataPublicationResult> {
  if (input.plan.mode === 'unavailable') return { status: 'skipped_unavailable' };
  if (input.published === null) return { status: 'skipped_unavailable' };

  try {
    const { data: currentRow, error: readError } = await client
      .from('prospect_batches')
      .select('metadata')
      .eq('id', input.batchId)
      .maybeSingle();

    if (readError) {
      return { status: 'failed', code: readError.code ?? 'metadata_read_failed' };
    }
    // 🔴 Sin fila no se escribe. Un lote invisible para la RLS de esta sesión no
    // es un lote vacío: componer sobre `{}` publicaría una metadata amputada.
    if (!currentRow) return { status: 'batch_not_found' };

    const metadata = composeFencedBatchMetadata(currentRow.metadata, input.published);

    const scoped = client
      .from('prospect_batches')
      .update({ metadata })
      .eq('id', input.batchId);

    const { data, error } =
      input.plan.mode === 'fenced'
        ? await scoped
            .eq(BATCH_IDENTITY_EPOCH_COLUMN, input.plan.expectedEpoch)
            .select('id')
        : await scoped.select('id');

    if (error) return { status: 'failed', code: error.code ?? 'metadata_write_failed' };
    // Cero filas con la valla puesta = la época cambió = `stale`. Sin valla, cero
    // filas sólo puede ser que el lote ya no esté visible.
    if (!data || data.length === 0) {
      return input.plan.mode === 'fenced'
        ? { status: 'stale' }
        : { status: 'batch_not_found' };
    }
    return { status: 'published', fenced: input.plan.mode === 'fenced' };
  } catch (error: unknown) {
    const code = (error as { code?: unknown } | null)?.code;
    return {
      status: 'failed',
      code: typeof code === 'string' ? code : 'metadata_publication_threw',
    };
  }
}
