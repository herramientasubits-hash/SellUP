/**
 * PanamaCompra Panamá — Cliente ASMX Convenio Marco
 *
 * Consulta la API ASMX pública de PanamaCompra para obtener convenios marco
 * y los proveedores registrados en cada uno.
 *
 * Cadena: listaConvenio → listaProveedor(idConvenio) → ObtenerInfoProveedor(proveedorId)
 *
 * No requiere credenciales. No usa sesión. No llama searchOrderList ni
 * ListarActosParametros (requieren sesión autenticada).
 *
 * Guardrail semántico:
 *   PanamaCompra Convenio Marco no es fuente legal ni tributaria.
 *   No valida RUC. No reemplaza DGI Panamá. No reemplaza Registro Público.
 *   Cobertura limitada a Convenio Marco.
 *
 * Hito: Centroamérica.5B
 */

// ─── Configuración ─────────────────────────────────────────────────────────────

export const PANAMACOMPRA_BASE = 'https://www.panamacompra.gob.pa';
export const PANAMACOMPRA_TIMEOUT_MS = 20_000;

const CONVENIO_ENDPOINT = `${PANAMACOMPRA_BASE}/Security/Convenio/ConvenioPublico.asmx/listaConvenio`;
const PROVEEDOR_ENDPOINT = `${PANAMACOMPRA_BASE}/Security/Convenio/ConvenioPublico.asmx/listaProveedor`;
const INFO_PROVEEDOR_ENDPOINT = `${PANAMACOMPRA_BASE}/Security/Convenio/Catalogo.asmx/ObtenerInfoProveedor`;

export const PANAMACOMPRA_USER_AGENT = 'SellUp/1.0 (procurement-signal-research)';

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type PanamaConvenio = {
  IdConvenio: number | string;
  Nombre?: string;
  NombreConvenio?: string;
  Descripcion?: string;
  Estado?: string;
  FechaInicio?: string;
  FechaFin?: string;
  [key: string]: unknown;
};

export type PanamaProveedor = {
  IdProveedor?: number | string;
  IdEmpresa?: number | string;
  nombreProveedor?: string;
  NombreProveedor?: string;
  ruc?: string;
  RUC?: string;
  [key: string]: unknown;
};

export type PanamaProveedorInfo = {
  IdProveedor?: number | string;
  IdEmpresa?: number | string;
  nombreProveedor?: string;
  NombreProveedor?: string;
  ruc?: string;
  RUC?: string;
  direccion?: string;
  Direccion?: string;
  nombreRepresentante?: string;
  NombreRepresentante?: string;
  telefono?: string;
  Telefono?: string;
  correo?: string;
  Correo?: string;
  sucursales?: unknown[];
  Sucursales?: unknown[];
  [key: string]: unknown;
};

export type ListConveniosResult =
  | { ok: true; convenios: PanamaConvenio[] }
  | { ok: false; error: string };

export type ListProveedoresResult =
  | { ok: true; proveedores: PanamaProveedor[] }
  | { ok: false; error: string };

export type GetProveedorInfoResult =
  | { ok: true; info: PanamaProveedorInfo }
  | { ok: false; error: string };

// ─── Helpers internos ──────────────────────────────────────────────────────────

function buildAbortController(): { controller: AbortController; timer: ReturnType<typeof setTimeout> } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PANAMACOMPRA_TIMEOUT_MS);
  return { controller, timer };
}

/**
 * Parsea la respuesta ASMX de PanamaCompra.
 *
 * Las respuestas ASMX pueden venir como:
 *   1. JSON directo con campo `d` (wrapper estándar ASP.NET Web Services).
 *   2. JSON directo sin wrapper.
 *   3. String JSON anidado dentro del campo `d`.
 */
