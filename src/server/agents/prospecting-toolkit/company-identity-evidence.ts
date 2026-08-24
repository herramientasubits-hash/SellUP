/**
 * AGENT1-CUT3B23 · CUT-3B2 — evidencia de identidad de empresa, UNA sola forma.
 *
 * Los tres escritores de Agente 1 (gratuito estructurado, `candidate-writer`
 * de pago/general y `lusha-pending-review`) deciden hoy la identidad de una
 * empresa con criterios que no se hablan entre sí: lo gratuito dedupea por
 * identidad FISCAL, lo de pago por DOMINIO/identidad de proveedor, y el nombre
 * se normaliza de tres maneras distintas. Este módulo es el ÚNICO contrato de
 * EVIDENCIA que los tres producen antes de la admisión, para que el registro de
 * lote (CUT-3B3) compare peras con peras.
 *
 * ── Cada señal significa algo DISTINTO ────────────────────────────────────────
 *
 * La evidencia es PLURAL a propósito. Colapsarla en una sola cadena sería
 * afirmar cosas que no son ciertas: que un dominio equivale a un identificador
 * fiscal, que un id de Apollo equivale a un id de Lusha, o que un nombre
 * identifica una empresa. Ninguna de las tres lo es.
 *
 * ── Normalizadores REUTILIZADOS, no nuevos ────────────────────────────────────
 *
 *   · fiscal    → `./fiscal-identity` (CUT-3B1). Autoridad canónica ÚNICA de
 *     Agente 1. Aquí no se canonicaliza nada por cuenta propia.
 *   · dominio   → `normalizeDomain` / `extractDomainFromWebsite` (`./normalization`).
 *   · LinkedIn  → `normalizeLinkedinUrl` (`./normalization`), que ya rechaza los
 *     perfiles PERSONALES (`/in/`): sólo entra identidad de EMPRESA.
 *   · nombre    → `buildIdentityKey` (`./canonical-company-identity`), el único
 *     helper de nombre canónico que este corte consume, y SÓLO como evidencia
 *     DÉBIL. No se unifica ni se reinterpreta `normalized_name`.
 *
 * ── Lo que este módulo NO hace ────────────────────────────────────────────────
 *
 *   · No fabrica señales: lo que la fuente no da queda `null`.
 *   · No compara ni decide: eso es `./batch-identity-registry`.
 *   · No toca la columna `identity_key` ni su derivación histórica.
 *   · No hace I/O, ni llama proveedores, ni lee el reloj. Puro y determinístico.
 */

import {
  buildFiscalIdentityKeyFromRaw,
  resolveFiscalCountryScope,
  resolveStoredFiscalIdentity,
  type FiscalIdentityKey,
} from './fiscal-identity';
import { normalizeDomain, extractDomainFromWebsite, normalizeLinkedinUrl } from './normalization';
import { buildIdentityKey } from './canonical-company-identity';

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * Las señales de identidad de una empresa, cada una con su propia autoridad.
 * `null` significa SIEMPRE «la fuente no la aporta», nunca «no coincide».
 */
export type CompanyIdentityEvidence = {
  /** Namespace de país en mayúsculas (`CO`), o `null` si la fuente no lo da. */
  countryNamespace: string | null;
  /**
   * Identidad fiscal con ámbito de país (`CO:900123456`), tal y como la compone
   * CUT-3B1. `null` cuando falta el identificador, cuando falta el país, o
   * cuando las dos columnas fiscales compatibles se contradicen (fail closed).
   */
  fiscalIdentityKey: FiscalIdentityKey | null;
  /** Dominio normalizado. `null` si no hay dominio ni web utilizable. */
  normalizedDomain: string | null;
  /**
   * Identidad nativa del proveedor, con NAMESPACE del proveedor incluido
   * (`lusha:12345`). El prefijo no es decorativo: es lo que hace IMPOSIBLE que
   * un id de Apollo y un id de Lusha con el mismo valor se comparen iguales.
   */
  providerEntityKey: string | null;
  /** LinkedIn de EMPRESA normalizado. Un perfil personal nunca llega aquí. */
  normalizedLinkedInCompany: string | null;
  /** Nombre canónico. Evidencia DÉBIL: nunca suprime por sí sola. */
  canonicalName: string | null;
};

