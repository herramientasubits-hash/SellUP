/**
 * denue-activity-live-reads.ts — la consulta EN VIVO (sólo lectura) al DENUE del INEGI
 * para el descubrimiento gratuito de México.
 *
 * SOURCES-MX-DENUE-FREE-DISCOVERY-1. La dueña autorizó la consulta en vivo
 * (30-09-2026). DENUE es gratuito: no gasta créditos.
 *
 * Método `BuscarAreaActEstr` (todo el país = entidad «00»):
 *   /BuscarAreaActEstr/{entidad}/{municipio}/{localidad}/{AGEB}/{manzana}/
 *     {sector}/{subsector}/{rama}/{clase}/{nombre}/{reg_ini}/{reg_fin}/{id}/{estrato}/{token}
 *
 * - La clave se obtiene con una función inyectada (en Producción, la bóveda de
 *   secretos vía `resolveSourceCredential('denue_mexico')`); nunca se registra.
 * - Cada consulta tiene tiempo máximo; cualquier error, respuesta no-JSON o clave
 *   ausente degrada a vacío (fail-open hacia el proveedor de pago).
 * - La clave se pide una sola vez por adapter y se reutiliza.
 *
 * Vive en el conector de DENUE, junto al resto del código que llama al INEGI, y
 * NO en `country-source-discovery/`: esa carpeta tiene una guarda que prohíbe
 * `fetch` (las fuentes locales no salen a la red). La capa gratuita sólo recibe
 * esta consulta ya construida, inyectada desde el cableado de producción.
 */

import type {
  DenueEstablishment,
  MxDenueDiscoveryReads,
} from '@/server/prospect-batches/country-source-discovery/mx-denue-discovery-adapter';

export const DENUE_API_BASE = 'https://www.inegi.org.mx/app/api/denue/v1/consulta';
/** Tiempo máximo por consulta a DENUE. */
export const DENUE_REQUEST_TIMEOUT_MS = 8000;

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; text(): Promise<string> }>;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Construye la URL de `BuscarAreaActEstr` para todo el país. */
export function buildDenueActivityUrl(input: {
  sector: string;
  subsector: string;
  rama: string;
  estrato: string;
  limit: number;
  token: string;
}): string {
  const safe = (value: string) => encodeURIComponent(value);
  return [
    DENUE_API_BASE,
    'BuscarAreaActEstr',
    '00', '0', '0', '0', '0',
    safe(input.sector), safe(input.subsector), safe(input.rama), '0',
    '0',
    '1', String(Math.max(1, Math.trunc(input.limit))),
    '0',
    safe(input.estrato),
    safe(input.token),
  ].join('/');
}

/** Fila cruda de DENUE → establecimiento. */
export function toDenueEstablishment(raw: Record<string, unknown>): DenueEstablishment | null {
  const id = text(raw['Id']) ?? text(raw['CLEE']);
  if (id === null) return null;
  return {
    id,
    name: text(raw['Nombre']),
    legalName: text(raw['Razon_social']),
    activityCode: text(raw['CLASE_ACTIVIDAD_ID']),
    activityName: text(raw['Clase_actividad']),
    estrato: text(raw['Estrato']),
    website: text(raw['Sitio_internet']),
    location: text(raw['Ubicacion']),
  };
}

/** Adapta un obtenedor de clave + fetch a la consulta del adapter. */
export function buildMxDenueLiveReads(deps: {
  getToken: () => Promise<string | null>;
  fetchImpl?: Fetch;
}): MxDenueDiscoveryReads {
  const doFetch: Fetch = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  let tokenPromise: Promise<string | null> | null = null;
  const token = () => {
    tokenPromise ??= deps.getToken().catch(() => null);
    return tokenPromise;
  };

  return {
    async readEstablishments({ filter, estrato, limit }) {
      const key = await token();
      if (!key) return [];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DENUE_REQUEST_TIMEOUT_MS);
      try {
        const response = await doFetch(
          buildDenueActivityUrl({ ...filter, estrato, limit, token: key }),
          { signal: controller.signal },
        );
        if (!response.ok) return [];
        const body = await response.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          return []; // DENUE responde texto («No hay resultados…») cuando no hay nada.
        }
        if (!Array.isArray(parsed)) return [];
        const rows: DenueEstablishment[] = [];
        for (const raw of parsed) {
          if (raw && typeof raw === 'object') {
            const row = toDenueEstablishment(raw as Record<string, unknown>);
            if (row !== null) rows.push(row);
          }
        }
        return rows;
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
