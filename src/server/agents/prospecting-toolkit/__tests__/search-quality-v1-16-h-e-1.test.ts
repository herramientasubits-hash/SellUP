/**
 * Tests — Agent 1 v1.16H-E.1 — Negative Memory QA Smoke Exclusion
 *
 * Verifica que candidatos QA/smoke NO contaminen la memoria negativa real.
 * Candidatos reales rechazados siguen bloqueando normalmente.
 * Duplicate guard activo (needs_review) no se relaja.
 *
 * Sin Supabase. Sin red. Fixtures en memoria.
 *
 * F1  — real rejected recent → blocks (negative_memory_rejected_recently)
 * F2  — smoke_test=true rejected recent → no block
 * F3  — qa_only=true rejected recent → no block
 * F4  — do_not_use_for_sales=true rejected recent → no block
 * F5  — do_not_convert=true rejected recent → no block
 * F6  — smoke_type exists rejected recent → no block
 * F7  — logical_cleanup.cleanup_mode=logical_only rejected recent → no block
 * F8  — created_by_script contains 'smoke' rejected recent → no block
 * F9  — mixed: one smoke rejected + one real rejected → real still blocks
 * F10 — only smoke rejected rows → no negative memory block
 * F11 — active candidate (needs_review) still blocks via pending path
 * F12 — qa smoke active candidate (needs_review) → still blocks via pending path
 * F13 — qa_cleanup metadata (legacy pattern) → no block (regression)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCandidateNovelty,
  isQaOrSmokeCandidateForNegativeMemory,
  type NoveltyIndex,
} from '../novelty-checker';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

type RowOverrides = {
  status: string;
  reviewed_at?: string | null;
  updated_at?: string | null;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
};

function makeRow(overrides: RowOverrides) {
  return {
    id: 'test-id-001',
    batch_id: 'batch-prev-001',
    name: 'Globant',
    domain: 'globant.com',
    website: 'https://www.globant.com',
    status: overrides.status,
    duplicate_status: 'none',
    reviewed_at: overrides.reviewed_at ?? null,
    updated_at: overrides.updated_at ?? null,
    created_at: overrides.created_at ?? daysAgo(5),
    metadata: overrides.metadata ?? null,
  };
}

function makeIndex(domain: string, rows: ReturnType<typeof makeRow>[]): NoveltyIndex {
  const index: NoveltyIndex = new Map();
  index.set(domain, rows);
  return index;
}

const CANDIDATE = { name: 'Globant', domain: 'globant.com', website: 'https://www.globant.com' };

// ─── F1 — real rejected recent → blocks ──────────────────────────────────────

describe('F1 — candidato real rechazado reciente → bloquea por negative memory', () => {
  it('discarded, reviewed_at=null, updated_at hace 5 días, sin metadata QA → shouldSkip=true', () => {
    const index = makeIndex('globant.com', [
      makeRow({ status: 'discarded', reviewed_at: null, updated_at: daysAgo(5), metadata: {} }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, true, 'Candidato real debe ser bloqueado');
    assert.equal(result.skipReason, 'negative_memory_rejected_recently');
    assert.equal(result.status, 'rejected_recently');
  });

  it('discarded, reviewed_at hace 5 días, sin metadata QA → shouldSkip=true (reviewed_at path)', () => {
    const index = makeIndex('globant.com', [
      makeRow({ status: 'discarded', reviewed_at: daysAgo(5), metadata: {} }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, true);
    assert.equal(result.skipReason, 'rejected_recently');
  });
});

// ─── F2 — smoke_test=true → no block ─────────────────────────────────────────

describe('F2 — smoke_test=true rejected recent → no bloquea', () => {
  it('discarded, reviewed_at=null, metadata.smoke_test=true → shouldSkip=false', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'discarded',
        reviewed_at: null,
        updated_at: daysAgo(5),
        metadata: { smoke_test: true },
      }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false, 'Smoke debe permitirse');
    assert.equal(result.status, 'soft_memory_qa_cleanup');
  });

  it('discarded, reviewed_at set, metadata.smoke_test=true → shouldSkip=false', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'discarded',
        reviewed_at: daysAgo(5),
        metadata: { smoke_test: true },
      }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false, 'Smoke con reviewed_at también debe permitirse');
  });
});

// ─── F3 — qa_only=true → no block ────────────────────────────────────────────

describe('F3 — qa_only=true rejected recent → no bloquea', () => {
  it('discarded, reviewed_at=null, metadata.qa_only=true → shouldSkip=false', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'discarded',
        reviewed_at: null,
        updated_at: daysAgo(5),
        metadata: { qa_only: true },
      }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false);
    assert.equal(result.status, 'soft_memory_qa_cleanup');
  });
});

// ─── F4 — do_not_use_for_sales=true → no block ───────────────────────────────

describe('F4 — do_not_use_for_sales=true rejected recent → no bloquea', () => {
  it('discarded, reviewed_at=null, metadata.do_not_use_for_sales=true → shouldSkip=false', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'discarded',
        reviewed_at: null,
        updated_at: daysAgo(5),
        metadata: { do_not_use_for_sales: true },
      }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false);
    assert.equal(result.status, 'soft_memory_qa_cleanup');
  });
});

// ─── F5 — do_not_convert=true → no block ─────────────────────────────────────

describe('F5 — do_not_convert=true rejected recent → no bloquea', () => {
  it('discarded, reviewed_at=null, metadata.do_not_convert=true → shouldSkip=false', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'discarded',
        reviewed_at: null,
        updated_at: daysAgo(5),
        metadata: { do_not_convert: true },
      }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false);
    assert.equal(result.status, 'soft_memory_qa_cleanup');
  });
});

// ─── F6 — smoke_type exists → no block ───────────────────────────────────────

describe('F6 — smoke_type existe → no bloquea', () => {
  it('discarded, reviewed_at=null, metadata.smoke_type=rich_profile_flow_globant_v1_16h_e → shouldSkip=false', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'discarded',
        reviewed_at: null,
        updated_at: daysAgo(5),
        metadata: { smoke_type: 'rich_profile_flow_globant_v1_16h_e' },
      }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false);
    assert.equal(result.status, 'soft_memory_qa_cleanup');
  });
});

// ─── F7 — logical_cleanup.cleanup_mode=logical_only → no block ───────────────

describe('F7 — logical_cleanup.cleanup_mode=logical_only rejected recent → no bloquea', () => {
  it('discarded, reviewed_at=null, metadata.logical_cleanup.cleanup_mode=logical_only → shouldSkip=false', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'discarded',
        reviewed_at: null,
        updated_at: daysAgo(5),
        metadata: {
          logical_cleanup: { cleanup_mode: 'logical_only', cleaned_at: daysAgo(1) },
          smoke_type: 'rich_profile_flow_globant_v1_16h_e',
        },
      }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false);
    assert.equal(result.status, 'soft_memory_qa_cleanup');
  });

  it('logical_cleanup con cleanup_mode diferente (no logical_only) no activa la exclusión', () => {
    // Sin otras señales QA, no debería excluir
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'discarded',
        reviewed_at: null,
        updated_at: daysAgo(5),
        metadata: { logical_cleanup: { cleanup_mode: 'hard_delete' } },
      }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    // cleanup_mode != 'logical_only' y sin otras señales QA → debe bloquear
    assert.equal(result.shouldSkip, true);
    assert.equal(result.skipReason, 'negative_memory_rejected_recently');
  });
});

// ─── F8 — created_by_script contains 'smoke' → no block ──────────────────────

describe('F8 — created_by_script contiene smoke → no bloquea', () => {
  it('metadata.created_by_script=v1_16h_e_globant_rich_profile_write_smoke → shouldSkip=false', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'discarded',
        reviewed_at: null,
        updated_at: daysAgo(5),
        metadata: { created_by_script: 'v1_16h_e_globant_rich_profile_write_smoke' },
      }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false);
    assert.equal(result.status, 'soft_memory_qa_cleanup');
  });

  it('metadata.created_by_script sin smoke en el nombre → no activa exclusión', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'discarded',
        reviewed_at: null,
        updated_at: daysAgo(5),
        metadata: { created_by_script: 'batch_production_run_v2' },
      }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    // Sin otras señales QA → debe bloquear
    assert.equal(result.shouldSkip, true);
    assert.equal(result.skipReason, 'negative_memory_rejected_recently');
  });
});

// ─── F9 — mixed: smoke + real → real blocks ──────────────────────────────────

describe('F9 — rows mixtos: un smoke rejected + un real rejected → el real sigue bloqueando', () => {
  it('ambas rows → shouldSkip=true (el real real bloquea)', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'discarded',
        reviewed_at: null,
        updated_at: daysAgo(3),
        metadata: { smoke_test: true, qa_only: true },
      }),
      {
        id: 'test-id-real',
        batch_id: 'batch-real-001',
        name: 'Globant Real',
        domain: 'globant.com',
        website: 'https://www.globant.com',
        status: 'discarded',
        duplicate_status: 'none',
        reviewed_at: null,
        updated_at: daysAgo(7),
        created_at: daysAgo(10),
        metadata: {}, // sin señales QA
      },
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, true, 'La row real debe seguir bloqueando');
    assert.equal(result.skipReason, 'negative_memory_rejected_recently');
  });
});

// ─── F10 — solo smoke rejected rows → no block ───────────────────────────────

describe('F10 — solo rows smoke rejected → no bloquea', () => {
  it('tres rows smoke con diferentes señales → shouldSkip=false', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'discarded',
        reviewed_at: null,
        updated_at: daysAgo(2),
        metadata: { smoke_test: true, qa_only: true, do_not_use_for_sales: true, do_not_convert: true },
      }),
      {
        id: 'test-id-smoke-2',
        batch_id: 'batch-smoke-002',
        name: 'Globant',
        domain: 'globant.com',
        website: 'https://www.globant.com',
        status: 'discarded',
        duplicate_status: 'none',
        reviewed_at: null,
        updated_at: daysAgo(10),
        created_at: daysAgo(12),
        metadata: { smoke_type: 'rich_profile_flow_v1_15_8_pre', created_by_script: 'v1_15_8_smoke_run' },
      },
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false, 'Solo smokes → debe permitir');
    assert.equal(result.status, 'soft_memory_qa_cleanup');
  });
});

// ─── F11 — active candidate (needs_review) still blocks ──────────────────────

describe('F11 — candidato activo (needs_review) sin smoke → sigue bloqueando via pending path', () => {
  it('needs_review, reviewed_at=null, created_at hace 5 días, sin metadata QA → shouldSkip=true', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'needs_review',
        reviewed_at: null,
        created_at: daysAgo(5),
        metadata: {},
      }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, true, 'Candidato activo debe seguir bloqueando');
    assert.equal(result.skipReason, 'seen_in_previous_batch_recently');
    assert.equal(result.status, 'pending_recent_suggestion');
  });
});

// ─── F12 — qa smoke active candidate still blocks ────────────────────────────

describe('F12 — candidato activo con metadata smoke (needs_review) → sigue bloqueando', () => {
  it('needs_review + smoke metadata → shouldSkip=true (active duplicate guard no se relaja)', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'needs_review',
        reviewed_at: null,
        created_at: daysAgo(5),
        metadata: { smoke_test: true, qa_only: true },
      }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    // La exclusión QA solo aplica a rows con status=discarded.
    // needs_review nunca llega a Regla 4/4a/4b, llega a Regla 5.
    assert.equal(result.shouldSkip, true, 'Candidato activo smoke debe bloquear por Regla 5');
    assert.equal(result.skipReason, 'seen_in_previous_batch_recently');
    assert.equal(result.status, 'pending_recent_suggestion');
  });
});

// ─── F13 — qa_cleanup legacy regression ──────────────────────────────────────

describe('F13 — qa_cleanup metadata (patrón legacy v1.10) → no bloquea (regresión)', () => {
  it('discarded, reviewed_at=null, metadata.qa_cleanup=true → shouldSkip=false', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'discarded',
        reviewed_at: null,
        updated_at: daysAgo(5),
        metadata: { qa_cleanup: true },
      }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false, 'qa_cleanup legacy debe seguir siendo soft memory');
    assert.equal(result.status, 'soft_memory_qa_cleanup');
  });

  it('qa_cleanup legacy no bloquea aunque esté reciente', () => {
    const index = makeIndex('globant.com', [
      makeRow({
        status: 'discarded',
        reviewed_at: null,
        updated_at: daysAgo(1),
        metadata: { qa_cleanup: true },
      }),
    ]);
    const result = evaluateCandidateNovelty(CANDIDATE, index);
    assert.equal(result.shouldSkip, false, 'qa_cleanup muy reciente tampoco debe bloquear');
  });
});

// ─── Pruebas unitarias del helper isQaOrSmokeCandidateForNegativeMemory ───────

describe('isQaOrSmokeCandidateForNegativeMemory — pruebas unitarias del helper', () => {
  function baseRow() {
    return {
      id: 'test',
      batch_id: 'batch-test',
      name: 'TestCo',
      domain: 'testco.com',
      website: null,
      status: 'discarded',
      duplicate_status: 'none',
      reviewed_at: null,
      updated_at: null,
      created_at: daysAgo(5),
    };
  }

  it('metadata null → false', () => {
    assert.equal(isQaOrSmokeCandidateForNegativeMemory({ ...baseRow(), metadata: null }), false);
  });

  it('metadata vacío → false', () => {
    assert.equal(isQaOrSmokeCandidateForNegativeMemory({ ...baseRow(), metadata: {} }), false);
  });

  it('smoke_test=true → true', () => {
    assert.equal(isQaOrSmokeCandidateForNegativeMemory({ ...baseRow(), metadata: { smoke_test: true } }), true);
  });

  it('smoke_test=false → false', () => {
    assert.equal(isQaOrSmokeCandidateForNegativeMemory({ ...baseRow(), metadata: { smoke_test: false } }), false);
  });

  it('qa_only=true → true', () => {
    assert.equal(isQaOrSmokeCandidateForNegativeMemory({ ...baseRow(), metadata: { qa_only: true } }), true);
  });

  it('do_not_use_for_sales=true → true', () => {
    assert.equal(isQaOrSmokeCandidateForNegativeMemory({ ...baseRow(), metadata: { do_not_use_for_sales: true } }), true);
  });

  it('do_not_convert=true → true', () => {
    assert.equal(isQaOrSmokeCandidateForNegativeMemory({ ...baseRow(), metadata: { do_not_convert: true } }), true);
  });

  it('smoke_type string non-empty → true', () => {
    assert.equal(isQaOrSmokeCandidateForNegativeMemory({ ...baseRow(), metadata: { smoke_type: 'test_run' } }), true);
  });

  it('smoke_type empty string → false', () => {
    assert.equal(isQaOrSmokeCandidateForNegativeMemory({ ...baseRow(), metadata: { smoke_type: '' } }), false);
  });

  it('created_by_script con smoke → true', () => {
    assert.equal(
      isQaOrSmokeCandidateForNegativeMemory({
        ...baseRow(),
        metadata: { created_by_script: 'v1_16h_e_globant_rich_profile_write_smoke' },
      }),
      true,
    );
  });

  it('created_by_script sin smoke → false', () => {
    assert.equal(
      isQaOrSmokeCandidateForNegativeMemory({
        ...baseRow(),
        metadata: { created_by_script: 'production_batch_runner' },
      }),
      false,
    );
  });

  it('logical_cleanup.cleanup_mode=logical_only → true', () => {
    assert.equal(
      isQaOrSmokeCandidateForNegativeMemory({
        ...baseRow(),
        metadata: { logical_cleanup: { cleanup_mode: 'logical_only' } },
      }),
      true,
    );
  });

  it('logical_cleanup.cleanup_mode=hard_delete → false', () => {
    assert.equal(
      isQaOrSmokeCandidateForNegativeMemory({
        ...baseRow(),
        metadata: { logical_cleanup: { cleanup_mode: 'hard_delete' } },
      }),
      false,
    );
  });

  it('logical_cleanup=null → false', () => {
    assert.equal(
      isQaOrSmokeCandidateForNegativeMemory({
        ...baseRow(),
        metadata: { logical_cleanup: null },
      }),
      false,
    );
  });
});
