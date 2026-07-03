/**
 * COMPRASAL El Salvador — Normalizador
 *
 * Guardrail:
 *   - NO crear tax_id ni normalized_tax_id — COMPRASAL no expone NIT/NRC.
 *   - proveedor.id se trata como platform_id, no como identificador fiscal.
 *   - matching_mode = name_only_review_required siempre.
 *
 * Hito: Centroamérica.7C
 */

import type { ComprasalAdjudicacion } from './comprasal-sv-client';

export type NormalizedAdjudicacion = {
  award_id: string;
  monto: number;
  supplier_name: string;
  supplier_commercial_name: string | null;
  supplier_platform_id: string;
  normalized_supplier_name: string;
  process_code: string;
  process_name: string;
  award_date: string | null;
  institution_name: string;
  institution_code: string;
  contract_form: string | null;
  // Guardrails explícitos: COMPRASAL no expone NIT/NRC
  tax_id: null;
  normalized_tax_id: null;
  matching_mode: 'name_only_review_required';
};

export function normalizeSupplierName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeAdjudicacion(raw: ComprasalAdjudicacion): NormalizedAdjudicacion | null {
  const supplierName = raw.proveedor?.nombre?.trim();
  if (!supplierName) return null;

  return {
    award_id: String(raw.id ?? ''),
    monto: typeof raw.monto === 'number' ? raw.monto : parseFloat(String(raw.monto ?? '0')) || 0,
    supplier_name: supplierName,
    supplier_commercial_name: raw.proveedor?.nombre_comercial?.trim() || null,
    supplier_platform_id: String(raw.proveedor?.id_proveedor ?? raw.proveedor?.id ?? ''),
    normalized_supplier_name: normalizeSupplierName(supplierName),
    process_code: raw.proceso_compra?.codigo_proceso?.trim() ?? '',
    process_name: raw.proceso_compra?.nombre_proceso?.trim() ?? '',
    award_date: raw.proceso_compra?.fecha_adjudicacion?.trim() ?? null,
    institution_name: raw.institucion?.nombre?.trim() ?? '',
    institution_code: raw.institucion?.codigo?.trim() ?? '',
    contract_form: null,
    tax_id: null,
    normalized_tax_id: null,
    matching_mode: 'name_only_review_required',
  };
}
