/**
 * ¿Siguen en la empresa? — comprobación automática de los contactos de HubSpot al buscar
 * (CONTACT-CURRENT-EMPLOYMENT-SWEEP-1, feedback de líderes 25-11, caso Colineal).
 *
 * HubSpot guarda a la gente por años: en Colineal, 2 de los 6 contactos de HubSpot ya trabajaban en
 * otra empresa y la vendedora lo descubría revisando uno por uno. Ahora, al terminar la búsqueda y
 * ANTES de la aprobación automática, cada contacto de HubSpot nuevo se comprueba (dueña 25-11:
 * «Apollo y luego IA»):
 *
 *   1. Apollo `people/match` por correo (o LinkedIn): 1 crédito; trae su trabajo actual.
 *   2. Si Apollo no lo conoce o no sabe dónde trabaja, «Verificar con IA» (Claude + web).
 *
 * Nunca escribe en HubSpot ni guarda correos o LinkedIn nuevos: sólo la comprobación (y el id de
 * Apollo, que ahorra la identificación al revelar el teléfono). Núcleo con dependencias
 * inyectadas, sin red: falla abierto, contacto por contacto.
 */

import type {
  IdentityLookup,
  IdentityLookupQuery,
  IdentityProviderUsage,
} from './candidate-identity-completion-core';
import {
  CURRENT_EMPLOYMENT_METADATA_KEY,
  CURRENT_EMPLOYMENT_SNAPSHOT_KEY,
  assessCurrentEmployment,
  readCurrentEmploymentCheck,
  titleAfterEmploymentCheck,
  type CurrentEmploymentCheck,
  type CurrentEmploymentStatus,
} from './current-employment-check';

/** Tope por búsqueda (cada uno puede costar 1 crédito de Apollo y una consulta a Claude). */
export const MAX_EMPLOYMENT_SWEEP_CONTACTS = 25;
/** Contactos que se comprueban a la vez. */
export const EMPLOYMENT_SWEEP_CONCURRENCY = 3;
/** Una consulta a Claude con búsqueda web tarda hasta ~45 s: sin este margen no se empieza. */
export const EMPLOYMENT_SWEEP_AI_MIN_REMAINING_MS = 50_000;
/** Apollo responde en 1–2 s: sin este margen tampoco se empieza. */
export const EMPLOYMENT_SWEEP_APOLLO_MIN_REMAINING_MS = 8_000;

export interface EmploymentSweepCandidate {
  id: string;
  email: string | null;
  linkedinUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  apolloPersonId: string | null;
  companyName: string | null;
  companyDomain: string | null;
  enrichmentMetadata: Record<string, unknown>;
}

export interface EmploymentSweepApolloPatch {
  enrichment_metadata: Record<string, unknown>;
  title?: string;
  apollo_person_id?: string;
}

export interface EmploymentSweepDeps {
  /** Contactos de HubSpot de ESTA búsqueda que siguen «por revisar». */
  loadCandidates: () => Promise<EmploymentSweepCandidate[]>;
  /** Hay créditos de Apollo (la cuota de Proveedores lo permite). */
  apolloAvailable: () => Promise<boolean>;
  lookupApollo: (query: IdentityLookupQuery) => Promise<IdentityLookup>;
  logApolloUsage: (usage: readonly IdentityProviderUsage[], candidateId: string, channel: 'email' | 'linkedin') => Promise<void>;
  persistApollo: (candidateId: string, patch: EmploymentSweepApolloPatch) => Promise<void>;
  /** «Verificar con IA» de un contacto; null si no se pudo (sin Claude, sin cuota, error). */
  verifyWithAi: (candidateId: string) => Promise<CurrentEmploymentStatus | null>;
  nowIso: () => string;
  nowMs: () => number;
  /** Hora límite (ms): lo que no alcanza queda sin comprobar, como antes. */
  deadlineMs: number;
  maxContacts?: number;
  concurrency?: number;
}

export interface EmploymentSweepSummary {
  considered: number;
  apolloChecks: number;
  aiChecks: number;
  /** Ya no están en la empresa (otra empresa o sin trabajo actual). */
  left: number;
  confirmed: number;
  /** Quedaron sin saber (ni Apollo ni la web lo dijeron, o no alcanzó el tiempo). */
  unknown: number;
}

