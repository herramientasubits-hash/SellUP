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
  /**
   * Proveedor/origen del candidato (contact_enrichment_candidates.source):
   * 'apollo' | 'lusha' | 'hubspot' | 'manual' | 'mock' | otros. Determina si
   * `sourceContactId` puede reenviarse como Apollo person id. Sólo los
   * candidatos origen Apollo tienen un id compatible con /people/match; el id de
   * Lusha (u otros) es de OTRO espacio de identificadores (p.ej. `v1.<token>`) y
   * Apollo lo rechaza con HTTP 422 ("... is not a valid ID"). Se acepta como
   * string libre (dato externo) y se normaliza aquí.
   */
  sourceProvider?: string | null;
  /**
   * Identificador de persona del proveedor de origen (Apollo person id / Lusha
   * contact id). SÓLO se envía a Apollo como `id` cuando `sourceProvider` es
   * Apollo (ver `shouldSendApolloPersonId`). Para Lusha u otros proveedores se
   * IGNORA como `id`: el match se resuelve por email/linkedin/name/company.
   */
  sourceContactId?: string | null;
  /** Email confiable del candidato. */
  email?: string | null;
  /** URL de LinkedIn del candidato. */
  linkedinUrl?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  organizationName?: string | null;
  /**
   * URL pública del webhook de Apollo para el reveal ASÍNCRONO. Obligatoria:
   * el contrato confirmado de Apollo exige `webhook_url` cuando
   * `reveal_phone_number` es true (sin ella responde HTTP 422). Nunca contiene
   * dato personal; es una ruta pública protegida por un token secreto.
   */
  webhookUrl?: string | null;
}

// ── Resultado ──────────────────────────────────────────────────

export type ApolloPhoneRevealResult =
  | { ok: true; params: MatchPersonParams }
  | { ok: false; error: ApolloPhoneRevealError };

/** Motivo por el que no se puede construir un payload de reveal seguro. */
export type ApolloPhoneRevealError =
  | 'insufficient_identity'
  | 'webhook_url_required';

// ── Helpers puros ──────────────────────────────────────────────

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Proveedor de origen canónico para el reveal: minúsculas + trim, o null. */
export function normalizeRevealSourceProvider(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Prefijos de `source_contact_id` conocidos de proveedores NO-Apollo. Defensa
 * SECUNDARIA (nunca la única): aunque un candidato viniera mal etiquetado como
 * origen Apollo, un id con este prefijo pertenece a otro espacio de identidad y
 * Apollo lo rechazaría. Hoy: Lusha usa `v1.<token>`.
 */
const NON_APOLLO_SOURCE_ID_PREFIXES: readonly string[] = ['v1.'];

/**
 * Decide si `sourceContactId` puede enviarse a Apollo como `id` (people/match).
 *
 * Regla (gate por proveedor PRIMERO, no por regex):
 *   1. Debe existir un id no vacío.
 *   2. El proveedor de origen normalizado debe ser exactamente `apollo`. Lusha,
 *      hubspot, manual, mock, unknown/null y cualquier otro → NO se reenvía.
 *   3. Defensa secundaria: aunque el proveedor diga apollo, un id con prefijo
 *      conocido de otro proveedor (p.ej. `v1.` de Lusha) NO se reenvía.
 *
 * Esto impide la contaminación cross-provider que provocaba el HTTP 422 de
 * Apollo ("v1.<token> is not a valid ID") al mandar ids de Lusha como Apollo id.
 */
export function shouldSendApolloPersonId(args: {
  sourceProvider?: string | null;
  sourceContactId?: string | null;
}): boolean {
  const id = clean(args.sourceContactId);
  if (!id) return false;
  // Gate primario: sólo candidatos origen Apollo.
  if (normalizeRevealSourceProvider(args.sourceProvider) !== 'apollo') return false;
  // Gate secundario defensivo: id con prefijo de otro proveedor → nunca.
  const lowerId = id.toLowerCase();
  if (NON_APOLLO_SOURCE_ID_PREFIXES.some((prefix) => lowerId.startsWith(prefix))) {
    return false;
  }
  return true;
}

// ── Constructor del payload ────────────────────────────────────

/**
 * Construye los params de people/match para un reveal explícito de teléfono.
 *
 * Requiere una identidad fuerte: Apollo person id (SÓLO si el candidato es
 * origen Apollo — ver `shouldSendApolloPersonId`), email o LinkedIn. El nombre +
 * empresa por sí solos NO bastan para gastar un reveal (mucho más caro y sujeto
 * a base legal), así que se rechazan con `insufficient_identity`. Un candidato
 * origen Lusha (u otro) sigue siendo elegible por email/LinkedIn: Apollo hace el
 * match con esos datos, sin recibir el id ajeno que rechazaría con HTTP 422.
 *
 * `reveal_phone_number: true` se fija aquí y solo aquí. `reveal_personal_emails`
 * NO se agrega: el reveal de teléfono no lo exige y evitarlo reduce el dato
 * personal que se solicita (minimización). El payload nunca incluye teléfonos.
 *
 * `webhook_url` es OBLIGATORIA: el reveal de Apollo es asíncrono y sin webhook
 * responde HTTP 422. Se rechaza con `webhook_url_required` si falta, para que
 * nunca se dispare una llamada que Apollo va a rechazar. El id de correlación
 * (request_id) lo devuelve Apollo en la respuesta inmediata; el teléfono llega
 * después por el webhook.
 */
export function buildApolloPhoneRevealMatchParams(
  input: ApolloPhoneRevealInput,
): ApolloPhoneRevealResult {
  // `id` SÓLO cuenta como identidad Apollo cuando el candidato es origen Apollo.
  // Un source_contact_id de Lusha (u otro proveedor) NO es un Apollo person id y
  // no debe reenviarse ni contar como identidad fuerte para Apollo.
  const apolloId = shouldSendApolloPersonId({
    sourceProvider: input.sourceProvider,
    sourceContactId: input.sourceContactId,
  })
    ? clean(input.sourceContactId)
    : null;
  const email = clean(input.email);
  const linkedinUrl = clean(input.linkedinUrl);

  // Identidad fuerte obligatoria: sin Apollo id/email/linkedin confiable no
  // revelamos. Para candidatos no-Apollo, email/linkedin son la vía de match.
  const hasStrongIdentity = !!apolloId || !!email || !!linkedinUrl;
  if (!hasStrongIdentity) {
    return { ok: false, error: 'insufficient_identity' };
  }

  // webhook_url obligatoria para el reveal asíncrono (sin ella → HTTP 422).
  const webhookUrl = clean(input.webhookUrl);
  if (!webhookUrl) {
    return { ok: false, error: 'webhook_url_required' };
  }

  // Único punto autorizado para reveal_phone_number: true + webhook_url.
  const params: MatchPersonParams = {
    reveal_phone_number: true,
    webhook_url: webhookUrl,
  };

  if (apolloId) params.id = apolloId;
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
