/**
 * Q3F-5AW.2 (Phase 1) — Aprobación idempotente + update condicional optimista.
 *
 * T1 — isCandidateAlreadyConverted: corte idempotente (status + converted_account_id).
 * T2 — applyOptimisticCandidateConversionUpdate: el UPDATE incluye condición sobre status.
 * T3 — carrera concurrente: 0 filas + relectura convertida → idempotent_success.
 * T4 — carrera incompatible: 0 filas + relectura en estado incompatible → conflicto.
 * T7 — forma de la migración 092 (aditiva, nullable, CHECK NOT VALID, sin unique/backfill/validate).
 *
 * Node built-in test runner. Sin Supabase real, sin Apollo/Tavily/Lusha/HubSpot,
 * sin LLM. El cliente Supabase es un fake in-memory; los helpers usan cliente inyectado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isCandidateAlreadyConverted,
  applyOptimisticCandidateConversionUpdate,
} from '../approval-idempotency';

// ─── T1 — corte idempotente ───────────────────────────────────────────────────

describe('isCandidateAlreadyConverted (T1)', () => {
  it('true cuando status=converted_to_account y converted_account_id presente', () => {
    assert.equal(
      isCandidateAlreadyConverted({ status: 'converted_to_account', converted_account_id: 'acc-1' }),
      true,
    );
  });

  it('false cuando falta converted_account_id aunque el status sea converted', () => {
    assert.equal(
      isCandidateAlreadyConverted({ status: 'converted_to_account', converted_account_id: null }),
      false,
    );
    assert.equal(
      isCandidateAlreadyConverted({ status: 'converted_to_account', converted_account_id: '  ' }),
      false,
    );
  });

  it('false para otros estados y para null/undefined', () => {
    assert.equal(isCandidateAlreadyConverted({ status: 'needs_review', converted_account_id: 'acc-1' }), false);
    assert.equal(isCandidateAlreadyConverted(null), false);
    assert.equal(isCandidateAlreadyConverted(undefined), false);
  });
});

// ─── Fake Supabase para applyOptimisticCandidateConversionUpdate ──────────────

interface ApprovalFakeOpts {
  updateRows: { id: string }[];
  rereadRow: { status?: string | null; converted_account_id?: string | null } | null;
  recorder: { eqCalls: Array<[string, unknown]> };
}

function makeApprovalFakeSupabase(opts: ApprovalFakeOpts): Pick<SupabaseClient, 'from'> {
  const client = {
    from() {
      let updateCalled = false;
      const builder: Record<string, unknown> = {
        update() {
          updateCalled = true;
          return builder;
        },
        eq(col: string, val: unknown) {
          opts.recorder.eqCalls.push([col, val]);
          return builder;
        },
        select() {
          if (updateCalled) {
            // Terminal thenable del chain de UPDATE (await query.select('id')).
            return {
              then(resolve: (v: { data: { id: string }[]; error: null }) => void) {
                resolve({ data: opts.updateRows, error: null });
              },
            };
          }
          // Chain de relectura: select().eq().single()
          return builder;
        },
        single() {
          return Promise.resolve({ data: opts.rereadRow, error: null });
        },
      };
      return builder;
    },
  };
  return client as unknown as Pick<SupabaseClient, 'from'>;
}

// ─── T2 — update condicional optimista sobre status ───────────────────────────

describe('applyOptimisticCandidateConversionUpdate — update condicional (T2)', () => {
  it('aplica la condición .eq("status", expectedStatus) y retorna updated cuando afecta filas', async () => {
    const recorder = { eqCalls: [] as Array<[string, unknown]> };
    const supabase = makeApprovalFakeSupabase({
      updateRows: [{ id: 'cand-1' }],
      rereadRow: null,
      recorder,
    });

    const res = await applyOptimisticCandidateConversionUpdate(supabase, {
      candidateId: 'cand-1',
      expectedStatus: 'needs_review',
      updates: { status: 'converted_to_account', converted_account_id: 'acc-1' },
    });

    assert.equal(res.outcome, 'updated');
    assert.equal(res.statusConditionApplied, true);
    // El query incluyó la condición sobre status esperado
    const hasStatusCond = recorder.eqCalls.some(([c, v]) => c === 'status' && v === 'needs_review');
    assert.ok(hasStatusCond, 'el UPDATE debe condicionar sobre status esperado');
    const hasIdCond = recorder.eqCalls.some(([c, v]) => c === 'id' && v === 'cand-1');
    assert.ok(hasIdCond, 'el UPDATE debe filtrar por id');
  });

  it('no aplica condición de status cuando expectedStatus es null', async () => {
    const recorder = { eqCalls: [] as Array<[string, unknown]> };
    const supabase = makeApprovalFakeSupabase({
      updateRows: [{ id: 'cand-1' }],
      rereadRow: null,
      recorder,
    });
    const res = await applyOptimisticCandidateConversionUpdate(supabase, {
      candidateId: 'cand-1',
      expectedStatus: null,
      updates: { status: 'converted_to_account' },
    });
    assert.equal(res.statusConditionApplied, false);
    assert.equal(recorder.eqCalls.some(([c]) => c === 'status'), false);
  });
});

// ─── T3 — carrera concurrente resuelta idempotentemente ───────────────────────

describe('applyOptimisticCandidateConversionUpdate — carrera concurrente (T3)', () => {
  it('0 filas + relectura convertida → idempotent_success sin segunda cuenta', async () => {
    const recorder = { eqCalls: [] as Array<[string, unknown]> };
    const supabase = makeApprovalFakeSupabase({
      updateRows: [], // otra sesión ya cambió el status
      rereadRow: { status: 'converted_to_account', converted_account_id: 'acc-winner' },
      recorder,
    });

    const res = await applyOptimisticCandidateConversionUpdate(supabase, {
      candidateId: 'cand-1',
      expectedStatus: 'needs_review',
      updates: { status: 'converted_to_account', converted_account_id: 'acc-loser' },
    });

    assert.equal(res.outcome, 'idempotent_success');
    assert.equal(res.accountId, 'acc-winner');
  });
});

// ─── T4 — carrera incompatible → conflicto controlado ─────────────────────────

describe('applyOptimisticCandidateConversionUpdate — carrera incompatible (T4)', () => {
  it('0 filas + relectura en estado incompatible → concurrency_conflict', async () => {
    const recorder = { eqCalls: [] as Array<[string, unknown]> };
    const supabase = makeApprovalFakeSupabase({
      updateRows: [],
      rereadRow: { status: 'rejected', converted_account_id: null },
      recorder,
    });

    const res = await applyOptimisticCandidateConversionUpdate(supabase, {
      candidateId: 'cand-1',
      expectedStatus: 'needs_review',
      updates: { status: 'converted_to_account', converted_account_id: 'acc-loser' },
    });

    assert.equal(res.outcome, 'concurrency_conflict');
    assert.equal(res.accountId, null);
  });

  it('0 filas + candidato inexistente en relectura → concurrency_conflict', async () => {
    const recorder = { eqCalls: [] as Array<[string, unknown]> };
    const supabase = makeApprovalFakeSupabase({
      updateRows: [],
      rereadRow: null,
      recorder,
    });
    const res = await applyOptimisticCandidateConversionUpdate(supabase, {
      candidateId: 'cand-1',
      expectedStatus: 'needs_review',
      updates: { status: 'converted_to_account' },
    });
    assert.equal(res.outcome, 'concurrency_conflict');
  });
});

// ─── T7 — forma de la migración 092 ───────────────────────────────────────────

describe('Migración 092 — forma aditiva segura (T7)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // <root>/src/modules/prospect-batches/__tests__ → subir 4 niveles
  const repoRoot = path.resolve(here, '..', '..', '..', '..');
  const migrationPath = path.join(
    repoRoot,
    'supabase',
    'migrations',
    '092_add_identity_key_to_prospect_candidates.sql',
  );
  const sql = readFileSync(migrationPath, 'utf8');
  // Validar el DDL real, no los comentarios (-- ...). Se eliminan las líneas de
  // comentario para que las palabras usadas en la documentación (unique, accounts,
  // backfill, validate) no produzcan falsos positivos.
  const ddl = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const lower = ddl.toLowerCase();

  it('agrega columna nullable identity_key con IF NOT EXISTS', () => {
    assert.match(lower, /add column if not exists identity_key text/);
    // sin NOT NULL sobre identity_key
    assert.equal(/identity_key text[^\n;]*not null/.test(lower), false);
  });

  it('usa CHECK ... NOT VALID', () => {
    assert.match(lower, /check\s*\(/);
    assert.match(lower, /not valid/);
  });

  it('no crea unique index ni constraint UNIQUE', () => {
    assert.equal(/unique/.test(lower), false);
  });

  it('no hace backfill (sin UPDATE/INSERT de datos)', () => {
    assert.equal(/\bupdate\s+public\./.test(lower), false);
    assert.equal(/\binsert\s+into\b/.test(lower), false);
  });

  it('no valida el constraint (sin VALIDATE CONSTRAINT)', () => {
    assert.equal(/validate\s+constraint/.test(lower), false);
  });

  it('no toca la tabla accounts', () => {
    assert.equal(/\baccounts\b/.test(lower), false);
  });
});
