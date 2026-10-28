import 'server-only';
import { isEnvFlagEnabled } from '@/lib/env-flag-parser';

/**
 * GROWTH-BULK-SEARCH-1 — la búsqueda masiva de Growth. Apagada por defecto: sólo
 * el token exacto `true` la enciende. Apagada, ninguna ruta masiva responde y la
 * pantalla no ofrece el paso de cantidad.
 */
export const GROWTH_BULK_SEARCH_FLAG = 'ENABLE_GROWTH_BULK_SEARCH';

export function isGrowthBulkSearchEnabled(): boolean {
  return isEnvFlagEnabled(process.env[GROWTH_BULK_SEARCH_FLAG]);
}
