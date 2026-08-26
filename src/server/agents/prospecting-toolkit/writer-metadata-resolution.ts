/**
 * writer-metadata-resolution.ts — la costura que deja resolver metadata ADICIONAL
 * cuando el resultado del writer ya se conoce, pero ANTES de su única publicación.
 *
 * AGENT1-LOCAL-CUT8-ACCEPTANCE-REPORTING-PROPAGATION · DECISIÓN B.
 *
 * ── El problema que resuelve ─────────────────────────────────────────────────
 *
 * `extraBatchMetadata` es una costura de ENTRADA: el llamador la arma antes de
 * que el writer corra, y por eso sólo puede llevar hechos que ya existían —el
 * enrutamiento del proveedor, la demanda de resultados, la taxonomía—. La
 * aceptación hacia el objetivo NO es uno de ellos: la mitad de pago sólo se
 * conoce cuando el writer terminó de contar sus `complete_valid_candidates`.
 *
 * Las dos salidas obvias eran malas:
 *
 *   · un UPDATE posterior desde el mago — una segunda escritura sobre
 *     `prospect_batches.metadata`, sin la valla del writer, que puede pisar lo
 *     que el writer publicó y que abre una ventana de estado incoherente;
 *   · recalcular la aceptación dentro del writer — una SEGUNDA autoridad del
 *     objetivo, justo lo que CUT-7 existe para impedir.
 *
 * Esta costura es la tercera salida: el llamador entrega una FUNCIÓN pura, el
 * writer la llama con su propio resultado y esparce lo devuelto en la MISMA
 * publicación de metadata que ya hacía. Cero escrituras nuevas, cero aritmética
 * nueva, y la autoridad sigue viviendo donde vivía.
 *
 * Puro: sin I/O, sin env, sin Supabase, sin reloj.
 */

/**
 * Lo que el writer sabe de SU aporte cuando la metadata se va a publicar.
 *
 * 🔴 `completeValidCandidates` es `number | null`, y `null` significa «no se
 * midió», nunca cero. El resolver que lo reciba debe tratarlo como ausencia:
 * sustituirlo por `persistedCandidates` es exactamente el defecto que CUT-7
 * cerró, y hacerlo aquí lo reabriría por la puerta de la metadata.
 */
export type WriterMetadataOutcome = {
  /** Filas REALMENTE insertadas por este writer. Universo durable, no aceptación. */
  persistedCandidates: number;
  /** `candidate-completeness-contract` → `target_count`. `null` = no medido. */
  completeValidCandidates: number | null;
  /** Filas guardadas SÓLO para revisión. `null` = no medido. */
  reviewOnlyCandidates: number | null;
};

/**
 * Resuelve claves ADITIVAS de metadata a partir del resultado del writer.
 *
 * Contrato:
 *   · se invoca UNA vez por ejecución del writer, después de contar y antes de
 *     publicar;
 *   · devuelve claves que se esparcen en la metadata final. `null` = no aporta;
 *   · debe ser PURA. El writer no la reintenta ni la espera: no es el sitio de
 *     una lectura, de una llamada de red ni de una escritura.
 */
export type ResolveExtraBatchMetadata = (
  outcome: WriterMetadataOutcome,
) => Record<string, unknown> | null;
