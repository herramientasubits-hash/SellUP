// AGENT2-CONTACT-BANK-1 — Banco de contactos por empresa (núcleo puro)
//
// Lo que SellUp ya encontró (y a veces pagó) para OTRA ficha de la MISMA compañía —la que se
// archivó y volvió a entrar, o un duplicado del mismo vendedor— se ofrece como candidato a
// revisión antes de gastar Apollo o Lusha. Este núcleo decide qué entra y si basta para no
// llamar a los proveedores. Sin red ni Supabase.
//
// Qué entra: personas con nombre, encontradas hace menos de CONTACT_BANK_TTL_DAYS, que el
// clasificador de relevancia considere del perfil que busca UBITS y que no estén ya en esta
// empresa ni en esta corrida. Qué NO entra NUNCA: alguien marcado «no contactar» en cualquier
// ficha de la compañía, una persona con supresión del proveedor (DSAR) o un registro de
// Apollo/Lusha cuya identidad no se puede verificar contra esas supresiones.
//
// Qué NO copia: teléfonos ni `apollo_person_id` (ése sólo lo escribe el revelado). Los teléfonos
// tienen su propia cadena de procedencia y borrado; se piden por el flujo normal de revelado. El candidato conserva su ORIGEN real (apollo, lusha, hubspot) para
// que el revelado, las puertas de novedad y el borrado por persona sigan funcionando igual; de
// dónde salió queda en `enrichment_metadata.contact_bank`.

import { classifyContactRelevance } from './contact-relevance-classifier';
import { HUBSPOT_FIRST_MIN_RELEVANT_WITH_EMAIL } from './hubspot-first-core';
import {
  resolveAllPhoneRevealProviderIdentities,
  type ProviderSuppressionIdentity,
} from '@/modules/contact-enrichment/provider-suppression-core';

/** Un dato de contacto encontrado hace más de esto ya no se reutiliza: la gente cambia de cargo. */
export const CONTACT_BANK_TTL_DAYS = 180;

/** Misma regla que «Primero HubSpot»: con tantos relevantes con correo no se llama a proveedores. */
export const CONTACT_BANK_MIN_RELEVANT_WITH_EMAIL = HUBSPOT_FIRST_MIN_RELEVANT_WITH_EMAIL;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ContactBankCandidateSource = 'apollo' | 'lusha' | 'hubspot' | 'manual';

/** Una persona que SellUp ya conoce de otra ficha de la misma compañía. */
export interface ContactBankEntry {
  /** `contact` = contacto aprobado; `candidate` = candidato pendiente de una búsqueda anterior. */
  origin: 'contact' | 'candidate';
  originId: string;
  originAccountId: string | null;
  /** Origen tal como está guardado (`contacts.source` o `contact_enrichment_candidates.source`). */
  source: string;
  sourceContactId: string | null;
  apolloPersonId: string | null;
  hubspotContactId: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  title: string | null;
  seniority: string | null;
  department: string | null;
  country: string | null;
  linkedinUrl: string | null;
  email: string | null;
  confidence: number | null;
  /** Cuándo se encontró (o se actualizó por última vez) el dato. ISO. */
  foundAt: string;
}

/** Alguien que ya está en la empresa actual o en esta misma corrida. */
export interface ContactBankKnownPerson {
  email: string | null;
  linkedinUrl: string | null;
  source?: string | null;
  sourceContactId?: string | null;
}

export interface ContactBankBlocklist {
  /** Correos y LinkedIn marcados «no contactar» en cualquier ficha de la compañía. */
  doNotContact: readonly ContactBankKnownPerson[];
  /** Identidades `proveedor::id` con supresión vigente (DSAR, no contactar, legal). */
  suppressedProviderKeys: ReadonlySet<string>;
}

export interface ContactBankCandidateRow {
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  title: string | null;
  seniority: string | null;
  department: string | null;
  country: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: null;
  source: ContactBankCandidateSource;
  source_contact_id: string | null;
  matched_hubspot_contact_id: string | null;
  confidence: number;
  status: 'pending_review';
  duplicate_status: 'no_match';
  enrichment_metadata: Record<string, unknown>;
}

