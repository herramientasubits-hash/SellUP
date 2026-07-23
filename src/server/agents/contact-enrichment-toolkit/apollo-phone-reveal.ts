// Agente 2A — Apollo Phone Reveal payload helper (PHONE-3D.1)
//
// Este módulo es el ÚNICO lugar autorizado del código base donde
// `reveal_phone_number: true` puede aparecer. Construye el payload de
// people/match para un FUTURO reveal explícito de teléfono aprobado por el
// operador. NO ejecuta nada:
//
//   - NO hace fetch / no llama a Apollo.
//   - NO lee env vars (el gate del flag ENABLE_APOLLO_PHONE_REVEAL vive en
//     src/lib/feature-flags.server.ts y todavía no lo consume ninguna ruta).
//   - NO toca Supabase.
//   - NO imprime logs.
//   - NO recibe ni reenvía números de teléfono existentes.
//
// El reveal real sigue bloqueado por decisión legal/producto (Habeas Data /
// Ley 1581 / LOPDP). Este helper solo prepara la forma del payload para que,
// cuando esa decisión se tome, exista un único punto controlado.

import type { MatchPersonParams } from '@/server/integrations/apollo-client';

// ── Entrada ────────────────────────────────────────────────────

/**
 * Identidad mínima del candidato para pedir un reveal de teléfono.
 *
 * Deliberadamente NO incluye ningún campo de teléfono: el reveal pide a Apollo
 * un dato nuevo, nunca reenvía teléfonos ya conocidos.
 */
export interface ApolloPhoneRevealInput {
  /** Apollo person ID (people_search). Identificador más fuerte posible. */
  sourceContactId?: string | null;
  /** Email confiable del candidato. */
  email?: string | null;
  /** URL de LinkedIn del candidato. */
  linkedinUrl?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  organizationName?: string | null;
}

// ── Resultado ──────────────────────────────────────────────────

export type ApolloPhoneRevealResult =
  | { ok: true; params: MatchPersonParams }
  | { ok: false; error: ApolloPhoneRevealError };

/** Motivo por el que no se puede construir un payload de reveal seguro. */
export type ApolloPhoneRevealError = 'insufficient_identity';

// ── Helpers puros ──────────────────────────────────────────────

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ── Constructor del payload ────────────────────────────────────

/**
 * Construye los params de people/match para un reveal explícito de teléfono.
 *
 * Requiere una identidad fuerte: Apollo person id, email o LinkedIn. El
 * nombre + empresa por sí solos NO bastan para gastar un reveal (mucho más
 * caro y sujeto a base legal), así que se rechazan con
 * `insufficient_identity`.
 *
 * `reveal_phone_number: true` se fija aquí y solo aquí. `reveal_personal_emails`
 * NO se agrega: el reveal de teléfono no lo exige y evitarlo reduce el dato
 * personal que se solicita (minimización). El payload nunca incluye teléfonos.
 */
export function buildApolloPhoneRevealMatchParams(
  input: ApolloPhoneRevealInput,
): ApolloPhoneRevealResult {
  const id = clean(input.sourceContactId);
  const email = clean(input.email);
  const linkedinUrl = clean(input.linkedinUrl);

  // Identidad fuerte obligatoria: sin id/email/linkedin confiable no revelamos.
  const hasStrongIdentity = !!id || !!email || !!linkedinUrl;
  if (!hasStrongIdentity) {
    return { ok: false, error: 'insufficient_identity' };
  }

  // Único punto autorizado para reveal_phone_number: true.
  const params: MatchPersonParams = { reveal_phone_number: true };

  if (id) params.id = id;
  if (email) params.email = email;
  if (linkedinUrl) params.linkedin_url = linkedinUrl;

  const firstName = clean(input.firstName);
  const lastName = clean(input.lastName);
  const organizationName = clean(input.organizationName);
  if (firstName) params.first_name = firstName;
  if (lastName) params.last_name = lastName;
  if (organizationName) params.organization_name = organizationName;

  return { ok: true, params };
}
