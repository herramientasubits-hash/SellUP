// Agente 2A — Lo que SellUp revela de un candidato viaja SOLO a su contacto de HubSpot
// (AGENT2A-HUBSPOT-REVEAL-PUSH).
//
// Un candidato que ya existe en HubSpot («Primero HubSpot», o uno emparejado con un contacto de
// HubSpot) puede revelar teléfono, LinkedIn o correo en SellUp. Antes, ese dato sólo llegaba a
// HubSpot si alguien APROBABA el candidato. Ahora llega en cuanto se revela, sin esperar a la
// aprobación.
//
// Reglas (las mismas del completado de vacíos al aprobar, #612 / #828):
//   * SÓLO se completan propiedades VACÍAS en HubSpot. Nunca se sobrescribe lo que el CRM tiene.
//   * Sólo viajan los canales que el reveal produce: `phone`, `hs_linkedin_url` y el correo.
//     Nombre y cargo no: el candidato los trajo de HubSpot.
//   * El correo va en un PATCH aparte: HubSpot rechaza (409) un correo que ya usa otro contacto,
//     y ese rechazo no puede impedir que el teléfono y el LinkedIn lleguen.
//   * Sin conexión, sin permiso de escritura o sin poder LEER el contacto, no se escribe nada:
//     no saber qué está vacío no autoriza a escribir.
//   * NUNCA lanza. El reveal ya ocurrió y ya se cobró; HubSpot no puede convertirlo en un fallo.
//
// Sin red, sin DB, sin reloj propios: todo inyectado.

import {
  buildHubSpotFillEmptyProperties,
  type ContactForSync,
  type HubSpotContactFillProperties,
  type HubSpotExistingContactMatch,
} from '@/modules/contacts/contact-hubspot-sync-core';
import type { HubSpotFillEmptyPropertyName } from '@/modules/contacts/contact-hubspot-sync-core';

export const CANDIDATE_REVEAL_HUBSPOT_PUSH_HITO = 'AGENT2A-HUBSPOT-REVEAL-PUSH';

/** Clave en `contact_enrichment_candidates.enrichment_metadata` donde queda el rastro. */
export const CANDIDATE_REVEAL_HUBSPOT_PUSH_METADATA_KEY = 'hubspot_reveal_push';

/** Qué canales produce un reveal y pueden viajar a HubSpot. */
const REVEAL_PROPERTY_NAMES: readonly HubSpotFillEmptyPropertyName[] = ['phone', 'hs_linkedin_url'];

/** De dónde vino el dato revelado (para el rastro; nunca el valor). */
export type CandidateRevealPushTrigger =
  | 'reveal_linkedin'
  | 'reveal_email'
  | 'reveal_phone_apollo_webhook'
  | 'reveal_phone_lusha_waterfall'
  | 'reveal_phone_recovery'
  | 'reveal_phone_cache_hit';

export type CandidateRevealPushOutcome =
  /** El candidato no se pudo leer. */
  | 'candidate_unavailable'
  /** El candidato no tiene contacto en HubSpot (Apollo/Lusha sin emparejar): nada que hacer. */
  | 'not_in_hubspot'
  /** Candidato rechazado: no se escribe nada en el CRM por él. */
  | 'candidate_rejected'
  /** No hay teléfono, LinkedIn ni correo que enviar. */
  | 'nothing_revealed'
  /** HubSpot no está conectado o la conexión no puede escribir contactos. */
  | 'hubspot_unavailable'
  /** No se pudo leer el contacto de HubSpot: no se sabe qué está vacío, no se escribe. */
  | 'hubspot_contact_unreadable'
  /** HubSpot ya tenía todo lo revelado: cero escrituras. */
  | 'nothing_to_fill'
  /** Se completó al menos una propiedad vacía. */
  | 'filled'
  /** Se intentó escribir y HubSpot lo rechazó todo. */
  | 'failed';

export interface CandidateRevealPushCandidate {
  id: string;
  status: string | null;
  source: string | null;
  sourceContactId: string | null;
  matchedHubSpotContactId: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  email: string | null;
  enrichmentMetadata: Record<string, unknown>;
}

export interface CandidateRevealPushReport {
  outcome: CandidateRevealPushOutcome;
  hubspotContactId: string | null;
  /** Propiedades que HubSpot aceptó (nombres, nunca valores). */
  properties: HubSpotFillEmptyPropertyName[];
  /** Resultado del PATCH del correo, aparte. `null` = no se intentó. */
  email: 'filled' | 'failed' | null;
  error: string | null;
}

