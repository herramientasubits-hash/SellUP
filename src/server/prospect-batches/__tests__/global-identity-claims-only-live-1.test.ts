/**
 * AGENT1-CLAIMS-ONLY-LIVE-CANDIDATES-1 — sólo una fila VIVA ocupa señales
 * globales de identidad.
 *
 * El defecto, medido en Producción el 2026-09-29 (Perú × Salud, lote
 * `701ffe78`): World Vision Perú se insertó ya como `duplicate` («ya existe en
 * HubSpot») y aun así reclamó su dominio y su LinkedIn. El disparador de la
 * migración 140 sólo libera en un UPDATE de status, y esa fila nunca pasa por
 * él: la empresa quedaba apartada para todos los vendedores, para siempre.
 *
 *   § 1 · qué status pueden reclamar;
 *   § 2 · la lista de status que liberan es la MISMA que la del disparador SQL;
 *   § 3 · Lusha (relectura por id) no reclama filas que no están vivas;
 *   § 4 · Apollo (writer) condiciona el reclamo al status con el que inserta.
 *
 * Cliente Supabase falso: sin red, sin base de datos, sin credenciales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  GLOBAL_IDENTITY_RELEASING_STATUSES,
  isGlobalIdentityClaimableStatus,
} from '@/server/agents/prospecting-toolkit/global-identity-claims';
import { claimGlobalIdentitiesForPersistedCandidates } from '../global-identity-claims-store';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// ─── § 1 ──────────────────────────────────────────────────────────────────────

describe('§ 1 — qué status pueden reclamar', () => {
  for (const live of ['needs_review', 'generated', 'approved', 'converted_to_account']) {
    it(`${live} reclama`, () => assert.equal(isGlobalIdentityClaimableStatus(live), true));
  }
  for (const released of ['duplicate', 'discarded']) {
    it(`🔴 ${released} NO reclama`, () => assert.equal(isGlobalIdentityClaimableStatus(released), false));
  }
  for (const [label, value] of [['null', null], ['undefined', undefined], ['vacío', ''], ['número', 3]] as const) {
    it(`un status ${label} NO reclama (reclamar de más aparta empresas para siempre)`, () =>
      assert.equal(isGlobalIdentityClaimableStatus(value), false));
  }
});

// ─── § 2 ──────────────────────────────────────────────────────────────────────

describe('§ 2 — la misma lista que el disparador de la migración 140', () => {
  it('`IF NEW.status IN (...)` libera exactamente GLOBAL_IDENTITY_RELEASING_STATUSES', () => {
    const sql = readFileSync(
      path.join(REPO_ROOT, 'supabase', 'migrations', '140_agent1_global_company_identity_claims.sql'),
      'utf8',
    ).replace(/--.*$/gm, '');
    const match = sql.match(/IF\s+NEW\.status\s+IN\s*\(([^)]*)\)/i);
    assert.ok(match, 'no encuentro la condición del disparador');
    const fromSql = [...match[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(fromSql, [...GLOBAL_IDENTITY_RELEASING_STATUSES].sort());
  });
});

// ─── § 3 ──────────────────────────────────────────────────────────────────────

type Row = { id: string; name: string; domain: string; status: string };

function lushaClient(rows: Row[]) {
  const rpcCalls: Array<{ p_candidates: Array<{ candidateId: string }> }> = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    }),
    rpc: (_name: string, args: { p_candidates: Array<{ candidateId: string }> }) => {
      rpcCalls.push(args);
      return Promise.resolve({
        data: { claimed_candidate_ids: args.p_candidates.map((c) => c.candidateId), claimed_elsewhere_candidate_ids: [] },
        error: null,
      });
    },
  } as unknown as SupabaseClient;
  return { client, rpcCalls };
}

const row = (id: string, status: string): Row => ({
  id,
  name: `Empresa ${id}`,
  domain: `${id}.com.pe`,
  status,
});

describe('§ 3 — Lusha no reclama filas que no están vivas', () => {
  it('🔴 la fila `duplicate` (World Vision) no viaja a la RPC; la viva sí', async () => {
    const { client, rpcCalls } = lushaClient([row('viva', 'needs_review'), row('worldvision', 'duplicate')]);
    const outcome = await claimGlobalIdentitiesForPersistedCandidates(client, 'b1', ['viva', 'worldvision']);
    assert.equal(outcome.degraded, false);
    assert.equal(rpcCalls.length, 1);
    assert.deepEqual(rpcCalls[0]!.p_candidates.map((c) => c.candidateId), ['viva']);
  });

  it('si ninguna está viva, no se llama a la RPC', async () => {
    const { client, rpcCalls } = lushaClient([row('a', 'duplicate'), row('b', 'discarded')]);
    const outcome = await claimGlobalIdentitiesForPersistedCandidates(client, 'b1', ['a', 'b']);
    assert.equal(rpcCalls.length, 0);
    assert.deepEqual(outcome, { claimedElsewhere: [], degraded: false });
  });
});

// ─── § 4 ──────────────────────────────────────────────────────────────────────

/** Código sin comentarios: nombrar algo en un comentario no es usarlo. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('§ 4 — Apollo reclama sólo si la fila se inserta viva', () => {
  it('`globalClaims` se condiciona a isGlobalIdentityClaimableStatus(completenessAdjustedStatus)', () => {
    const writer = stripComments(
      readFileSync(
        path.join(REPO_ROOT, 'src', 'server', 'agents', 'prospecting-toolkit', 'candidate-writer.ts'),
        'utf8',
      ),
    );
    assert.match(
      writer,
      /const globalClaims\s*=\s*isGlobalIdentityClaimableStatus\(completenessAdjustedStatus\)\s*\?\s*deriveGlobalIdentityClaims\(identityEvidence\)\s*:\s*\[\]/,
    );
    // Y el status es el MISMO con el que se inserta la fila.
    assert.match(writer, /status:\s*completenessAdjustedStatus,/);
  });
});
