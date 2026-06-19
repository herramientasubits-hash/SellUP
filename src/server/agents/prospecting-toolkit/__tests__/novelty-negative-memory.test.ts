/**
 * Tests — Novelty checker: negative memory (discarded sin reviewed_at)
 *
 * Verifica la Regla 4b: candidatos con status=discarded y reviewed_at=null
 * deben bloquearse usando COALESCE(updated_at, created_at) como fecha de
 * referencia con una ventana de 90 días.
 *
 * Cubre el caso real: Intive (batch c03553b8) — descartado en QA humano
 * pero sin reviewed_at registrado, lo que le permitía pasar el checker.
 *
 * No Supabase. No red. Fixtures en memoria.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCandidateNovelty,
  type NoveltyIndex,
} from '../novelty-checker';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function makeRow(overrides: {
  status: string;
  reviewed_at?: string | null;
  updated_at?: string | null;
  created_at?: string;
}) {
  return {
    id: 'test-id-001',
    batch_id: 'batch-prev-001',
    name: 'TestCo',
    domain: 'testco.com',
    website: 'https://testco.com',
    status: overrides.status,
    duplicate_status: 'none',
    reviewed_at: overrides.reviewed_at ?? null,
    updated_at: overrides.updated_at ?? null,
    created_at: overrides.created_at ?? daysAgo(10),
  };
}

function makeIndex(domain: string, rows: ReturnType<typeof makeRow>[]): NoveltyIndex {
  const index: NoveltyIndex = new Map();
  index.set(domain, rows);
  return index;
}

const CANDIDATE = { name: 'TestCo', domain: 'testco.com', website: 'https://testco.com' };

// ─── NM1: Caso base — discarded con reviewed_at NON-null (Regla 4 original) ──

describe('NM1 — Regla 4 original: discarded con reviewed_at reciente → skip', () => {
  it('NM1-a: discarded, reviewed_at hace 5 días → shouldSkip=true, reason=rejected_recently', () => {
    const index = makeIndex('testco.com', [
      makeRow({ status: 'discarded', reviewed_at: daysAgo(5) }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, true);
    assert.equal(result.skipReason, 'rejected_recently');
    assert.equal(result.status, 'rejected_recently');
  });

  it('NM1-b: discarded, reviewed_at hace 35 días (fuera de 30d) → shouldSkip=false', () => {
    const index = makeIndex('testco.com', [
      makeRow({ status: 'discarded', reviewed_at: daysAgo(35) }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false);
  });
});

// ─── NM2: Fix principal — discarded con reviewed_at=null, updated_at reciente ─

describe('NM2 — Regla 4b: discarded sin reviewed_at → usar updated_at como fallback', () => {
  it('NM2-a: discarded, reviewed_at=null, updated_at hace 10 días → shouldSkip=true', () => {
    const index = makeIndex('testco.com', [
      makeRow({ status: 'discarded', reviewed_at: null, updated_at: daysAgo(10) }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, true, 'Debe bloquear por negative memory');
    assert.equal(result.skipReason, 'negative_memory_rejected_recently');
    assert.equal(result.status, 'rejected_recently');
    assert.ok(
      result.noveltyMetadata.reason.includes('memoria negativa'),
      `reason debe mencionar "memoria negativa", got: "${result.noveltyMetadata.reason}"`,
    );
  });

  it('NM2-b: discarded, reviewed_at=null, updated_at hace 95 días → shouldSkip=false (fuera de 90d)', () => {
    const index = makeIndex('testco.com', [
      makeRow({ status: 'discarded', reviewed_at: null, updated_at: daysAgo(95) }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false, 'Fuera de ventana de 90d → debe permitir');
  });

  it('NM2-c: cooldown_until se calcula desde updated_at + 90 días', () => {
    const index = makeIndex('testco.com', [
      makeRow({ status: 'discarded', reviewed_at: null, updated_at: daysAgo(10) }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.ok(result.noveltyMetadata.cooldown_until !== null, 'cooldown_until debe estar definido');
    const until = new Date(result.noveltyMetadata.cooldown_until!);
    const expected = new Date();
    expected.setDate(expected.getDate() + 80); // 90 - 10 = 80 días desde hoy
    // Tolerancia de ±2 días para evitar flakiness por timing
    const diffDays = Math.abs((until.getTime() - expected.getTime()) / (1000 * 60 * 60 * 24));
    assert.ok(diffDays < 2, `cooldown_until debería ser ~80 días desde hoy, diff=${diffDays.toFixed(1)}d`);
  });
});

// ─── NM3: Fix con fallback a created_at cuando updated_at también es null ────

describe('NM3 — Regla 4b: discarded sin reviewed_at ni updated_at → usar created_at', () => {
  it('NM3-a: discarded, reviewed_at=null, updated_at=null, created_at hace 15 días → skip', () => {
    const index = makeIndex('testco.com', [
      makeRow({ status: 'discarded', reviewed_at: null, updated_at: null, created_at: daysAgo(15) }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, true);
    assert.equal(result.skipReason, 'negative_memory_rejected_recently');
  });

  it('NM3-b: discarded, reviewed_at=null, updated_at=null, created_at hace 100 días → allow', () => {
    const index = makeIndex('testco.com', [
      makeRow({ status: 'discarded', reviewed_at: null, updated_at: null, created_at: daysAgo(100) }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false);
  });
});

// ─── NM4: Caso real — Intive ──────────────────────────────────────────────────

describe('NM4 — Caso real Intive (batch c03553b8)', () => {
  it('NM4-a: Intive discarded sin reviewed_at, updated_at reciente → skip', () => {
    const intive = { name: 'Intive', domain: 'intive.com', website: 'https://intive.com/lp/edtech-es' };
    const index: NoveltyIndex = new Map();
    index.set('intive.com', [
      {
        id: 'candidate-intive-prev',
        batch_id: 'batch-c03553b8',
        name: 'Intive',
        domain: 'intive.com',
        website: 'https://intive.com',
        status: 'discarded',
        duplicate_status: 'none',
        reviewed_at: null,
        updated_at: daysAgo(3),
        created_at: daysAgo(5),
      },
    ]);
    const result = evaluateCandidateNovelty(intive, index);
    assert.equal(result.shouldSkip, true, 'Intive debe ser bloqueado por negative memory');
    assert.equal(result.skipReason, 'negative_memory_rejected_recently');
  });

  it('NM4-b: Intive no visto antes → allow (candidato genuinamente nuevo)', () => {
    const intive = { name: 'Intive', domain: 'intive.com', website: 'https://intive.com' };
    const emptyIndex: NoveltyIndex = new Map();
    const result = evaluateCandidateNovelty(intive, emptyIndex);
    assert.equal(result.shouldSkip, false);
    assert.equal(result.status, 'new_candidate');
  });
});

// ─── NM5: No-regresión — otros estados no afectados por Regla 4b ─────────────

describe('NM5 — No-regresión: estados distintos de discarded no son bloqueados por Regla 4b', () => {
  it('NM5-a: needs_review, reviewed_at=null, updated_at reciente → pendiente (no negative memory)', () => {
    const index = makeIndex('testco.com', [
      makeRow({ status: 'needs_review', reviewed_at: null, updated_at: daysAgo(5) }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    // Debe ser pending_recent_suggestion (Regla 5), no negative_memory
    assert.notEqual(result.skipReason, 'negative_memory_rejected_recently');
  });

  it('NM5-b: approved, reviewed_at=null, updated_at reciente → allow', () => {
    const index = makeIndex('testco.com', [
      makeRow({ status: 'approved', reviewed_at: null, updated_at: daysAgo(2) }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false, 'Candidato aprobado no debe bloquearse');
  });
});
