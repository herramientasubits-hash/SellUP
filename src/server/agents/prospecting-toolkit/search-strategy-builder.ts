/**
 * Search Strategy Builder v1.8 — Source Catalog vs Search Strategy Separation
 *
 * Separa explícitamente el Catálogo de Fuentes (qué existe) de la Estrategia de
 * Búsqueda (cómo buscar prospectos). Para cada combinación país/industria/subindustria,
 * materializa los roles de las fuentes y decide cuáles pueden usarse como discovery seed,
 * cuáles solo para enrichment/validación, y cuáles están bloqueadas.
 *
 * Reglas fundamentales:
 * - RUES / Personas Jurídicas / Cámara de Comercio → legal_registry, nunca discovery.
 * - SIIS / enriquecimiento financiero → enrichment_only, nunca discovery.
 * - SECOP → blocked_from_discovery salvo contexto B2G explícito.
 * - ANDICOM → contextual_signal, puede orientar queries pero no es discovery seed.
 * - Fedesoft → sector_signal (pausada upstream — no activa para source-guided).
 * - Colombia Fintech → blocked_from_discovery salvo señal fintech explícita.
 * - Comparadores/directorios → gestionados por external-platform-blocklist (fuera de scope aquí).
 *
 * Puramente determinístico — sin I/O, sin llamadas externas.
 */

import { CATALOG_SOURCES } from './source-catalog';
import type {
  CatalogSource,
  SearchStrategyV1,
  SourceDiscoveryRole,
  SourceRoleDecision,
} from './types';

// ─── Tipos de entrada ─────────────────────────────────────────────────────────

export type SearchStrategyInput = {
  countryCode: string;
  country: string;
  industry: string;
  subindustries?: string[];
  additionalCriteria?: string | null;
};

// ─── Detección de señales de contexto ────────────────────────────────────────

const FINTECH_TERMS = [
  'fintech', 'pago', 'payment', 'open banking', 'open finance',
  'wallet', 'adquirenci', 'banca', 'financial_technology',
  'banking-as-a-service', 'infraestructura financiera',
];

const B2G_TERMS = [
  'gobierno', 'estado', 'publico', 'b2g', 'licitacion',
  'contratacion estatal', 'proveedor estatal', 'sector publico',
  'entidad publica', 'compra publica',
];

function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Detecta señal fintech en subindustrias o criterios adicionales.
 * Exportado para uso en tests y como referencia centralizada.
 */
export function detectFintechSignal(
  subindustries: string[],
  additionalCriteria: string | null | undefined,
): boolean {
  const allText = [...subindustries, additionalCriteria ?? '']
    .join(' ');
  const normalized = normalizeForSearch(allText);
  return FINTECH_TERMS.some((t) => normalized.includes(t));
}

/**
 * Detecta señal B2G/gobierno en criterios adicionales.
 * Exportado para uso en tests.
 */
export function detectB2GSignal(
  additionalCriteria: string | null | undefined,
): boolean {
  if (!additionalCriteria) return false;
  const normalized = normalizeForSearch(additionalCriteria);
  return B2G_TERMS.some((t) => normalized.includes(t));
}

// ─── Derivación de rol por fuente ─────────────────────────────────────────────

type RoleDerivationContext = {
  isFintech: boolean;
  isB2G: boolean;
};

const QUERY_ALLOWED_ROLES: SourceDiscoveryRole[] = [
  'discovery_seed',
  'sector_signal',
  'contextual_signal',
];