const LEFT: ReadonlySet<CurrentEmploymentStatus> = new Set(['other_company', 'no_current_role']);

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function plain(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Ya tiene una comprobación que dice algo: no se gasta de nuevo. */
export function needsEmploymentSweep(candidate: EmploymentSweepCandidate): boolean {
  const check = readCurrentEmploymentCheck(candidate.enrichmentMetadata[CURRENT_EMPLOYMENT_METADATA_KEY]);
  return !check || check.status === 'unknown';
}

/**
 * La persona que devolvió Apollo es la misma: el apellido coincide (o uno contiene al otro). Un
 * correo genérico o reciclado puede traer a otra persona, y su empleo no dice nada de la nuestra.
 */
export function apolloPersonMatchesCandidate(
  candidate: Pick<EmploymentSweepCandidate, 'firstName' | 'lastName'>,
  person: { firstName?: string | null; lastName?: string | null },
): boolean {
  const ours = clean(candidate.lastName) ? plain(candidate.lastName as string) : null;
  const theirs = clean(person.lastName) ? plain(person.lastName as string) : null;
  if (!ours || !theirs) return true;
  return ours === theirs || ` ${ours} `.includes(` ${theirs} `) || ` ${theirs} `.includes(` ${ours} `);
}

type ApolloOutcome = { check: CurrentEmploymentCheck } | { check: null };

async function checkWithApollo(
  candidate: EmploymentSweepCandidate,
  deps: EmploymentSweepDeps,
): Promise<ApolloOutcome> {
  const channel: 'email' | 'linkedin' | null = clean(candidate.email) ? 'email' : clean(candidate.linkedinUrl) ? 'linkedin' : null;
  if (!channel) return { check: null };
  const lookup = await deps.lookupApollo({
    channel,
    email: clean(candidate.email),
    linkedinUrl: clean(candidate.linkedinUrl),
    firstName: clean(candidate.firstName),
    lastName: clean(candidate.lastName),
    organizationName: clean(candidate.companyName),
    domain: clean(candidate.companyDomain),
    // Sólo el empleo: nunca se piden correos ni teléfonos.
    wantsEmail: false,
  });
  if (lookup.usage.length > 0) await deps.logApolloUsage(lookup.usage, candidate.id, channel).catch(() => undefined);
  if (lookup.kind !== 'found' || !apolloPersonMatchesCandidate(candidate, lookup.person)) return { check: null };

  const snapshot = lookup.person.currentEmployment ?? null;
  const check = assessCurrentEmployment({
    snapshot,
    shownTitle: clean(candidate.title),
    companyName: clean(candidate.companyName),
    companyDomain: clean(candidate.companyDomain),
    checkedAt: deps.nowIso(),
  });

  const patch: EmploymentSweepApolloPatch = {
    enrichment_metadata: {
      ...candidate.enrichmentMetadata,
      [CURRENT_EMPLOYMENT_METADATA_KEY]: check,
      ...(snapshot ? { [CURRENT_EMPLOYMENT_SNAPSHOT_KEY]: snapshot } : {}),
    },
  };
  const title = titleAfterEmploymentCheck(check, clean(candidate.title));
  if (title && title !== clean(candidate.title)) patch.title = title;
  const personId = clean(lookup.person.id);
  if (personId && !clean(candidate.apolloPersonId)) patch.apollo_person_id = personId;
  await deps.persistApollo(candidate.id, patch);
  return { check };
}

type SweepOneResult = { status: CurrentEmploymentStatus | null; apollo: boolean; ai: boolean };

async function sweepOne(candidate: EmploymentSweepCandidate, deps: EmploymentSweepDeps, apolloOk: boolean): Promise<SweepOneResult> {
  const remaining = () => deps.deadlineMs - deps.nowMs();
  let status: CurrentEmploymentStatus | null = null;
  let usedApollo = false;
  const previous = readCurrentEmploymentCheck(candidate.enrichmentMetadata[CURRENT_EMPLOYMENT_METADATA_KEY]);

  // Una comprobación de Apollo que ya dijo «no sé» no se repite: va directo a la IA.
  if (apolloOk && !previous && remaining() >= EMPLOYMENT_SWEEP_APOLLO_MIN_REMAINING_MS) {
    try {
      const outcome = await checkWithApollo(candidate, deps);
      usedApollo = true;
      status = outcome.check?.status ?? null;
    } catch (err) {
      console.error('[employment-sweep] apollo check failed', { candidateId: candidate.id, error: err instanceof Error ? err.message : err });
    }
  }
  if (status && status !== 'unknown') return { status, apollo: usedApollo, ai: false };

  if (remaining() < EMPLOYMENT_SWEEP_AI_MIN_REMAINING_MS) return { status, apollo: usedApollo, ai: false };
  try {
    const aiStatus = await deps.verifyWithAi(candidate.id);
    return { status: aiStatus ?? status, apollo: usedApollo, ai: aiStatus !== null };
  } catch (err) {
    console.error('[employment-sweep] ai check failed', { candidateId: candidate.id, error: err instanceof Error ? err.message : err });
    return { status, apollo: usedApollo, ai: false };
  }
}

export async function runEmploymentSweep(deps: EmploymentSweepDeps): Promise<EmploymentSweepSummary> {
  const summary: EmploymentSweepSummary = { considered: 0, apolloChecks: 0, aiChecks: 0, left: 0, confirmed: 0, unknown: 0 };
  const candidates = (await deps.loadCandidates())
    .filter(needsEmploymentSweep)
    .slice(0, deps.maxContacts ?? MAX_EMPLOYMENT_SWEEP_CONTACTS);
  if (candidates.length === 0) return summary;
  summary.considered = candidates.length;

  const apolloOk = await deps.apolloAvailable().catch(() => false);
  const queue = [...candidates];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const result = await sweepOne(next, deps, apolloOk);
      if (result.apollo) summary.apolloChecks += 1;
      if (result.ai) summary.aiChecks += 1;
      if (result.status && LEFT.has(result.status)) summary.left += 1;
      else if (result.status === 'confirmed' || result.status === 'title_changed') summary.confirmed += 1;
      else summary.unknown += 1;
    }
  };
  const workers = Math.max(1, Math.min(deps.concurrency ?? EMPLOYMENT_SWEEP_CONCURRENCY, candidates.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return summary;
}
