/**
 * COMPRASAL El Salvador — Cliente REST público
 *
 * Consulta la API REST pública de COMPRASAL para obtener adjudicaciones
 * públicas de El Salvador.
 *
 * Base: https://www.comprasal.gob.sv/api/v1/publico/
 *
 * No requiere credenciales. No usa sesión. No llama /api/v1/procesos ni
 * endpoints autenticados de personas.
 *
 * Guardrail semántico:
 *   COMPRASAL no es fuente legal ni tributaria.
 *   No expone NIT/NRC en endpoints públicos.
 *   No permite post-approval automático por identificador fiscal.
 *
 * Hito: Centroamérica.7C
 */

export const COMPRASAL_BASE = 'https://www.comprasal.gob.sv';
export const COMPRASAL_PUBLIC_PREFIX = '/api/v1/publico/';
export const COMPRASAL_TIMEOUT_MS = 20_000;

const PROCESSES_ENDPOINT = `${COMPRASAL_BASE}/api/v1/publico/obtener/procesos/publicos`;
const AWARD_REPORT_ENDPOINT = `${COMPRASAL_BASE}/api/v1/publico/obtener/informe-adjudicacion`;

export const COMPRASAL_USER_AGENT = 'SellUp/1.0 (procurement-signal-research)';

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type ComprasalInstitucion = {
  id?: number | string;
  codigo?: string;
  nombre?: string;
  [key: string]: unknown;
};

export type ComprasalProveedor = {
  id?: number | string;
  id_proveedor?: number | string;
  nombre?: string;
  nombre_comercial?: string;
  [key: string]: unknown;
};

export type ComprasalProcesoCompra = {
  id?: number | string;
  codigo_proceso?: string;
  nombre_proceso?: string;
  fecha_adjudicacion?: string;
  id_forma_contratacion?: number | string;
  [key: string]: unknown;
};

export type ComprasalAdjudicacion = {
  id?: number | string;
  monto?: number | string;
  proceso_compra?: ComprasalProcesoCompra;
  institucion?: ComprasalInstitucion;
  proveedor?: ComprasalProveedor;
  [key: string]: unknown;
};

export type ComprasalProcessesPage = {
  data: ComprasalAdjudicacion[];
  total?: number;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
};

export type ListPublicProcessesParams = {
  page?: number;
  per_page?: number;
};

// ─── Cliente ───────────────────────────────────────────────────────────────────

export async function listPublicProcurementProcesses(
  params: ListPublicProcessesParams = {},
): Promise<ComprasalProcessesPage> {
  const page = params.page ?? 1;
  const perPage = Math.min(params.per_page ?? 100, 200);

  const url = new URL(PROCESSES_ENDPOINT);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMPRASAL_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': COMPRASAL_USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`COMPRASAL HTTP ${res.status}: ${res.statusText}`);
    }

    const json: unknown = await res.json();

    if (Array.isArray(json)) {
      return { data: json as ComprasalAdjudicacion[] };
    }

    if (typeof json === 'object' && json !== null && 'data' in json) {
      return json as ComprasalProcessesPage;
    }

    return { data: [] };
  } finally {
    clearTimeout(timer);
  }
}

export async function getPublicAwardReport(id: number | string): Promise<unknown> {
  const url = `${AWARD_REPORT_ENDPOINT}/${id}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMPRASAL_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': COMPRASAL_USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`COMPRASAL award report HTTP ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pagina automáticamente hasta maxPages páginas.
 * Corta cuando data.length < per_page (señal de última página).
 */
export async function fetchAllAdjudicaciones(opts: {
  maxPages: number;
  perPage?: number;
}): Promise<ComprasalAdjudicacion[]> {
  const perPage = Math.min(opts.perPage ?? 100, 200);
  const results: ComprasalAdjudicacion[] = [];

  for (let page = 1; page <= opts.maxPages; page++) {
    const resp = await listPublicProcurementProcesses({ page, per_page: perPage });
    const items = resp.data ?? [];
    results.push(...items);

    if (items.length < perPage) {
      break;
    }
  }

  return results;
}
