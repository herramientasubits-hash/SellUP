/**
 * A1-APOLLO-WIZARD-1 — Contrato de identidad y orden de deduplicación para Apollo.
 *
 * Puro: sin I/O. Define y hace verificable la regla que el pipeline debe cumplir.
 *
 * El punto de fondo:
 *   El Apollo Organization ID identifica un REGISTRO DEL PROVEEDOR, no a la
 *   empresa. Dos registros de Apollo pueden ser la misma empresa y un registro
 *   puede desaparecer. Tratarlo como identidad permanente ata la base de datos a
 *   la vista que Apollo tenía de una empresa un martes cualquiera.
 *
 *   Apollo Organization Search tampoco es una fuente confiable de identificador
 *   legal: NIT, RFC, RUT, RUC, CNPJ, VAT, registro mercantil o razón social
 *   verificada. Esos datos vienen del enriquecimiento oficial del país (para
 *   Colombia, el enrichment ya conectado, incluido `co_siis` cuando aplica).
 *   Inferir un NIT desde Apollo es fabricar identidad legal.
 *
 * De ahí el orden obligatorio:
 *   discovery → normalización → enriquecimiento legal del país →
 *   identidad canónica → deduplicación definitiva → persistencia
 */

import type { ApolloProviderReference } from './apollo-organizations-response-normalizer';

// ─── Orden del pipeline ───────────────────────────────────────────────────────

export const APOLLO_PIPELINE_STAGE_ORDER = [
  'provider_discovery',
  'initial_normalization',
  'initial_gates',
  'country_legal_enrichment',
  'canonical_company_identity',
  'definitive_deduplication',
  'candidate_persistence',
  'human_review',
] as const;

export type ApolloPipelineStage = (typeof APOLLO_PIPELINE_STAGE_ORDER)[number];

export function apolloPipelineStageIndex(stage: ApolloPipelineStage): number {
  return APOLLO_PIPELINE_STAGE_ORDER.indexOf(stage);
}

/**
 * Verifica que la deduplicación definitiva no ocurra antes del enriquecimiento
 * legal.
 *
 * Distinción que importa: el writer del Agente 1 marca `duplicate_status` sobre
 * el candidato para la revisión humana — eso es una SEÑAL provisional, no una
 * fusión. La deduplicación DEFINITIVA (la que decide si se crea o se reutiliza
 * una `account`) ocurre en la aprobación, contra `tax_identifier + country_code`
 * y luego dominio, es decir, después del enriquecimiento legal. Esta función
 * mantiene esa garantía comprobable en lugar de confiada.
 */
export function assertApolloDeduplicationOrder(observed: {
  legalEnrichmentStage: ApolloPipelineStage;
  definitiveDeduplicationStage: ApolloPipelineStage;
}): void {
  const legalIndex = apolloPipelineStageIndex(observed.legalEnrichmentStage);
  const dedupIndex = apolloPipelineStageIndex(observed.definitiveDeduplicationStage);

  if (legalIndex < 0 || dedupIndex < 0) {
    throw new Error('apollo_identity_contract_unknown_stage');
  }
  if (dedupIndex < legalIndex) {
    throw new Error(
      'apollo_identity_contract_violation: definitive deduplication runs before country legal enrichment',
    );
  }
}

// ─── Identidad canónica ───────────────────────────────────────────────────────

/**
 * Señales admitidas para construir la identidad canónica de una empresa.
 * El identificador legal entra DESPUÉS, desde el enriquecimiento oficial.
 */
export type CanonicalIdentitySignals = {
  primaryDomain: string | null;
  alternateDomains: string[];
  linkedinUrl: string | null;
  normalizedName: string | null;
  /** Sólo del enriquecimiento oficial del país. Nunca de Apollo. */
  legalIdentifier: string | null;
  legalIdentifierSource: string | null;
};

/**
 * Campos que Apollo Organization Search NO puede fundamentar. Si alguno de estos
 * apareciera con procedencia Apollo, sería un dato legal fabricado.
 */
