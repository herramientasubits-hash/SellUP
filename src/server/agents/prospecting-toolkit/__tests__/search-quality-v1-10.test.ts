/**
 * Tests — Search Quality v1.10 — Recall Recovery + Company Name Extraction
 *
 * Verifica que el buscador no bloquea empresas reales cuando Tavily devuelve
 * un título genérico de página en lugar del nombre de empresa, y que la
 * identity memory diferencia entre "memoria negativa real" y "limpieza de QA".
 *
 * Fixtures:
 *   F1:  Heinsohn    — título SEO genérico → inferencia desde dominio → NO bloqueado
 *   F2:  Dinamica CD — título SEO genérico → inferencia desde dominio → NO bloqueado
 *   F3:  TTICol      — slogan genérico     → inferencia desde dominio → NO bloqueado
 *   F4:  SDesk       — título con "en Colombia" → inferencia → NO bloqueado
 *   F5:  GRM /partners — name="Partners" → bloqueado (page_title canonical identity)
 *   F6:  Portal ERP  — sigue bloqueado (external-platform gate — regresión v1.6)
 *   F7:  Capterra/G2/GetApp — siguen bloqueados (external-platform gate — regresión v1.7)
 *   F8:  ACTI        — nombre real → NO bloqueado (regresión)
 *   F9:  Soft memory QA cleanup → NO bloqueado (re-evaluación permitida)
 *   F10: Hard negative memory   → bloqueado (memoria negativa real)
 *
 * Sin Supabase. Sin LLM. Sin Tavily. Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeProspectCompanyName } from '../company-name-normalizer';
import { evaluateCompanyOwnership, isBlockedByCompanyOwnership } from '../company-ownership-gate';
import { buildCanonicalCompanyIdentity } from '../canonical-company-identity';
import { evaluateExternalPlatformGate } from '../external-platform-blocklist';
import { evaluateBusinessFit, isBlockedByBusinessFit } from '../business-fit-gate';
import { evaluateCandidateNovelty } from '../novelty-checker';
import type { NoveltyIndex } from '../novelty-checker';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNoveltyIndex(entries: Array<{
  domain: string;
  status: string;
  reviewedAt: string | null;
  updatedAt: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}>): NoveltyIndex {
  const index: NoveltyIndex = new Map();
  for (const e of entries) {
    const row = {
      id: 'test-id',
      batch_id: 'test-batch',
      name: 'Test',
      domain: e.domain,
      website: `https://${e.domain}`,
      status: e.status,
      duplicate_status: 'no_match',
      reviewed_at: e.reviewedAt,
      updated_at: e.updatedAt,
      created_at: e.createdAt,
      metadata: e.metadata ?? null,
    };
    index.set(e.domain, [row]);
  }
  return index;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

// ─── F1: Heinsohn — título genérico → inferencia desde dominio ───────────────

describe('F1 — Heinsohn: título SEO genérico → inferencia de nombre desde dominio', () => {
  const url = 'https://www.heinsohn.co/co/gestion-humana-y-nomina/software-talento-humano';
  const detectedName = 'Software de talento humano en la nube';

  it('normalizeProspectCompanyName detecta título genérico e infiere "Heinsohn" desde dominio', () => {
    const result = normalizeProspectCompanyName(detectedName, url);
    assert.equal(result.wasNormalized, true, 'Debe normalizar el nombre genérico');
    assert.equal(
      result.normalizationReason,
      'seo_phrase_replaced_by_domain',
      `normalizationReason debe ser seo_phrase_replaced_by_domain, got: ${result.normalizationReason}`,
    );
    assert.equal(result.originalName, detectedName, 'originalName debe preservar el título original');
    assert.equal(
      result.name.toLowerCase(),
      'heinsohn',
      `nombre inferido debe ser heinsohn, got: ${result.name}`,
    );
  });

  it('ownership gate NO bloquea cuando se usa el nombre inferido "Heinsohn"', () => {
    const normResult = normalizeProspectCompanyName(detectedName, url);
    const nameForOwnership = normResult.normalizationReason === 'seo_phrase_replaced_by_domain'
      ? normResult.name
      : detectedName;
    const ownershipResult = evaluateCompanyOwnership(nameForOwnership, url, 'heinsohn.co');
    assert.equal(
      isBlockedByCompanyOwnership(ownershipResult),
      false,
      `Heinsohn no debe quedar bloqueado. confidence: ${ownershipResult.confidence}, reason: ${ownershipResult.reason}`,
    );
    assert.ok(
      ownershipResult.allowed,
      'allowed debe ser true',
    );
  });

  it('ownership gate SÍ bloquea si se usa el título genérico sin inferencia (regresión)', () => {
    const ownershipResult = evaluateCompanyOwnership(detectedName, url, 'heinsohn.co');
    assert.equal(
      isBlockedByCompanyOwnership(ownershipResult),
      true,
      'Sin inferencia, el título genérico debe quedar bloqueado (para confirmar que el fix es necesario)',
    );
  });
});

// ─── F2: Dinamica CD — consultoría ERP genérico → inferencia desde dominio ───

describe('F2 — Dinamica CD: "Consultoría ERP, CRM, HCM" → inferencia desde dominio', () => {
  const url = 'https://dinamicacd.com.co/servicios-de-consultoria/consultoria-erp-crm-hcm';
  const detectedName = 'Consultoría ERP, CRM, HCM';

  it('normalizeProspectCompanyName detecta frase genérica e infiere nombre desde dominio', () => {
    const result = normalizeProspectCompanyName(detectedName, url);
    assert.equal(result.wasNormalized, true, 'Debe normalizar el nombre genérico');
    assert.equal(
      result.normalizationReason,
      'seo_phrase_replaced_by_domain',
      `normalizationReason debe ser seo_phrase_replaced_by_domain, got: ${result.normalizationReason}`,
    );
    assert.ok(
      result.name.toLowerCase().includes('dinamicacd') || result.name.toLowerCase().includes('dinamica'),
      `nombre inferido debe contener "dinamica", got: "${result.name}"`,
    );
  });

  it('ownership gate NO bloquea cuando se usa el nombre inferido desde dominio', () => {
    const normResult = normalizeProspectCompanyName(detectedName, url);
    const nameForOwnership = normResult.normalizationReason === 'seo_phrase_replaced_by_domain'
      ? normResult.name
      : detectedName;
    const ownershipResult = evaluateCompanyOwnership(nameForOwnership, url, 'dinamicacd.com.co');
    assert.equal(
      isBlockedByCompanyOwnership(ownershipResult),
      false,
      `Dinamica CD no debe quedar bloqueado. confidence: ${ownershipResult.confidence}, reason: ${ownershipResult.reason}`,
    );
  });
});

// ─── F3: TTICol — slogan genérico → inferencia desde dominio ─────────────────

describe('F3 — TTICol: "Somos Integradores de Tecnología" → inferencia desde dominio', () => {
  const url = 'https://tticol.com';
  const detectedName = 'Somos Integradores de Tecnología en Espacios Corporativos';

  it('normalizeProspectCompanyName detecta slogan genérico e infiere nombre desde dominio', () => {
    const result = normalizeProspectCompanyName(detectedName, url);
    assert.equal(result.wasNormalized, true, 'Debe normalizar el slogan genérico');
    assert.equal(
      result.normalizationReason,
      'seo_phrase_replaced_by_domain',
      `normalizationReason debe ser seo_phrase_replaced_by_domain, got: ${result.normalizationReason}`,
    );
    // La inferencia devuelve "Tticol" (toTitleCase del dominio sin TLD)
    assert.ok(
      result.name.toLowerCase().startsWith('tticol'),
      `nombre inferido debe comenzar con "tticol", got: "${result.name}"`,
    );
  });

  it('ownership gate NO bloquea cuando se usa el nombre inferido desde dominio', () => {
    const normResult = normalizeProspectCompanyName(detectedName, url);
    const nameForOwnership = normResult.normalizationReason === 'seo_phrase_replaced_by_domain'
      ? normResult.name
      : detectedName;
    const ownershipResult = evaluateCompanyOwnership(nameForOwnership, url, 'tticol.com');
    assert.equal(
      isBlockedByCompanyOwnership(ownershipResult),
      false,
      `TTICol no debe quedar bloqueado. confidence: ${ownershipResult.confidence}, reason: ${ownershipResult.reason}`,
    );
  });
});

// ─── F4: SDesk — "en Colombia" pattern → inferencia desde dominio ─────────────

describe('F4 — SDesk: "Compra de Equipos Corporativos en Colombia" → inferencia desde dominio', () => {
  const url = 'https://sdesk.com.co/compra-equipos-corporativos';
  const detectedName = 'Compra de Equipos Corporativos en Colombia';

  it('normalizeProspectCompanyName detecta frase "en Colombia" e infiere nombre desde dominio', () => {
    const result = normalizeProspectCompanyName(detectedName, url);
    assert.equal(result.wasNormalized, true, 'Debe normalizar el nombre con "en Colombia"');
    assert.equal(
      result.normalizationReason,
      'seo_phrase_replaced_by_domain',
      `normalizationReason debe ser seo_phrase_replaced_by_domain, got: ${result.normalizationReason}`,
    );
    assert.ok(
      result.name.toLowerCase().includes('sdesk'),
      `nombre inferido debe contener "sdesk", got: "${result.name}"`,
    );
  });

  it('ownership gate NO bloquea cuando se usa el nombre inferido "SDesk"', () => {
    const normResult = normalizeProspectCompanyName(detectedName, url);
    const nameForOwnership = normResult.normalizationReason === 'seo_phrase_replaced_by_domain'
      ? normResult.name
      : detectedName;
    const ownershipResult = evaluateCompanyOwnership(nameForOwnership, url, 'sdesk.com.co');
    assert.equal(
      isBlockedByCompanyOwnership(ownershipResult),
      false,
      `SDesk no debe quedar bloqueado. confidence: ${ownershipResult.confidence}, reason: ${ownershipResult.reason}`,
    );
  });
});

// ─── F5: GRM /partners — name="Partners" → bloqueado (page_title) ────────────

describe('F5 — GRM partners: name="Partners" → bloqueado como page_title', () => {
  it('buildCanonicalCompanyIdentity("Partners") → isNonCompanyPhrase: true', () => {
    const result = buildCanonicalCompanyIdentity('Partners');
    assert.equal(
      result.isNonCompanyPhrase,
      true,
      '"Partners" debe ser detectado como page_title / non-company phrase',
    );
    assert.equal(
      result.nonCompanyReason,
      'page_title_not_company_name',
      `nonCompanyReason debe ser page_title_not_company_name, got: ${result.nonCompanyReason}`,
    );
  });

  it('buildCanonicalCompanyIdentity("Partner") → isNonCompanyPhrase: true', () => {
    const result = buildCanonicalCompanyIdentity('Partner');
    assert.equal(result.isNonCompanyPhrase, true, '"Partner" debe ser detectado como page_title');
  });

  it('normalizeProspectCompanyName("Partners") NO infiere desde dominio GRM (Partners no es SEO phrase)', () => {
    const url = 'https://www.grmdocumentmanagement.com/es-co/company/partners';
    const result = normalizeProspectCompanyName('Partners', url);
    // "Partners" alone is NOT an SEO phrase — it's caught earlier by canonical identity gate
    // The point is that domain inference does NOT produce "Grmdocumentmanagement" for this case
    assert.equal(
      result.normalizationReason,
      undefined,
      `"Partners" no debe tener normalizationReason de SEO replacement, got: ${result.normalizationReason}`,
    );
  });
});

// ─── F6: Portal ERP — sigue bloqueado (regresión v1.6) ───────────────────────
// Portal ERP es un portal de noticias/media — bloqueado por business-fit gate (portal_media_aggregator),
// no por external-platform gate (que bloquea directorios de reseñas como Capterra/G2).

describe('F6 — Portal ERP: sigue bloqueado por business-fit gate (regresión v1.6)', () => {
  it('Portal ERP → fit = reject, portal_media_aggregator', () => {
    const result = evaluateBusinessFit({
      name: 'Portal ERP',
      website: 'https://portalerp.com/co',
      domain: 'portalerp.com',
      sourceSnippet:
        'Portal ERP es el mayor portal de noticias, análisis, entrevistas y soluciones de gestión empresarial (ERP, CRM, BI) de América Latina.',
      sourceTitle: 'Portal ERP — Noticias, Análisis y Soluciones ERP — Colombia',
    });
    assert.equal(result.fit, 'reject', `Portal ERP debe quedar rechazado, got fit: ${result.fit}`);
    assert.equal(isBlockedByBusinessFit(result), true, 'isBlockedByBusinessFit debe ser true');
    assert.ok(
      result.reasons.some((r) => r.includes('portal_media_aggregator')),
      `reasons debe incluir portal_media_aggregator, got: ${JSON.stringify(result.reasons)}`,
    );
  });
});

// ─── F7: Capterra / G2 / GetApp — siguen bloqueados (regresión v1.7) ─────────

describe('F7 — Capterra / G2 / GetApp: siguen bloqueados (regresión v1.7)', () => {
  const fixtures = [
    { name: 'Capterra', url: 'https://www.capterra.com/erp-software/' },
    { name: 'G2', url: 'https://www.g2.com/categories/crm' },
    { name: 'GetApp', url: 'https://www.getapp.com/operations-management-software/a/erp/' },
  ];

  for (const { name, url } of fixtures) {
    it(`external-platform gate bloquea ${name}`, () => {
      const result = evaluateExternalPlatformGate(url, name);
      assert.equal(
        result.allowed,
        false,
        `${name} debe quedar bloqueado por external-platform gate`,
      );
    });
  }
});

// ─── F8: ACTI — nombre real → NO bloqueado (regresión) ───────────────────────

describe('F8 — ACTI: nombre real → NO bloqueado', () => {
  const url = 'https://www.acti.com.co';
  const name = 'ACTI';

  it('normalizeProspectCompanyName("ACTI") no normaliza — nombre real corto', () => {
    const result = normalizeProspectCompanyName(name, url);
    assert.equal(result.wasNormalized, false, 'ACTI no debe ser detectado como SEO phrase');
  });

  it('ownership gate permite ACTI (dominio contiene "acti")', () => {
    const ownershipResult = evaluateCompanyOwnership(name, url, 'acti.com.co');
    assert.equal(
      isBlockedByCompanyOwnership(ownershipResult),
      false,
      `ACTI no debe quedar bloqueado. confidence: ${ownershipResult.confidence}`,
    );
    assert.ok(ownershipResult.allowed, 'allowed debe ser true para ACTI');
  });

  it('canonical identity para ACTI → identityKey "acti" sin bloquearse', () => {
    const result = buildCanonicalCompanyIdentity(name);
    assert.equal(result.isNonCompanyPhrase, false, 'ACTI no es una frase genérica');
    assert.equal(result.identityKey, 'acti', `identityKey debe ser "acti", got: ${result.identityKey}`);
  });
});

// ─── F9: Soft memory QA cleanup → re-evaluación permitida ────────────────────

describe('F9 — Soft memory QA cleanup: candidato descartado en batch de prueba → NO bloqueado', () => {
  it('evaluateCandidateNovelty permite re-evaluación si metadata.qa_cleanup = true', () => {
    const mockIndex = makeNoveltyIndex([{
      domain: 'cegid.com',
      status: 'discarded',
      reviewedAt: null,                     // sin revisión real
      updatedAt: daysAgo(10),
      createdAt: daysAgo(15),
      metadata: { qa_cleanup: true },        // limpieza de batch de prueba
    }]);

    const result = evaluateCandidateNovelty(
      { name: 'Cegid', domain: 'cegid.com', website: 'https://www.cegid.com' },
      mockIndex,
    );

    assert.equal(
      result.shouldSkip,
      false,
      'qa_cleanup no debe bloquear el candidato',
    );
    assert.equal(
      result.status,
      'soft_memory_qa_cleanup',
      `status debe ser soft_memory_qa_cleanup, got: ${result.status}`,
    );
  });

  it('soft memory QA cleanup con reviewed_at existente → usa Regla 4 estándar', () => {
    // Si el candidato fue discarded con reviewed_at real (dentro del cooldown),
    // se aplica Regla 4 aunque tenga qa_cleanup en metadata — Regla 4 tiene prioridad.
    const mockIndex = makeNoveltyIndex([{
      domain: 'cegid.com',
      status: 'discarded',
      reviewedAt: daysAgo(5),              // revisado recientemente por humano
      updatedAt: daysAgo(5),
      createdAt: daysAgo(10),
      metadata: { qa_cleanup: true },
    }]);

    const result = evaluateCandidateNovelty(
      { name: 'Cegid', domain: 'cegid.com', website: 'https://www.cegid.com' },
      mockIndex,
    );

    // Regla 4 (reviewed_at dentro del cooldown) tiene prioridad sobre qa_cleanup
    assert.equal(
      result.shouldSkip,
      true,
      'discarded con reviewed_at dentro del cooldown debe seguir bloqueado',
    );
    assert.equal(result.status, 'rejected_recently');
  });
});

// ─── F10: Hard negative memory → sigue bloqueando ────────────────────────────

describe('F10 — Hard negative memory: candidato descartado sin qa_cleanup → bloqueado', () => {
  it('evaluateCandidateNovelty bloquea candidato descartado sin qa_cleanup (dentro de ventana 90d)', () => {
    const mockIndex = makeNoveltyIndex([{
      domain: 'portal-erp.com',
      status: 'discarded',
      reviewedAt: null,                     // sin reviewed_at
      updatedAt: daysAgo(20),               // 20 días — dentro de ventana 90d
      createdAt: daysAgo(25),
      metadata: null,                       // SIN qa_cleanup
    }]);

    const result = evaluateCandidateNovelty(
      { name: 'Portal ERP', domain: 'portal-erp.com', website: 'https://portal-erp.com' },
      mockIndex,
    );

    assert.equal(
      result.shouldSkip,
      true,
      'Candidato descartado sin qa_cleanup debe quedar bloqueado',
    );
    assert.equal(
      result.status,
      'rejected_recently',
      `status debe ser rejected_recently, got: ${result.status}`,
    );
    assert.equal(
      result.skipReason,
      'negative_memory_rejected_recently',
      `skipReason debe ser negative_memory_rejected_recently, got: ${result.skipReason}`,
    );
  });

  it('hard negative memory: discarded con metadata vacío → sigue bloqueado', () => {
    const mockIndex = makeNoveltyIndex([{
      domain: 'capterra.com',
      status: 'discarded',
      reviewedAt: null,
      updatedAt: daysAgo(5),
      createdAt: daysAgo(10),
      metadata: {},                         // metadata vacío sin qa_cleanup
    }]);

    const result = evaluateCandidateNovelty(
      { name: 'Capterra', domain: 'capterra.com', website: 'https://capterra.com' },
      mockIndex,
    );

    assert.equal(result.shouldSkip, true, 'metadata vacío no activa soft memory');
    assert.equal(result.status, 'rejected_recently');
  });
});
