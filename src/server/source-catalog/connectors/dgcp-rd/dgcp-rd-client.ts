/**
 * DGCP RD Connector — Read-only HTTP Client
 *
 * Fuente: Dirección General de Contrataciones Públicas (República Dominicana)
 * Base: https://datosabiertos.dgcp.gob.do/api-dgcp/v1
 *
 * Endpoints usados:
 *   GET /contratos   — listado paginado de contratos históricos
 *   GET /proveedores — ficha de proveedor (permite filtrar por rpe)
 *
 * Sin auth. Solo GET. Timeout 15s. Sin retries agresivos.
 * No crea accounts, candidates ni adapters.
 * No es fuente de validación fiscal — solo señal B2G comercial.
 */

export const DGCP_BASE = 'https://datosabiertos.dgcp.gob.do/api-dgcp/v1';
const DGCP_TIMEOUT_MS = 15_000;

/** Límite máximo seguro para el piloto. No superar en este hito. */
export const DGCP_MAX_LIMIT = 1_000;

const DGCP_HEADERS = {
  'User-Agent': 'SellUp/0.1 data-source-audit',
  Accept: 'application/json',
};

// ─── URL builders ──────────────────────────────────────────────────────────────

export function buildContratosUrl(params: {
  page: number;
  limit: number;
  year?: number;
}): string {
  const safeLimit = Math.max(1, Math.min(Math.trunc(params.limit), DGCP_MAX_LIMIT));
  const safePage = Math.max(1, Math.trunc(params.page));
  const url = new URL(`${DGCP_BASE}/contratos`);
  url.searchParams.set('page', String(safePage));
  url.searchParams.set('limit', String(safeLimit));
  if (params.year != null) {
    url.searchParams.set('year', String(params.year));
  }
  return url.toString();
}

export function buildProveedorByRpeUrl(rpe: string | number): string {
  const url = new URL(`${DGCP_BASE}/proveedores`);
  url.searchParams.set('rpe', String(rpe));
  return url.toString();
}

// ─── Result types ──────────────────────────────────────────────────────────────

export type DgcpErrorKind = 'timeout' | 'http' | 'invalid_json' | 'unexpected_shape' | 'network';

export type DgcpContrato = {
  codigo_contrato: string | null;
  codigo_proceso: string | null;
  estado_contrato: string | null;
  estado_adjudicacion: string | null;
  fecha_adjudicacion: string | null;
  divisa: string | null;
  valor_contratado: number | null;
  descripcion: string | null;
  url_contrato: string | null;
  unidad_compra: string | null;
  codigo_unidad_compra: string | null;
  rpe: string | null;
  razon_social: string | null;
};

export type DgcpProveedor = {
  rpe: string | null;
  razon_social: string | null;
  tipo_documento: string | null;
  numero_documento: string | null;
  estado: string | null;
  tipo_persona: string | null;
  forma_juridica: string | null;
  fecha_registro_rpe: string | null;
  es_mipyme: boolean | null;
  clasificacion: string | null;
  pais: string | null;
  region: string | null;
  provincia: string | null;
  municipio: string | null;
};

export type FetchContratosResult =
  | { ok: true; contratos: DgcpContrato[]; total: number | null }
  | { ok: false; errorKind: DgcpErrorKind; error: string };

export type FetchProveedorResult =
  | { ok: true; proveedor: DgcpProveedor | null }
  | { ok: false; errorKind: DgcpErrorKind; error: string };

// ─── Contratos ─────────────────────────────────────────────────────────────────

export async function fetchDgcpContractsPage(params: {
  page: number;
  limit: number;
  year?: number;
}): Promise<FetchContratosResult> {
  const url = buildContratosUrl(params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DGCP_TIMEOUT_MS);

  let responseText: string;
  let status: number;
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: DGCP_HEADERS,
      });
    } finally {
      clearTimeout(timeout);
    }
    status = response.status;
    responseText = await response.text();
    if (!response.ok) {
      return { ok: false, errorKind: 'http', error: `HTTP ${status} desde DGCP /contratos` };
    }
  } catch (error: unknown) {
    return mapTransportError(error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return { ok: false, errorKind: 'invalid_json', error: 'La respuesta de /contratos no es JSON válido.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, errorKind: 'unexpected_shape', error: 'Formato inesperado en /contratos.' };
  }

  const body = parsed as Record<string, unknown>;
  const contratos = extractContratos(body);
  const total = extractTotal(body);

  return { ok: true, contratos, total };
}

// ─── Proveedores ───────────────────────────────────────────────────────────────

export async function fetchDgcpProviderByRpe(
  rpe: string | number,
): Promise<FetchProveedorResult> {
  const url = buildProveedorByRpeUrl(rpe);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DGCP_TIMEOUT_MS);

  let responseText: string;
  let status: number;
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: DGCP_HEADERS,
      });
    } finally {
      clearTimeout(timeout);
    }
    status = response.status;
    responseText = await response.text();
    if (!response.ok) {
      return { ok: false, errorKind: 'http', error: `HTTP ${status} desde DGCP /proveedores?rpe=${rpe}` };
    }
  } catch (error: unknown) {
    return mapTransportError(error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return { ok: false, errorKind: 'invalid_json', error: 'La respuesta de /proveedores no es JSON válido.' };
  }

  const proveedor = extractProveedor(parsed);
  return { ok: true, proveedor };
}

