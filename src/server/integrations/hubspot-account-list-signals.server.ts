/**
 * hubspot-account-list-signals.server.ts — lo que la «Lista de empresas» muestra de
 * HubSpot (dueño 17-11): última actividad, próxima actividad agendada y estado
 * comercial (cliente, negocio abierto, libre…).
 *
 * Sólo lectura: `POST /crm/v3/objects/companies/batch/read` (100 empresas por
 * petición) con las propiedades de la regla de «empresa libre», y el directorio
 * de dueños de `hubspot-free-company-pool` (con su caché).
 *
 * Nunca lanza y nunca bloquea la lista: con HubSpot caído o lento, las empresas
 * quedan «Sin lectura de HubSpot» y la página sigue.
 */

import { getHubSpotToken } from './hubspot-company-create';
import { fetchHubSpotWithRetry } from './hubspot-rate-limit';
import { loadHubSpotOwnerDirectory, type HubSpotFetch } from './hubspot-free-company-pool.server';
import {
  classifyHubSpotCompanyAvailability,
  HUBSPOT_FREE_POLICY_PROPERTIES,
  latestHubSpotActivity,
  parseHubSpotTimestamp,
  type HubSpotOwnerDirectory,
} from './hubspot-free-company-policy';
import { commercialStatusFromAvailability, type HubSpotAccountSignal } from '@/modules/accounts/list-signals';

const HUBSPOT_API = 'https://api.hubapi.com';
const BATCH_SIZE = 100;
const CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 10_000;
/** Lo más que la lista espera a HubSpot: después sigue con lo que haya. */
export const HUBSPOT_LIST_SIGNALS_DEADLINE_MS = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

type BatchReadResponse = {
  results?: Array<{ id: string; properties?: Record<string, unknown> }>;
};

const cache = new Map<string, { signal: HubSpotAccountSignal; at: number }>();

/** Sólo para pruebas. */
export function resetHubSpotAccountListSignalsCache(): void {
  cache.clear();
}

function isoOrNull(at: number | null): string | null {
  return at === null ? null : new Date(at).toISOString();
}

/** La señal de una empresa a partir de sus propiedades ya leídas. */
export function hubSpotSignalFromProperties(
  properties: Record<string, unknown>,
  owners: HubSpotOwnerDirectory | null,
  now: Date,
): HubSpotAccountSignal {
  const lastActivityAt = isoOrNull(latestHubSpotActivity(properties));
  const nextActivityAt = isoOrNull(parseHubSpotTimestamp(properties.notes_next_activity_date));
  const availability = classifyHubSpotCompanyAvailability(
    properties,
    owners ?? { activeIds: new Set(), deactivatedIds: new Set(), poolIds: new Set() },
    now,
  );
  // Sin directorio de dueños no se sabe si el dueño es una persona activa o una bolsa:
  // eso no se adivina.
  const ownerUnknown = !owners && !availability.free && availability.reason === 'unknown_owner';
  return {
    status: ownerUnknown ? 'unavailable' : commercialStatusFromAvailability(availability),
    lastActivityAt,
    nextActivityAt,
  };
}

async function readBatch(
  token: string,
  ids: string[],
  fetchFn: HubSpotFetch,
): Promise<Map<string, Record<string, unknown>> | null> {
  const res = await fetchHubSpotWithRetry(
    `${HUBSPOT_API}/crm/v3/objects/companies/batch/read`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: HUBSPOT_FREE_POLICY_PROPERTIES, inputs: ids.map((id) => ({ id })) }),
    },
    REQUEST_TIMEOUT_MS,
    { fetchFn },
  );
  // 207: algunas no existen (fusionadas o borradas); las demás vienen igual.
  if (!res.ok && res.status !== 207) {
    console.error(`[hubspot-list-signals] batch/read HTTP ${res.status}`);
    return null;
  }
  const body = (await res.json()) as BatchReadResponse;
  const out = new Map<string, Record<string, unknown>>();
  for (const result of body.results ?? []) out.set(String(result.id), result.properties ?? {});
  return out;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Las señales de HubSpot de las empresas pedidas (por Company ID). Las que HubSpot
 * no devuelve quedan «No encontrada»; si una petición falla, sus empresas no
 * aparecen en el mapa (quien llama las muestra «Sin lectura»).
 */
export async function readHubSpotAccountListSignals(
  companyIds: readonly string[],
  options: {
    fetchFn?: HubSpotFetch;
    now?: Date;
    resolveToken?: () => Promise<string | null>;
    deadlineMs?: number;
  } = {},
): Promise<Map<string, HubSpotAccountSignal>> {
  const result = new Map<string, HubSpotAccountSignal>();
  const wanted = Array.from(new Set(companyIds.map((id) => id.trim()).filter((id) => /^\d+$/.test(id))));
  if (wanted.length === 0) return result;

  const nowMs = (options.now ?? new Date()).getTime();
  const pending: string[] = [];
  for (const id of wanted) {
    const hit = cache.get(id);
    if (hit && nowMs - hit.at < CACHE_TTL_MS) result.set(id, hit.signal);
    else pending.push(id);
  }
  if (pending.length === 0) return result;

  const work = (async () => {
    try {
      const fetchFn = options.fetchFn ?? fetch;
      const token = await (options.resolveToken ?? getHubSpotToken)();
      if (!token) return;
      const owners = await loadHubSpotOwnerDirectory(token, { fetchFn });
      const now = new Date(nowMs);
      const batches = chunk(pending, BATCH_SIZE);
      let next = 0;
      const worker = async () => {
        while (next < batches.length) {
          const ids = batches[next++];
          try {
            const read = await readBatch(token, ids, fetchFn);
            if (!read) continue;
            for (const id of ids) {
              const properties = read.get(id);
              const signal: HubSpotAccountSignal = properties
                ? hubSpotSignalFromProperties(properties, owners, now)
                : { status: 'not_found', lastActivityAt: null, nextActivityAt: null };
              result.set(id, signal);
              cache.set(id, { signal, at: nowMs });
            }
          } catch (err) {
            console.error('[hubspot-list-signals] batch/read falló:', err instanceof Error ? err.message : err);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
    } catch (err) {
      console.error('[hubspot-list-signals] no disponible:', err instanceof Error ? err.message : err);
    }
  })();

  const deadlineMs = options.deadlineMs ?? HUBSPOT_LIST_SIGNALS_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deadlineMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  // Lo que llegue tarde queda en la caché para la próxima carga; aquí va lo que hay.
  return new Map(result);
}
