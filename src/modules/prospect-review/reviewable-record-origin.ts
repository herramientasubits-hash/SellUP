// AGENT1-IMPORT-PARITY-4 — qué procedencias puede operar la revisión de Prospectos.
//
// El defecto que cierra: un prospecto importado (drawer «Importar» → vista
// previa → cargar a SellUp) aparecía en Prospectos con la etiqueta «Nuevo»
// igual que los de IA, pero NO se podía aprobar, descartar ni marcar duplicado:
// las cuatro reglas de elegibilidad exigían `record_origin === 'production'` y el
// clasificador canónico lo deja en `'import'` (regla R4).
//
// Por qué NO se cambia la procedencia a `production`: `record_origin` es la
// dimensión que usa el modelo de efectividad de Agente 1 para separar lo que
// produjo una corrida real de lo que subió una persona. Etiquetar un import como
// `production` inflaría esas métricas. La procedencia sigue siendo `import`; lo
// que cambia es que la revisión también la acepta.
//
// Siguen FUERA (fail-closed): smoke_test, qa, synthetic, historical_cleanup,
// unknown y NULL.
//
// Pura: sin I/O.

export const REVIEWABLE_RECORD_ORIGINS = ['production', 'import'] as const;

export type ReviewableRecordOrigin = (typeof REVIEWABLE_RECORD_ORIGINS)[number];

export function isReviewableRecordOrigin(
  recordOrigin: string | null | undefined,
): recordOrigin is ReviewableRecordOrigin {
  return (REVIEWABLE_RECORD_ORIGINS as readonly string[]).includes(recordOrigin ?? '');
}
