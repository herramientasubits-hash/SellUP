/**
 * AGENT1-AUDIT-WS2 § 7 — el lote del asistente pasa a `generating` cuando empieza
 * la parte de pago (puro salvo el cliente inyectado).
 *
 * El lote nace en `draft` (`wizard-idempotency.ts`) y sólo Tavily-primero y «Claude
 * busca empresas» lo movían a `generating`. La ruta de Apollo no: durante toda la
 * corrida el lote decía «borrador», y la bandeja, el historial y el cierre de
 * corridas trabadas no podían distinguir «corriendo» de «abandonado».
 *
 * Sólo desde `draft`: un lote que otro escritor ya movió (p. ej. `ready_for_review`)
 * queda intacto, y 0 filas no es error. El escritor de Apollo acepta `draft` y
 * `generating` (`candidate-writer.ts`), así que esto no cambia lo que se escribe.
 */

/** Lo mínimo del cliente Supabase que usa la transición (inyectable en pruebas). */
export type MarkBatchGeneratingClient = {
  from(table: 'prospect_batches'): {
    update(values: { status: 'generating' }): {
      eq(column: 'id', value: string): {
        eq(column: 'status', value: 'draft'): PromiseLike<{ error: unknown }>;
      };
    };
  };
};

/** `true` = la escritura no falló (aunque no tocara ninguna fila). Nunca lanza. */
export async function markWizardBatchGenerating(
  client: MarkBatchGeneratingClient,
  batchId: string,
): Promise<boolean> {
  try {
    const { error } = await client
      .from('prospect_batches')
      .update({ status: 'generating' })
      .eq('id', batchId)
      .eq('status', 'draft');
    return !error;
  } catch {
    return false;
  }
}
