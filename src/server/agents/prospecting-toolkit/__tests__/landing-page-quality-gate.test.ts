/**
 * Tests — Source URL Quality Gate: landing page patterns
 *
 * Verifica que URLs con /lp/ y /landing/ sean bloqueadas como landing_page
 * y que homepages corporativas válidas no sean afectadas.
 *
 * Cubre el caso real: https://intive.com/lp/edtech-es que pasó el gate
 * antes de este fix porque /lp/ no estaba en los patrones bloqueados.
 *
 * No red. Completamente determinístico.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySourceUrlQuality,
  isBlockedBySourceUrlQuality,
} from '../source-url-quality-gate';

// ─── LP1: Bloqueo de /lp/ ─────────────────────────────────────────────────────

describe('LP1 — /lp/ path → bloqueado como landing_page', () => {
  it('LP1-a: caso real Intive — /lp/edtech-es → landing_page bloqueada', () => {
    const result = classifySourceUrlQuality('https://intive.com/lp/edtech-es');
    assert.ok(isBlockedBySourceUrlQuality(result), 'URL con /lp/ debe ser bloqueada');
    assert.equal(result.quality, 'landing_page');
  });

  it('LP1-b: /lp/ en posición raíz → bloqueado', () => {
    const result = classifySourceUrlQuality('https://example.com/lp/campaña-colombia');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'landing_page');
  });

  it('LP1-c: /lp/ con subpath → bloqueado', () => {
    const result = classifySourceUrlQuality('https://empresa.com/lp/producto-b2b');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'landing_page');
  });

  it('LP1-d: rankingBonus es negativo para landing_page', () => {
    const result = classifySourceUrlQuality('https://empresa.com/lp/demo');
    assert.ok(result.rankingBonus < 0, `rankingBonus debe ser negativo, got ${result.rankingBonus}`);
  });
});

// ─── LP2: Bloqueo de /landing/ ───────────────────────────────────────────────

describe('LP2 — /landing/ path → bloqueado como landing_page', () => {
  it('LP2-a: /landing/tech-solutions → bloqueado', () => {
    const result = classifySourceUrlQuality('https://vendor.com/landing/tech-solutions');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'landing_page');
  });

  it('LP2-b: /landing/colombia-erp → bloqueado', () => {
    const result = classifySourceUrlQuality('https://saas.co/landing/colombia-erp');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'landing_page');
  });
});

// ─── LP3: Bloqueo de /landing-page/ ─────────────────────────────────────────

describe('LP3 — /landing-page/ path → bloqueado como landing_page', () => {
  it('LP3-a: /landing-page/demo-software → bloqueado', () => {
    const result = classifySourceUrlQuality('https://empresa.com/landing-page/demo-software');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'landing_page');
  });
});

// ─── LP4: Homepages corporativas válidas — NO deben bloquearse ───────────────

describe('LP4 — Homepages corporativas válidas no afectadas por landing page check', () => {
  it('LP4-a: homepage raíz → official_homepage, no bloqueada', () => {
    const result = classifySourceUrlQuality('https://intive.com/');
    assert.ok(!isBlockedBySourceUrlQuality(result), 'Homepage raíz no debe bloquearse');
    assert.equal(result.quality, 'official_homepage');
  });

  it('LP4-b: homepage sin path → official_homepage', () => {
    const result = classifySourceUrlQuality('https://pragma.com.co');
    assert.ok(!isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'official_homepage');
  });

  it('LP4-c: página de producto legítima → no bloqueada', () => {
    const result = classifySourceUrlQuality('https://siesa.com/producto/erp-colombia');
    assert.ok(!isBlockedBySourceUrlQuality(result));
  });

  it('LP4-d: /solutions/ sin /lp/ → no bloqueada como landing', () => {
    const result = classifySourceUrlQuality('https://empresa.com/solutions/erp');
    assert.ok(result.quality !== 'landing_page', 'Página de soluciones no debe ser landing_page');
  });

  it('LP4-e: /platform/ → no bloqueada como landing', () => {
    const result = classifySourceUrlQuality('https://empresa.com/platform');
    assert.ok(result.quality !== 'landing_page');
  });
});

// ─── LP5: reason contiene el path para trazabilidad ─────────────────────────

describe('LP5 — Trazabilidad: reason incluye el path bloqueado', () => {
  it('LP5-a: reason menciona el path al bloquear /lp/edtech-es', () => {
    const result = classifySourceUrlQuality('https://intive.com/lp/edtech-es');
    assert.ok(
      result.reason.includes('/lp/'),
      `reason debe incluir "/lp/", got: "${result.reason}"`,
    );
  });
});