export type CompanyIdentityEvidenceInput = {
  countryCode?: string | null;
  /** Identificador fiscal de la fuente. Se canonicaliza con la autoridad CUT-3B1. */
  taxIdentifier?: string | null;
  /**
   * Segunda columna fiscal compatible (`tax_id`). Cuando se pasan las dos y
   * canonicalizan DISTINTO, la identidad fiscal es `null` (fail closed): no se
   * elige una arbitrariamente.
   */
  taxId?: string | null;
  domain?: string | null;
  website?: string | null;
  linkedinUrl?: string | null;
  /** Namespace del proveedor (`apollo`, `lusha`, …). Sin él no hay clave. */
  providerKey?: string | null;
  /** Id nativo de la EMPRESA/entidad en ese proveedor. Nunca un id de persona. */
  providerEntityId?: string | null;
  name?: string | null;
};

// ─── Identidad de proveedor ───────────────────────────────────────────────────

/**
 * Compone la clave de identidad de proveedor con su namespace.
 *
 * Devuelve `null` si falta cualquiera de las dos partes: una identidad de
 * proveedor sin proveedor no es comparable con nada, y tratarla como clave
 * desnuda es exactamente cómo dos proveedores distintos terminarían empatando.
 *
 * @example
 * buildProviderEntityKey({ providerKey: 'lusha', providerEntityId: '99' }) → 'lusha:99'
 * buildProviderEntityKey({ providerKey: null,    providerEntityId: '99' }) → null
 */
export function buildProviderEntityKey(params: {
  providerKey?: string | null;
  providerEntityId?: string | null;
}): string | null {
  const provider = (params.providerKey ?? '').trim().toLowerCase();
  const entityId = (params.providerEntityId ?? '').trim();
  if (!provider || !entityId) return null;
  return `${provider}:${entityId}`;
}

// ─── Constructor ──────────────────────────────────────────────────────────────

/**
 * Construye la evidencia de identidad de una empresa a partir de lo que la
 * fuente realmente entregó.
 *
 * Es el ÚNICO constructor: los tres escritores lo llaman con su propio mapeo de
 * campos, y ninguno compone evidencia por su cuenta.
 */
export function buildCompanyIdentityEvidence(
  input: CompanyIdentityEvidenceInput,
): CompanyIdentityEvidence {
  const scope = resolveFiscalCountryScope(input.countryCode);

  // Identidad fiscal: si llegan las DOS columnas compatibles, la lectura de
  // compatibilidad de CUT-3B1 decide (y falla cerrado si se contradicen).
  const hasBothFiscalColumns =
    input.taxId != null && input.taxIdentifier != null;
  let fiscalIdentityKey: FiscalIdentityKey | null = null;
  if (hasBothFiscalColumns) {
    const stored = resolveStoredFiscalIdentity(
      { tax_id: input.taxId, tax_identifier: input.taxIdentifier },
      input.countryCode,
    );
    fiscalIdentityKey =
      stored.kind === 'resolved' && scope ? `${scope.namespace}:${stored.canonical}` : null;
  } else {
    fiscalIdentityKey = buildFiscalIdentityKeyFromRaw({
      value: input.taxIdentifier ?? input.taxId ?? null,
      countryCode: input.countryCode,
    });
  }

  const normalizedDomain =
    normalizeDomain(input.domain ?? '') ?? extractDomainFromWebsite(input.website);

  const canonicalNameRaw = buildIdentityKey(input.name ?? '').trim();

  return {
    countryNamespace: scope?.namespace ?? null,
    fiscalIdentityKey,
    normalizedDomain,
    providerEntityKey: buildProviderEntityKey({
      providerKey: input.providerKey,
      providerEntityId: input.providerEntityId,
    }),
    normalizedLinkedInCompany: normalizeLinkedinUrl(input.linkedinUrl),
    canonicalName: canonicalNameRaw.length > 0 ? canonicalNameRaw : null,
  };
}

/**
 * `true` cuando la evidencia no aporta NINGUNA señal fuerte (fiscal, dominio,
 * identidad de proveedor o LinkedIn de empresa). Sólo informativo: un candidato
 * sin señal fuerte se ADMITE, nunca se suprime.
 */
export function hasNoStrongIdentitySignal(evidence: CompanyIdentityEvidence): boolean {
  return (
    evidence.fiscalIdentityKey === null &&
    evidence.normalizedDomain === null &&
    evidence.providerEntityKey === null &&
    evidence.normalizedLinkedInCompany === null
  );
}
