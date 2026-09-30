/**
 * AGENT1-IMPORT-PARITY-3 — marcas de revisión de una fila IMPORTADA.
 *
 * Las escribe `evaluateImportQualityGates` (server) en `review_flags`; las lee
 * la ficha del candidato. Puro, sin I/O, importable desde cliente.
 *
 * Ninguna marca descarta la fila: dicen qué revisar antes de aprobar. La marca
 * de dominio no verificado es la MISMA de Lusha (`ownership_unverified`) y vive
 * en `ownership-review-flag.ts`.
 */

export const IMPORT_COUNTRY_MISMATCH_FLAG = 'import_country_mismatch' as const;
export const IMPORT_EXTERNAL_PLATFORM_FLAG = 'import_external_platform' as const;
export const IMPORT_BELOW_ICP_SIZE_FLAG = 'import_below_icp_size' as const;

export const IMPORT_REVIEW_FLAG_LABELS: Readonly<Record<string, string>> = {
  [IMPORT_COUNTRY_MISMATCH_FLAG]:
    'El sitio web parece de otro país. Confirma el país antes de aprobar.',
  [IMPORT_EXTERNAL_PLATFORM_FLAG]:
    'El sitio web es una plataforma o directorio, no el sitio de la empresa.',
  [IMPORT_BELOW_ICP_SIZE_FLAG]:
    'El tamaño indicado está por debajo de 200 empleados.',
};

/** Marcas de importación presentes en `review_flags`, en orden estable. */
export function readImportReviewFlags(flags: unknown): string[] {
  if (!Array.isArray(flags)) return [];
  return Object.keys(IMPORT_REVIEW_FLAG_LABELS).filter((f) => flags.includes(f));
}