export const APOLLO_NON_AUTHORITATIVE_IDENTITY_FIELDS = [
  'tax_identifier',
  'nit',
  'rfc',
  'rut',
  'ruc',
  'cnpj',
  'vat',
  'commercial_registry',
  'verified_legal_name',
] as const;

export type ApolloNonAuthoritativeIdentityField =
  (typeof APOLLO_NON_AUTHORITATIVE_IDENTITY_FIELDS)[number];

/**
 * Falla si un identificador legal dice provenir de Apollo.
 *
 * `legalIdentifierSource` debe nombrar una fuente oficial del país (por ejemplo
 * `co_siis`), no al proveedor de discovery.
 */
export function assertLegalIdentifierNotFromApollo(signals: {
  legalIdentifier: string | null;
  legalIdentifierSource: string | null;
}): void {
  if (!signals.legalIdentifier) return;
  const source = (signals.legalIdentifierSource ?? '').trim().toLowerCase();
  if (!source) {
    throw new Error(
      'apollo_identity_contract_violation: legal identifier present without an official source',
    );
  }
  if (source.includes('apollo')) {
    throw new Error(
      'apollo_identity_contract_violation: legal identifier attributed to Apollo discovery',
    );
  }
}

/**
 * Construye la referencia al registro del proveedor.
 *
 * Es una REFERENCIA, no identidad: se guarda para trazabilidad y para reconocer
 * el mismo registro de Apollo entre ejecuciones, nunca para decidir si dos
 * candidatos son la misma empresa.
 */
export function buildApolloProviderReference(input: {
  providerOrganizationId: string;
  providerAccountId?: string | null;
}): ApolloProviderReference {
  const organizationId = input.providerOrganizationId.trim();
  if (!organizationId) {
    throw new Error('apollo_provider_reference_requires_organization_id');
  }
  const accountId = input.providerAccountId?.trim();
  return {
    provider: 'apollo',
    providerOrganizationId: organizationId,
    providerAccountId: accountId ? accountId : null,
  };
}

/**
 * Fuerza que el Apollo Organization ID no se use como identidad canónica.
 *
 * Un candidato cuya única señal de identidad es el id de Apollo no tiene
 * identidad: tiene una referencia de proveedor.
 */
export function assertApolloIdNotUsedAsCanonicalIdentity(input: {
  canonicalIdentityKey: string | null;
  providerReference: ApolloProviderReference;
}): void {
  const key = input.canonicalIdentityKey?.trim();
  if (!key) return;
  const orgId = input.providerReference.providerOrganizationId.trim();
  const accountId = input.providerReference.providerAccountId?.trim() ?? null;

  if (key === orgId || key === `apollo:${orgId}`) {
    throw new Error(
      'apollo_identity_contract_violation: Apollo organization id used as canonical identity',
    );
  }
  if (accountId && (key === accountId || key === `apollo:${accountId}`)) {
    throw new Error(
      'apollo_identity_contract_violation: Apollo account id used as canonical identity',
    );
  }
}

/**
 * Fuerza de la identidad disponible en un momento dado.
 *
 * `provider_reference_only` es el estado esperado justo tras el discovery: es
 * legítimo, siempre que no se confunda con identidad y no dispare deduplicación
 * definitiva.
 */
export type CanonicalIdentityStrength =
  | 'legal_identifier'
  | 'domain_backed'
  | 'linkedin_backed'
  | 'name_only'
  | 'provider_reference_only';

export function evaluateCanonicalIdentityStrength(
  signals: CanonicalIdentitySignals,
): CanonicalIdentityStrength {
  if (signals.legalIdentifier) return 'legal_identifier';
  if (signals.primaryDomain || signals.alternateDomains.length > 0) return 'domain_backed';
  if (signals.linkedinUrl) return 'linkedin_backed';
  if (signals.normalizedName) return 'name_only';
  return 'provider_reference_only';
}

/** Sólo la identidad legal habilita la deduplicación definitiva. */
export function canRunDefinitiveDeduplication(
  strength: CanonicalIdentityStrength,
): boolean {
  return strength === 'legal_identifier';
}