export interface ContactBankSelection {
  rows: ContactBankCandidateRow[];
  /** Cuántos de los nuevos tienen correo: lo que cuenta para saltarse a los proveedores. */
  relevantWithEmail: number;
  skippedNoName: number;
  skippedExpired: number;
  skippedBlocked: number;
  skippedUnverifiableIdentity: number;
  skippedKnown: number;
  skippedNotRelevant: number;
}

function emailKey(value: string | null | undefined): string | null {
  const key = value?.trim().toLowerCase();
  return key ? key : null;
}

function linkedinKey(value: string | null | undefined): string | null {
  const key = value
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  return key ? key : null;
}

function providerKey(source: string | null | undefined, id: string | null | undefined): string | null {
  const s = source?.trim().toLowerCase();
  const v = id?.trim();
  return s && v ? `${s}::${v}` : null;
}

export function suppressionKey(identity: ProviderSuppressionIdentity): string {
  return `${identity.provider}::${identity.providerPersonId}`;
}

/** Identidades del proveedor que hay que comprobar contra `provider_suppressions`. */
export function contactBankEntryIdentities(entry: ContactBankEntry): ProviderSuppressionIdentity[] {
  return resolveAllPhoneRevealProviderIdentities({
    apolloPersonId: entry.apolloPersonId,
    source: entry.source,
    sourceContactId: entry.sourceContactId,
  });
}

function mapSource(source: string): ContactBankCandidateSource {
  const s = source.trim().toLowerCase();
  if (s === 'apollo' || s === 'lusha' || s === 'hubspot') return s;
  // manual, agent_1, imported, other: el candidato sólo admite este vocabulario. El origen real
  // queda en enrichment_metadata.contact_bank.original_source.
  return 'manual';
}

function isProviderSource(source: string): boolean {
  const s = source.trim().toLowerCase();
  return s === 'apollo' || s === 'lusha';
}

class PersonIndex {
  private readonly emails = new Set<string>();
  private readonly linkedins = new Set<string>();
  private readonly providers = new Set<string>();

  add(person: ContactBankKnownPerson): void {
    const e = emailKey(person.email);
    const l = linkedinKey(person.linkedinUrl);
    const p = providerKey(person.source, person.sourceContactId);
    if (e) this.emails.add(e);
    if (l) this.linkedins.add(l);
    if (p) this.providers.add(p);
  }

  has(person: ContactBankKnownPerson): boolean {
    const e = emailKey(person.email);
    const l = linkedinKey(person.linkedinUrl);
    const p = providerKey(person.source, person.sourceContactId);
    return (e !== null && this.emails.has(e)) || (l !== null && this.linkedins.has(l)) || (p !== null && this.providers.has(p));
  }
}

/**
 * Orden de preferencia cuando la misma persona aparece varias veces: primero lo que una
 * persona ya aprobó (contacto), después lo más reciente.
 */
function byPreference(a: ContactBankEntry, b: ContactBankEntry): number {
  if (a.origin !== b.origin) return a.origin === 'contact' ? -1 : 1;
  return Date.parse(b.foundAt) - Date.parse(a.foundAt);
}

