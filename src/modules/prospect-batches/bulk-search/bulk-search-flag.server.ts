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

/**
 * La búsqueda masiva corre sola en el servidor (dueña 28-10). Apagada por defecto:
 * sin ella, sólo avanza con SellUp abierto, como antes. Exige también la de arriba.
 */
export const GROWTH_BULK_SEARCH_SERVER_RUNNER_FLAG = 'ENABLE_GROWTH_BULK_SEARCH_SERVER_RUNNER';

export function isBulkSearchServerRunnerEnabled(): boolean {
  return isGrowthBulkSearchEnabled() && isEnvFlagEnabled(process.env[GROWTH_BULK_SEARCH_SERVER_RUNNER_FLAG]);
}