export interface CandidateRevealPushDeps {
  nowIso: string;
  loadCandidate: (candidateId: string) => Promise<CandidateRevealPushCandidate | null>;
  checkConnection: () => Promise<{ connected: boolean; canWriteContacts: boolean }>;
  findHubSpotContactById: (hubspotContactId: string) => Promise<HubSpotExistingContactMatch | null>;
  fillEmptyHubSpotContactProperties: (
    hubspotContactId: string,
    properties: HubSpotContactFillProperties,
  ) => Promise<{ ok: true; written: HubSpotFillEmptyPropertyName[] } | { error: string }>;
  fillEmptyHubSpotContactEmail: (
    hubspotContactId: string,
    email: string,
  ) => Promise<{ ok: true } | { error: string }>;
  /** Best-effort: guarda el rastro en el candidato. Su fallo no cambia el informe. */
  persistTrace: (candidateId: string, enrichmentMetadata: Record<string, unknown>) => Promise<void>;
}

function clean(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function shortError(err: unknown, fallback: string): string {
  // Sólo el inicio del mensaje: los errores de HubSpot pueden citar el valor enviado.
  return err instanceof Error ? err.message.slice(0, 120) : fallback;
}

/**
 * El contacto de HubSpot del candidato. El emparejamiento explícito manda; si no lo hay, un
 * candidato de origen HubSpot ES ese contacto (`source_contact_id`).
 */
export function resolveCandidateHubSpotContactId(
  candidate: Pick<CandidateRevealPushCandidate, 'source' | 'sourceContactId' | 'matchedHubSpotContactId'>,
): string | null {
  const matched = clean(candidate.matchedHubSpotContactId);
  if (matched) return matched;
  if (candidate.source === 'hubspot') return clean(candidate.sourceContactId);
  return null;
}

/**
 * Las propiedades revelables que HubSpot tiene VACÍAS. `null` = no se pudieron leer las
 * propiedades de HubSpot (no se escribe nada).
 */
export function buildCandidateRevealFill(
  candidate: Pick<CandidateRevealPushCandidate, 'id' | 'phone' | 'linkedinUrl'>,
  existing: HubSpotExistingContactMatch,
): HubSpotContactFillProperties | null {
  // Se reutiliza EL constructor del completado de vacíos (misma normalización del LinkedIn, misma
  // definición de «vacío»), sin nombre ni cargo: no los produce un reveal.
  const asContact: ContactForSync = {
    id: candidate.id,
    account_id: null,
    full_name: '',
    first_name: null,
    last_name: null,
    email: null,
    phone: clean(candidate.phone),
    mobile_phone: null,
    job_title: null,
    linkedin_url: clean(candidate.linkedinUrl),
    hubspot_contact_id: null,
    metadata: {},
  };
  const fill = buildHubSpotFillEmptyProperties(asContact, existing.properties);
  if (fill === null) return null;
  const onlyRevealed: HubSpotContactFillProperties = {};
  for (const name of REVEAL_PROPERTY_NAMES) {
    const value = fill[name];
    if (value) onlyRevealed[name] = value;
  }
  return onlyRevealed;
}

/** Rastro sin PII: qué pasó, cuándo y qué propiedades se escribieron, nunca los valores. */
export function writeCandidateRevealPushTrace(
  metadata: Record<string, unknown>,
  report: CandidateRevealPushReport,
  trigger: CandidateRevealPushTrigger,
  nowIso: string,
): Record<string, unknown> {
  const previous = metadata[CANDIDATE_REVEAL_HUBSPOT_PUSH_METADATA_KEY];
  const previousProperties =
    previous && typeof previous === 'object' && !Array.isArray(previous)
      ? ((previous as Record<string, unknown>).properties_filled as unknown)
      : null;
  const accumulated = new Set<string>(Array.isArray(previousProperties) ? (previousProperties as string[]) : []);
  for (const name of report.properties) accumulated.add(name);
  if (report.email === 'filled') accumulated.add('email');
  return {
    ...metadata,
    [CANDIDATE_REVEAL_HUBSPOT_PUSH_METADATA_KEY]: {
      hito: CANDIDATE_REVEAL_HUBSPOT_PUSH_HITO,
      last_at: nowIso,
      last_trigger: trigger,
      last_outcome: report.outcome,
      last_error: report.error,
      hubspot_contact_id: report.hubspotContactId,
      // Todo lo que alguna vez se completó desde un reveal de este candidato.
      properties_filled: [...accumulated].sort(),
    },
  };
}

/**
 * Envía a HubSpot lo revelado del candidato (sólo vacíos). NUNCA lanza.
 */
export async function runCandidateRevealHubSpotPush(
  candidateId: string,
  trigger: CandidateRevealPushTrigger,
  deps: CandidateRevealPushDeps,
): Promise<CandidateRevealPushReport> {
  const report = (
    outcome: CandidateRevealPushOutcome,
    extra: Partial<CandidateRevealPushReport> = {},
  ): CandidateRevealPushReport => ({
    outcome,
    hubspotContactId: null,
    properties: [],
    email: null,
    error: null,
    ...extra,
  });

  let candidate: CandidateRevealPushCandidate | null;
  try {
    candidate = await deps.loadCandidate(candidateId);
  } catch {
    return report('candidate_unavailable');
  }
  if (!candidate) return report('candidate_unavailable');

  const hubspotContactId = resolveCandidateHubSpotContactId(candidate);
  if (!hubspotContactId) return report('not_in_hubspot');
  if (candidate.status === 'rejected') return report('candidate_rejected', { hubspotContactId });

  const phone = clean(candidate.phone);
  const linkedin = clean(candidate.linkedinUrl);
  const email = clean(candidate.email)?.toLowerCase() ?? null;
  if (!phone && !linkedin && !email) return report('nothing_revealed', { hubspotContactId });

  // A partir de aquí hay un contacto de HubSpot y algo que enviar: el desenlace se anota.
  const finish = async (final: CandidateRevealPushReport): Promise<CandidateRevealPushReport> => {
    try {
      await deps.persistTrace(
        candidate!.id,
        writeCandidateRevealPushTrace(candidate!.enrichmentMetadata, final, trigger, deps.nowIso),
      );
    } catch {
      // Ver `persistTrace`: el rastro no puede convertirse en el hecho reportado.
    }
    return final;
  };

  let existing: HubSpotExistingContactMatch | null;
  try {
    const connection = await deps.checkConnection();
    if (!connection.connected || !connection.canWriteContacts) {
      return finish(report('hubspot_unavailable', { hubspotContactId }));
    }
    existing = await deps.findHubSpotContactById(hubspotContactId);
  } catch (err) {
    return finish(
      report('hubspot_contact_unreadable', { hubspotContactId, error: shortError(err, 'HUBSPOT_READ_ERROR') }),
    );
  }
  if (!existing) return finish(report('hubspot_contact_unreadable', { hubspotContactId }));

  const fill = buildCandidateRevealFill(candidate, existing);
  if (fill === null) return finish(report('hubspot_contact_unreadable', { hubspotContactId }));

  let properties: HubSpotFillEmptyPropertyName[] = [];
  let propertiesError: string | null = null;
  if (Object.keys(fill).length > 0) {
    try {
      const written = await deps.fillEmptyHubSpotContactProperties(existing.id, fill);
      if ('error' in written) propertiesError = written.error;
      else properties = written.written;
    } catch (err) {
      propertiesError = shortError(err, 'HUBSPOT_FILL_ERROR');
    }
  }

  // El correo, sólo si se LEYÓ y está vacío en HubSpot. `undefined` = no se leyó ⇒ no se escribe.
  let emailOutcome: 'filled' | 'failed' | null = null;
  let emailError: string | null = null;
  if (email && existing.email !== undefined && !clean(existing.email)) {
    try {
      const written = await deps.fillEmptyHubSpotContactEmail(existing.id, email);
      if ('error' in written) {
        emailOutcome = 'failed';
        emailError = written.error;
      } else {
        emailOutcome = 'filled';
      }
    } catch (err) {
      emailOutcome = 'failed';
      emailError = shortError(err, 'HUBSPOT_EMAIL_FILL_ERROR');
    }
  }

  const anyFilled = properties.length > 0 || emailOutcome === 'filled';
  const anyFailed = propertiesError !== null || emailOutcome === 'failed';
  const outcome: CandidateRevealPushOutcome = anyFilled ? 'filled' : anyFailed ? 'failed' : 'nothing_to_fill';
  return finish(
    report(outcome, {
      hubspotContactId: existing.id,
      properties,
      email: emailOutcome,
      error: propertiesError ?? emailError,
    }),
  );
}
