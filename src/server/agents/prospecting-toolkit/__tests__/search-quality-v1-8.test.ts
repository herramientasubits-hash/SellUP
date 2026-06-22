/**
 * Tests — Search Quality v1.8 (Agent 1 v1.8)
 * Source Catalog vs Search Strategy Separation
 *
 * Criterios de aceptación:
 *   S1: CO + Tecnología + Software Empresarial (sin fintech)
 *       - Fedesoft → sector_signal
 *       - co_software_empresarial → en sourceGuidedQuerySeeds (virtual intent)
 *       - RUES → legal_registry, allowedForDiscovery=false
 *       - Personas Jurídicas → legal_registry, allowedForDiscovery=false
 *       - SECOP → blocked_from_discovery
 *       - ANDICOM → contextual_signal, allowedForDiscovery=false
 *       - Colombia Fintech → blocked_from_discovery (sin señal fintech)
 *       - SIIS → enrichment_only, allowedForDiscovery=false
 *       - sourceGuidedQuerySeeds NO contiene co_rues, co_personas_juridicas_cc
 *       - sourceGuidedQuerySeeds NO contiene co_colombia_fintech (sin señal fintech)
 *
 *   S2: CO + Tecnología + Fintech (subindustria fintech)
 *       - Colombia Fintech → sector_signal (activada por señal fintech)
 *       - co_colombia_fintech en sourceGuidedQuerySeeds
 *       - RUES sigue legal_registry
 *       - SIIS sigue enrichment_only
 *
 *   S3: CO + Tecnología + criterio B2G/gobierno
 *       - co_secop2_proveedores → sector_signal (B2G condicional)
 *       - co_secop2 sigue blocked_from_discovery (not_for_ai_flow)
 *       - RUES sigue legal_registry
 *
 *   S4: Metadata / estructura de estrategia
 *       - strategy.version === 'search_strategy_v1_8'
 *       - source_decisions tiene entries con reason
 *       - sourceGuidedQuerySeeds no contiene fuentes validation_only/enrichment_only/legal_registry
 *
 *   S5: Integración con search-planner — buildSearchPlan incluye searchStrategy
 *
 * Sin Supabase. Sin LLM. Sin Tavily. Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSearchStrategyFromCatalog,
  detectFintechSignal,
  detectB2GSignal,
} from '../search-strategy-builder';
import { buildSearchPlan } from '../search-planner';

// ─── S1: CO + Tecnología + Software Empresarial (sin fintech) ─────────────────

describe('S1 — CO + Tecnología + Software Empresarial (sin señal fintech)', () => {
  const strategy = buildSearchStrategyFromCatalog({
    countryCode: 'CO',
    country: 'Colombia',
    industry: 'Tecnología',
    subindustries: ['Software Empresarial (SaaS / ERP / CRM)', 'Edtech: Plataformas de Aprendizaje'],
    additionalCriteria: 'Empresas B2B en Colombia con operación real verificable',
  });

  it('strategy.version es search_strategy_v1_8', () => {
    assert.equal(strategy.version, 'search_strategy_v1_8');
  });

  it('co_fedesoft → sector_signal (señal sectorial tech/software)', () => {
    const dec = strategy.sourceDecisions.find((d) => d.sourceKey === 'co_fedesoft');
    assert.ok(dec, 'co_fedesoft debe tener decisión en la estrategia');
    assert.equal(dec!.role, 'sector_signal', `co_fedesoft debe ser sector_signal, got: ${dec!.role}`);
  });

  it('co_fedesoft.allowedForDiscovery es false (pausada upstream)', () => {
    const dec = strategy.sourceDecisions.find((d) => d.sourceKey === 'co_fedesoft');
    assert.equal(dec!.allowedForDiscovery, false, 'Fedesoft pausada no permite discovery directo');
  });

  it('co_software_empresarial está en sourceGuidedQuerySeeds (virtual intent)', () => {
    assert.ok(
      strategy.queryStrategy.sourceGuidedQuerySeeds.includes('co_software_empresarial'),
      'co_software_empresarial (virtual intent) debe estar en sourceGuidedQuerySeeds',
    );
  });

  it('co_rues → legal_registry (nunca discovery)', () => {
    const dec = strategy.sourceDecisions.find((d) => d.sourceKey === 'co_rues');
    assert.ok(dec, 'co_rues debe tener decisión');
    assert.equal(dec!.role, 'legal_registry', `co_rues debe ser legal_registry, got: ${dec!.role}`);
    assert.equal(dec!.allowedForDiscovery, false);
  });

  it('co_personas_juridicas_cc → legal_registry (nunca discovery)', () => {
    const dec = strategy.sourceDecisions.find((d) => d.sourceKey === 'co_personas_juridicas_cc');
    assert.ok(dec, 'co_personas_juridicas_cc debe tener decisión');
    assert.equal(dec!.role, 'legal_registry', `debe ser legal_registry, got: ${dec!.role}`);
    assert.equal(dec!.allowedForDiscovery, false);
  });

  it('co_siis → enrichment_only (enriquecimiento post-discovery, no discovery)', () => {
    const dec = strategy.sourceDecisions.find((d) => d.sourceKey === 'co_siis');
    assert.ok(dec, 'co_siis debe tener decisión');
    assert.equal(dec!.role, 'enrichment_only', `co_siis debe ser enrichment_only, got: ${dec!.role}`);
    assert.equal(dec!.allowedForDiscovery, false);
  });

  it('co_secop2 → blocked_from_discovery (not_for_ai_flow)', () => {
    const dec = strategy.sourceDecisions.find((d) => d.sourceKey === 'co_secop2');
    assert.ok(dec, 'co_secop2 debe tener decisión');
    assert.equal(dec!.role, 'blocked_from_discovery', `co_secop2 debe estar bloqueado, got: ${dec!.role}`);
  });

  it('co_secop2_proveedores → enrichment_only (sin señal B2G)', () => {
    const dec = strategy.sourceDecisions.find((d) => d.sourceKey === 'co_secop2_proveedores');
    assert.ok(dec, 'co_secop2_proveedores debe tener decisión');
    assert.equal(dec!.role, 'enrichment_only', `sin B2G debe ser enrichment_only, got: ${dec!.role}`);
    assert.equal(dec!.allowedForDiscovery, false);
  });

  it('co_andicom → contextual_signal (no discovery seed)', () => {
    const dec = strategy.sourceDecisions.find((d) => d.sourceKey === 'co_andicom');
    assert.ok(dec, 'co_andicom debe tener decisión');
    assert.equal(dec!.role, 'contextual_signal', `co_andicom debe ser contextual_signal, got: ${dec!.role}`);
    assert.equal(dec!.allowedForDiscovery, false);
  });

  it('co_colombia_fintech → blocked_from_discovery (sin señal fintech)', () => {
    const dec = strategy.sourceDecisions.find((d) => d.sourceKey === 'co_colombia_fintech');
    assert.ok(dec, 'co_colombia_fintech debe tener decisión');
    assert.equal(dec!.role, 'blocked_from_discovery', `sin fintech debe estar bloqueada, got: ${dec!.role}`);
  });

  it('sourceGuidedQuerySeeds no contiene co_rues', () => {
    assert.ok(
      !strategy.queryStrategy.sourceGuidedQuerySeeds.includes('co_rues'),
      'co_rues (legal_registry) no debe aparecer como source-guided seed',
    );
  });

  it('sourceGuidedQuerySeeds no contiene co_personas_juridicas_cc', () => {
    assert.ok(
      !strategy.queryStrategy.sourceGuidedQuerySeeds.includes('co_personas_juridicas_cc'),
      'co_personas_juridicas_cc (legal_registry) no debe aparecer como source-guided seed',
    );
  });

  it('sourceGuidedQuerySeeds no contiene co_siis', () => {
    assert.ok(
      !strategy.queryStrategy.sourceGuidedQuerySeeds.includes('co_siis'),
      'co_siis (enrichment_only) no debe aparecer como source-guided seed',
    );
  });

  it('sourceGuidedQuerySeeds no contiene co_colombia_fintech (sin señal fintech)', () => {
    assert.ok(
      !strategy.queryStrategy.sourceGuidedQuerySeeds.includes('co_colombia_fintech'),
      'co_colombia_fintech sin señal fintech no debe aparecer como source-guided seed',
    );
  });

  it('blockedSourceKeys contiene co_secop2', () => {
    assert.ok(
      strategy.queryStrategy.blockedSourceKeys.includes('co_secop2'),
      'co_secop2 debe estar en blockedSourceKeys',
    );
  });

  it('blockedSourceKeys contiene co_colombia_fintech (sin fintech)', () => {
    assert.ok(
      strategy.queryStrategy.blockedSourceKeys.includes('co_colombia_fintech'),
      'co_colombia_fintech sin señal fintech debe estar en blockedSourceKeys',
    );
  });

  it('fintechSignal es false', () => {
    assert.equal(strategy.fintechSignal, false);
  });

  it('b2gSignal es false', () => {
    assert.equal(strategy.b2gSignal, false);
  });

  it('legal_registry agrupa co_rues y co_personas_juridicas_cc', () => {
    assert.ok(
      strategy.sourceRoles.legal_registry.includes('co_rues'),
      'co_rues debe estar en legal_registry',
    );
    assert.ok(
      strategy.sourceRoles.legal_registry.includes('co_personas_juridicas_cc'),
      'co_personas_juridicas_cc debe estar en legal_registry',
    );
  });

  it('enrichment_only agrupa co_siis', () => {
    assert.ok(
      strategy.sourceRoles.enrichment_only.includes('co_siis'),
      'co_siis debe estar en enrichment_only',
    );
  });

  it('sector_signal agrupa co_fedesoft', () => {
    assert.ok(
      strategy.sourceRoles.sector_signal.includes('co_fedesoft'),
      'co_fedesoft debe estar en sector_signal',
    );
  });
});

// ─── S2: CO + Tecnología + Fintech (señal fintech activa) ────────────────────

describe('S2 — CO + Tecnología + señal fintech activa', () => {
  const strategyFintech = buildSearchStrategyFromCatalog({
    countryCode: 'CO',
    country: 'Colombia',
    industry: 'Tecnología',
    subindustries: ['Fintech: Pagos y Wallets', 'Open Banking'],
    additionalCriteria: null,
  });

  it('co_colombia_fintech → sector_signal (activada por señal fintech)', () => {
    const dec = strategyFintech.sourceDecisions.find((d) => d.sourceKey === 'co_colombia_fintech');
    assert.ok(dec, 'co_colombia_fintech debe tener decisión');
    assert.equal(dec!.role, 'sector_signal', `con fintech debe ser sector_signal, got: ${dec!.role}`);
  });

  it('co_colombia_fintech aparece en sourceGuidedQuerySeeds (señal fintech)', () => {
    assert.ok(
      strategyFintech.queryStrategy.sourceGuidedQuerySeeds.includes('co_colombia_fintech'),
      'co_colombia_fintech debe estar en sourceGuidedQuerySeeds con señal fintech',
    );
  });

  it('co_rues sigue siendo legal_registry con señal fintech', () => {
    const dec = strategyFintech.sourceDecisions.find((d) => d.sourceKey === 'co_rues');
    assert.equal(dec!.role, 'legal_registry');
    assert.equal(dec!.allowedForDiscovery, false);
  });

  it('co_siis sigue siendo enrichment_only con señal fintech', () => {
    const dec = strategyFintech.sourceDecisions.find((d) => d.sourceKey === 'co_siis');
    assert.equal(dec!.role, 'enrichment_only');
  });

  it('fintechSignal es true', () => {
    assert.equal(strategyFintech.fintechSignal, true);
  });

  it('co_colombia_fintech no está en blocked_from_discovery con fintech', () => {
    assert.ok(
      !strategyFintech.sourceRoles.blocked_from_discovery.includes('co_colombia_fintech'),
      'con fintech, co_colombia_fintech no debe estar bloqueada',
    );
  });

  it('sector_signal agrupa co_colombia_fintech y co_fedesoft', () => {
    assert.ok(
      strategyFintech.sourceRoles.sector_signal.includes('co_colombia_fintech'),
      'co_colombia_fintech debe estar en sector_signal con fintech',
    );
    assert.ok(
      strategyFintech.sourceRoles.sector_signal.includes('co_fedesoft'),
      'co_fedesoft debe estar en sector_signal',
    );
  });
});

// ─── S2b: detectFintechSignal — criteria con fintech ─────────────────────────

describe('S2b — detectFintechSignal via additionalCriteria', () => {
  it('detecta fintech en additionalCriteria', () => {
    assert.equal(
      detectFintechSignal([], 'Empresas de pagos digitales y open banking en Colombia'),
      true,
    );
  });

  it('detecta fintech en subindustria', () => {
    assert.equal(
      detectFintechSignal(['Fintech: Pagos y Adquirencia'], null),
      true,
    );
  });

  it('no detecta fintech cuando no hay señal', () => {
    assert.equal(
      detectFintechSignal(['Software Empresarial', 'Edtech'], 'Empresas B2B Colombia'),
      false,
    );
  });
});

// ─── S3: CO + Tecnología + criterio B2G/gobierno ─────────────────────────────

describe('S3 — CO + Tecnología + señal B2G/gobierno', () => {
  const strategyB2G = buildSearchStrategyFromCatalog({
    countryCode: 'CO',
    country: 'Colombia',
    industry: 'Tecnología',
    subindustries: ['Software Empresarial'],
    additionalCriteria: 'Empresas proveedoras del Estado colombiano, B2G, contratación estatal',
  });

  it('co_secop2_proveedores → sector_signal con señal B2G', () => {
    const dec = strategyB2G.sourceDecisions.find((d) => d.sourceKey === 'co_secop2_proveedores');
    assert.ok(dec, 'co_secop2_proveedores debe tener decisión');
    assert.equal(dec!.role, 'sector_signal', `con B2G debe ser sector_signal, got: ${dec!.role}`);
  });

  it('co_secop2 sigue blocked_from_discovery (not_for_ai_flow siempre)', () => {
    const dec = strategyB2G.sourceDecisions.find((d) => d.sourceKey === 'co_secop2');
    assert.equal(dec!.role, 'blocked_from_discovery');
  });

  it('co_rues sigue legal_registry con señal B2G', () => {
    const dec = strategyB2G.sourceDecisions.find((d) => d.sourceKey === 'co_rues');
    assert.equal(dec!.role, 'legal_registry');
  });

  it('b2gSignal es true', () => {
    assert.equal(strategyB2G.b2gSignal, true);
  });

  it('detectB2GSignal detecta contratación estatal', () => {
    assert.equal(detectB2GSignal('Proveedores del Estado, licitacion publica'), true);
  });

  it('detectB2GSignal retorna false cuando no hay señal B2G', () => {
    assert.equal(detectB2GSignal('Empresas B2B Colombia tecnología'), false);
    assert.equal(detectB2GSignal(null), false);
  });
});

// ─── S4: Estructura y metadata de la estrategia ──────────────────────────────

describe('S4 — Estructura y metadata de la estrategia', () => {
  const strategy = buildSearchStrategyFromCatalog({
    countryCode: 'CO',
    country: 'Colombia',
    industry: 'Tecnología',
    subindustries: ['Software Empresarial'],
    additionalCriteria: null,
  });

  it('strategy.version es search_strategy_v1_8', () => {
    assert.equal(strategy.version, 'search_strategy_v1_8');
  });

  it('sourceDecisions es array no vacío', () => {
    assert.ok(Array.isArray(strategy.sourceDecisions));
    assert.ok(strategy.sourceDecisions.length > 0, 'debe haber al menos una decisión de fuente');
  });

  it('cada sourceDecision tiene reason no vacío', () => {
    for (const dec of strategy.sourceDecisions) {
      assert.ok(
        typeof dec.reason === 'string' && dec.reason.length > 0,
        `Decisión ${dec.sourceKey} debe tener reason, got: ${dec.reason}`,
      );
    }
  });

  it('sourceGuidedQuerySeeds no contiene fuentes legal_registry', () => {
    const legalRegistrySources = strategy.sourceRoles.legal_registry;
    for (const key of legalRegistrySources) {
      assert.ok(
        !strategy.queryStrategy.sourceGuidedQuerySeeds.includes(key),
        `${key} (legal_registry) no debe estar en sourceGuidedQuerySeeds`,
      );
    }
  });

  it('sourceGuidedQuerySeeds no contiene fuentes enrichment_only', () => {
    const enrichmentSources = strategy.sourceRoles.enrichment_only;
    for (const key of enrichmentSources) {
      assert.ok(
        !strategy.queryStrategy.sourceGuidedQuerySeeds.includes(key),
        `${key} (enrichment_only) no debe estar en sourceGuidedQuerySeeds`,
      );
    }
  });

  it('sourceGuidedQuerySeeds no contiene fuentes blocked_from_discovery', () => {
    const blockedSources = strategy.sourceRoles.blocked_from_discovery;
    for (const key of blockedSources) {
      assert.ok(
        !strategy.queryStrategy.sourceGuidedQuerySeeds.includes(key),
        `${key} (blocked_from_discovery) no debe estar en sourceGuidedQuerySeeds`,
      );
    }
  });

  it('sourceGuidedQuerySeeds no contiene fuentes manual_signal_only', () => {
    const manualSources = strategy.sourceRoles.manual_signal_only;
    for (const key of manualSources) {
      assert.ok(
        !strategy.queryStrategy.sourceGuidedQuerySeeds.includes(key),
        `${key} (manual_signal_only) no debe estar en sourceGuidedQuerySeeds`,
      );
    }
  });

  it('evidenceRequirements tiene valores correctos', () => {
    assert.equal(strategy.evidenceRequirements.requiresOfficialCompanySite, true);
    assert.equal(strategy.evidenceRequirements.requiresCountryEvidence, true);
    assert.equal(strategy.evidenceRequirements.blocksMediaDirectoriesMarketplaces, true);
    assert.equal(strategy.evidenceRequirements.queryOnlyConfidenceCap, 45);
  });

  it('queryStrategy.fintechGated es true', () => {
    assert.equal(strategy.queryStrategy.fintechGated, true);
  });

  it('queryStrategy.b2gConditional es true', () => {
    assert.equal(strategy.queryStrategy.b2gConditional, true);
  });
});

// ─── S5: Integración con buildSearchPlan ─────────────────────────────────────

describe('S5 — buildSearchPlan incluye searchStrategy v1.8', () => {
  const plan = buildSearchPlan({
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    subindustries: ['Software Empresarial (SaaS / ERP / CRM)', 'Edtech: Plataformas de Aprendizaje'],
    additionalCriteria: 'Empresas B2B Colombia operación real verificable',
  });

  it('plan.searchStrategy existe y tiene version correcta', () => {
    assert.ok(plan.searchStrategy, 'plan.searchStrategy debe existir');
    assert.equal(plan.searchStrategy.version, 'search_strategy_v1_8');
  });

  it('plan.searchStrategy.countryCode es CO', () => {
    assert.equal(plan.searchStrategy.countryCode, 'CO');
  });

  it('plan.searchStrategy mantiene co_rues como legal_registry', () => {
    const dec = plan.searchStrategy.sourceDecisions.find((d) => d.sourceKey === 'co_rues');
    assert.ok(dec);
    assert.equal(dec!.role, 'legal_registry');
  });

  it('plan.sourceStrategy.doNotUseAsPrimary sigue incluyendo RUES (compatibilidad v1.3)', () => {
    assert.ok(
      plan.sourceStrategy.doNotUseAsPrimary.includes('co_rues'),
      'Compatibilidad hacia atrás: co_rues en doNotUseAsPrimary',
    );
  });

  it('plan.metadata.planVersion sigue siendo search_planner_v0 (sin regresión)', () => {
    assert.equal(plan.metadata.planVersion, 'search_planner_v0');
  });
});
