/**
 * Agente 2A — Apollo Phone Reveal action (PHONE-3D.3)
 *
 * Pruebas offline/DI del core puro `runRevealCandidatePhone` + guards estáticos.
 * Sin red, sin Supabase, sin proveedores reales: todas las dependencias
 * (flag, actor, carga de candidato, do_not_contact, llamada Apollo, persistencia
 * y usage-log) se inyectan y se capturan en memoria.
 *
 * Contrato verificado:
 *  - Flag OFF → disabled (no Apollo, no DB).
 *  - Confirmación de costo obligatoria.
 *  - phone_processing_basis obligatorio + válido; nota para other_approved_basis.
 *  - Rol autorizado (admin / commercial_manager).
 *  - Identidad suficiente antes de gastar reveal.
 *  - Éxito con/sin teléfono, error seguro sin PII, re-reveal bloqueado,
 *    do_not_contact bloquea.
 *  - No bulk (candidateId único).
 *  - Usage-log sin PII.
 *  - reveal_phone_number: true aislado al helper 3D.1; sin Lusha/HubSpot/UI.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  runRevealCandidatePhone,
  APOLLO_PHONE_REVEAL_CREDITS,
  PHONE_REVEAL_OPERATION_KEY,
  type RevealCandidatePhoneInput,
  type RevealCandidatePhoneDeps,
  type RevealCandidateRecord,
  type ApolloPhoneRevealCallResult,
  type RevealPersistencePatch,
  type PhoneRevealUsageLogEntry,
} from '../phone-reveal-core';
import type { MatchPersonParams } from '@/server/integrations/apollo-client';
import { isApolloPhoneRevealEnabled, APOLLO_PHONE_REVEAL_FLAG } from '@/lib/feature-flags.server';

const HERE = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

// ── Fixtures + captura ─────────────────────────────────────────

const NOW = '2026-07-24T12:00:00.000Z';
const ACTOR = { internalUserId: 'user-admin-1', roleKey: 'admin' };

function baseCandidate(
  overrides: Partial<RevealCandidateRecord> = {},
): RevealCandidateRecord {
  return {
    id: 'cand-1',
    accountId: 'acct-1',
    sourceContactId: 'apollo-person-1',
    email: 'jane.doe@acme.com',
    linkedinUrl: 'https://linkedin.com/in/jane-doe',
    firstName: 'Jane',
    lastName: 'Doe',
    organizationName: 'Acme SA',
    existingPhone: null,
    enrichmentMetadata: {},
    phoneRevealStatus: null,
    ...overrides,
  };
}

interface Capture {
  apolloCalls: MatchPersonParams[];
  persisted: Array<{ id: string; patch: RevealPersistencePatch }>;
  logs: PhoneRevealUsageLogEntry[];
  doNotContactChecked: number;
  candidateLoaded: number;
}

function makeDeps(
  cap: Capture,
  opts: {
    flagEnabled?: boolean;
    actor?: { internalUserId: string; roleKey: string | null };
    candidate?: RevealCandidateRecord | null;
    isDoNotContact?: boolean;
    apollo?: ApolloPhoneRevealCallResult;
  } = {},
): RevealCandidatePhoneDeps {
  return {
    flagEnabled: opts.flagEnabled ?? true,
    actor: opts.actor ?? ACTOR,
    nowIso: NOW,
    loadCandidate: async () => {
      cap.candidateLoaded += 1;
      return opts.candidate === undefined ? baseCandidate() : opts.candidate;
    },
    isDoNotContact: async () => {
      cap.doNotContactChecked += 1;
      return opts.isDoNotContact ?? false;
    },
    revealViaApollo: async (params) => {
      cap.apolloCalls.push(params);
      return (
        opts.apollo ?? {
          ok: true,
          phoneNumbers: [{ sanitized_number: '+573001112233', type: 'mobile' }],
        }
      );
    },
    persist: async (id, patch) => {
      cap.persisted.push({ id, patch });
    },
    logUsage: async (entry) => {
      cap.logs.push(entry);
    },
  };
}

function freshCapture(): Capture {
  return {
    apolloCalls: [],
    persisted: [],
    logs: [],
    doNotContactChecked: 0,
    candidateLoaded: 0,
  };
}

function validInput(
  overrides: Partial<RevealCandidatePhoneInput> = {},
): RevealCandidatePhoneInput {
  return {
    candidateId: 'cand-1',
    confirmCost: true,
    phoneProcessingBasis: 'legitimate_interest_b2b',
    ...overrides,
  };
}

let cap: Capture;
beforeEach(() => {
  cap = freshCapture();
});

// ── 1. Flag OFF ────────────────────────────────────────────────

describe('PHONE-3D.3 — flag OFF', () => {
  it('retorna disabled sin llamar Apollo ni escribir DB', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { flagEnabled: false }),
    );
    assert.equal(res.status, 'disabled');
    assert.equal(res.ok, false);
    assert.equal(cap.apolloCalls.length, 0);
    assert.equal(cap.persisted.length, 0);
    assert.equal(cap.logs.length, 0);
    assert.equal(cap.candidateLoaded, 0);
  });
});

// ── 2. Confirmación de costo ───────────────────────────────────

describe('PHONE-3D.3 — confirmación de costo', () => {
  it('confirmCost !== true → cost_confirmation_required, sin Apollo/DB', async () => {
    const res = await runRevealCandidatePhone(
      validInput({ confirmCost: false }),
      makeDeps(cap),
    );
    assert.equal(res.status, 'cost_confirmation_required');
    assert.equal(cap.apolloCalls.length, 0);
    assert.equal(cap.persisted.length, 0);
  });

  it('expectedMaxCredits por debajo del costo (8) → cost_confirmation_required', async () => {
    const res = await runRevealCandidatePhone(
      validInput({ expectedMaxCredits: 4 }),
      makeDeps(cap),
    );
    assert.equal(res.status, 'cost_confirmation_required');
    assert.equal(cap.apolloCalls.length, 0);
  });
});

// ── 3. Processing basis ────────────────────────────────────────

describe('PHONE-3D.3 — processing basis', () => {
  it('basis ausente → processing_basis_required', async () => {
    const res = await runRevealCandidatePhone(
      validInput({ phoneProcessingBasis: null }),
      makeDeps(cap),
    );
    assert.equal(res.status, 'processing_basis_required');
    assert.equal(cap.apolloCalls.length, 0);
  });

  it('basis inválido → invalid_processing_basis', async () => {
    const res = await runRevealCandidatePhone(
      validInput({ phoneProcessingBasis: 'because_i_can' }),
      makeDeps(cap),
    );
    assert.equal(res.status, 'invalid_processing_basis');
    assert.equal(cap.apolloCalls.length, 0);
  });

  it('other_approved_basis sin nota → processing_basis_note_required', async () => {
    const res = await runRevealCandidatePhone(
      validInput({ phoneProcessingBasis: 'other_approved_basis' }),
      makeDeps(cap),
    );
    assert.equal(res.status, 'processing_basis_note_required');
    assert.equal(cap.apolloCalls.length, 0);
  });

  it('other_approved_basis con nota → procede', async () => {
    const res = await runRevealCandidatePhone(
      validInput({
        phoneProcessingBasis: 'other_approved_basis',
        phoneProcessingBasisNote: 'Cliente solicitó ser contactado por este medio.',
      }),
      makeDeps(cap),
    );
    assert.equal(res.status, 'revealed');
    assert.equal(cap.persisted[0].patch.phone_processing_basis, 'other_approved_basis');
    assert.equal(
      cap.persisted[0].patch.phone_processing_basis_note,
      'Cliente solicitó ser contactado por este medio.',
    );
  });
});

// ── Rol ────────────────────────────────────────────────────────

describe('PHONE-3D.3 — gate de rol', () => {
  it('rol no autorizado → unauthorized_role, sin Apollo', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { actor: { internalUserId: 'u2', roleKey: 'seller_bd' } }),
    );
    assert.equal(res.status, 'unauthorized_role');
    assert.equal(cap.apolloCalls.length, 0);
  });

  it('commercial_manager sí puede', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        actor: { internalUserId: 'u3', roleKey: 'commercial_manager' },
      }),
    );
    assert.equal(res.status, 'revealed');
  });

  it('sin rol → unauthorized_role', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { actor: { internalUserId: 'u4', roleKey: null } }),
    );
    assert.equal(res.status, 'unauthorized_role');
  });
});

// ── 4. Identidad insuficiente ──────────────────────────────────

describe('PHONE-3D.3 — identidad insuficiente', () => {
  it('sin id/email/linkedin → insufficient_identity, sin Apollo', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        candidate: baseCandidate({
          sourceContactId: null,
          email: null,
          linkedinUrl: null,
        }),
      }),
    );
    assert.equal(res.status, 'insufficient_identity');
    assert.equal(cap.apolloCalls.length, 0);
    assert.equal(cap.persisted.length, 0);
  });
});

describe('PHONE-3D.3 — candidato inválido / sin cuenta', () => {
  it('candidateId vacío → invalid_candidate', async () => {
    const res = await runRevealCandidatePhone(
      validInput({ candidateId: '   ' }),
      makeDeps(cap),
    );
    assert.equal(res.status, 'invalid_candidate');
    assert.equal(cap.candidateLoaded, 0);
  });

  it('candidato inexistente → candidate_not_found', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { candidate: null }),
    );
    assert.equal(res.status, 'candidate_not_found');
    assert.equal(cap.apolloCalls.length, 0);
  });

  it('candidato sin cuenta → candidate_account_invalid', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { candidate: baseCandidate({ accountId: null }) }),
    );
    assert.equal(res.status, 'candidate_account_invalid');
    assert.equal(cap.apolloCalls.length, 0);
  });
});

// ── 5. Éxito con teléfono ──────────────────────────────────────

describe('PHONE-3D.3 — éxito con teléfono', () => {
  it('revela vía helper (reveal_phone_number: true) y persiste apollo_reveal', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        apollo: {
          ok: true,
          phoneNumbers: [
            { sanitized_number: '+573001112233', type: 'mobile' },
            { sanitized_number: '+571234567', type: 'hq' },
          ],
        },
      }),
    );
    assert.equal(res.status, 'revealed');
    assert.equal(res.ok, true);
    assert.equal(res.phoneRevealed, true);
    assert.equal(res.phoneType, 'mobile');

    // El reveal_phone_number: true llegó a Apollo SOLO vía el helper 3D.1.
    assert.equal(cap.apolloCalls.length, 1);
    assert.equal(cap.apolloCalls[0].reveal_phone_number, true);

    const { patch } = cap.persisted[0];
    assert.equal(patch.phone, '+573001112233');
    assert.equal(patch.phone_reveal_status, 'revealed');
    assert.equal(patch.phone_revealed_at, NOW);
    assert.equal(patch.phone_revealed_by, ACTOR.internalUserId);
    assert.equal(patch.phone_reveal_provider, 'apollo');
    assert.equal(patch.phone_reveal_cost_credits, APOLLO_PHONE_REVEAL_CREDITS);
    assert.equal(patch.phone_reveal_error_code, null);
    const meta = patch.enrichment_metadata?.phone;
    assert.equal(meta?.source, 'apollo_reveal');
    assert.equal(meta?.number, '+573001112233');
    assert.equal(meta?.type, 'mobile');
  });
});

// ── 6. Sin teléfono ────────────────────────────────────────────

describe('PHONE-3D.3 — sin teléfono', () => {
  it('Apollo sin phone → no_phone_found, no inventa dato', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { apollo: { ok: true, phoneNumbers: [] } }),
    );
    assert.equal(res.status, 'no_phone_found');
    assert.equal(res.phoneRevealed, false);
    const { patch } = cap.persisted[0];
    assert.equal(patch.phone_reveal_status, 'no_phone_found');
    assert.equal(patch.phone, undefined); // no toca phone existente
    assert.equal(patch.enrichment_metadata, undefined);
    assert.equal(patch.phone_reveal_cost_credits, APOLLO_PHONE_REVEAL_CREDITS);
  });
});

// ── 7. Error Apollo ────────────────────────────────────────────

describe('PHONE-3D.3 — error Apollo', () => {
  it('error → status error, código seguro, no borra phone existente', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        candidate: baseCandidate({ existingPhone: '+573009998877' }),
        apollo: { ok: false, errorCode: 'HTTP_500' },
      }),
    );
    assert.equal(res.status, 'error');
    assert.equal(res.errorCode, 'HTTP_500');
    const { patch } = cap.persisted[0];
    assert.equal(patch.phone_reveal_status, 'error');
    assert.equal(patch.phone_reveal_error_code, 'HTTP_500');
    assert.equal(patch.phone, undefined); // no borra teléfono existente
    assert.equal(patch.phone_reveal_cost_credits, null);
  });
});

// ── 8. Re-reveal bloqueado ─────────────────────────────────────

describe('PHONE-3D.3 — re-reveal bloqueado', () => {
  it('phone_reveal_status = revealed → already_revealed, sin Apollo', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        candidate: baseCandidate({ phoneRevealStatus: 'revealed' }),
      }),
    );
    assert.equal(res.status, 'already_revealed');
    assert.equal(cap.apolloCalls.length, 0);
  });

  it('phone existente con source apollo_reveal → already_revealed', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        candidate: baseCandidate({
          enrichmentMetadata: {
            phone: { number: '+571', type: 'mobile', source: 'apollo_reveal', raw_type: 'mobile' },
          },
        }),
      }),
    );
    assert.equal(res.status, 'already_revealed');
    assert.equal(cap.apolloCalls.length, 0);
  });
});

// ── 9. do_not_contact ──────────────────────────────────────────

describe('PHONE-3D.3 — do_not_contact', () => {
  it('do_not_contact = true → bloquea, sin Apollo', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { isDoNotContact: true }),
    );
    assert.equal(res.status, 'do_not_contact');
    assert.equal(cap.apolloCalls.length, 0);
    assert.equal(cap.persisted.length, 0);
  });
});

// ── 11. No PII en logs ─────────────────────────────────────────

describe('PHONE-3D.3 — usage-log sin PII', () => {
  it('metadata no contiene teléfono/email/linkedin/nombre ni payload crudo', async () => {
    await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        candidate: baseCandidate({
          email: 'jane.doe@acme.com',
          linkedinUrl: 'https://linkedin.com/in/jane-doe',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
        apollo: {
          ok: true,
          phoneNumbers: [{ sanitized_number: '+573001112233', type: 'mobile' }],
        },
      }),
    );
    assert.equal(cap.logs.length, 1);
    const serialized = JSON.stringify(cap.logs[0]);
    assert.equal(serialized.includes('+573001112233'), false);
    assert.equal(serialized.includes('jane.doe@acme.com'), false);
    assert.equal(serialized.includes('linkedin.com/in/jane-doe'), false);
    assert.equal(/jane/i.test(serialized), false);
    assert.equal(/doe/i.test(serialized), false);
    // Sí incluye la telemetría segura.
    assert.equal(cap.logs[0].operationKey, PHONE_REVEAL_OPERATION_KEY);
    assert.equal(cap.logs[0].metadata.reveal_status, 'revealed');
    assert.equal(cap.logs[0].metadata.phone_revealed, true);
    assert.equal(cap.logs[0].metadata.credits_used, APOLLO_PHONE_REVEAL_CREDITS);
  });
});

// ── 10 + 12. Guards estáticos ──────────────────────────────────

describe('PHONE-3D.3 — guards estáticos', () => {
  const CORE_REL = 'src/modules/contact-enrichment/phone-reveal-core.ts';
  const ACTION_REL = 'src/modules/contact-enrichment/phone-reveal-actions.ts';
  const rawCore = readRepo(CORE_REL);
  const rawAction = readRepo(ACTION_REL);
  const REVEAL_TRUE = /reveal_phone_number\s*:\s*true/;

  // Los guards de contenido se evalúan sobre el CÓDIGO, no sobre los comentarios
  // (que mencionan intencionalmente "Lusha", "HubSpot" o "reveal_phone_number:
  // true" para documentar qué NO se hace / dónde vive el flag).
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const core = stripComments(rawCore);
  const action = stripComments(rawAction);

  it('no bulk: la entrada es candidateId único, sin candidateIds array', () => {
    assert.equal(/candidateIds/.test(core), false);
    assert.equal(/candidateIds/.test(action), false);
    assert.equal(/candidateId\s*:\s*string/.test(core), true);
  });

  it('reveal_phone_number: true NO aparece en el core ni en el action', () => {
    assert.equal(REVEAL_TRUE.test(core), false);
    assert.equal(REVEAL_TRUE.test(action), false);
  });

  it('el core usa el helper 3D.1 (buildApolloPhoneRevealMatchParams)', () => {
    assert.equal(/buildApolloPhoneRevealMatchParams/.test(core), true);
  });

  it('el action es un server action ("use server") y lee el flag', () => {
    assert.equal(/^['"]use server['"];/m.test(rawAction), true);
    assert.equal(/isApolloPhoneRevealEnabled/.test(action), true);
  });

  it('no toca Lusha (sin imports/refs de Lusha en código)', () => {
    assert.equal(/lusha/i.test(core), false);
    assert.equal(/lusha/i.test(action), false);
  });

  it('no toca HubSpot (sin imports/refs de HubSpot en código)', () => {
    assert.equal(/hubspot/i.test(core), false);
    assert.equal(/hubspot/i.test(action), false);
  });

  it('no crea contacto oficial ni aprueba candidato', () => {
    assert.equal(/runApproveCandidate|insertContact|from\(['"]contacts['"]\)\s*\n?\s*\.insert/i.test(core), false);
    assert.equal(/runApproveCandidate|approveContactCandidate/.test(action), false);
  });

  it('operation_key del reveal es person_phone_reveal', () => {
    assert.equal(/person_phone_reveal/.test(core), true);
  });

  it('roles autorizados: admin + commercial_manager', () => {
    assert.equal(/'admin'/.test(core), true);
    assert.equal(/'commercial_manager'/.test(core), true);
  });

  it('no crea UI de reveal (sin .tsx nuevo en el árbol de módulos)', () => {
    const modulesDir = join(REPO_ROOT, 'src', 'modules', 'contact-enrichment');
    const tsx = readdirSync(modulesDir).filter((f) => f.endsWith('.tsx'));
    assert.equal(tsx.length, 0);
  });

  it('el flag NO está activado en el entorno de test', () => {
    assert.equal(process.env[APOLLO_PHONE_REVEAL_FLAG], undefined);
    assert.equal(isApolloPhoneRevealEnabled(), false);
  });

  it('completion / runner / routing / bulk siguen sin reveal_phone_number: true', () => {
    const files = [
      'src/server/agents/contact-enrichment-toolkit/contact-completion-adapter.ts',
      'src/server/agents/contact-enrichment-toolkit/apollo-enrichment-runner.ts',
      'src/server/agents/contact-enrichment-toolkit/contact-enrichment-routing-orchestrator.ts',
      'src/modules/contact-enrichment/bulk-enrichment-runner.ts',
    ];
    for (const rel of files) {
      assert.equal(REVEAL_TRUE.test(readRepo(rel)), false, `${rel} no debe revelar`);
    }
  });

  it('la migración 095 sigue existiendo y no ejecuta reveal', () => {
    const mig = 'supabase/migrations/095_candidate_phone_reveal_audit.sql';
    assert.equal(existsSync(join(REPO_ROOT, mig)), true);
    assert.equal(REVEAL_TRUE.test(readRepo(mig)), false);
  });
});
