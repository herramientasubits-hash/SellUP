/**
 * Tests de hipótesis — Señales de empresa Apollo vs Sector Gate (L2.12-A)
 *
 * Sin llamadas reales a Apollo. Usa fixtures de respuestas reales observadas
 * (PwC, Citigroup, Huawei, Politécnico, Platzi, CognosOnline).
 *
 * Hipótesis cubiertas:
 *   H1 — Apollo trae `industry`        → gate lo lee directamente
 *   H2 — Apollo trae `keywords`        → gate los lee desde metadata.keywords
 *   H3 — Apollo trae `short_description` → gate la lee desde metadata
 *   H4 — Apollo solo trae name + domain → sin evidencia sectorial → rechazado
 *   H5 — Señal solo en query tags enviados → no ayuda al gate (tags ≠ response)
 *   H6 — employee_ranges filtra correctamente por tamaño
 *   H7 — Tags cortos (lms, edtech) vs frases largas vs corporativo:
 *         comportamiento esperado del gate post-API
 *   H8 — Gate distingue educación general vs formación corporativa (L2.12-A):
 *         Politécnico FALLA gate estricto; Platzi y CognosOnline PASAN.
 *         PwC, Citigroup y Huawei SIGUEN rechazados.
 *
 * Estas hipótesis guían qué payload variant usar en el próximo QA real.
 * Ver: __tests__/fixtures/apollo-payload-variants-qa.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyApolloSectorRelevanceGate } from '../apollo-sector-relevance-gate';
import type { WebSearchResult } from '../types';
import {
  FIXTURE_PWC,
  FIXTURE_CITIGROUP,
  FIXTURE_HUAWEI,
  FIXTURE_POLITECNICO,
  FIXTURE_POLITECNICO_CORP,
  FIXTURE_PLATZI,
  FIXTURE_COGNOS,
  FIXTURE_BARE_NAME_DOMAIN,
  FIXTURE_DESCRIPTION_ONLY,
  FIXTURE_INDUSTRY_ONLY,
  FIXTURE_LARGE_WITH_KEYWORDS,
} from './fixtures/apollo-org-real-responses';
import type { ApolloOrganization } from '@/server/integrations/apollo-client';

// ─── Helper: convierte ApolloOrganization fixture → WebSearchResult ───────────
//
// Simula el mapeo que hace apollo-organizations-search-provider.ts
// antes de pasar resultados al sector gate.

function orgToResult(org: ApolloOrganization): WebSearchResult {
  const url = org.website_url ?? `https://${org.primary_domain ?? 'unknown.com'}`;
  return {
    title: org.name ?? 'Unknown',
    url,
    snippet: org.short_description ?? `Empresa: ${org.name}`,
    source: 'apollo_organizations',
    rank: 1,
    provider: 'apollo_organizations',
    confidence: 0.85,
    metadata: {
      apollo_organization_id: org.id,
      domain: org.primary_domain ?? null,
      website: url,
      industry: org.industry ?? null,
      employee_count: org.employee_count ?? null,
      country: org.country ?? null,
      linkedin_url: org.linkedin_url ?? null,
      keywords: org.keywords,
      short_description: org.short_description ?? null,
      source_provider: 'apollo',
      source_key: 'apollo_organizations',
      source_type: 'structured_company_database',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// H1 — industry como señal sectorial (gate genérico 'Educación')
// ─────────────────────────────────────────────────────────────────────────────

describe('H1 — industry como señal sectorial (gate genérico Educación)', () => {
  it('Politécnico: industry="higher education" → pasa gate genérico Educación', () => {
    // Con el gate genérico 'Educación' (sin subindustria), una universidad
    // legítimamente pasa: ES una empresa educativa.
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_POLITECNICO)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 1,
      'Politécnico pasa gate genérico Educación: "higher education" contiene "education"');
    assert.equal(result.metadata.subindustry_signal_used, false);
  });

  it('PwC: industry="accounting" → rechazado por gate genérico Educación', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_PWC)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0, 'PwC: sin señales educativas');
    assert.equal(result.metadata.rejected_samples[0].name, 'PwC');
  });

  it('Citigroup: industry="banking" → rechazado por gate genérico Educación', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_CITIGROUP)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0);
  });

  it('Huawei: industry="telecommunications" → rechazado por gate genérico Educación', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_HUAWEI)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H2 — keywords de empresa como señal sectorial
// ─────────────────────────────────────────────────────────────────────────────

describe('H2 — keywords de empresa como señal sectorial', () => {
  it('Platzi: keywords incluye "e-learning", "lms" → pasa gate genérico Educación', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_PLATZI)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 1, 'Platzi: e-learning y lms en keywords');
    const sample = result.metadata.passed_samples[0];
    assert.ok(
      sample.matched_terms.some(t => ['e-learning', 'lms', 'edtech'].includes(t)),
      `Esperaba e-learning/lms/edtech, got: ${sample.matched_terms.join(', ')}`,
    );
  });

  it('CognosOnline: keywords incluye "lms", "corporate training" → pasa gate', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_COGNOS)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 1, 'CognosOnline: lms + corporate training');
  });

  it('empresa large_with_keywords: keywords=[banking, digital transformation] → rechazada', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_LARGE_WITH_KEYWORDS)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0, 'BancoAndes: sin señal educativa en keywords');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H3 — short_description como señal sectorial
// ─────────────────────────────────────────────────────────────────────────────

describe('H3 — short_description como señal sectorial', () => {
  it('FIXTURE_DESCRIPTION_ONLY: description menciona "capacitación corporativa" → pasa gate', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_DESCRIPTION_ONLY)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 1,
      '"capacitacion" y "training" en description son señales educativas');
  });

  it('PwC: description con "audit, tax, advisory" → rechazado', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_PWC)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0, 'PwC: sin señal educativa en description');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H4 — Apollo solo trae name + domain
// ─────────────────────────────────────────────────────────────────────────────

describe('H4 — solo name + domain (campos mínimos)', () => {
  it('FIXTURE_BARE_NAME_DOMAIN: sin industry, keywords ni description → rechazado', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_BARE_NAME_DOMAIN)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0,
      'Sin evidencia sectorial → rechazado. Apollo debe enriquecer keywords/description.');
    assert.equal(result.metadata.rejected_samples[0].reason, 'insufficient_sector_evidence');
  });

  it('FIXTURE_INDUSTRY_ONLY: solo industry="staffing and recruiting" → rechazado', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_INDUSTRY_ONLY)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0, 'staffing sin señal educativa → rechazado');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H5 — query tags enviados vs señales en la respuesta
// ─────────────────────────────────────────────────────────────────────────────

describe('H5 — query tags enviados vs señales en la respuesta', () => {
  it('Gate ignora qué tags enviamos: solo evalúa lo que Apollo devuelve', () => {
    const resultBad = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_CITIGROUP)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(resultBad.passed.length, 0,
      'Citigroup rechazado aunque enviemos tags de lms/e-learning');

    const resultGood = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_PLATZI)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(resultGood.passed.length, 1,
      'Platzi pasa porque su respuesta tiene señales educativas');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H6 — employee ranges
// ─────────────────────────────────────────────────────────────────────────────

describe('H6 — employee ranges como filtro de relevancia', () => {
  it('PwC (364k) sería excluido por range Y rechazado por gate educación', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_PWC)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0);
    assert.ok((FIXTURE_PWC.employee_count ?? 0) > 100000, 'PwC > 100k empleados');
  });

  it('Politécnico (2800) pasaría range 500-10000 y pasa gate genérico', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_POLITECNICO)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 1, 'Politécnico pasa gate genérico educación');
    assert.ok((FIXTURE_POLITECNICO.employee_count ?? 0) < 10000, 'Politécnico < 10k empleados');
  });

  it('Huawei (207k) sería excluido por range Y rechazado por gate', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_HUAWEI)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H7 — tags cortos vs frases largas: señales en respuesta Apollo
// ─────────────────────────────────────────────────────────────────────────────

describe('H7 — tags cortos vs frases largas: señales en respuesta Apollo', () => {
  it('"lms" (tag corto) es señal suficiente para gate genérico', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_COGNOS)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 1, 'lms es señal educativa suficiente');
  });

  it('"edtech" es señal suficiente para gate genérico', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_PLATZI)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 1, 'edtech es señal educativa suficiente');
  });

  it('"corporate training" (frase larga) es señal suficiente', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_COGNOS)],
      'Educación',
      'apollo_organizations',
    );
    assert.equal(result.passed.length, 1);
  });

  it('Mix real [Platzi, CognosOnline, PwC, Citigroup, Huawei] → 2/5 pasan gate genérico', () => {
    const mixed = [
      FIXTURE_PLATZI, FIXTURE_COGNOS,
      FIXTURE_PWC, FIXTURE_CITIGROUP, FIXTURE_HUAWEI,
    ].map(orgToResult);

    const result = applyApolloSectorRelevanceGate(mixed, 'Educación', 'apollo_organizations');
    assert.equal(result.passed.length, 2, 'Solo Platzi y CognosOnline pasan gate genérico');
    assert.equal(result.metadata.rejected_count, 3);
    const passedNames = result.passed.map(r => r.title).sort();
    assert.deepEqual(passedNames, ['CognosOnline', 'Platzi']);
  });

  it('Mix con Politécnico y gate genérico → Politécnico pasa (es educación)', () => {
    const mix = [FIXTURE_POLITECNICO, FIXTURE_PWC, FIXTURE_CITIGROUP].map(orgToResult);
    const result = applyApolloSectorRelevanceGate(mix, 'Educación', 'apollo_organizations');
    assert.equal(result.passed.length, 1);
    assert.equal(result.passed[0].title, 'Politécnico Grancolombiano');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H8 — Gate distingue educación general vs formación corporativa (L2.12-A)
//
// Caso wizard: País=Colombia, Sector=Educación, Subindustria=Formación Corporativa.
// Criterio de aceptación:
//   - Platzi      → PASA   (edtech, online learning, lms en keywords)
//   - CognosOnline → PASA  (lms, corporate training, e-learning en keywords)
//   - Politécnico → FALLA  (solo higher education / university — no corp training)
//   - Politécnico + unidad corporativa → PASA (formacion corporativa explícita)
//   - PwC         → FALLA
//   - Citigroup   → FALLA
//   - Huawei      → FALLA
// ─────────────────────────────────────────────────────────────────────────────

describe('H8 — Gate estricto formación corporativa (subindustry=formación corporativa)', () => {
  const SECTOR = 'Educación';
  const SUBINDUSTRY = 'formación corporativa';

  it('metadata.subindustry_signal_used=true cuando subindustria tiene mapping', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_PLATZI)],
      SECTOR,
      'apollo_organizations',
      SUBINDUSTRY,
    );
    assert.equal(result.metadata.subindustry_signal_used, true,
      'Debe usar señales de subindustria, no del sector padre');
    assert.equal(result.metadata.subindustry, SUBINDUSTRY);
  });

  it('Platzi: keywords [edtech, online learning, lms] → PASA gate formación corporativa', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_PLATZI)],
      SECTOR,
      'apollo_organizations',
      SUBINDUSTRY,
    );
    assert.equal(result.passed.length, 1, 'Platzi debe pasar: edtech + online learning + lms');
    const sample = result.metadata.passed_samples[0];
    assert.ok(
      sample.matched_terms.some(t => ['lms', 'e-learning', 'edtech', 'online learning'].includes(t)),
      `Esperaba lms/e-learning/edtech/online learning, got: ${sample.matched_terms.join(', ')}`,
    );
  });

  it('CognosOnline: keywords [lms, e-learning, corporate training] → PASA gate formación corporativa', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_COGNOS)],
      SECTOR,
      'apollo_organizations',
      SUBINDUSTRY,
    );
    assert.equal(result.passed.length, 1, 'CognosOnline: lms + corporate training son señales suficientes');
    const sample = result.metadata.passed_samples[0];
    assert.ok(
      sample.matched_terms.some(t => ['lms', 'corporate training', 'e-learning'].includes(t)),
    );
  });

  it('Politécnico (solo higher education): keywords académicas → FALLA gate formación corporativa', () => {
    // El Politécnico pasa el gate GENÉRICO de Educación (es una universidad válida),
    // pero con subindustria=formación corporativa es rechazado porque sus keywords
    // son académicas (higher education, university) sin señal de LMS/corp training.
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_POLITECNICO)],
      SECTOR,
      'apollo_organizations',
      SUBINDUSTRY,
    );
    assert.equal(result.passed.length, 0,
      'Politécnico FALLA gate formación corporativa: sus keywords son académicas, no corporativas');
    assert.equal(result.metadata.rejected_samples[0].name, 'Politécnico Grancolombiano');
    assert.equal(result.metadata.rejected_samples[0].reason, 'insufficient_sector_evidence');
  });

  it('Politécnico SOLO pasa si tiene señal explícita de formación corporativa', () => {
    // FIXTURE_POLITECNICO_CORP tiene "formacion corporativa" y "corporate training"
    // en keywords y descripción — representa la unidad B2B del Politécnico.
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_POLITECNICO_CORP)],
      SECTOR,
      'apollo_organizations',
      SUBINDUSTRY,
    );
    assert.equal(result.passed.length, 1,
      'Politécnico con señal explícita de formación corporativa SÍ pasa');
    const sample = result.metadata.passed_samples[0];
    assert.ok(
      sample.matched_terms.some(t =>
        ['formacion corporativa', 'corporate training', 'lms'].includes(t),
      ),
      `Esperaba formacion corporativa/corporate training/lms, got: ${sample.matched_terms.join(', ')}`,
    );
  });

  it('PwC → FALLA gate formación corporativa', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_PWC)],
      SECTOR,
      'apollo_organizations',
      SUBINDUSTRY,
    );
    assert.equal(result.passed.length, 0, 'PwC: sin señal de formación corporativa');
  });

  it('Citigroup → FALLA gate formación corporativa', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_CITIGROUP)],
      SECTOR,
      'apollo_organizations',
      SUBINDUSTRY,
    );
    assert.equal(result.passed.length, 0, 'Citigroup: sin señal de formación corporativa');
  });

  it('Huawei → FALLA gate formación corporativa', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_HUAWEI)],
      SECTOR,
      'apollo_organizations',
      SUBINDUSTRY,
    );
    assert.equal(result.passed.length, 0, 'Huawei: sin señal de formación corporativa');
  });

  it('Mix completo: [Platzi, CognosOnline, Politécnico, PwC, Citigroup, Huawei] → 2/6 pasan', () => {
    const mixed = [
      FIXTURE_PLATZI,
      FIXTURE_COGNOS,
      FIXTURE_POLITECNICO, // <-- falla gate estricto aunque pasaría el genérico
      FIXTURE_PWC,
      FIXTURE_CITIGROUP,
      FIXTURE_HUAWEI,
    ].map(orgToResult);

    const result = applyApolloSectorRelevanceGate(
      mixed,
      SECTOR,
      'apollo_organizations',
      SUBINDUSTRY,
    );

    assert.equal(result.passed.length, 2,
      'Solo Platzi y CognosOnline pasan gate estricto formación corporativa');
    assert.equal(result.metadata.rejected_count, 4,
      'Politécnico, PwC, Citigroup y Huawei rechazados');

    const passedNames = result.passed.map(r => r.title).sort();
    assert.deepEqual(passedNames, ['CognosOnline', 'Platzi'],
      'Politécnico rechazado por gate formación corporativa a pesar de ser institución educativa');
  });

  it('Mix con Politécnico_CORP → 3/6 pasan (Platzi + CognosOnline + Politécnico con señal explícita)', () => {
    const mixed = [
      FIXTURE_PLATZI,
      FIXTURE_COGNOS,
      FIXTURE_POLITECNICO_CORP, // <-- variante con formación corporativa explícita
      FIXTURE_PWC,
      FIXTURE_CITIGROUP,
      FIXTURE_HUAWEI,
    ].map(orgToResult);

    const result = applyApolloSectorRelevanceGate(
      mixed,
      SECTOR,
      'apollo_organizations',
      SUBINDUSTRY,
    );

    assert.equal(result.passed.length, 3,
      'Politécnico con señal corporativa explícita también pasa');
    const passedNames = result.passed.map(r => r.title).sort();
    assert.deepEqual(passedNames, ['CognosOnline', 'Platzi', 'Politécnico Grancolombiano']);
  });

  it('Metadata: gate genérico NO usa subindustry_signal', () => {
    const generic = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_PLATZI)],
      SECTOR,
      'apollo_organizations',
      // sin subindustry
    );
    assert.equal(generic.metadata.subindustry_signal_used, false);
    assert.equal(generic.metadata.subindustry, null);

    const strict = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_PLATZI)],
      SECTOR,
      'apollo_organizations',
      SUBINDUSTRY,
    );
    assert.equal(strict.metadata.subindustry_signal_used, true);
    assert.equal(strict.metadata.subindustry, SUBINDUSTRY);
  });

  it('Subindustria sin mapping → fallback a señales de sector (passthrough si sector tampoco mapeado)', () => {
    const result = applyApolloSectorRelevanceGate(
      [orgToResult(FIXTURE_PLATZI)],
      'Tecnología',            // sector sin mapping
      'apollo_organizations',
      'subindustria-inexistente', // subindustria sin mapping
    );
    // Sin mapping en subindustria ni sector → passthrough (backward compatible)
    assert.equal(result.metadata.enabled, false);
    assert.equal(result.metadata.strategy, 'passthrough');
    assert.equal(result.metadata.subindustry_signal_used, false);
    assert.equal(result.passed.length, 1, 'Passthrough: todos pasan');
  });
});
