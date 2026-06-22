/**
 * Tests — Search Quality v1.7 (Hito v1.7)
 * Directory / Comparator Fixtures
 *
 * Criterios de aceptación:
 *   F9:  Capterra  → blocked (external-platform: review_site + business-fit: portal_media_aggregator)
 *   F10: G2        → blocked (external-platform: review_site + business-fit: portal_media_aggregator)
 *   F11: GetApp    → blocked (external-platform: review_site)
 *   F12: ComparaSoftware → blocked (external-platform: directory + business-fit: portal_media_aggregator)
 *   F13: Mi-ERP    → NO bloqueado (empresa legítima implementadora Odoo)
 *   F14: Portal ERP → sigue bloqueado (regresión v1.6)
 *   F15: Kondory   → sigue NO bloqueado (regresión v1.5)
 *
 * Sin Supabase. Sin LLM. Sin Tavily. Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateBusinessFit,
  isBlockedByBusinessFit,
} from '../business-fit-gate';
import {
  evaluateExternalPlatformGate,
} from '../external-platform-blocklist';

// ─── F9: Capterra bloqueado ───────────────────────────────────────────────────

describe('F9 — Capterra bloqueado (directorio/review de software)', () => {
  const url = 'https://www.capterra.com/p/erp-software/';
  const fitInput = {
    name: 'Capterra',
    domain: 'capterra.com',
    website: url,
    sourceTitle: 'Mejores software ERP | Capterra',
    sourceSnippet:
      'Compara los mejores sistemas ERP, lee reseñas, precios y funcionalidades para encontrar la solución ideal.',
  };

  it('external-platform gate bloquea capterra.com como review_site', () => {
    const result = evaluateExternalPlatformGate(url);
    assert.equal(result.allowed, false, 'Capterra debe quedar bloqueado por external-platform gate');
    assert.equal(result.platformType, 'review_site');
  });

  it('business-fit gate rechaza Capterra por señal de comparador en snippet (lee reseñas)', () => {
    const result = evaluateBusinessFit(fitInput);
    assert.equal(result.fit, 'reject', `fit debe ser reject, got: ${result.fit}`);
    assert.ok(isBlockedByBusinessFit(result), 'Capterra debe quedar bloqueado');
    assert.ok(
      result.reasons.some((r) => r.includes('portal_media_aggregator')),
      `reasons debe contener portal_media_aggregator, got: ${JSON.stringify(result.reasons)}`,
    );
  });

  it('business-fit gate rechaza Capterra por señal de comparador en title (mejores software)', () => {
    const resultTitleOnly = evaluateBusinessFit({
      ...fitInput,
      sourceSnippet: null,
      sourceTitle: 'Mejores software ERP | Capterra',
    });
    assert.equal(resultTitleOnly.fit, 'reject');
    assert.ok(isBlockedByBusinessFit(resultTitleOnly));
  });
});

// ─── F10: G2 bloqueado ────────────────────────────────────────────────────────

describe('F10 — G2 bloqueado (comparador de software)', () => {
  const url = 'https://www.g2.com/categories/crm';
  const fitInput = {
    name: 'G2',
    domain: 'g2.com',
    website: url,
    sourceTitle: 'Best CRM Software | G2',
    sourceSnippet:
      'Compare CRM software based on user reviews, features, pricing, and market presence.',
  };

  it('external-platform gate bloquea g2.com como review_site', () => {
    const result = evaluateExternalPlatformGate(url);
    assert.equal(result.allowed, false, 'G2 debe quedar bloqueado por external-platform gate');
    assert.equal(result.platformType, 'review_site');
  });

  it('business-fit gate rechaza G2 por señal de reseñas en snippet (user reviews)', () => {
    const result = evaluateBusinessFit(fitInput);
    assert.equal(result.fit, 'reject', `fit debe ser reject, got: ${result.fit}`);
    assert.ok(isBlockedByBusinessFit(result));
    assert.ok(
      result.reasons.some((r) => r.includes('portal_media_aggregator')),
      `reasons debe contener portal_media_aggregator, got: ${JSON.stringify(result.reasons)}`,
    );
  });
});

// ─── F11: GetApp bloqueado ────────────────────────────────────────────────────

describe('F11 — GetApp bloqueado (directorio/review de software)', () => {
  const url = 'https://www.getapp.com/customer-management-software/crm/';

  it('external-platform gate bloquea getapp.com como review_site', () => {
    const result = evaluateExternalPlatformGate(url);
    assert.equal(result.allowed, false, 'GetApp debe quedar bloqueado por external-platform gate');
    assert.equal(result.platformType, 'review_site');
  });

  it('GetApp no debe persistir como candidato (blocked = true)', () => {
    const result = evaluateExternalPlatformGate(url);
    assert.equal(result.allowed, false);
  });
});

// ─── F12: ComparaSoftware bloqueado ──────────────────────────────────────────

describe('F12 — ComparaSoftware bloqueado (directorio/comparador regional)', () => {
  const url = 'https://www.comparasoftware.com/software-erp';
  const fitInput = {
    name: 'ComparaSoftware',
    domain: 'comparasoftware.com',
    website: url,
    sourceTitle: 'Comparativa de Software ERP',
    sourceSnippet:
      'Compara proveedores de software ERP, precios, funcionalidades, reseñas y alternativas.',
  };

  it('external-platform gate bloquea comparasoftware.com como directory', () => {
    const result = evaluateExternalPlatformGate(url);
    assert.equal(result.allowed, false, 'ComparaSoftware debe quedar bloqueado por external-platform gate');
    assert.equal(result.platformType, 'directory');
  });

  it('business-fit gate rechaza ComparaSoftware por señal en snippet (compara proveedores de software)', () => {
    const result = evaluateBusinessFit(fitInput);
    assert.equal(result.fit, 'reject', `fit debe ser reject, got: ${result.fit}`);
    assert.ok(isBlockedByBusinessFit(result));
    assert.ok(
      result.reasons.some((r) => r.includes('portal_media_aggregator')),
      `reasons debe contener portal_media_aggregator, got: ${JSON.stringify(result.reasons)}`,
    );
  });

  it('business-fit gate rechaza ComparaSoftware por señal en title (comparativa de software)', () => {
    const resultTitleOnly = evaluateBusinessFit({
      ...fitInput,
      sourceSnippet: null,
      sourceTitle: 'Comparativa de Software ERP',
    });
    assert.equal(resultTitleOnly.fit, 'reject');
    assert.ok(isBlockedByBusinessFit(resultTitleOnly));
  });
});

// ─── F13: Mi-ERP NO bloqueado (no-regression) ────────────────────────────────

describe('F13 — Mi-ERP NO bloqueado (empresa legítima implementadora Odoo)', () => {
  const url = 'https://www.mi-erp.app';
  const fitInput = {
    name: 'Mi-ERP',
    domain: 'mi-erp.app',
    website: url,
    sourceTitle: 'Mi-ERP — Expertos en Odoo en Colombia | Partner Odoo',
    sourceSnippet:
      'Somos un equipo especializado en consultoría, implementación y desarrollo Odoo. Automatizamos, integramos y escalamos tu operación.',
  };

  it('external-platform gate permite mi-erp.app (no es plataforma externa)', () => {
    const result = evaluateExternalPlatformGate(url);
    assert.equal(result.allowed, true, 'Mi-ERP no debe quedar bloqueado por external-platform gate');
  });

  it('business-fit gate NO rechaza Mi-ERP (implementadora Odoo legítima)', () => {
    const result = evaluateBusinessFit(fitInput);
    assert.ok(
      result.fit !== 'reject',
      `Mi-ERP no debe ser reject, got fit: ${result.fit}, reasons: ${JSON.stringify(result.reasons)}`,
    );
    assert.equal(isBlockedByBusinessFit(result), false, 'Mi-ERP no debe quedar bloqueado');
  });
});

// ─── F14: Portal ERP sigue bloqueado (regresión v1.6) ────────────────────────

describe('F14 — Portal ERP sigue bloqueado (regresión v1.6)', () => {
  it('Portal ERP → fit = reject, portal_media_aggregator', () => {
    const result = evaluateBusinessFit({
      name: 'Portal ERP',
      website: 'https://portalerp.com/co',
      domain: 'portalerp.com',
      sourceSnippet:
        'Portal ERP es el mayor portal de noticias, análisis, entrevistas y soluciones de gestión empresarial (ERP, CRM, BI) de América Latina.',
      sourceTitle: 'Portal ERP — Noticias, Análisis y Soluciones ERP — Colombia',
    });
    assert.equal(result.fit, 'reject');
    assert.ok(isBlockedByBusinessFit(result));
    assert.ok(result.reasons.some((r) => r.includes('portal_media_aggregator')));
  });
});

// ─── F15: Kondory sigue NO bloqueado (regresión v1.5) ────────────────────────

describe('F15 — Kondory sigue NO bloqueado (regresión v1.5)', () => {
  it('Kondory → fit high o medium, isBlockedByBusinessFit = false', () => {
    const result = evaluateBusinessFit({
      name: 'Kondory',
      website: 'https://kondory.com.co/erp-empresarial-colombia',
      domain: 'kondory.com.co',
      sourceSnippet:
        'ERP empresarial para empresas en Colombia plataforma de gestión corporativa clientes B2B',
      sourceTitle: 'ERP Colombia — Kondory Software Empresarial',
    });
    assert.ok(
      result.fit === 'high' || result.fit === 'medium',
      `Kondory debe ser high o medium, got: ${result.fit}`,
    );
    assert.equal(isBlockedByBusinessFit(result), false);
  });

  it('external-platform gate permite kondory.com.co', () => {
    const result = evaluateExternalPlatformGate('https://kondory.com.co/erp-empresarial-colombia');
    assert.equal(result.allowed, true, 'Kondory no debe quedar bloqueado por external-platform gate');
  });
});