export function selectContactBankCandidates(input: {
  entries: readonly ContactBankEntry[];
  /** Contactos de la empresa actual y candidatos que ya están en esta corrida. */
  known: readonly ContactBankKnownPerson[];
  blocklist: ContactBankBlocklist;
  now: Date;
  ttlDays?: number;
}): ContactBankSelection {
  const ttlDays = input.ttlDays ?? CONTACT_BANK_TTL_DAYS;
  const cutoff = input.now.getTime() - ttlDays * DAY_MS;

  const known = new PersonIndex();
  for (const person of input.known) known.add(person);
  const doNotContact = new PersonIndex();
  for (const person of input.blocklist.doNotContact) doNotContact.add(person);

  const result: ContactBankSelection = {
    rows: [],
    relevantWithEmail: 0,
    skippedNoName: 0,
    skippedExpired: 0,
    skippedBlocked: 0,
    skippedUnverifiableIdentity: 0,
    skippedKnown: 0,
    skippedNotRelevant: 0,
  };

  for (const entry of [...input.entries].sort(byPreference)) {
    const fullName = entry.fullName?.trim();
    // `normalizeContactSnapshot` rellena «HubSpot Contact <id>» cuando no hay nombre: no es un nombre.
    if (!fullName || fullName.startsWith('HubSpot Contact ')) {
      result.skippedNoName += 1;
      continue;
    }
    const foundAt = Date.parse(entry.foundAt);
    if (!Number.isFinite(foundAt) || foundAt < cutoff) {
      result.skippedExpired += 1;
      continue;
    }

    const person: ContactBankKnownPerson = {
      email: entry.email,
      linkedinUrl: entry.linkedinUrl,
      source: entry.source,
      sourceContactId: entry.sourceContactId,
    };
    const identities = contactBankEntryIdentities(entry);
    if (doNotContact.has(person) || identities.some((id) => input.blocklist.suppressedProviderKeys.has(suppressionKey(id)))) {
      result.skippedBlocked += 1;
      continue;
    }
    // Un registro de Apollo/Lusha sin identidad resoluble no se puede comprobar contra las
    // supresiones del proveedor: se descarta (falla cerrado), igual que el revelado de teléfono.
    if (isProviderSource(entry.source) && identities.length === 0) {
      result.skippedUnverifiableIdentity += 1;
      continue;
    }
    if (known.has(person)) {
      result.skippedKnown += 1;
      continue;
    }

    const relevance = classifyContactRelevance({
      fullName,
      firstName: entry.firstName,
      lastName: entry.lastName,
      title: entry.title,
      email: entry.email,
      linkedinUrl: entry.linkedinUrl,
      phone: null,
    });
    if (!relevance.shouldInsertForReview) {
      result.skippedNotRelevant += 1;
      continue;
    }

    // La misma persona no entra dos veces aunque venga de dos fichas.
    known.add(person);
    const email = entry.email?.trim() || null;
    if (email) result.relevantWithEmail += 1;
    const source = mapSource(entry.source);
    result.rows.push({
      first_name: entry.firstName ?? null,
      last_name: entry.lastName ?? null,
      full_name: fullName,
      title: entry.title ?? null,
      seniority: entry.seniority ?? null,
      department: entry.department ?? null,
      country: entry.country ?? null,
      linkedin_url: entry.linkedinUrl ?? null,
      email,
      phone: null,
      source,
      source_contact_id: entry.sourceContactId ?? (source === 'hubspot' ? entry.hubspotContactId : null) ?? null,
      matched_hubspot_contact_id: entry.hubspotContactId ?? null,
      // Un contacto aprobado ya pasó por una persona; un candidato conserva su confianza original.
      confidence: entry.origin === 'contact' ? 1 : Math.max(0, Math.min(1, entry.confidence ?? 0)),
      status: 'pending_review',
      duplicate_status: 'no_match',
      enrichment_metadata: {
        contact_bank: {
          origin: entry.origin,
          origin_id: entry.originId,
          origin_account_id: entry.originAccountId,
          original_source: entry.source,
          found_at: entry.foundAt,
        },
        relevance: {
          status: relevance.relevanceStatus,
          category: relevance.matchedCategory,
          score: relevance.relevanceScore,
        },
      },
    });
  }
  return result;
}

/** ¿Lo que ya hay en la corrida más lo del banco basta para no gastar proveedores? */
export function isSatisfiedByContactBank(
  relevantWithEmail: number,
  min: number = CONTACT_BANK_MIN_RELEVANT_WITH_EMAIL,
): boolean {
  return relevantWithEmail >= min;
}
