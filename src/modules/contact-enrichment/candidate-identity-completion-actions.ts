'use server';

// Agente 2A — Completar un candidato que ya existe en HubSpot: acciones del servidor
// (AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION).
//
//   * `revealCandidateLinkedinAction` — «Revelar LinkedIn»: identifica por correo y guarda el
//     LinkedIn (y, de paso, la identidad de Apollo).
//   * `revealCandidateEmailAction` — «Revelar correo»: identifica por LinkedIn y guarda el
//     correo (y, de paso, la identidad de Apollo).
//   * `revealCandidatePhoneWithIdentityAction` — «Revelar teléfono» para un candidato SIN
//     identidad nativa de proveedor (los de «Primero HubSpot»).
//
// El trabajo vive en `candidate-identity-completion-runner.server.ts`. Desde aquí (el navegador)
// sólo se completan candidatos en `pending_review`.

import { createClient } from '@/lib/supabase/server';
import { requireActiveActor } from './current-actor.server';
import { canSeeContactCandidate } from './candidate-scope.server';
import type { IdentityCompletionResult, IdentityCompletionStatus } from './candidate-identity-completion-core';
import {
  revealCandidatePhoneWithIdentity,
  runIdentityCompletionForCandidate,
  type RevealCandidatePhoneWithIdentityResult,
} from './candidate-identity-completion-runner.server';
import type { RevealCandidatePhoneInput } from './phone-reveal-core';

// ── «Revelar LinkedIn» / «Revelar correo» ──────────────────────────

function failed(status: IdentityCompletionStatus): IdentityCompletionResult {
  return {
    ok: false,
    status,
    linkedinAvailable: false,
    emailAvailable: false,
    providerIdentityAvailable: false,
    linkedinProvider: null,
    emailProvider: null,
  };
}

async function revealChannel(
  input: { candidateId: string },
  purpose: 'linkedin' | 'email',
): Promise<IdentityCompletionResult> {
  const candidateId = typeof input?.candidateId === 'string' ? input.candidateId.trim() : '';
  const { internalUserId, roleKey } = await requireActiveActor();
  const actor = { internalUserId, roleKey };
  const supabase = await createClient();
  // Alcance comercial ANTES de gastar: un candidato ajeno no existe para este actor.
  if (!candidateId || !(await canSeeContactCandidate(supabase, candidateId))) {
    return failed('candidate_not_found');
  }
  try {
    return await runIdentityCompletionForCandidate(candidateId, purpose, actor);
  } catch {
    return failed('provider_error');
  }
}

export type RevealCandidateLinkedinActionResult = IdentityCompletionResult;

/** «Revelar LinkedIn»: busca por el correo del candidato. */
export async function revealCandidateLinkedinAction(input: {
  candidateId: string;
}): Promise<RevealCandidateLinkedinActionResult> {
  return revealChannel(input, 'linkedin');
}

/** «Revelar correo»: busca por el LinkedIn del candidato. */
export async function revealCandidateEmailAction(input: {
  candidateId: string;
}): Promise<IdentityCompletionResult> {
  return revealChannel(input, 'email');
}

// ── «Revelar teléfono» con identificación previa ──────────────────

export type { RevealCandidatePhoneWithIdentityResult } from './candidate-identity-completion-runner.server';

export async function revealCandidatePhoneWithIdentityAction(
  input: RevealCandidatePhoneInput,
): Promise<RevealCandidatePhoneWithIdentityResult> {
  return revealCandidatePhoneWithIdentity(input);
}
