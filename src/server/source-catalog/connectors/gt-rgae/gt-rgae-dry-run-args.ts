/**
 * GT RGAE — CLI Args Parser
 *
 * Parsea y valida los argumentos del script de dry-run.
 * --apply está explícitamente bloqueado en este hito.
 *
 * Hito: Centroamérica.7G.1
 */

export const GT_RGAE_SUPPORTED_YEARS = [2025] as const;
export type GtRgaeSupportedYear = (typeof GT_RGAE_SUPPORTED_YEARS)[number];

export interface GtRgaeDryRunArgs {
  year: GtRgaeSupportedYear;
  localFile: string;
  applyRejected: boolean;
}

/**
 * Parsea argv (process.argv.slice(2) o equivalente de test).
 * Lanza Error con código semántico si faltan args requeridos.
 */
export function parseGtRgaeArgs(argv: string[]): GtRgaeDryRunArgs {
  let year: number | null = null;
  let localFile: string | null = null;
  let applyRejected = false;

  for (const arg of argv) {
    if (arg.startsWith('--year=')) {
      year = parseInt(arg.slice('--year='.length), 10);
    } else if (arg.startsWith('--local-file=')) {
      const val = arg.slice('--local-file='.length);
      localFile = val.trim() === '' ? null : val;
    } else if (arg === '--apply') {
      applyRejected = true;
    }
  }

  if (year === null || isNaN(year)) {
    throw new Error('year_required: --year=<YYYY> is required');
  }

  if (!GT_RGAE_SUPPORTED_YEARS.includes(year as GtRgaeSupportedYear)) {
    throw new Error(`unsupported_year: ${year} is not supported. Supported: ${GT_RGAE_SUPPORTED_YEARS.join(', ')}`);
  }

  if (!localFile) {
    throw new Error('local_file_required: --local-file=<absolute path> is required');
  }

  return { year: year as GtRgaeSupportedYear, localFile, applyRejected };
}
