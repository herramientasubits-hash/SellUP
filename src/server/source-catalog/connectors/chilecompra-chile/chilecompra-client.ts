/**
 * ChileCompra Connector — Client
 *
 * Consulta la API pública de Mercado Público Chile (ChileCompra).
 * Solo lectura. Sin writes. Timeout 15s. Hard limit 100 registros.
 *
 * Estrategia de acceso:
 *   Opción A (preferida): OCDS endpoint abierto — sin ticket.
 *   Opción B: API Mercado Público estándar — requiere ticket gratuito.
 *
 * El ticket se obtiene en: https://www.mercadopublico.cl/Portal/Modules/Sites/InfoTicketPublico/
 * Si no hay ticket disponible el dry-run reporta el estado y las instrucciones.
 *
 * No se hardcodea ningún ticket ni credencial.
 */

import type { ChileCompraRawRecord } from './types';

// ── Endpoints ─────────────────────────────────────────────────

/**
 * OCDS endpoint abierto de ChileCompra.
 * Devuelve paquetes de contratos/licitaciones con datos de proveedores.
 * Documentado en https://desarrolladores.mercadopublico.cl
 */
const OCDS_BASE = 'https://apis.mercadopublico.cl/OCDS/data/listaorigenes/';

/**
 * API estándar de proveedores — requiere ticket.
 * Endpoint de búsqueda de empresa/proveedor por nombre o RUT.
 */
const API_PROVEEDOR_BASE =
  'https://api.mercadopublico.cl/servicios/v1/publico/empresas/busquedaproveedor.json';

const TIMEOUT_MS = 15_000;
const HARD_MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

const HEADERS = {
  'User-Agent': 'SellUp/0.1 data-source-audit',
  Accept: 'application/json',
};

// ── Result type ────────────────────────────────────────────────

export type FetchChileCompraResult =
  | { ok: true; records: ChileCompraRawRecord[]; total: number; endpointUsed: string; ticketRequired: false }
  | { ok: false; error: string; ticketRequired: boolean; endpointUsed: string; instructions?: string };

export type FetchChileCompraParams = {
  limit?: number;
  /** Ticket opcional — si se provee, se usa la API estándar de proveedores. */
  ticket?: string;
};

// ── OCDS parser ───────────────────────────────────────────────

type OcdsResponse = {
  releases?: Array<{
    parties?: Array<{
      identifier?: { id?: unknown; legalName?: unknown };
      name?: unknown;
      roles?: string[];
      address?: { locality?: unknown; region?: unknown; countryName?: unknown };
    }>;
    tender?: {
      items?: Array<{
        classification?: { id?: unknown; description?: unknown; scheme?: unknown };
      }>;
    };
    awards?: Array<{
      suppliers?: Array<{ identifier?: { id?: unknown; legalName?: unknown }; name?: unknown }>;
    }>;
    buyer?: { name?: unknown };
  }>;
  // paginado
  uri?: string;
  publishedDate?: string;
};

function extractSuppliersFromOcds(data: OcdsResponse): ChileCompraRawRecord[] {
  const records: ChileCompraRawRecord[] = [];
  const seen = new Set<string>();

  for (const release of data.releases ?? []) {
    const buyerName =
      typeof release.buyer?.name === 'string' ? release.buyer.name : null;

    // Obtener categoría desde tender.items
    const firstItem = release.tender?.items?.[0];
    const classifId =
      firstItem?.classification?.id != null
        ? String(firstItem.classification.id)
        : null;
    const classifDesc =
      typeof firstItem?.classification?.description === 'string'
        ? firstItem.classification.description
        : null;

    // Awards: proveedores ganadores
    for (const award of release.awards ?? []) {
      for (const supplier of award.suppliers ?? []) {
        const rut =
          supplier.identifier?.id != null ? String(supplier.identifier.id) : null;
        const nombre =
          typeof supplier.identifier?.legalName === 'string'
            ? supplier.identifier.legalName
            : typeof supplier.name === 'string'
              ? supplier.name
              : null;

        if (!rut || seen.has(rut)) continue;
        seen.add(rut);

        records.push({
          RutProveedor: rut,
          NombreProveedor: nombre,
          RazonSocial: nombre,
          CodigoUnspsc: classifId,
          NombreUnspsc: classifDesc,
          OrganismoComprador: buyerName,
        });
      }
    }

    // Parties con rol 'supplier'
    for (const party of release.parties ?? []) {
      if (!Array.isArray(party.roles) || !party.roles.includes('supplier')) continue;
      const rut =
        party.identifier?.id != null ? String(party.identifier.id) : null;
      const nombre =
        typeof party.identifier?.legalName === 'string'
          ? party.identifier.legalName
          : typeof party.name === 'string'
            ? party.name
            : null;

      if (!rut || seen.has(rut)) continue;
      seen.add(rut);

      records.push({
        RutProveedor: rut,
        NombreProveedor: nombre,
        RazonSocial: nombre,
        CodigoUnspsc: classifId,
        NombreUnspsc: classifDesc,
        Region:
          party.address?.region != null ? String(party.address.region) : null,
        Ciudad:
          party.address?.locality != null ? String(party.address.locality) : null,
        OrganismoComprador: buyerName,
      });
    }
  }

  return records;
}

// ── Fetch helpers ─────────────────────────────────────────────

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { method: 'GET', signal: controller.signal, headers: HEADERS });
  } finally {
    clearTimeout(timer);
  }
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

// ── Opción A — OCDS sin ticket ─────────────────────────────────

