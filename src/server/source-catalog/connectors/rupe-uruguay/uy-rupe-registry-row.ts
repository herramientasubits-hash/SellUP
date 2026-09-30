/**
 * uy-rupe-registry-row.ts — fila MÍNIMA de `uy_rupe_registry` a partir de un
 * registro del RUPE (Registro Único de Proveedores del Estado, Uruguay), para el
 * RUT por nombre dentro de la corrida del Agente 1.
 *
 * SOURCES-UY-RUT-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * El RUPE (datos abiertos de ARCE, catalogodatos.gub.uy, un CSV por mes separado
 * por «;») trae: pais_prov; identificacion_prov; denominacion_social_prov;
 * domicilio_fiscal; localidad_prov; departamento_prov; estado_prov.
 *
 * Sólo entran proveedores de URUGUAY, en estado ACTIVO, con RUT de 12 dígitos
 * cuyo dígito verificador cuadra y cuya razón social termina en una forma
 * societaria (S.A., S.R.L., SAS, Ltda.): así se cargan EMPRESAS y nunca personas
 * físicas. El domicilio no se guarda.
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { normalizeCompanyNameCore, URUGUAY_LEGAL_FORMS } from '../../company-name-core';
import { calculateUruguayRutCheckDigit } from '@/modules/prospect-batches/tax-identifier-rules';

export const UY_RUPE_REGISTRY_SOURCE_KEY = 'uy_rupe_registry' as const;
export const UY_RUPE_REGISTRY_COUNTRY_CODE = 'UY' as const;

export type UyRupeRegistryRow = {
  source_key: typeof UY_RUPE_REGISTRY_SOURCE_KEY;
  country_code: typeof UY_RUPE_REGISTRY_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Núcleo del nombre uruguayo: el MISMO que calcula el resolvedor de la corrida. */
export function normalizeUruguayCompanyCore(name: string | null | undefined): string {
  return normalizeCompanyNameCore(name, URUGUAY_LEGAL_FORMS);
}

/** ¿La razón social termina en una forma societaria uruguaya? */
export function carriesUruguayLegalForm(name: string | null | undefined): boolean {
  const core = normalizeUruguayCompanyCore(name);
  return core !== normalizeCompanyNameCore(name, []);
}

/** Registro del RUPE → fila, o `null` si no es una empresa uruguaya activa válida. */
export function buildUyRupeRegistryRow(
  record: Record<string, string>,
  params: { sourceYear: number; importedAt: string },
): UyRupeRegistryRow | null {
  const country = (record['pais_prov'] ?? '').trim().toUpperCase();
  const status = (record['estado_prov'] ?? '').trim().toUpperCase();
  const rut = (record['identificacion_prov'] ?? '').replace(/\D/g, '');
  const legalName = (record['denominacion_social_prov'] ?? '').replace(/\s+/g, ' ').trim();
  if (country !== 'URUGUAY' || status !== 'ACTIVO' || rut.length !== 12) return null;
  if (calculateUruguayRutCheckDigit(rut.slice(0, 11)) !== Number(rut[11])) return null;
  if (!carriesUruguayLegalForm(legalName)) return null;

  const core = normalizeUruguayCompanyCore(legalName);
  if (core.length < 2) return null;

  const identity = deriveTaxRecordIdentity(rut);
  const department = (record['departamento_prov'] ?? '').trim();
  return {
    source_key: UY_RUPE_REGISTRY_SOURCE_KEY,
    country_code: UY_RUPE_REGISTRY_COUNTRY_CODE,
    source_year: params.sourceYear,
    tax_id: rut,
    normalized_tax_id: rut,
    legal_name: legalName,
    normalized_legal_name: core,
    raw_data: { department: department && department !== 'Sin dato' ? department : null },
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}