function deriveSourceRole(
  source: CatalogSource,
  ctx: RoleDerivationContext,
): { role: SourceDiscoveryRole; reason: string } {
  // 1. Excluidas explícitamente del flujo IA
  if (source.sellupUse === 'not_for_ai_flow') {
    return { role: 'blocked_from_discovery', reason: 'not_for_ai_flow' };
  }
  if (source.sellupUse === 'technical_container') {
    return { role: 'blocked_from_discovery', reason: 'technical_container_not_a_source' };
  }

  // 2. Registro legal → nunca discovery comercial
  if (source.sellupUse === 'legal_validation') {
    return { role: 'legal_registry', reason: 'legal_registry_not_commercial_discovery' };
  }

  // 3. Enriquecimiento post-discovery
  if (source.sellupUse === 'enrichment') {
    return { role: 'enrichment_only', reason: 'enrichment_post_discovery_not_a_seed' };
  }

  // 4. Señal contextual (e.g., ANDICOM source_guided)
  if (
    source.sellupUse === 'contextual_signal' ||
    source.aiFlowStatus === 'source_guided'
  ) {
    return {
      role: 'contextual_signal',
      reason: 'contextual_signal_guides_queries_not_discovery_seed',
    };
  }

  // 5. Referencia manual
  if (source.sellupUse === 'manual_reference') {
    // Colombia Fintech: activa solo con señal fintech explícita en subindustria o criteria
    if (source.key === 'co_colombia_fintech') {
      if (ctx.isFintech) {
        return { role: 'sector_signal', reason: 'fintech_signal_activates_colombia_fintech' };
      }
      return {
        role: 'blocked_from_discovery',
        reason: 'colombia_fintech_blocked_no_fintech_subindustry',
      };
    }
    return { role: 'manual_signal_only', reason: 'manual_reference_not_automated' };
  }

  // 6. Señal comercial — diferenciación por fuente específica
  if (source.sellupUse === 'commercial_signal') {
    // SECOP II Proveedores: B2G enrichment por defecto; discovery solo con señal B2G explícita
    if (source.key === 'co_secop2_proveedores') {
      if (ctx.isB2G) {
        return {
          role: 'sector_signal',
          reason: 'secop2_proveedores_b2g_conditional_signal',
        };
      }
      return {
        role: 'enrichment_only',
        reason: 'secop2_proveedores_b2g_enrichment_not_general_discovery',
      };
    }

    // Fedesoft: señal sectorial tech/software Colombia (pausada por captcha SiteGround)
    if (source.key === 'co_fedesoft') {
      const reason =
        source.aiFlowStatus === 'paused'
          ? 'fedesoft_sector_signal_paused_upstream_blocked'
          : 'fedesoft_sector_signal_tech_software_colombia';
      return { role: 'sector_signal', reason };
    }

    // Otras señales comerciales no automatizadas
    if (
      source.aiFlowStatus === 'paused' ||
      source.aiFlowStatus === 'manual_only'
    ) {
      return { role: 'manual_signal_only', reason: 'commercial_signal_not_automated' };
    }

    return { role: 'sector_signal', reason: 'commercial_signal_sector_discovery' };
  }

  // 7. Fuentes de discovery explícito
  if (source.sellupUse === 'discovery') {
    if (source.aiFlowStatus === 'connected') {
      return { role: 'discovery_seed', reason: 'connected_discovery_source' };
    }
    if (source.aiFlowStatus === 'eligible_not_connected') {
      return { role: 'discovery_seed', reason: 'eligible_discovery_source_not_yet_connected' };
    }
    if (source.aiFlowStatus === 'paused') {
      return { role: 'sector_signal', reason: 'discovery_source_paused' };
    }
    return { role: 'manual_signal_only', reason: 'discovery_source_not_active' };
  }

  return { role: 'manual_signal_only', reason: 'unclassified_source_fallback' };
}

// ─── buildSearchStrategyFromCatalog ──────────────────────────────────────────