// ─── Extractors ────────────────────────────────────────────────────────────────

function toStr(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (typeof v === 'string') {
    const lower = v.toLowerCase().trim();
    if (lower === 'si' || lower === 'sí' || lower === 'yes') return true;
    if (lower === 'no' || lower === 'false') return false;
  }
  if (v === 0 || v === '0') return false;
  return null;
}

export function extractTotal(body: Record<string, unknown>): number | null {
  // DGCP RD: { totalResults: N, page: N, limit: N, pages: N, payload: { content: [] } }
  for (const key of ['totalResults', 'total', 'count', 'total_count']) {
    const v = body[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  const pagination = body.pagination;
  if (pagination && typeof pagination === 'object') {
    const t = (pagination as Record<string, unknown>).total;
    if (typeof t === 'number' && Number.isFinite(t)) return t;
  }
  return null;
}

export function extractContratos(body: Record<string, unknown>): DgcpContrato[] {
  // DGCP RD: { payload: { content: [] } }
  const payload = body.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const content = (payload as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      return content.map(parseContrato).filter((c): c is DgcpContrato => c !== null);
    }
  }
  // Fallback: otros shapes comunes
  for (const key of ['data', 'contratos', 'items', 'results', 'content']) {
    if (Array.isArray(body[key])) {
      return (body[key] as unknown[]).map(parseContrato).filter((c): c is DgcpContrato => c !== null);
    }
  }
  if (Array.isArray(body)) {
    return (body as unknown[]).map(parseContrato).filter((c): c is DgcpContrato => c !== null);
  }
  return [];
}

function parseContrato(raw: unknown): DgcpContrato | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    codigo_contrato: toStr(o.codigo_contrato),
    codigo_proceso: toStr(o.codigo_proceso),
    estado_contrato: toStr(o.estado_contrato),
    estado_adjudicacion: toStr(o.estado_adjudicacion),
    fecha_adjudicacion: toStr(o.fecha_adjudicacion),
    divisa: toStr(o.divisa),
    valor_contratado: toNum(o.valor_contratado),
    descripcion: toStr(o.descripcion),
    url_contrato: toStr(o.url_contrato),
    unidad_compra: toStr(o.unidad_compra),
    codigo_unidad_compra: toStr(o.codigo_unidad_compra),
    rpe: toStr(o.rpe),
    razon_social: toStr(o.razon_social),
  };
}

export function extractProveedor(body: unknown): DgcpProveedor | null {
  // Puede venir como array con 1 elemento, como objeto directo, o envuelto en data/payload.content
  if (Array.isArray(body) && body.length === 0) return null;

  let raw: unknown = body;
  if (Array.isArray(body) && body.length > 0) {
    raw = body[0];
  } else if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    // DGCP RD: { payload: { content: [{ ... }] } }
    const payload = b.payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const content = (payload as Record<string, unknown>).content;
      if (Array.isArray(content) && content.length > 0) {
        raw = content[0];
      } else if (Array.isArray(content) && content.length === 0) {
        return null;
      }
    } else if (b.data && typeof b.data === 'object' && !Array.isArray(b.data)) {
      raw = b.data;
    } else if (Array.isArray(b.data) && b.data.length > 0) {
      raw = b.data[0];
    } else if (b.proveedor && typeof b.proveedor === 'object') {
      raw = b.proveedor;
    }
  }

  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    rpe: toStr(o.rpe),
    razon_social: toStr(o.razon_social),
    tipo_documento: toStr(o.tipo_documento),
    numero_documento: toStr(o.numero_documento),
    estado: toStr(o.estado),
    tipo_persona: toStr(o.tipo_persona),
    forma_juridica: toStr(o.forma_juridica),
    fecha_registro_rpe: toStr(o.fecha_registro_rpe),
    es_mipyme: toBool(o.es_mipyme),
    clasificacion: toStr(o.clasificacion),
    pais: toStr(o.pais),
    region: toStr(o.region),
    provincia: toStr(o.provincia),
    municipio: toStr(o.municipio),
  };
}

// ─── Error sanitization ────────────────────────────────────────────────────────

function mapTransportError(error: unknown): {
  ok: false;
  errorKind: DgcpErrorKind;
  error: string;
} {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('abort') || msg.includes('timeout')) {
      return { ok: false, errorKind: 'timeout', error: 'DGCP no respondió a tiempo.' };
    }
    if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
      return { ok: false, errorKind: 'network', error: 'Error DNS al resolver DGCP.' };
    }
    return { ok: false, errorKind: 'network', error: `Error de red: ${error.message.slice(0, 120)}` };
  }
  return { ok: false, errorKind: 'network', error: 'Error desconocido al consultar DGCP.' };
}
