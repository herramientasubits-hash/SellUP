/**
 * ChileCompra Connector — Client
 *
 * Consulta la API oficial de Mercado Público Chile (v1 clásica + v2 Compra Ágil).
 * Solo lectura. Sin writes. Timeout 15s.
 *
 * v1 clásica (api.mercadopublico.cl): autenticación por query param ?ticket=...
 *   - BuscarComprador, BuscarProveedor, licitaciones, ordenesdecompra
 *
 * v2 Compra Ágil (api2.mercadopublico.cl): autenticación por header `ticket`
 *   - GET /v2/compra-agil (listado + búsqueda por keyword)
 *   - GET /v2/compra-agil/{codigo} (detalle con proveedores_cotizando)
 *
 * Nunca se loguea el ticket. Nunca se retorna el ticket. Errores sanitizados.
 */

// ── Endpoints v1 clásicos ─────────────────────────────────────────────────────

export const CHILECOMPRA_BUSCAR_COMPRADOR =
  'https://api.mercadopublico.cl/servicios/v1/Publico/Empresas/BuscarComprador';

export const CHILECOMPRA_BUSCAR_PROVEEDOR =
  'https://api.mercadopublico.cl/servicios/v1/Publico/Empresas/BuscarProveedor';

export const CHILECOMPRA_LICITACIONES =
  'https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json';

export const CHILECOMPRA_ORDENES =
  'https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json';

// ── Endpoints v2 Compra Ágil ─────────────────────────────────────────────────

export const CHILECOMPRA_V2_BASE = 'https://api2.mercadopublico.cl';
export const CHILECOMPRA_V2_COMPRA_AGIL = `${CHILECOMPRA_V2_BASE}/v2/compra-agil`;

const TIMEOUT_MS = 15_000;

const HEADERS = {
  'User-Agent': 'SellUp/0.1 data-source-audit',
  Accept: 'application/json',
};

// ── RUT formatter ──────────────────────────────────────────────────────────────

/**
 * Formatea un RUT chileno al formato requerido por la API: XX.XXX.XXX-Y.
 * Acepta: 76345678, 76345678-9, 76.345.678-9.
 */