export function parseAsmxResponse(text: string): { ok: true; data: unknown } | { ok: false; error: string } {
  if (text.trimStart().startsWith('<')) {
    return { ok: false, error: 'PanamaCompra retornó XML/HTML — endpoint no disponible o incorrecto' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Respuesta PanamaCompra no es JSON válido' };
  }

  if (parsed === null || parsed === undefined) {
    return { ok: false, error: 'Respuesta PanamaCompra vacía' };
  }

  // Caso 1: wrapper `d` estándar ASP.NET
  if (typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if ('d' in obj) {
      const d = obj['d'];
      // `d` puede ser string JSON anidado
      if (typeof d === 'string') {
        try {
          return { ok: true, data: JSON.parse(d) };
        } catch {
          // Si no parsea, devolver el string tal cual
          return { ok: true, data: d };
        }
      }
      return { ok: true, data: d };
    }
  }

  // Caso 2: JSON directo (array u objeto)
  return { ok: true, data: parsed };
}

async function safePostForm(
  url: string,
  body: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const { controller, timer } = buildAbortController();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': PANAMACOMPRA_USER_AGENT,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} desde PanamaCompra ASMX` };
    }

    const text = await res.text();
    return { ok: true, text };
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('abort') || msg.includes('timeout')) {
        return { ok: false, error: 'Timeout al conectar con PanamaCompra ASMX' };
      }
      return { ok: false, error: `Error de red PanamaCompra: ${err.message.slice(0, 120)}` };
    }
    return { ok: false, error: 'Error desconocido al consultar PanamaCompra ASMX' };
  }
}

async function safeGetJson(
  url: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const { controller, timer } = buildAbortController();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': PANAMACOMPRA_USER_AGENT,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} desde PanamaCompra` };
    }

    const text = await res.text();
    return { ok: true, text };
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('abort') || msg.includes('timeout')) {
        return { ok: false, error: 'Timeout al conectar con PanamaCompra' };
      }
      return { ok: false, error: `Error de red PanamaCompra: ${err.message.slice(0, 120)}` };
    }
    return { ok: false, error: 'Error desconocido al consultar PanamaCompra' };
  }
}

// ─── API pública ───────────────────────────────────────────────────────────────

/**
 * Lista todos los convenios marco activos en PanamaCompra.
 * GET /Security/Convenio/ConvenioPublico.asmx/listaConvenio
 */
export async function listConvenios(): Promise<ListConveniosResult> {
  const fetchResult = await safeGetJson(CONVENIO_ENDPOINT);
  if (!fetchResult.ok) return { ok: false, error: fetchResult.error };

  const parsed = parseAsmxResponse(fetchResult.text);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const data = parsed.data;
  if (!Array.isArray(data)) {
    return { ok: false, error: `listaConvenio no devolvió un array (tipo: ${typeof data})` };
  }

  return { ok: true, convenios: data as PanamaConvenio[] };
}

/**
 * Lista proveedores de un convenio específico.
 * POST /Security/Convenio/ConvenioPublico.asmx/listaProveedor
 * Body: METHOD=&VALUE={"IdConvenio":X}
 */
export async function listProveedoresByConvenio(
  idConvenio: string | number,
): Promise<ListProveedoresResult> {
  const value = JSON.stringify({ IdConvenio: idConvenio });
  const body = `METHOD=&VALUE=${encodeURIComponent(value)}`;

  const fetchResult = await safePostForm(PROVEEDOR_ENDPOINT, body);
  if (!fetchResult.ok) return { ok: false, error: fetchResult.error };

  const parsed = parseAsmxResponse(fetchResult.text);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const data = parsed.data;
  if (!Array.isArray(data)) {
    return { ok: false, error: `listaProveedor(${idConvenio}) no devolvió un array (tipo: ${typeof data})` };
  }

  return { ok: true, proveedores: data as PanamaProveedor[] };
}

/**
 * Obtiene información detallada de un proveedor.
 * POST /Security/Convenio/Catalogo.asmx/ObtenerInfoProveedor
 * Body: METHOD=&VALUE={"proveedorId":X}
 */
export async function getProveedorInfo(
  proveedorId: string | number,
): Promise<GetProveedorInfoResult> {
  const value = JSON.stringify({ proveedorId });
  const body = `METHOD=&VALUE=${encodeURIComponent(value)}`;

  const fetchResult = await safePostForm(INFO_PROVEEDOR_ENDPOINT, body);
  if (!fetchResult.ok) return { ok: false, error: fetchResult.error };

  const parsed = parseAsmxResponse(fetchResult.text);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const data = parsed.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: `ObtenerInfoProveedor(${proveedorId}) no devolvió un objeto` };
  }

  return { ok: true, info: data as PanamaProveedorInfo };
}