/**
 * Materializa la estrategia de búsqueda para una combinación de país/industria/subindustria.
 *
 * Deriva el rol de cada fuente del catálogo usando sus campos operativos existentes
 * (sellupUse, operationalStatus, aiFlowStatus, connectionMode) más el contexto del
 * input (señales fintech, B2G, subindustrias).
 *
 * Virtual query intents (co_software_empresarial) se incluyen en sourceGuidedQuerySeeds
 * porque representan intents de subindustria que guían queries sin ser fuentes reales.
 *
 * Garantías:
 * - RUES nunca aparece como discovery_seed.
 * - Personas Jurídicas / Cámara de Comercio nunca aparece como discovery_seed.
 * - SECOP no aparece como discovery para Tecnología general (solo con señal B2G).
 * - ANDICOM aparece como contextual_signal, no como discovery_seed.
 * - Fedesoft aparece como sector_signal.
 * - Colombia Fintech aparece como sector_signal solo con señal fintech explícita.
 * - Las queries source-guided solo salen de discovery_seed, sector_signal o contextual_signal.
 */
export function buildSearchStrategyFromCatalog(
  input: SearchStrategyInput,
): SearchStrategyV1 {
  const {
    countryCode,
    industry,
    subindustries = [],
    additionalCriteria = null,
  } = input;

  const code = countryCode.toUpperCase().trim();
  const isFintech = detectFintechSignal(subindustries, additionalCriteria);
  const isB2G = detectB2GSignal(additionalCriteria);
  const ctx: RoleDerivationContext = { isFintech, isB2G };

  const countrySources = CATALOG_SOURCES.filter((s) =>
    s.countryCodes.includes(code),
  );

  // Derivar decisión para cada fuente del país
  const sourceDecisions: SourceRoleDecision[] = countrySources.map((source) => {
    const { role, reason } = deriveSourceRole(source, ctx);
    const allowedForDiscovery = role === 'discovery_seed';
    const allowedForSourceGuidedQueries =
      QUERY_ALLOWED_ROLES.includes(role) && source.aiFlowStatus !== 'paused';
    return {
      sourceKey: source.key,
      sourceName: source.name,
      role,
      allowedForDiscovery,
      allowedForSourceGuidedQueries,
      reason,
    };
  });

  // Agrupar por rol
  const byRole = (role: SourceDiscoveryRole): string[] =>
    sourceDecisions.filter((d) => d.role === role).map((d) => d.sourceKey);

  // Source-guided query seeds: fuentes del catálogo permitidas + virtual query intents
  const catalogSeeds = sourceDecisions
    .filter((d) => d.allowedForSourceGuidedQueries)
    .map((d) => d.sourceKey);

  // Virtual intents: representan subindustrias o subclusters sin fuente real en catálogo
  const virtualQueryIntents: string[] = [];
  if (code === 'CO') {
    // co_software_empresarial: intent virtual para queries de Software Empresarial en Colombia
    virtualQueryIntents.push('co_software_empresarial');
  }

  const sourceGuidedQuerySeeds = [...virtualQueryIntents, ...catalogSeeds];

  const blockedSourceKeys = sourceDecisions
    .filter((d) => d.role === 'blocked_from_discovery')
    .map((d) => d.sourceKey);

  return {
    version: 'search_strategy_v1_8',
    countryCode: code,
    industry,
    subindustries,
    fintechSignal: isFintech,
    b2gSignal: isB2G,
    sourceRoles: {
      discovery_seed: byRole('discovery_seed'),
      sector_signal: byRole('sector_signal'),
      validation_only: byRole('validation_only'),
      enrichment_only: byRole('enrichment_only'),
      legal_registry: byRole('legal_registry'),
      contextual_signal: byRole('contextual_signal'),
      manual_signal_only: byRole('manual_signal_only'),
      blocked_from_discovery: byRole('blocked_from_discovery'),
    },
    sourceDecisions,
    queryStrategy: {
      sourceGuidedQuerySeeds,
      blockedSourceKeys,
      fintechGated: true,
      b2gConditional: true,
    },
    evidenceRequirements: {
      requiresOfficialCompanySite: true,
      requiresCountryEvidence: true,
      allowsQueryOnlyCountry: true,
      queryOnlyConfidenceCap: 45,
      blocksMediaDirectoriesMarketplaces: true,
    },
  };
}