async function fetchOcdsProviders(limit: number): Promise<FetchChileCompraResult> {
  const url = OCDS_BASE;
  let response: Response;
  try {
    response = await fetchWithTimeout(url);
  } catch (err: unknown) {
    return {
      ok: false,
      error: sanitizeError(err),
      ticketRequired: false,
      endpointUsed: url,
    };
  }

  const text = await response.text();

  if (text.trim().startsWith('<')) {
    return {
      ok: false,
      error: 'OCDS ChileCompra retornó HTML — endpoint no disponible o cambiado',
      ticketRequired: false,
      endpointUsed: url,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: `OCDS ChileCompra requiere autenticación (HTTP ${response.status})`,
      ticketRequired: true,
      endpointUsed: url,
      instructions: buildTicketInstructions(),
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `HTTP ${response.status} desde OCDS ChileCompra`,
      ticketRequired: false,
      endpointUsed: url,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Respuesta OCDS no es JSON válido', ticketRequired: false, endpointUsed: url };
  }

  const data = parsed as OcdsResponse;
  const records = extractSuppliersFromOcds(data).slice(0, limit);

  return {
    ok: true,
    records,
    total: records.length,
    endpointUsed: url,
    ticketRequired: false,
  };
}

// ── Opción B — API estándar con ticket ─────────────────────────

async function fetchApiConTicket(
  ticket: string,
  limit: number,
): Promise<FetchChileCompraResult> {
  const url = `${API_PROVEEDOR_BASE}?nombre=capacitacion&ticket=${ticket}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(url);
  } catch (err: unknown) {
    return {
      ok: false,
      error: sanitizeError(err),
      ticketRequired: true,
      endpointUsed: API_PROVEEDOR_BASE,
    };
  }

  const text = await response.text();

  if (text.trim().startsWith('<')) {
    return {
      ok: false,
      error: 'API ChileCompra retornó HTML — ticket inválido o endpoint cambiado',
      ticketRequired: true,
      endpointUsed: API_PROVEEDOR_BASE,
      instructions: buildTicketInstructions(),
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: 'Ticket ChileCompra inválido o expirado',
      ticketRequired: true,
      endpointUsed: API_PROVEEDOR_BASE,
      instructions: buildTicketInstructions(),
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `HTTP ${response.status} desde API Mercado Público`,
      ticketRequired: true,
      endpointUsed: API_PROVEEDOR_BASE,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Respuesta API no es JSON válido', ticketRequired: true, endpointUsed: API_PROVEEDOR_BASE };
  }

  const records = extractProveedoresFromApiResponse(parsed, limit);

  return {
    ok: true,
    records,
    total: records.length,
    endpointUsed: API_PROVEEDOR_BASE,
    ticketRequired: false,
  };
}

function extractProveedoresFromApiResponse(
  data: unknown,
  limit: number,
): ChileCompraRawRecord[] {
  if (!data || typeof data !== 'object') return [];
  const obj = data as Record<string, unknown>;

  // Estructura: { Cantidad, Empresas: [...] }
  const empresas =
    Array.isArray(obj['Empresas']) ? (obj['Empresas'] as unknown[]) :
    Array.isArray(obj['empresas']) ? (obj['empresas'] as unknown[]) :
    Array.isArray(obj['items']) ? (obj['items'] as unknown[]) :
    [];

  return empresas.slice(0, limit).map((e) => {
    const item = e as Record<string, unknown>;
    return {
      RutProveedor: item['Rut'] ?? item['rut'] ?? item['RutProveedor'],
      NombreProveedor: item['Nombre'] ?? item['nombre'] ?? item['RazonSocial'],
      RazonSocial: item['RazonSocial'] ?? item['razonSocial'] ?? item['Nombre'],
      CodigoUnspsc: item['CodigoRubro'] ?? item['codigoRubro'],
      NombreUnspsc: item['NombreRubro'] ?? item['nombreRubro'],
      Region: item['Region'] ?? item['region'],
      Ciudad: item['Ciudad'] ?? item['ciudad'],
    };
  });
}

// ── Instrucciones de ticket ────────────────────────────────────

function buildTicketInstructions(): string {
  return (
    'Para activar la API de ChileCompra: ' +
    '(1) Visitar https://www.mercadopublico.cl/Portal/Modules/Sites/InfoTicketPublico/ ' +
    '(2) Solicitar ticket gratuito por email. ' +
    '(3) Configurar CHILECOMPRA_API_TICKET en Vault/env del proyecto. ' +
    '(4) El conector lo usará automáticamente en la próxima ejecución.'
  );
}

// ── Punto de entrada público ───────────────────────────────────

/**
 * Consulta ChileCompra para obtener proveedores.
 * Intenta OCDS sin ticket primero; si falla y hay ticket disponible, usa API estándar.
 * Sin ingesta masiva — límite hard de 100 registros.
 */
export async function fetchChileCompraProviders(
  params: FetchChileCompraParams = {},
): Promise<FetchChileCompraResult> {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, HARD_MAX_LIMIT);

  // Opción B si hay ticket explícito
  if (params.ticket) {
    return fetchApiConTicket(params.ticket, limit);
  }

  // Opción A — OCDS sin ticket
  const ocdsResult = await fetchOcdsProviders(limit);
  if (ocdsResult.ok) return ocdsResult;

  // OCDS falló — reportar con instrucciones de ticket
  return {
    ok: false,
    error: `Endpoint OCDS no disponible: ${ocdsResult.error}. ${buildTicketInstructions()}`,
    ticketRequired: true,
    endpointUsed: ocdsResult.endpointUsed,
    instructions: buildTicketInstructions(),
  };
}

export { buildTicketInstructions };
export const CHILECOMPRA_OCDS_ENDPOINT = OCDS_BASE;
export const CHILECOMPRA_API_ENDPOINT = API_PROVEEDOR_BASE;
