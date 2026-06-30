/**
 * ChileCompra / Mercado Público OCDS — Health-check (read-only)
 *
 * Consulta el listado mensual OCDS y reporta el total de procesos del mes.
 * NO escribe en Supabase. NO crea candidatos. NO crea cuentas. Sin credencial.
 */

import { fetchOcdsListado } from './chilecompra-ocds-client';
import type {
  ChileCompraOcdsHealthCheckInput,
  ChileCompraOcdsHealthCheckReport,
} from './types';

const HEALTH_CHECK_MAX_LIMIT = 5;
const NO_WRITE_MESSAGE = 'Fuente abierta sin credenciales. No escribe en Supabase.';

function errorReport(
  input: { year: number; month: number; limit: number; offset: number },
  error: string,
): ChileCompraOcdsHealthCheckReport {
  return {
    status: 'error',
    year: input.year,
    month: input.month,
    limit: input.limit,
    offset: input.offset,
    totalMonthProcesses: null,
    firstOcids: [],
    writes_performed: 0,
    message: NO_WRITE_MESSAGE,
    error,
  };
}

export async function runChileCompraOcdsHealthCheck(
  input: ChileCompraOcdsHealthCheckInput,
): Promise<ChileCompraOcdsHealthCheckReport> {
  const limit = Math.max(1, Math.min(input.limit ?? HEALTH_CHECK_MAX_LIMIT, HEALTH_CHECK_MAX_LIMIT));
  const offset = Math.max(0, input.offset ?? 0);
  const base = { year: input.year, month: input.month, limit, offset };

  const result = await fetchOcdsListado({
    year: input.year,
    month: input.month,
    offset,
    limit,
  });

  if (!result.ok) {
    return errorReport(base, result.error);
  }

  // total ausente → falla explícita
  if (result.total === null) {
    return errorReport(base, 'No se pudo leer el total de procesos del mes.');
  }

  // items ausentes (sin array reconocible) → falla de shape
  if (result.items === null) {
    return errorReport(base, 'El listado del mes no trae procesos.');
  }

  return {
    status: 'operational',
    year: input.year,
    month: input.month,
    limit,
    offset,
    totalMonthProcesses: result.total,
    firstOcids: result.items.slice(0, limit).map((i) => i.ocid),
    writes_performed: 0,
    message: NO_WRITE_MESSAGE,
  };
}
