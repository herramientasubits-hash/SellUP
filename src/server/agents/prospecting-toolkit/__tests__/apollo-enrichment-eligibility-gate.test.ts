/**
 * Tests — gates baratos previos al enrichment pagado
 * A1-APOLLO-BUDGET-RECONCILIATION-1 (§7, §8, §9, §10)
 *
 * Los tres casos que el hito nombra explícitamente:
 *   - Falabella Retail Colombia / falabella.com.pe con país objetivo CO → rechazado
 *     ANTES de Organization Enrichment (fue el crédito realmente gastado en el QA).
 *   - Citigroup → no elegible para enrichment de supermercados.
 *   - Google / gmail.com → no elegible para enrichment de supermercados.
 *
 * Offline: sin red, sin Supabase, sin Apollo, sin créditos.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateApolloEnrichmentEligibility,
  extractApolloCandidateFacts,
  buildApolloIdentityKey,
} from '../apollo-enrichment-eligibility-gate';
import {
  applyApolloSectorRelevanceGate,
  resolveApolloSectorSignalSet,
  hasCheapSectorEvidence,
} from '../apollo-sector-relevance-gate';
import {
  buildApolloSpendObservability,
  toObservedNumber,
  toProviderUsageObservabilityColumns,
} from '../apollo-spend-observability';
import type { WebSearchResult } from '../types';

// ── Guard de red ─────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async () => {
    throw new Error('network_access_forbidden_in_offline_test');
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = originalFetch;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function result(overrides: {
  title: string;
  url: string;
  domain: string | null;
  industry?: string | null;
  keywords?: string[];
  shortDescription?: string | null;
  organizationId?: string;
  linkedinUrl?: string | null;
}): WebSearchResult {
  return {
    title: overrides.title,
    url: overrides.url,
    snippet: `Empresa: ${overrides.title}`,
    source: 'apollo_organizations',
    rank: 1,
    provider: 'apollo_organizations',
    confidence: 0.85,
    metadata: {
      apollo_organization_id: overrides.organizationId ?? 'org-1',
      domain: overrides.domain,
      industry: overrides.industry ?? null,
      keywords: overrides.keywords ?? [],
      short_description: overrides.shortDescription ?? null,
      linkedin_url: overrides.linkedinUrl ?? null,
    },
  } as WebSearchResult;
}

const SUPERMARKET_CONTEXT = {
  targetCountryCode: 'CO',
  sector: 'Retail y Consumo',
  subindustry: 'Supermercados e Hipermercados',
} as const;

// Un supermercado colombiano legítimo — el control positivo.
const EXITO = result({
  title: 'Almacenes Exito',
  url: 'https://www.exito.com',
  domain: 'exito.com',
  organizationId: 'org-exito',
  industry: 'retail',
  keywords: ['supermercado', 'grocery retail'],
  shortDescription: 'Cadena de supermercados e hipermercados en Colombia.',
});

// ── §9 Mapeo determinista del sector ─────────────────────────────────────────

describe('§9 mapeo de Retail y Consumo / Supermercados e Hipermercados', () => {
  it('ambos sectores tienen mapping (ya no hay passthrough por falta de mapeo)', () => {
    assert.notEqual(resolveApolloSectorSignalSet('Retail y Consumo', null), null);
    assert.notEqual(
      resolveApolloSectorSignalSet('Retail y Consumo', 'Supermercados e Hipermercados'),
      null,
    );
  });

  it('la subindustria gana sobre el sector (más estricta)', () => {
    const set = resolveApolloSectorSignalSet('Retail y Consumo', 'Supermercados e Hipermercados');
    assert.equal(set?.key, 'supermercados e hipermercados');
  });

  it('incluye las señales exigidas por el hito', () => {
    const set = resolveApolloSectorSignalSet(null, 'Supermercados e Hipermercados');
    const signals = set?.signals ?? [];
    for (const required of [
      'supermercado',
      'hipermercado',
      'supermarket',
      'hypermarket',
      'grocery',
      'grocery retail',
      'retail chain',
    ]) {
      assert.ok(signals.includes(required), `falta la señal: ${required}`);
    }
  });

  it('NO usa el token suelto "retail" — colisiona con "retail banking"', () => {
    for (const key of ['Retail y Consumo', 'Supermercados e Hipermercados']) {
      const signals = resolveApolloSectorSignalSet(null, key)?.signals ?? [];
      assert.ok(!signals.includes('retail'), `"${key}" no debe incluir el token suelto "retail"`);
    }
  });

  it('un supermercado real SÍ pasa el filtro sectorial estricto', () => {
    const gate = applyApolloSectorRelevanceGate(
      [EXITO],
      'Retail y Consumo',
      'apollo_organizations',
      'Supermercados e Hipermercados',
    );
    assert.equal(gate.passed.length, 1, 'la exclusión buyer/vendor no debe rechazar supermercados');
    assert.equal(gate.metadata.sector_mapped, true);
  });

  it('la exclusión buyer/vendor sigue activa para formación corporativa', () => {
    const banco = result({
      title: 'Banco Grande',
      url: 'https://bancogrande.com.co',
      domain: 'bancogrande.com.co',
      industry: 'banking',
      keywords: ['employee training'],
    });
    const gate = applyApolloSectorRelevanceGate(
      [banco],
      'Educación',
      'apollo_organizations',
      'formación corporativa',
    );
    assert.equal(gate.passed.length, 0);
    assert.equal(gate.metadata.rejected_samples[0]?.reason, 'buyer_or_non_vendor_signal');
  });
});

// ── §7 / §8 Los tres casos nombrados ─────────────────────────────────────────

describe('§7 Falabella: rechazado ANTES del Organization Enrichment', () => {
  it('falabella.com.pe con país objetivo CO no es elegible', () => {
    const falabella = result({
      title: 'Falabella Retail Colombia',
      url: 'https://www.falabella.com.pe',
      domain: 'falabella.com.pe',
      organizationId: 'org-falabella',
      industry: 'retail',
      keywords: ['retail chain'],
      shortDescription: 'Cadena de tiendas por departamento.',
    });

    const outcome = evaluateApolloEnrichmentEligibility([falabella], SUPERMARKET_CONTEXT);

    assert.equal(outcome.meta.eligible_count, 0, 'no debe pagarse enrichment por este candidato');
    assert.deepEqual(outcome.eligibleIndices, []);
    const decision = outcome.decisions[0];
    assert.equal(decision?.eligible, false);
    assert.equal(decision?.skipReason, 'country_tld_incompatible');
    assert.match(String(decision?.detail), /\.com\.pe/);
  });

  it('el mismo grupo con dominio CO sí es elegible (el país es la causa, no el nombre)', () => {
    const falabellaCo = result({
      title: 'Falabella Colombia',
      url: 'https://www.falabella.com.co',
      domain: 'falabella.com.co',
      organizationId: 'org-falabella-co',
      industry: 'retail',
      keywords: ['supermercado', 'grocery retail'],
      shortDescription: 'Cadena de supermercados en Colombia.',
    });
    const outcome = evaluateApolloEnrichmentEligibility([falabellaCo], SUPERMARKET_CONTEXT);
    assert.equal(outcome.meta.eligible_count, 1);
  });
});

describe('§9 Citigroup y Google/gmail no son elegibles para enrichment de supermercados', () => {
  it('Citigroup queda fuera (retail banking no es retail de alimentos)', () => {
    const citi = result({
      title: 'Citigroup',
      url: 'https://www.citi.com',
      domain: 'citi.com',
      organizationId: 'org-citi',
      industry: 'banking',
      keywords: ['retail banking', 'investment banking'],
      shortDescription: 'Global bank offering retail banking services.',
    });
    const outcome = evaluateApolloEnrichmentEligibility([citi], SUPERMARKET_CONTEXT);
    assert.equal(outcome.meta.eligible_count, 0);
    assert.equal(outcome.decisions[0]?.skipReason, 'sector_relevance_unverified');
  });

  it('gmail.com queda fuera por ser proveedor de correo, no una empresa candidata', () => {
    const gmail = result({
      title: 'gmail.com.co',
      url: 'https://www.google.com',
      domain: 'google.com',
      organizationId: 'org-google',
      industry: 'internet',
      keywords: ['email'],
    });
    const outcome = evaluateApolloEnrichmentEligibility([gmail], SUPERMARKET_CONTEXT);
    assert.equal(outcome.meta.eligible_count, 0);
    assert.equal(outcome.decisions[0]?.skipReason, 'generic_email_provider_domain');
  });

  it('gmail.com directo también queda fuera', () => {
    const gmail = result({
      title: 'Gmail',
      url: 'https://gmail.com',
      domain: 'gmail.com',
      organizationId: 'org-gmail',
    });
    const outcome = evaluateApolloEnrichmentEligibility([gmail], SUPERMARKET_CONTEXT);
    assert.equal(outcome.decisions[0]?.skipReason, 'generic_email_provider_domain');
  });
});

// ── §7 Cobertura del resto de bloqueos exigidos ──────────────────────────────

describe('§7 todos los bloqueos exigidos antes del enrichment pagado', () => {
  it('dominio ausente por completo → invalid_domain', () => {
    const noDomain = result({
      title: 'Empresa Sin Dominio',
      url: '',
      domain: null,
      organizationId: 'org-x',
    });
    const outcome = evaluateApolloEnrichmentEligibility([noDomain], SUPERMARKET_CONTEXT);
    assert.equal(outcome.decisions[0]?.skipReason, 'invalid_domain');
  });

  it('dominio sintácticamente inválido → invalid_domain', () => {
    for (const badDomain of ['no-tiene-punto', 'espacio en medio.com', 'doble..punto.com', '-guion.com']) {
      const bad = result({
        title: 'Empresa Rara',
        url: badDomain,
        domain: badDomain,
        organizationId: `org-${badDomain}`,
      });
      const outcome = evaluateApolloEnrichmentEligibility([bad], SUPERMARKET_CONTEXT);
      assert.equal(
        outcome.decisions[0]?.skipReason,
        'invalid_domain',
        `debería ser invalid_domain: ${badDomain}`,
      );
    }
  });

  it('el placeholder de apollo.io no llega al enrichment (plataforma externa)', () => {
    // Cuando Apollo no devuelve website, el mapper usa apollo.io/companies/{id}.
    // Sea cual sea el código, lo que importa es que NO se pague por él.
    const placeholder = result({
      title: 'Empresa Sin Dominio',
      url: 'https://apollo.io/companies/org-x',
      domain: null,
      organizationId: 'org-x',
    });
    const outcome = evaluateApolloEnrichmentEligibility([placeholder], SUPERMARKET_CONTEXT);
    assert.equal(outcome.meta.eligible_count, 0);
    assert.equal(outcome.decisions[0]?.skipReason, 'external_platform');
  });

  it('plataforma externa', () => {
    const linkedin = result({
      title: 'Alguna Empresa',
      url: 'https://www.linkedin.com/company/alguna',
      domain: 'linkedin.com',
      organizationId: 'org-li',
      keywords: ['supermercado'],
    });
    const outcome = evaluateApolloEnrichmentEligibility([linkedin], SUPERMARKET_CONTEXT);
    assert.equal(outcome.decisions[0]?.skipReason, 'external_platform');
  });

  it('sector sin mapping → sin enrichment, con skipReason estructurado y 0 créditos', () => {
    const outcome = evaluateApolloEnrichmentEligibility([EXITO], {
      targetCountryCode: 'CO',
      sector: 'Un Sector Sin Mapeo Alguno',
      subindustry: null,
    });
    assert.equal(outcome.meta.eligible_count, 0, 'sector_not_mapped ya NO es passthrough para gasto');
    assert.equal(outcome.decisions[0]?.skipReason, 'sector_not_mapped');
    assert.equal(outcome.meta.sector_mapping_missing, true);
  });

  it('sector mapeado pero sin evidencia → sector_relevance_unverified', () => {
    const generic = result({
      title: 'Compañía Genérica',
      url: 'https://generica.com.co',
      domain: 'generica.com.co',
      organizationId: 'org-gen',
      industry: 'manufacturing',
      keywords: [],
    });
    const outcome = evaluateApolloEnrichmentEligibility([generic], SUPERMARKET_CONTEXT);
    assert.equal(outcome.decisions[0]?.skipReason, 'sector_relevance_unverified');
  });

  it('organización ya procesada', () => {
    const identityKey = buildApolloIdentityKey(extractApolloCandidateFacts(EXITO)) as string;
    const outcome = evaluateApolloEnrichmentEligibility([EXITO], {
      ...SUPERMARKET_CONTEXT,
      processedIdentityKeys: new Set([identityKey]),
    });
    assert.equal(outcome.decisions[0]?.skipReason, 'identity_already_processed');
  });

  it('cooldown activo', () => {
    const identityKey = buildApolloIdentityKey(extractApolloCandidateFacts(EXITO)) as string;
    const outcome = evaluateApolloEnrichmentEligibility([EXITO], {
      ...SUPERMARKET_CONTEXT,
      identityCooldownKeys: new Set([identityKey]),
    });
    assert.equal(outcome.decisions[0]?.skipReason, 'identity_cooldown_active');
  });

  it('duplicado preliminar dentro del mismo conjunto: la primera pasa, la segunda no', () => {
    const twin = result({
      title: 'Almacenes Exito',
      url: 'https://www.exito.com',
      domain: 'exito.com',
      organizationId: 'org-exito',
      industry: 'retail',
      keywords: ['supermercado'],
      shortDescription: 'Cadena de supermercados.',
    });
    const outcome = evaluateApolloEnrichmentEligibility([EXITO, twin], SUPERMARKET_CONTEXT);
    assert.deepEqual(outcome.eligibleIndices, [0]);
    assert.equal(outcome.decisions[1]?.skipReason, 'duplicate_preliminary_domain');
  });

  it('el conteo de bloqueos cuadra y el detalle no lleva valores sensibles', () => {
    const citi = result({
      title: 'Citigroup',
      url: 'https://www.citi.com',
      domain: 'citi.com',
      organizationId: 'org-citi',
      industry: 'banking',
      keywords: ['retail banking'],
    });
    const outcome = evaluateApolloEnrichmentEligibility([EXITO, citi], SUPERMARKET_CONTEXT);
    assert.equal(outcome.meta.checked_count, 2);
    assert.equal(outcome.meta.eligible_count, 1);
    assert.equal(outcome.meta.skipped_count, 1);
    assert.equal(outcome.meta.target_country_code, 'CO');
  });
});

// ── §8 Evidencia sectorial barata ────────────────────────────────────────────

describe('§8 hasCheapSectorEvidence sólo usa señales gratuitas', () => {
  it('reconoce el sector desde el dominio y el nombre, sin enrichment', () => {
    const outcome = hasCheapSectorEvidence({
      sector: 'Retail y Consumo',
      subindustry: 'Supermercados e Hipermercados',
      name: 'Supermercados La Grande',
      domain: 'lagrande.com.co',
      url: 'https://lagrande.com.co',
      linkedinUrl: null,
    });
    assert.equal(outcome.outcome, 'relevant');
    assert.ok(outcome.matchedTerms.includes('supermercado'));
  });

  it('sin mapping devuelve sector_not_mapped, distinguible de "sin evidencia"', () => {
    assert.equal(
      hasCheapSectorEvidence({
        sector: 'Sector Inexistente',
        subindustry: null,
        name: 'X',
        domain: 'x.com',
        url: 'https://x.com',
        linkedinUrl: null,
      }).outcome,
      'sector_not_mapped',
    );
  });
});

// ── §10 Observabilidad: ausencias como null, nunca 0 ─────────────────────────

describe('§10 observabilidad económica', () => {
  it('toda ausencia queda null — nunca un 0 inventado', () => {
    const observability = buildApolloSpendObservability({});
    for (const [field, value] of Object.entries(observability)) {
      if (field === 'observability_version') continue;
      assert.equal(value, null, `${field} debería ser null cuando no se midió`);
    }
  });

  it('un 0 real se conserva y se distingue de la ausencia', () => {
    const observability = buildApolloSpendObservability({
      rateLimit: {
        minute: { window: 'minute', used: 60, remaining: 0, limit: 60 },
        hourly: { window: 'hourly', used: null, remaining: null, limit: null },
        daily: { window: 'daily', used: null, remaining: null, limit: null },
        retryAfterSeconds: 30,
        anyHeaderPresent: true,
      },
    });
    assert.equal(observability.rate_limit_minute_remaining, 0, 'cuota agotada = 0 real');
    assert.equal(observability.rate_limit_hourly_remaining, null, 'no informado = null');
    assert.equal(observability.retry_after_seconds, 30);
  });

  it('toObservedNumber no convierte basura en 0', () => {
    assert.equal(toObservedNumber(undefined), null);
    assert.equal(toObservedNumber(null), null);
    assert.equal(toObservedNumber(''), null);
    assert.equal(toObservedNumber('abc'), null);
    assert.equal(toObservedNumber(Number.NaN), null);
    assert.equal(toObservedNumber(Number.POSITIVE_INFINITY), null);
    assert.equal(toObservedNumber(0), 0);
    assert.equal(toObservedNumber('3.5'), 3.5);
  });

  it('cubre todos los campos exigidos por §10', () => {
    const columns = toProviderUsageObservabilityColumns(buildApolloSpendObservability({}));
    for (const field of [
      'http_status',
      'latency_ms',
      'page',
      'per_page',
      'pagination_page',
      'pagination_total_pages',
      'pagination_total_entries',
      'results_returned',
      'rate_limit_minute',
      'rate_limit_minute_remaining',
      'rate_limit_hourly',
      'rate_limit_hourly_remaining',
      'rate_limit_24_hour',
      'rate_limit_24_hour_remaining',
      'retry_after_seconds',
      'billing_state',
      'estimated_credits',
      'recorded_usage_credits',
    ]) {
      assert.ok(field in columns, `falta el campo de observabilidad: ${field}`);
    }
  });

  it('la versión del bloque no se filtra a las columnas', () => {
    const columns = toProviderUsageObservabilityColumns(buildApolloSpendObservability({}));
    assert.ok(!('observability_version' in columns));
  });
});