export function formatChileRut(rut: string): string {
  const clean = rut.trim().toUpperCase().replace(/\./g, '').replace(/\s/g, '');
  const dashIdx = clean.lastIndexOf('-');
  if (dashIdx !== -1) {
    const body = clean.slice(0, dashIdx);
    const dv = clean.slice(dashIdx + 1);
    const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${formatted}-${dv}`;
  }
  return clean.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: extraHeaders ? { ...HEADERS, ...extraHeaders } : HEADERS,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** V2 Compra Ágil usa header `ticket`, no query param. */
function v2Headers(ticket: string): Record<string, string> {
  return { ticket: ticket.trim() };
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('abort') || msg.includes('timeout'))
      return 'Timeout al conectar con la API ChileCompra';
    if (msg.includes('enotfound') || msg.includes('getaddrinfo'))
      return 'Error DNS al resolver API ChileCompra';
    if (msg.includes('ssl') || msg.includes('certificate'))
      return 'Error SSL al conectar con ChileCompra';
    return `Error de red ChileCompra: ${error.message.slice(0, 120)}`;
  }
  return 'Error desconocido al consultar ChileCompra';
}

function isHtmlResponse(text: string): boolean {
  return text.trim().startsWith('<');
}

function buildTicketError(httpStatus: number): string {
  if (httpStatus === 401 || httpStatus === 403)
    return 'Ticket ChileCompra inválido o expirado';
  return `HTTP ${httpStatus} desde API Mercado Público`;
}

// ── Instrucciones de ticket ────────────────────────────────────────────────────

export function buildTicketInstructions(): string {
  return (
    'Para activar la API de ChileCompra: ' +
    '(1) Visitar https://www.mercadopublico.cl/Portal/Modules/Sites/InfoTicketPublico/ ' +
    '(2) Solicitar ticket gratuito por email. ' +
    '(3) Configurar el secreto en Vault del proyecto bajo sellup_source_chilecompra_ticket. ' +
    '(4) El conector lo usará automáticamente en la próxima ejecución.'
  );
}

// ── Connection test ─────────────────────────────────────────────────────────────

export type ChileCompraConnectionTestResult = {
  ok: boolean;
  httpStatus?: number;
  responseTimeMs?: number;
  /** Ítems Compra Ágil encontrados (V2). */
  compraAgilFound?: number;
  error?: string;
};

/**
 * Prueba la conexión usando el endpoint V2 Compra Ágil con header `ticket`.
 * Si devuelve HTTP 200 con datos, la conexión está OK.
 * No loguea el ticket. No retorna el ticket.
 */
export async function testChileCompraConnection(
  ticket: string,
): Promise<ChileCompraConnectionTestResult> {
  if (!ticket || ticket.trim() === '') {
    return { ok: false, error: 'Ticket vacío — no se puede probar conexión ChileCompra' };
  }

  const url = `${CHILECOMPRA_V2_COMPRA_AGIL}?tamano_pagina=1&numero_pagina=1`;
  const startMs = Date.now();
  let response: Response;

  try {
    response = await fetchWithTimeout(url, v2Headers(ticket));
  } catch (err: unknown) {
    return {
      ok: false,
      responseTimeMs: Date.now() - startMs,
      error: sanitizeError(err),
    };
  }

  const responseTimeMs = Date.now() - startMs;
  const text = await response.text();

  if (isHtmlResponse(text)) {
    return {
      ok: false,
      httpStatus: response.status,
      responseTimeMs,
      error: `HTTP ${response.status} — respuesta HTML (ticket inválido o expirado)`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      httpStatus: response.status,
      responseTimeMs,
      error: buildTicketError(response.status),
    };
  }

  let compraAgilFound: number | undefined;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const qty = parsed['total'] ?? parsed['Cantidad'] ?? parsed['cantidad'];
    if (typeof qty === 'number') compraAgilFound = qty;
    else if (typeof qty === 'string') compraAgilFound = parseInt(qty, 10) || undefined;
    else {
      const data = parsed['data'];
      if (Array.isArray(data)) compraAgilFound = data.length;
    }
  } catch {
    // JSON parse failed — still report OK if HTTP 200
  }

  return { ok: true, httpStatus: response.status, responseTimeMs, compraAgilFound };
}

// ── listChileCompraBuyers ──────────────────────────────────────────────────────

export type ListChileCompraBuyersResult = {
  ok: boolean;
  buyersCount?: number;
  buyersSample?: string[];
  httpStatus?: number;
  responseTimeMs?: number;
  error?: string;
};

/**
 * Lista organismos compradores del Estado chileno.
 * Endpoint: BuscarComprador — no requiere RUT.
 * Usado como health-check primario del conector.
 */
export async function listChileCompraBuyers(params: {
  ticket: string;
}): Promise<ListChileCompraBuyersResult> {
  if (!params.ticket?.trim()) {
    return { ok: false, error: 'Ticket requerido para BuscarComprador' };
  }

  const url = `${CHILECOMPRA_BUSCAR_COMPRADOR}?ticket=${encodeURIComponent(params.ticket.trim())}`;
  const startMs = Date.now();
  let response: Response;

  try {
    response = await fetchWithTimeout(url);
  } catch (err: unknown) {
    return {
      ok: false,
      responseTimeMs: Date.now() - startMs,
      error: sanitizeError(err),
    };
  }

  const responseTimeMs = Date.now() - startMs;
  const text = await response.text();

  if (isHtmlResponse(text)) {
    return {
      ok: false,
      httpStatus: response.status,
      responseTimeMs,
      error: `HTTP ${response.status} — respuesta HTML (ticket inválido o expirado)`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      httpStatus: response.status,
      responseTimeMs,
      error: buildTicketError(response.status),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, httpStatus: response.status, responseTimeMs, error: 'Respuesta no es JSON válido' };
  }

  const obj = parsed as Record<string, unknown>;
  const qty = obj['Cantidad'];
  let buyersCount: number | undefined;
  if (typeof qty === 'number') buyersCount = qty;
  else if (typeof qty === 'string') buyersCount = parseInt(qty, 10) || undefined;

  const lista = Array.isArray(obj['listadoOrganismos']) ? obj['listadoOrganismos'] as unknown[] : [];
  const buyersSample = lista
    .slice(0, 5)
    .map((b) => {
      const item = b as Record<string, unknown>;
      return String(item['NombreOrganismo'] ?? item['Nombre'] ?? '—');
    })
    .filter((n) => n !== '—');

  return { ok: true, httpStatus: response.status, responseTimeMs, buyersCount, buyersSample };
}

// ── searchChileCompraSupplierByRut ─────────────────────────────────────────────

export type SearchChileCompraSupplierResult = {
  ok: boolean;
  supplierCode?: string;
  supplierName?: string;
  rut: string;
  rutFormatted: string;
  httpStatus?: number;
  responseTimeMs?: number;
  found: boolean;
  error?: string;
};

/**
 * Busca un proveedor por RUT.
 * Formatea el RUT al formato con puntos y guión si viene sin formato.
 * Endpoint: BuscarProveedor?rutempresaproveedor=XX.XXX.XXX-Y&ticket=...
 */
export async function searchChileCompraSupplierByRut(params: {
  rut: string;
  ticket: string;
}): Promise<SearchChileCompraSupplierResult> {
  const { rut, ticket } = params;
  const rutFormatted = formatChileRut(rut);

  if (!ticket?.trim()) {
    return { ok: false, rut, rutFormatted, found: false, error: 'Ticket requerido para BuscarProveedor' };
  }

  const url =
    `${CHILECOMPRA_BUSCAR_PROVEEDOR}?rutempresaproveedor=${encodeURIComponent(rutFormatted)}` +
    `&ticket=${encodeURIComponent(ticket.trim())}`;

  const startMs = Date.now();
  let response: Response;

  try {
    response = await fetchWithTimeout(url);
  } catch (err: unknown) {
    return {
      ok: false,
      rut,
      rutFormatted,
      found: false,
      responseTimeMs: Date.now() - startMs,
      error: sanitizeError(err),
    };
  }

  const responseTimeMs = Date.now() - startMs;
  const text = await response.text();

  if (isHtmlResponse(text)) {
    return {
      ok: false,
      rut,
      rutFormatted,
      found: false,
      httpStatus: response.status,
      responseTimeMs,
      error: `HTTP ${response.status} — respuesta HTML (ticket inválido o expirado)`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      rut,
      rutFormatted,
      found: false,
      httpStatus: response.status,
      responseTimeMs,
      error: buildTicketError(response.status),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, rut, rutFormatted, found: false, httpStatus: response.status, responseTimeMs, error: 'Respuesta no es JSON válido' };
  }

  const obj = parsed as Record<string, unknown>;
  const lista = Array.isArray(obj['listaEmpresas']) ? obj['listaEmpresas'] as unknown[] : [];
  const first = lista[0] as Record<string, unknown> | undefined;

  if (!first) {
    return { ok: true, rut, rutFormatted, found: false, httpStatus: response.status, responseTimeMs };
  }

  const supplierCode =
    first['CodigoEmpresa'] != null ? String(first['CodigoEmpresa']) : undefined;
  const supplierName =
    (first['NombreEmpresa'] != null ? String(first['NombreEmpresa']) : null) ??
    (first['RazonSocial'] != null ? String(first['RazonSocial']) : undefined);

  return {
    ok: true,
    rut,
    rutFormatted,
    found: true,
    supplierCode,
    supplierName,
    httpStatus: response.status,
    responseTimeMs,
  };
}

// ── fetchChileCompraPurchaseOrdersBySupplier ───────────────────────────────────

export type FetchChileCompraPurchaseOrdersResult = {
  ok: boolean;
  ordersCount?: number;
  supplierCode: string;
  httpStatus?: number;
  responseTimeMs?: number;
  error?: string;
};

/**
 * Consulta órdenes de compra emitidas a un proveedor por CodigoProveedor.
 * Endpoint: ordenesdecompra.json?CodigoProveedor=...&ticket=...
 * fecha: DDMMYYYY opcional. estado: opcional.
 */
export async function fetchChileCompraPurchaseOrdersBySupplier(params: {
  supplierCode: string;
  ticket: string;
  fecha?: string;
  estado?: string;
}): Promise<FetchChileCompraPurchaseOrdersResult> {
  const { supplierCode, ticket, fecha, estado } = params;

  if (!ticket?.trim()) {
    return { ok: false, supplierCode, error: 'Ticket requerido para consultar órdenes de compra' };
  }

  let url = `${CHILECOMPRA_ORDENES}?CodigoProveedor=${encodeURIComponent(supplierCode)}&ticket=${encodeURIComponent(ticket.trim())}`;
  if (fecha) url += `&fecha=${encodeURIComponent(fecha)}`;
  if (estado) url += `&estado=${encodeURIComponent(estado)}`;

  const startMs = Date.now();
  let response: Response;

  try {
    response = await fetchWithTimeout(url);
  } catch (err: unknown) {
    return {
      ok: false,
      supplierCode,
      responseTimeMs: Date.now() - startMs,
      error: sanitizeError(err),
    };
  }

  const responseTimeMs = Date.now() - startMs;
  const text = await response.text();

  if (isHtmlResponse(text)) {
    return {
      ok: false,
      supplierCode,
      httpStatus: response.status,
      responseTimeMs,
      error: `HTTP ${response.status} — respuesta HTML (ticket inválido o expirado)`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      supplierCode,
      httpStatus: response.status,
      responseTimeMs,
      error: buildTicketError(response.status),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, supplierCode, httpStatus: response.status, responseTimeMs, error: 'Respuesta no es JSON válido' };
  }

  const obj = parsed as Record<string, unknown>;
  const qty = obj['Cantidad'];
  let ordersCount: number | undefined;
  if (typeof qty === 'number') ordersCount = qty;
  else if (typeof qty === 'string') ordersCount = parseInt(qty, 10) || 0;
  else {
    const lista = Array.isArray(obj['listadoOrdenesCompra']) ? obj['listadoOrdenesCompra'] : [];
    ordersCount = lista.length;
  }

  return { ok: true, supplierCode, httpStatus: response.status, responseTimeMs, ordersCount };
}

// ── fetchChileCompraTendersBySupplier ──────────────────────────────────────────

export type FetchChileCompraTendersResult = {
  ok: boolean;
  tendersCount?: number;
  supplierCode: string;
  httpStatus?: number;
  responseTimeMs?: number;
  error?: string;
};

/**
 * Consulta licitaciones asociadas a un proveedor por CodigoProveedor.
 * Endpoint: licitaciones.json?CodigoProveedor=...&ticket=...
 * fecha: DDMMYYYY opcional. estado: opcional.
 */
export async function fetchChileCompraTendersBySupplier(params: {
  supplierCode: string;
  ticket: string;
  fecha?: string;
  estado?: string;
}): Promise<FetchChileCompraTendersResult> {
  const { supplierCode, ticket, fecha, estado } = params;

  if (!ticket?.trim()) {
    return { ok: false, supplierCode, error: 'Ticket requerido para consultar licitaciones' };
  }

  let url = `${CHILECOMPRA_LICITACIONES}?CodigoProveedor=${encodeURIComponent(supplierCode)}&ticket=${encodeURIComponent(ticket.trim())}`;
  if (fecha) url += `&fecha=${encodeURIComponent(fecha)}`;
  if (estado) url += `&estado=${encodeURIComponent(estado)}`;

  const startMs = Date.now();
  let response: Response;

  try {
    response = await fetchWithTimeout(url);
  } catch (err: unknown) {
    return {
      ok: false,
      supplierCode,
      responseTimeMs: Date.now() - startMs,
      error: sanitizeError(err),
    };
  }

  const responseTimeMs = Date.now() - startMs;
  const text = await response.text();

  if (isHtmlResponse(text)) {
    return {
      ok: false,
      supplierCode,
      httpStatus: response.status,
      responseTimeMs,
      error: `HTTP ${response.status} — respuesta HTML (ticket inválido o expirado)`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      supplierCode,
      httpStatus: response.status,
      responseTimeMs,
      error: buildTicketError(response.status),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, supplierCode, httpStatus: response.status, responseTimeMs, error: 'Respuesta no es JSON válido' };
  }

  const obj = parsed as Record<string, unknown>;
  const qty = obj['Cantidad'];
  let tendersCount: number | undefined;
  if (typeof qty === 'number') tendersCount = qty;
  else if (typeof qty === 'string') tendersCount = parseInt(qty, 10) || 0;
  else {
    const lista = Array.isArray(obj['Listado']) ? obj['Listado'] : [];
    tendersCount = lista.length;
  }

  return { ok: true, supplierCode, httpStatus: response.status, responseTimeMs, tendersCount };
}

// ── V2 Compra Ágil — fetchCompraAgilList ──────────────────────────────────────

/** Ítem de listado Compra Ágil V2 (campos defensivos). */
export type CompraAgilListItem = {
  codigo?: string;
  nombre?: string;
  titulo?: string;
  estado?: string;
  region?: string;
  unidad_compradora?: string;
  organismo?: string;
  fecha_publicacion?: string;
  fecha_cierre?: string;
  [key: string]: unknown;
};

export type FetchCompraAgilListResult = {
  ok: boolean;
  items: CompraAgilListItem[];
  total?: number;
  httpStatus?: number;
  responseTimeMs?: number;
  error?: string;
};

/**
 * Lista procesos de Compra Ágil.
 * Autenticación: header `ticket` (V2).
 * Endpoint: GET /v2/compra-agil
 */
export async function fetchCompraAgilList(params: {
  ticket: string;
  q?: string;
  region?: string;
  estado?: string;
  publicado_desde?: string;
  publicado_hasta?: string;
  tamano_pagina?: number;
  numero_pagina?: number;
}): Promise<FetchCompraAgilListResult> {
  const { ticket, q, region, estado, publicado_desde, publicado_hasta } = params;
  const tamanoPagina = Math.min(params.tamano_pagina ?? 10, 50);
  const numeroPagina = params.numero_pagina ?? 1;

  if (!ticket?.trim()) {
    return { ok: false, items: [], error: 'Ticket requerido para Compra Ágil V2' };
  }

  const qs = new URLSearchParams({
    tamano_pagina: String(tamanoPagina),
    numero_pagina: String(numeroPagina),
  });
  if (q) qs.set('q', q);
  if (region) qs.set('region', region);
  if (estado) qs.set('estado', estado);
  if (publicado_desde) qs.set('publicado_desde', publicado_desde);
  if (publicado_hasta) qs.set('publicado_hasta', publicado_hasta);

  const url = `${CHILECOMPRA_V2_COMPRA_AGIL}?${qs.toString()}`;
  const startMs = Date.now();
  let response: Response;

  try {
    response = await fetchWithTimeout(url, v2Headers(ticket));
  } catch (err: unknown) {
    return { ok: false, items: [], responseTimeMs: Date.now() - startMs, error: sanitizeError(err) };
  }

  const responseTimeMs = Date.now() - startMs;
  const text = await response.text();

  if (isHtmlResponse(text)) {
    return {
      ok: false, items: [],
      httpStatus: response.status, responseTimeMs,
      error: `HTTP ${response.status} — respuesta HTML (ticket inválido o expirado)`,
    };
  }

  if (!response.ok) {
    return {
      ok: false, items: [],
      httpStatus: response.status, responseTimeMs,
      error: buildTicketError(response.status),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, items: [], httpStatus: response.status, responseTimeMs, error: 'Respuesta no es JSON válido' };
  }

  const obj = parsed as Record<string, unknown>;
  const rawItems = Array.isArray(obj['data'])
    ? (obj['data'] as unknown[])
    : Array.isArray(obj['items'])
      ? (obj['items'] as unknown[])
      : Array.isArray(parsed)
        ? (parsed as unknown[])
        : [];

  const items = rawItems.map((r) => r as CompraAgilListItem);

  const qty = obj['total'] ?? obj['Cantidad'] ?? obj['cantidad'];
  let total: number | undefined;
  if (typeof qty === 'number') total = qty;
  else if (typeof qty === 'string') total = parseInt(qty, 10) || undefined;

  return { ok: true, items, total, httpStatus: response.status, responseTimeMs };
}

// ── V2 Compra Ágil — fetchCompraAgilDetail ────────────────────────────────────

/** Proveedor cotizando en un proceso Compra Ágil. */
export type CompraAgilProveedor = {
  rut_proveedor?: string;
  razon_social?: string;
  es_emt?: boolean;
  id_cotizacion?: string;
  [key: string]: unknown;
};

/** Detalle de un proceso Compra Ágil V2. */
export type CompraAgilDetail = {
  codigo?: string;
  nombre?: string;
  titulo?: string;
  estado?: string;
  region?: string;
  unidad_compradora?: string;
  organismo?: string;
  fecha_publicacion?: string;
  fecha_cierre?: string;
  proveedores_cotizando?: CompraAgilProveedor[];
  [key: string]: unknown;
};

export type FetchCompraAgilDetailResult = {
  ok: boolean;
  detail?: CompraAgilDetail;
  httpStatus?: number;
  responseTimeMs?: number;
  error?: string;
};

/**
 * Obtiene el detalle de un proceso Compra Ágil incluyendo proveedores_cotizando.
 * Autenticación: header `ticket` (V2).
 * Endpoint: GET /v2/compra-agil/{codigo}
 */
export async function fetchCompraAgilDetail(params: {
  codigo: string;
  ticket: string;
}): Promise<FetchCompraAgilDetailResult> {
  const { codigo, ticket } = params;

  if (!ticket?.trim()) {
    return { ok: false, error: 'Ticket requerido para detalle Compra Ágil V2' };
  }

  const url = `${CHILECOMPRA_V2_COMPRA_AGIL}/${encodeURIComponent(codigo)}`;
  const startMs = Date.now();
  let response: Response;

  try {
    response = await fetchWithTimeout(url, v2Headers(ticket));
  } catch (err: unknown) {
    return { ok: false, responseTimeMs: Date.now() - startMs, error: sanitizeError(err) };
  }

  const responseTimeMs = Date.now() - startMs;
  const text = await response.text();

  if (isHtmlResponse(text)) {
    return {
      ok: false, httpStatus: response.status, responseTimeMs,
      error: `HTTP ${response.status} — respuesta HTML (ticket inválido o expirado)`,
    };
  }

  if (!response.ok) {
    return {
      ok: false, httpStatus: response.status, responseTimeMs,
      error: buildTicketError(response.status),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, httpStatus: response.status, responseTimeMs, error: 'Respuesta no es JSON válido' };
  }

  const obj = parsed as Record<string, unknown>;
  const raw = (obj['data'] ?? parsed) as CompraAgilDetail;

  const proveedores = Array.isArray(raw?.proveedores_cotizando)
    ? (raw.proveedores_cotizando as CompraAgilProveedor[])
    : Array.isArray(obj['proveedores_cotizando'])
      ? (obj['proveedores_cotizando'] as CompraAgilProveedor[])
      : [];

  const detail: CompraAgilDetail = {
    codigo: String(raw?.codigo ?? obj['codigo'] ?? codigo),
    nombre: raw?.nombre != null ? String(raw.nombre) : obj['nombre'] != null ? String(obj['nombre']) : undefined,
    titulo: raw?.titulo != null ? String(raw.titulo) : obj['titulo'] != null ? String(obj['titulo']) : undefined,
    estado: raw?.estado != null ? String(raw.estado) : obj['estado'] != null ? String(obj['estado']) : undefined,
    region: raw?.region != null ? String(raw.region) : obj['region'] != null ? String(obj['region']) : undefined,
    organismo: raw?.organismo != null ? String(raw.organismo) : obj['organismo'] != null ? String(obj['organismo']) : undefined,
    unidad_compradora: raw?.unidad_compradora != null ? String(raw.unidad_compradora) : undefined,
    proveedores_cotizando: proveedores,
  };

  return { ok: true, detail, httpStatus: response.status, responseTimeMs };
}
