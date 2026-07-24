/**
 * Static schema + safety guards — PHONE-3D.2
 *
 * PHONE-3D.2 solo agrega una migración aditiva a
 * `contact_enrichment_candidates` para que un FUTURO reveal de teléfono Apollo
 * (PHONE-3D.3 server action + PHONE-3D.4 UI) pueda registrar estado, actor,
 * timestamp, proveedor, costo, error y base de tratamiento. Este hito NO revela
 * nada, NO llama Apollo, NO crea server action, NO toca UI, NO activa el flag y
 * NO gasta créditos.
 *
 * Estas pruebas leen los archivos en disco y verifican los invariantes.
 * Sin red, sin DB, sin proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  isApolloPhoneRevealEnabled,
  isLushaPhoneRevealEnabled,
  APOLLO_PHONE_REVEAL_FLAG,
} from '@/lib/feature-flags.server';

const HERE = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

function readRepo(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

const MIGRATION_REL = 'supabase/migrations/095_candidate_phone_reveal_audit.sql';

const AUDIT_COLUMNS: readonly string[] = [
  'phone_reveal_status',
  'phone_revealed_at',
  'phone_revealed_by',
  'phone_reveal_provider',
  'phone_reveal_cost_credits',
  'phone_reveal_cost_usd',
  'phone_reveal_error_code',
  'phone_processing_basis',
  'phone_processing_basis_note',
];

const STATUS_VOCAB: readonly string[] = [
  'not_requested',
  'revealed',
  'no_phone_found',
  'error',
];

const BASIS_VOCAB: readonly string[] = [
  'legitimate_interest_b2b',
  'consent_obtained',
  'existing_business_relationship',
  'customer_requested_contact',
  'other_approved_basis',
];

// ── Migración 095: forma / seguridad ───────────────────────────

describe('PHONE-3D.2 migration 095 — shape', () => {
  const rawSql = readRepo(MIGRATION_REL);
  // Elimina comentarios de línea (`-- ...`) para no confundir la prosa
  // explicativa ("no NOT NULL", "no backfill") con DDL real.
  const sql = rawSql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

  it('la migración 095 existe con el nombre esperado', () => {
    assert.equal(existsSync(join(REPO_ROOT, MIGRATION_REL)), true);
  });

  it('apunta a contact_enrichment_candidates', () => {
    assert.equal(
      /ALTER TABLE public\.contact_enrichment_candidates/i.test(sql),
      true,
    );
  });

  it('no toca ninguna otra tabla', () => {
    const altered = [...sql.matchAll(/ALTER TABLE\s+([a-z0-9_.]+)/gi)].map(
      (m) => m[1].toLowerCase(),
    );
    for (const t of altered) {
      assert.equal(
        t,
        'public.contact_enrichment_candidates',
        `ALTER TABLE inesperado: ${t}`,
      );
    }
  });

  it('agrega SOLO las columnas autorizadas con ADD COLUMN IF NOT EXISTS', () => {
    const added = [
      ...sql.matchAll(/ADD COLUMN IF NOT EXISTS\s+([a-z0-9_]+)/gi),
    ].map((m) => m[1].toLowerCase());
    assert.deepEqual([...added].sort(), [...AUDIT_COLUMNS].sort());
  });

  for (const col of AUDIT_COLUMNS) {
    it(`agrega ${col} de forma idempotente (IF NOT EXISTS)`, () => {
      assert.equal(
        new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}\\b`, 'i').test(sql),
        true,
        `falta ADD COLUMN IF NOT EXISTS ${col}`,
      );
    });
  }
});

describe('PHONE-3D.2 migration 095 — nullable / no destructiva / sin backfill', () => {
  const rawSql = readRepo(MIGRATION_REL);
  const sql = rawSql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  const upper = sql.toUpperCase();

  it('NO usa NOT NULL (todas las columnas nullable)', () => {
    assert.equal(upper.includes('NOT NULL'), false);
  });

  it('NO es destructiva (sin DROP / DELETE / TRUNCATE)', () => {
    assert.equal(/\bDROP\s+(TABLE|COLUMN)\b/i.test(sql), false);
    assert.equal(/\bDELETE\s+FROM\b/i.test(sql), false);
    assert.equal(/\bTRUNCATE\b/i.test(sql), false);
  });

  it('NO hace backfill (sin UPDATE / INSERT de datos)', () => {
    assert.equal(
      /\bUPDATE\s+public\.contact_enrichment_candidates\b/i.test(sql),
      false,
    );
    assert.equal(/\bINSERT\s+INTO\b/i.test(sql), false);
  });

  it('NO cambia RLS ni políticas', () => {
    assert.equal(/ENABLE ROW LEVEL SECURITY/i.test(sql), false);
    assert.equal(/CREATE POLICY|ALTER POLICY|DROP POLICY/i.test(sql), false);
  });

  it('NO crea ni altera triggers', () => {
    assert.equal(/CREATE TRIGGER|DROP TRIGGER/i.test(sql), false);
  });

  it('constraints guardados por pg_constraint (idempotente)', () => {
    assert.equal(/pg_constraint/i.test(sql), true);
  });
});

describe('PHONE-3D.2 migration 095 — constraints NOT VALID + vocabulario', () => {
  const rawSql = readRepo(MIGRATION_REL);
  const sql = rawSql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  const upper = sql.toUpperCase();

  it('los check constraints son NOT VALID (no re-valida filas legacy)', () => {
    assert.equal(
      /contact_enrichment_candidates_phone_reveal_status_check/i.test(sql),
      true,
    );
    assert.equal(
      /contact_enrichment_candidates_phone_reveal_provider_check/i.test(sql),
      true,
    );
    assert.equal(
      /contact_enrichment_candidates_phone_processing_basis_check/i.test(sql),
      true,
    );
    // Un NOT VALID por cada uno de los tres checks.
    assert.equal((upper.match(/NOT VALID/g) ?? []).length >= 3, true);
  });

  it('phone_reveal_status contiene SOLO el vocabulario aprobado', () => {
    for (const v of STATUS_VOCAB) {
      assert.equal(sql.includes(`'${v}'`), true, `falta estado ${v}`);
    }
    // Ningún estado fuera del vocabulario (defensivo contra ampliaciones).
    const statusBlock = sql
      .slice(sql.indexOf('phone_reveal_status IN'))
      .slice(0, 200);
    const found = [...statusBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const f of found) {
      assert.equal(
        STATUS_VOCAB.includes(f),
        true,
        `estado inesperado en el CHECK: ${f}`,
      );
    }
  });

  it('phone_reveal_provider solo permite apollo (sin Lusha)', () => {
    const providerBlock = sql
      .slice(sql.indexOf('phone_reveal_provider IN'))
      .slice(0, 120);
    const found = [...providerBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(found, ['apollo']);
    assert.equal(/'lusha'/i.test(providerBlock), false);
  });

  it('phone_processing_basis contiene SOLO el vocabulario aprobado por legal', () => {
    for (const v of BASIS_VOCAB) {
      assert.equal(sql.includes(`'${v}'`), true, `falta basis ${v}`);
    }
    const basisBlock = sql
      .slice(sql.indexOf('phone_processing_basis IN'))
      .slice(0, 400);
    const found = [...basisBlock.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
    for (const f of found) {
      assert.equal(
        BASIS_VOCAB.includes(f),
        true,
        `basis inesperado en el CHECK: ${f}`,
      );
    }
  });
});

describe('PHONE-3D.2 migration 095 — FK del actor', () => {
  const sql = readRepo(MIGRATION_REL);

  it('phone_revealed_by es uuid con FK a internal_users ON DELETE SET NULL', () => {
    assert.equal(
      /ADD COLUMN IF NOT EXISTS\s+phone_revealed_by\s+uuid/i.test(sql),
      true,
    );
    assert.equal(
      /FOREIGN KEY \(phone_revealed_by\)/i.test(sql),
      true,
    );
    assert.equal(
      /REFERENCES public\.internal_users\(id\)/i.test(sql),
      true,
    );
    assert.equal(/ON DELETE SET NULL/i.test(sql), true);
  });
});

// ── Tipos centrales de candidates ──────────────────────────────

describe('PHONE-3D.2 — tipos centrales actualizados (opcionales/nullable)', () => {
  const types = readRepo('src/modules/contact-enrichment/types.ts');
  const core = readRepo('src/modules/contact-enrichment/candidate-review-core.ts');

  it('types.ts declara la interfaz de auditoría con el vocabulario aprobado', () => {
    assert.equal(/ContactCandidatePhoneRevealAudit/.test(types), true);
    assert.equal(/PhoneRevealStatus/.test(types), true);
    assert.equal(/PhoneRevealProvider/.test(types), true);
    assert.equal(/PhoneProcessingBasis/.test(types), true);
    for (const v of [...STATUS_VOCAB, ...BASIS_VOCAB, 'apollo']) {
      assert.equal(types.includes(`'${v}'`), true, `falta el literal ${v}`);
    }
  });

  it('CandidateRecord expone los 9 campos como opcionales (nullable)', () => {
    for (const col of AUDIT_COLUMNS) {
      assert.equal(
        new RegExp(`${col}\\?:`).test(core),
        true,
        `CandidateRecord debe declarar ${col}? opcional`,
      );
    }
  });
});

// ── Safety invariants: sin superficie de reveal ────────────────

const REVEAL_TRUE = /reveal_phone_number\s*:\s*true/;

const RUNTIME_FILES_WITHOUT_REVEAL_TRUE: readonly string[] = [
  'src/server/agents/contact-enrichment-toolkit/contact-completion-adapter.ts',
  'src/server/agents/contact-enrichment-toolkit/apollo-enrichment-runner.ts',
  'src/server/agents/contact-enrichment-toolkit/apollo-people-adapter.ts',
  'src/server/agents/contact-enrichment-toolkit/contact-enrichment-runner.ts',
  'src/server/agents/contact-enrichment-toolkit/contact-enrichment-routing-orchestrator.ts',
  'src/server/agents/contact-enrichment-toolkit/lusha-enrichment-runner.ts',
  'src/modules/contact-enrichment/bulk-enrichment-runner.ts',
  'src/modules/contact-enrichment/candidate-review-core.ts',
  'src/components/contact-enrichment/contact-candidate-detail-sheet.tsx',
];

describe('PHONE-3D.2 — reveal_phone_number: true sigue aislado en el helper', () => {
  it('el helper apollo-phone-reveal.ts SÍ contiene reveal_phone_number: true', () => {
    const helper = readRepo(
      'src/server/agents/contact-enrichment-toolkit/apollo-phone-reveal.ts',
    );
    assert.equal(REVEAL_TRUE.test(helper), true);
  });

  for (const rel of RUNTIME_FILES_WITHOUT_REVEAL_TRUE) {
    it(`${rel} NO envía reveal_phone_number: true`, () => {
      assert.equal(
        REVEAL_TRUE.test(readRepo(rel)),
        false,
        `${rel} no debe activar reveal_phone_number`,
      );
    });
  }

  it('la migración 095 no contiene reveal_phone_number', () => {
    assert.equal(REVEAL_TRUE.test(readRepo(MIGRATION_REL)), false);
  });
});

describe('PHONE-3D.2 — no hay server action ni UI de reveal', () => {
  // La server action revealCandidatePhone la introduce PHONE-3D.3 en archivos
  // dedicados (phone-reveal-actions.ts / phone-reveal-core.ts). La invariante de
  // 3D.2 que sigue vigente: la acción no se filtra a otros módulos y la UI de
  // reveal (botón/modal) sigue sin existir en este milestone.
  it('revealCandidatePhone solo vive en los archivos dedicados de 3D.3', () => {
    const modulesDir = join(REPO_ROOT, 'src', 'modules', 'contact-enrichment');
    const DEDICATED_3D3 = new Set(['phone-reveal-actions.ts', 'phone-reveal-core.ts']);
    const files = readdirSync(modulesDir).filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      if (DEDICATED_3D3.has(f)) continue;
      const source = readFileSync(join(modulesDir, f), 'utf8');
      assert.equal(
        /revealCandidatePhone/.test(source),
        false,
        `${f} no debe declarar revealCandidatePhone`,
      );
    }
  });

  it('la UI de detalle no expone reveal_phone_number (aislado al helper 3D.1)', () => {
    // NOTA (PHONE-3D.4): el botón "Revelar teléfono" + modal de costo se
    // introdujeron deliberadamente en PHONE-3D.4. La invariante que sigue
    // vigente para 3D.2 es que la literal `reveal_phone_number` NO viva en la
    // UI (solo en el helper 3D.1). La presencia del botón/modal la verifica
    // contact-candidate-detail-phone-reveal-ui-3d4-static.test.ts.
    const detailSheet = readRepo(
      'src/components/contact-enrichment/contact-candidate-detail-sheet.tsx',
    );
    assert.equal(/reveal_phone_number/.test(detailSheet), false);
  });
});

describe('PHONE-3D.2 — flags de reveal siguen apagados', () => {
  it('ENABLE_APOLLO_PHONE_REVEAL no está activo en el entorno', () => {
    assert.equal(process.env[APOLLO_PHONE_REVEAL_FLAG], undefined);
    assert.equal(isApolloPhoneRevealEnabled(), false);
  });

  it('el flag es server-only (no NEXT_PUBLIC) y sin default true', () => {
    const flags = readRepo('src/lib/feature-flags.server.ts');
    assert.equal(/ENABLE_APOLLO_PHONE_REVEAL/.test(flags), true);
    assert.equal(/NEXT_PUBLIC_ENABLE_APOLLO_PHONE_REVEAL/.test(flags), false);
  });

  it('guardrails de Apollo: automaticPhoneRevealEnabled sigue false', () => {
    const guardrails = readRepo('src/lib/apollo-guardrails.ts');
    assert.equal(/automaticPhoneRevealEnabled\s*:\s*false/.test(guardrails), true);
    assert.equal(/automaticPhoneRevealEnabled\s*:\s*true/.test(guardrails), false);
  });

  it('isLushaPhoneRevealEnabled() sigue hard-off (returns false)', () => {
    assert.equal(isLushaPhoneRevealEnabled(), false);
  });
});
