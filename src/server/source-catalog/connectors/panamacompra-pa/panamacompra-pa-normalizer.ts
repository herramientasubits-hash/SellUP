/**
 * PanamaCompra Panamá — Normalizador de proveedores Convenio Marco
 *
 * Normaliza respuestas de la API ASMX de PanamaCompra:
 * - RUC panameño (preservar original, limpiar espacios, no validar legalmente)
 * - Nombre, dirección, representante, teléfono, correo
 * - Sucursales / provincias / distritos
 *
 * Guardrail semántico:
 *   No validar legalmente el RUC. No inventar DV. No convertir a NIT/RNC/RUT.
 *   Si falta RUC, marcar como skipped con razón 'no_ruc'.
 *   PanamaCompra no es fuente legal ni tributaria.
 *
 * Hito: Centroamérica.5B
 */

import type { PanamaProveedor, PanamaProveedorInfo } from './panamacompra-pa-client';

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type PanamaRucResult =
  | { valid: true; original: string; normalized: string }
  | { valid: false; reason: 'no_ruc' | 'empty_ruc' };

export type PanamaBranch = {
  provincia?: string | null;
  distrito?: string | null;
  direccion?: string | null;
};

export type PanaNormalizedProvider = {
  providerId: string | null;
  companyId: string | null;
  rucOriginal: string | null;
  normalizedTaxId: string | null;
  rucStatus: 'present' | 'missing';
  legalName: string | null;
  address: string | null;
  representativeName: string | null;
  phone: string | null;
  email: string | null;
  branches: PanamaBranch[];
};

export type PanaNormalizeSkipReason = 'no_name' | 'no_ruc';

export type PanaNormalizeResult =
  | { ok: true; provider: PanaNormalizedProvider }
  | { ok: false; reason: PanaNormalizeSkipReason };

// ─── Normalización de RUC panameño ────────────────────────────────────────────

/**
 * Normaliza un RUC panameño.
 *
 * Reglas:
 * - Preservar el RUC original exacto (puede contener guiones: "8-123-456789").
 * - normalized_tax_id = RUC sin espacios iniciales/finales.
 * - No validar legalmente el formato ni el dígito verificador.
 * - No inventar DV.
 * - No convertir a NIT/RNC/RUT.
 * - Si vacío o ausente → valid: false.
 *
 * PanamaCompra no es fuente de validación fiscal; esta normalización
 * es heurística para agrupar registros únicamente.
 */
export function normalizePanamaRuc(value: unknown): PanamaRucResult {
  if (value === null || value === undefined || value === '') {
    return { valid: false, reason: 'no_ruc' };
  }

  const raw = String(value).trim();
  if (raw === '') return { valid: false, reason: 'empty_ruc' };

  // normalized = RUC sin espacios (preservar guiones y estructura original)
  const normalized = raw.replace(/\s+/g, '');

  return { valid: true, original: raw, normalized };
}

// ─── Helpers de extracción ────────────────────────────────────────────────────

function firstPresent(...values: (unknown | undefined)[]): string | null {
  for (const v of values) {
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return null;
}

function extractRuc(raw: PanamaProveedor | PanamaProveedorInfo): string | null {
  return firstPresent(raw['ruc'], raw['RUC'], raw['Ruc']);
}

function extractName(raw: PanamaProveedor | PanamaProveedorInfo): string | null {
  return firstPresent(
    // listaProveedor usa NOMBFANTASIA; ObtenerInfoProveedor usa nombreProveedor
    raw['NOMBFANTASIA'],
    raw['nombfantasia'],
    raw['nombreProveedor'],
    raw['NombreProveedor'],
    raw['nombre'],
    raw['Nombre'],
    raw['razonSocial'],
    raw['RazonSocial'],
  );
}

function extractProviderId(raw: PanamaProveedor | PanamaProveedorInfo): string | null {
  // ObtenerInfoProveedor devuelve `proveedorId` (= IdEmpresa del listado)
  return firstPresent(raw['proveedorId'], raw['IdProveedorConvenio'], raw['IdProveedor'], raw['idProveedor']);
}

function extractCompanyId(raw: PanamaProveedor | PanamaProveedorInfo): string | null {
  return firstPresent(raw['IdEmpresa'], raw['idEmpresa'], raw['empresaId']);
}

function extractBranches(info: PanamaProveedorInfo): PanamaBranch[] {
  const raw = info['sucursales'] ?? info['Sucursales'];
  if (!Array.isArray(raw)) return [];

  return raw.map((s: unknown) => {
    if (!s || typeof s !== 'object') return {};
    const branch = s as Record<string, unknown>;
    return {
      // ObtenerInfoProveedor usa nombreProvincia/nombreDistrito en sucursales
      provincia: firstPresent(branch['nombreProvincia'], branch['provincia'], branch['Provincia']),
      distrito: firstPresent(branch['nombreDistrito'], branch['distrito'], branch['Distrito']),
      direccion: firstPresent(branch['direccion'], branch['Direccion']),
    };
  });
}

// ─── Normalizador principal ───────────────────────────────────────────────────

/**
 * Normaliza un proveedor desde la respuesta de ObtenerInfoProveedor.
 * Si falta nombre → skip (no_name).
 * Si falta RUC → ok pero rucStatus='missing'.
 */
export function normalizeProveedorInfo(info: PanamaProveedorInfo): PanaNormalizeResult {
  const name = extractName(info);
  if (!name) return { ok: false, reason: 'no_name' };

  const rawRuc = extractRuc(info);
  const rucResult = normalizePanamaRuc(rawRuc);

  return {
    ok: true,
    provider: {
      providerId: extractProviderId(info),
      companyId: extractCompanyId(info),
      rucOriginal: rucResult.valid ? rucResult.original : null,
      normalizedTaxId: rucResult.valid ? rucResult.normalized : null,
      rucStatus: rucResult.valid ? 'present' : 'missing',
      legalName: name,
      address: firstPresent(info['direccion'], info['Direccion']),
      representativeName: firstPresent(info['nombreRepresentante'], info['NombreRepresentante']),
      phone: firstPresent(info['telefono'], info['Telefono']),
      email: firstPresent(info['correo'], info['Correo']),
      branches: extractBranches(info),
    },
  };
}

/**
 * Normaliza un proveedor desde la respuesta ligera de listaProveedor.
 * Útil para deduplicación antes de llamar ObtenerInfoProveedor.
 */
export function normalizeProveedorListing(raw: PanamaProveedor): PanaNormalizeResult {
  const name = extractName(raw);
  if (!name) return { ok: false, reason: 'no_name' };

  const rawRuc = extractRuc(raw);
  const rucResult = normalizePanamaRuc(rawRuc);

  return {
    ok: true,
    provider: {
      providerId: extractProviderId(raw),
      companyId: extractCompanyId(raw),
      rucOriginal: rucResult.valid ? rucResult.original : null,
      normalizedTaxId: rucResult.valid ? rucResult.normalized : null,
      rucStatus: rucResult.valid ? 'present' : 'missing',
      legalName: name,
      address: null,
      representativeName: null,
      phone: null,
      email: null,
      branches: [],
    },
  };
}
