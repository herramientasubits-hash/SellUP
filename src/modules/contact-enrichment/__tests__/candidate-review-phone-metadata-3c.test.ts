/**
 * Tests — PHONE-3C: persist phone metadata to official contacts.
 *
 * Verifica que, al aprobar un candidato enriquecido, la metadata de teléfono que
 * PHONE-3A conservó en `enrichment_metadata.phone` (tipo/fuente/raw_type,
 * entregada gratis por Apollo search) se copie al contacto oficial SIN revelar
 * teléfonos, SIN llamar proveedores, SIN gastar créditos y SIN hacer el teléfono
 * obligatorio.
 *
 * Cobertura:
 *  - Caso A: candidato con teléfono + metadata → phone_type/source/raw_type se copian.
 *  - Caso B: candidato con teléfono pero sin metadata → phone scalar intacto, tipo/fuente null.
 *  - Caso C: candidato sin teléfono → aprobación NO se bloquea.
 *  - phone_revealed_at / phone_processing_basis quedan null para apollo_search.
 *  - Valores fuera del vocabulario estable → null (defensivo).
 *  - Guards estáticos: no reveal, no botón "Revelar teléfono", no Lusha reveal.
 *  - Migración 094: aditiva, nullable, idempotente, sin backfill, sin NOT NULL.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildContactInsertPayload,
  buildContactPhoneMetadata,
  runApproveCandidate,
  type CandidateRecord,
  type ApproveDeps,
  type ContactInsertPayload,
  type CandidateReviewPatch,
} from '../candidate-review-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

// ── Fixtures ────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    id: 'cand-1',
    status: 'pending_review',
    full_name: 'Ana López',
    first_name: 'Ana',
    last_name: 'López',
    title: 'HR Manager',
    seniority: 'manager',
    department: 'human resources',
    email: 'ana@corp.com',
    phone: '+573001111111',
    linkedin_url: 'https://linkedin.com/in/analopez',
    source: 'apollo',
    enrichment_metadata: {},
    enrichment_run_id: 'run-1',
    account_id: 'acc-1',
    hubspot_company_id: null,
    company_name: null,
    company_domain: null,
    country_code: null,
    ...overrides,
  };
}

function makeApproveDeps(overrides: Partial<ApproveDeps> = {}): {
  deps: ApproveDeps;
  calls: {
    inserted: ContactInsertPayload[];
    updated: { id: string; patch: CandidateReviewPatch }[];
  };
} {
  const calls = {
    inserted: [] as ContactInsertPayload[],
    updated: [] as { id: string; patch: CandidateReviewPatch }[],
  };
  const deps: ApproveDeps = {
    actorId: 'user-1',
    nowIso: '2026-07-23T12:00:00.000Z',
    loadCandidate: async () => makeCandidate(),
    loadExistingContacts: async () => [],
    insertContact: async (payload) => {
      calls.inserted.push(payload);
      return { id: 'contact-new' };
    },
    updateCandidate: async (id, patch) => {
      calls.updated.push({ id, patch });
      return {};
    },
    logAudit: async () => {},
    ...overrides,
  };
  return { deps, calls };
}

// ── buildContactPhoneMetadata (helper puro) ─────────────────────

describe('buildContactPhoneMetadata', () => {
  it('Caso A: copia type/source/raw_type desde enrichment_metadata.phone', () => {
    const meta = buildContactPhoneMetadata(
      makeCandidate({
        enrichment_metadata: {
          phone: { number: '+573001111111', type: 'mobile', source: 'apollo_search', raw_type: 'mobile' },
        },
      }),
    );
    assert.equal(meta.phone_type, 'mobile');
    assert.equal(meta.phone_source, 'apollo_search');
    assert.equal(meta.phone_raw_type, 'mobile');
    assert.equal(meta.phone_revealed_at, null);
    assert.equal(meta.phone_processing_basis, null);
  });

  it('Caso B: sin metadata de teléfono → todo null', () => {
    const meta = buildContactPhoneMetadata(makeCandidate({ enrichment_metadata: {} }));
    assert.equal(meta.phone_type, null);
    assert.equal(meta.phone_source, null);
    assert.equal(meta.phone_raw_type, null);
    assert.equal(meta.phone_revealed_at, null);
    assert.equal(meta.phone_processing_basis, null);
  });

  it('type/source fuera del vocabulario estable → null (defensivo)', () => {
    const meta = buildContactPhoneMetadata(
      makeCandidate({
        enrichment_metadata: {
          phone: { number: '+573001111111', type: 'landline', source: 'some_other_provider', raw_type: 'landline' },
        },
      }),
    );
    assert.equal(meta.phone_type, null);
    assert.equal(meta.phone_source, null);
    // raw_type se conserva tal cual para trazabilidad aunque el type no mapee.
    assert.equal(meta.phone_raw_type, 'landline');
  });

  it('personal_mobile se conserva (tipo sensible, sin revelar nada)', () => {
    const meta = buildContactPhoneMetadata(
      makeCandidate({
        enrichment_metadata: { phone: { type: 'personal_mobile', source: 'apollo_search' } },
      }),
    );
    assert.equal(meta.phone_type, 'personal_mobile');
    assert.equal(meta.phone_source, 'apollo_search');
    assert.equal(meta.phone_raw_type, null);
  });
});

// ── buildContactInsertPayload — copia de metadata ───────────────

describe('buildContactInsertPayload — phone metadata (PHONE-3C)', () => {
  it('Caso A: copia phone scalar + phone_type/source/raw_type', () => {
    const payload = buildContactInsertPayload({
      candidate: makeCandidate({
        phone: '+573001111111',
        enrichment_metadata: {
          phone: { number: '+573001111111', type: 'mobile', source: 'apollo_search', raw_type: 'mobile' },
        },
      }),
      accountId: 'acc-1',
      internalUserId: 'user-1',
    });
    assert.equal(payload.phone, '+573001111111');
    assert.equal(payload.phone_type, 'mobile');
    assert.equal(payload.phone_source, 'apollo_search');
    assert.equal(payload.phone_raw_type, 'mobile');
    assert.equal(payload.phone_revealed_at, null);
    assert.equal(payload.phone_processing_basis, null);
  });

  it('Caso B: phone presente sin metadata → phone scalar intacto, tipo/fuente null', () => {
    const payload = buildContactInsertPayload({
      candidate: makeCandidate({ phone: '+573002222222', enrichment_metadata: {} }),
      accountId: 'acc-1',
      internalUserId: 'user-1',
    });
    assert.equal(payload.phone, '+573002222222');
    assert.equal(payload.phone_type, null);
    assert.equal(payload.phone_source, null);
    assert.equal(payload.phone_raw_type, null);
    assert.equal(payload.phone_revealed_at, null);
    assert.equal(payload.phone_processing_basis, null);
  });

  it('Caso C: sin teléfono → phone null y tipo/fuente null (no obligatorio)', () => {
    const payload = buildContactInsertPayload({
      candidate: makeCandidate({ phone: null, enrichment_metadata: {} }),
      accountId: 'acc-1',
      internalUserId: 'user-1',
    });
    assert.equal(payload.phone, null);
    assert.equal(payload.phone_type, null);
    assert.equal(payload.phone_source, null);
  });

  it('phone_revealed_at queda null incluso con metadata (no hay reveal en este hito)', () => {
    const payload = buildContactInsertPayload({
      candidate: makeCandidate({
        enrichment_metadata: { phone: { type: 'mobile', source: 'apollo_search' } },
      }),
      accountId: 'acc-1',
      internalUserId: 'user-1',
    });
    assert.equal(payload.phone_revealed_at, null);
    assert.equal(payload.phone_processing_basis, null);
  });
});

// ── runApproveCandidate — comportamiento de aprobación ──────────

describe('runApproveCandidate — phone metadata copy (PHONE-3C)', () => {
  it('Caso A: aprobar inserta el contacto con phone_type/source copiados', async () => {
    const candidate = makeCandidate({
      phone: '+573001111111',
      enrichment_metadata: {
        phone: { number: '+573001111111', type: 'mobile', source: 'apollo_search', raw_type: 'mobile' },
      },
    });
    const { deps, calls } = makeApproveDeps({ loadCandidate: async () => candidate });
    const res = await runApproveCandidate('cand-1', deps);
    assert.equal(res.ok, true);
    assert.equal(calls.inserted.length, 1);
    assert.equal(calls.inserted[0].phone, '+573001111111');
    assert.equal(calls.inserted[0].phone_type, 'mobile');
    assert.equal(calls.inserted[0].phone_source, 'apollo_search');
    assert.equal(calls.inserted[0].phone_raw_type, 'mobile');
    assert.equal(calls.inserted[0].phone_revealed_at, null);
  });

  it('Caso C: candidato sin teléfono → aprobación NO se bloquea', async () => {
    const candidate = makeCandidate({ phone: null, enrichment_metadata: {} });
    const { deps, calls } = makeApproveDeps({ loadCandidate: async () => candidate });
    const res = await runApproveCandidate('cand-1', deps);
    assert.equal(res.ok, true);
    assert.equal(calls.inserted.length, 1);
    assert.equal(calls.inserted[0].phone, null);
    assert.equal(calls.inserted[0].phone_type, null);
    assert.equal(calls.inserted[0].phone_source, null);
  });

  it('no crea segundas mutaciones: solo insertContact + updateCandidate', async () => {
    const candidate = makeCandidate({
      enrichment_metadata: { phone: { type: 'mobile', source: 'apollo_search' } },
    });
    const { deps, calls } = makeApproveDeps({ loadCandidate: async () => candidate });
    await runApproveCandidate('cand-1', deps);
    assert.equal(calls.inserted.length, 1);
    assert.equal(calls.updated.length, 1);
  });
});

// ── Guards estáticos: sin reveal / sin proveedores / sin Lusha ──

describe('PHONE-3C static guards — candidate-review-core.ts', () => {
  const source = readFileSync(join(REPO_ROOT, 'src/modules/contact-enrichment/candidate-review-core.ts'), 'utf8');

  it('NO envía reveal_phone_number', () => {
    assert.equal(source.includes('reveal_phone_number'), false);
  });

  it('NO activa ni referencia automaticPhoneRevealEnabled', () => {
    assert.equal(source.includes('automaticPhoneRevealEnabled'), false);
  });

  it('NO referencia isLushaPhoneRevealEnabled ni Lusha reveal', () => {
    assert.equal(source.includes('isLushaPhoneRevealEnabled'), false);
    assert.equal(/lusha[_-]?reveal(?!')/i.test(source.replace(/'lusha_reveal'/g, '')), false);
  });

  it('NO crea botón "Revelar teléfono"', () => {
    assert.equal(/revelar tel[eé]fono/i.test(source), false);
  });

  it('NO llama proveedores reales (fetch/apollo/lusha clients) desde el core', () => {
    assert.equal(/\bfetch\s*\(/.test(source), false);
    assert.equal(source.includes('ApolloClient'), false);
    assert.equal(source.includes('LushaClient'), false);
  });

  it('phone_revealed_at y phone_processing_basis se emiten como null (sin política de reveal)', () => {
    assert.equal(source.includes('phone_revealed_at: null'), true);
    assert.equal(source.includes('phone_processing_basis: null'), true);
  });
});

// ── Migración 094: aditiva / nullable / idempotente / sin backfill ─

describe('PHONE-3C migration 094 static checks', () => {
  const rawSql = readFileSync(
    join(REPO_ROOT, 'supabase/migrations/094_contact_phone_metadata.sql'),
    'utf8',
  );
  // Elimina comentarios de línea (`-- ...`) para no confundir la prosa
  // explicativa ("no NOT NULL", "no backfill") con DDL real.
  const sql = rawSql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  const upper = sql.toUpperCase();

  it('agrega columnas con ADD COLUMN IF NOT EXISTS (idempotente)', () => {
    for (const col of [
      'phone_type',
      'phone_source',
      'phone_raw_type',
      'phone_revealed_at',
      'phone_processing_basis',
    ]) {
      assert.equal(
        new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}\\b`, 'i').test(sql),
        true,
        `falta ADD COLUMN IF NOT EXISTS ${col}`,
      );
    }
  });

  it('apunta a la tabla contacts', () => {
    assert.equal(/ALTER TABLE public\.contacts/i.test(sql), true);
  });

  it('NO usa NOT NULL', () => {
    assert.equal(upper.includes('NOT NULL'), false);
  });

  it('NO es destructiva (sin DROP / DELETE / TRUNCATE)', () => {
    assert.equal(/\bDROP\s+(TABLE|COLUMN)\b/i.test(sql), false);
    assert.equal(/\bDELETE\s+FROM\b/i.test(sql), false);
    assert.equal(/\bTRUNCATE\b/i.test(sql), false);
  });

  it('NO hace backfill (sin UPDATE / INSERT de datos)', () => {
    assert.equal(/\bUPDATE\s+public\.contacts\b/i.test(sql), false);
    assert.equal(/\bINSERT\s+INTO\b/i.test(sql), false);
  });

  it('NO cambia RLS ni políticas', () => {
    assert.equal(/ENABLE ROW LEVEL SECURITY/i.test(sql), false);
    assert.equal(/CREATE POLICY|ALTER POLICY|DROP POLICY/i.test(sql), false);
  });

  it('NO crea ni altera triggers', () => {
    assert.equal(/CREATE TRIGGER|DROP TRIGGER/i.test(sql), false);
  });

  it('check constraints son NOT VALID (no re-valida filas legacy)', () => {
    assert.equal(/contacts_phone_type_check/i.test(sql), true);
    assert.equal(/contacts_phone_source_check/i.test(sql), true);
    assert.equal(upper.includes('NOT VALID'), true);
  });

  it('constraints guardados por pg_constraint (idempotente)', () => {
    assert.equal(/pg_constraint/i.test(sql), true);
  });
});
