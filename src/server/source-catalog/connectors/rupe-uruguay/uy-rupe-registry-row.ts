/**
 * uy-rupe-registry-row.ts — fila MÍNIMA de `uy_rupe_registry` a partir de un
 * registro del RUPE (Registro Único de Proveedores del Estado, Uruguay), para el
 * RUT por nombre dentro de la corrida del Agente 1, y sus alias.
 *
 * SOURCES-UY-RUT-BY-NAME-1 + SOURCES-UY-CLOSE-1. Puro: sin env, sin I/O, sin DB,
 * sin reloj.
 *
 * El RUPE (datos abiertos de ARCE, catalogodatos.gub.uy, un CSV por mes separado
 * por «;») trae: pais_prov; identificacion_prov; denominacion_social_prov;
 * domicilio_fiscal; localidad_prov; departamento_prov; estado_prov.
 *
 * Entran proveedores de URUGUAY, en estado ACTIVO o EN INGRESO (el RUT ya existe
 * en la DGI; Telefónica o República AFAP estaban «en ingreso»), con RUT de 12
 * dígitos cuyo dígito verificador cuadra, y que son una ORGANIZACIÓN:
 *   - una razón social con forma societaria (S.A., S.R.L., SAS, Ltda., en todas
 *     sus escrituras: `uy-name-keys.ts`), o
 *   - una cooperativa, mutualista, asociación, fundación o entidad pública
 *     (palabra institucional, `UY_ORGANIZATION_WORD`).
 * Nunca personas físicas, ni consorcios («… S A Y TIBEFOX S A», «… Y OTROS»), ni
 * sociedades disueltas o en liquidación. El domicilio no se guarda.
 */

import { buildRecordIdentityKey, deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { calculateUruguayRutCheckDigit } from '@/modules/prospect-batches/tax-identifier-rules';
import { endsWithUruguayLegalForm, plainUpperUruguay, uruguayNameCore } from './uy-name-keys';

export const UY_RUPE_REGISTRY_SOURCE_KEY = 'uy_rupe_registry' as const;
export const UY_RUPE_REGISTRY_COUNTRY_CODE = 'UY' as const;
export const UY_RUPE_NAME_ALIAS_SOURCE_KEY = 'uy_rupe_name_alias' as const;

/** Espacio de nombres de la identidad de un alias (`uy-name-alias:<RUT>:<clave>`). */
export const UY_NAME_ALIAS_IDENTITY_NAMESPACE = 'uy-name-alias' as const;

/** Estados del RUPE que entran: el RUT existe y la empresa no se dio de baja. */
const LOADED_STATES: ReadonlySet<string> = new Set(['ACTIVO', 'EN INGRESO']);

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

export type UyRupeNameAliasRow = Omit<UyRupeRegistryRow, 'source_key'> & {
  source_key: typeof UY_RUPE_NAME_ALIAS_SOURCE_KEY;
};

/**
 * Palabras que hacen de una razón social sin forma societaria una ORGANIZACIÓN
 * (no una persona): cooperativas, mutualistas, asociaciones, entes del Estado.
 */
export const UY_ORGANIZATION_WORD =
  /\b(COOPERATIVA|ASOCIACION|FUNDACION|INTENDENCIA|MINISTERIO|ADMINISTRACION|UNIVERSIDAD|INSTITUTO|INSTITUCION|BANCO|HOSPITAL|SANATORIO|MUTUALISTA|CORPORACION|CAMARA|FEDERACION|CONGREGACION|IGLESIA|COLEGIO|LICEO|ESCUELA|SOCIEDAD|CIRCULO|CENTRO|LABORATORIO|AGENCIA|UNIDAD REGULADORA|JUNTA DEPARTAMENTAL|PODER JUDICIAL|PODER LEGISLATIVO|TRIBUNAL|CORTE ELECTORAL|PRESIDENCIA DE LA REPUBLICA|MUNICIPIO|CAJA|PATRONATO|COMPANIA|EMPRESA|GRUPO)\b/;

/** Consorcios y uniones de varias sociedades: no son UNA empresa. */
const CONSORTIUM = /\b(CONSORCIO|Y OTROS|Y OTRAS)\b|\b(?:S A|SA|S R L|SRL|LTDA|SOCIEDAD ANONIMA)\s+Y\s+\S/;

/** Sociedad disuelta o en liquidación: su RUT no identifica a una empresa viva. */
const DISSOLVED = /\b(DISUELTA|DISUELTO|EN LIQUIDACION|LIQUIDADA)\b/;

/** Núcleo del nombre uruguayo: el MISMO que calcula el resolvedor de la corrida. */
export function normalizeUruguayCompanyCore(name: string | null | undefined): string {
  return uruguayNameCore(name);
}

/** ¿La razón social termina en una forma societaria uruguaya? */
export function carriesUruguayLegalForm(name: string | null | undefined): boolean {
  return typeof name === 'string' && uruguayNameCore(name).length >= 2 && endsWithUruguayLegalForm(name);
}

/** ¿Es la razón social la de una organización (empresa, cooperativa, ente), no la de una persona? */
export function isUruguayOrganizationName(name: string | null | undefined): boolean {
  if (typeof name !== 'string') return false;
  const upper = plainUpperUruguay(name);
  if (CONSORTIUM.test(upper) || DISSOLVED.test(upper)) return false;
  return carriesUruguayLegalForm(name) || UY_ORGANIZATION_WORD.test(upper);
}

/** Registro del RUPE → fila, o `null` si no es una organización uruguaya vigente válida. */
export function buildUyRupeRegistryRow(
  record: Record<string, string>,
  params: { sourceYear: number; importedAt: string },
): UyRupeRegistryRow | null {
  const country = (record['pais_prov'] ?? '').trim().toUpperCase();
  const status = (record['estado_prov'] ?? '').trim().toUpperCase();
  const rut = (record['identificacion_prov'] ?? '').replace(/\D/g, '');
  const legalName = (record['denominacion_social_prov'] ?? '').replace(/\s+/g, ' ').trim();
  if (country !== 'URUGUAY' || !LOADED_STATES.has(status) || rut.length !== 12) return null;
  if (calculateUruguayRutCheckDigit(rut.slice(0, 11)) !== Number(rut[11])) return null;
  if (!isUruguayOrganizationName(legalName)) return null;

  const core = uruguayNameCore(legalName);
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
    raw_data: {
      department: department && department !== 'Sin dato' ? department : null,
      rupe_state: status === 'ACTIVO' ? 'active' : 'registering',
    },
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

/**
 * Filas de alias de una organización del RUPE: una por clave EXTRA de nombre
 * (`uruguayRegistryAliasKeys`, ya sin las que son el nombre propio de otra).
 * Guardan el RUT y la razón social del RUPE.
 */
export function buildUyRupeNameAliasRows(params: {
  registryRow: UyRupeRegistryRow;
  keys: readonly string[];
}): UyRupeNameAliasRow[] {
  const { registryRow, keys } = params;
  const rows: UyRupeNameAliasRow[] = [];
  const seen = new Set<string>([registryRow.normalized_legal_name]);
  for (const key of keys) {
    const core = key.trim();
    if (core.length < 2 || seen.has(core)) continue;
    seen.add(core);
    const identity = buildRecordIdentityKey(UY_NAME_ALIAS_IDENTITY_NAMESPACE, `${registryRow.tax_id}:${core}`);
    rows.push({
      ...registryRow,
      source_key: UY_RUPE_NAME_ALIAS_SOURCE_KEY,
      normalized_legal_name: core,
      raw_data: { ...registryRow.raw_data, alias_of: registryRow.normalized_legal_name },
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows;
}
