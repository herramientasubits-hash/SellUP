// TABLEROS-1 — El cálculo de los tableros, puro: recibe filas ya leídas (y ya
// limitadas al alcance de quien mira) y devuelve las cifras, series y tablas.
// Sin E/S, para probarlo sin base.
//
// Reglas (dueño 25-11):
//   - Sólo lo APROBADO/REVISADO es resultado («enriquecido»). Lo buscado y lo
//     pendiente por revisar es USO del sistema.
//   - El resultado se acredita a quien APROBÓ y se fecha cuando se aprobó. El uso
//     se acredita a quien buscó y se fecha cuando buscó.
//   - «Enriquecer empresa de HubSpot» (#894) no pasa por aprobación: se acredita
//     a quien lo pidió, cuando terminó.
//   - Empresas y contactos de todas las fuentes cuentan; el filtro de fuente
//     deja ver una, varias o todas, una a una o agrupadas.

import {
  bogotaDayOf,
  bucketKeyForIso,
  daysBetween,
  isWithinRange,
  listBuckets,
  type Bucket,
  type DashboardFilters,
  type Granularity,
  type ResolvedRange,
} from './dashboard-filters';
import {
  CONTACT_ORIGIN_LABELS,
  GROUPED_SOURCE_KEY,
  contactOriginOf,
  dashboardSourceLabel,
  normalizeDashboardSource,
  sortSourceKeys,
  sourcePassesFilter,
  type ContactOrigin,
} from './dashboard-sources';
import {
  COMPANY_APPROVED_STATUSES,
  COMPANY_FILLED_FIELD_LABELS,
  COMPANY_PENDING_STATUSES,
  COMPANY_REJECTED_STATUSES,
  CONTACT_APPROVED_STATUSES,
  CONTACT_COMPLETENESS_LABELS,
  CONTACT_COMPLETENESS_ORDER,
  CONTACT_PENDING_STATUSES,
  CONTACT_REJECTED_STATUSES,
  CONTACT_REQUEST_STATE_LABELS,
  CONTACT_REQUEST_STATE_ORDER,
  HUBSPOT_ENRICHED_STATUSES,
  HUBSPOT_OUTCOME_LABELS,
  SENIORITY_UNKNOWN,
  SIZE_UNKNOWN,
  completenessOf,
  contactRequestStateOf,
  hubspotFilledDataOf,
  seniorityLabel,
  sizeBandRank,
  type ContactCompleteness,
  type ContactRequestState,
} from './dashboard-dimensions';

// ── Filas de entrada ───────────────────────────────────────────────────────────

export interface DashboardPerson {
  id: string;
  name: string;
  email: string | null;
  groupId: string | null;
  groupName: string | null;
}

/** Una corrida de búsqueda de contactos (`contact_enrichment_runs`). */
export interface ContactRunRow {
  id: string;
  requestId: string | null;
  status: string;
  triggeredBy: string | null;
  createdAt: string;
  countryCode: string | null;
}

/** Un contacto candidato (`contact_enrichment_candidates`). */
export interface ContactCandidateRow {
  id: string;
  runId: string | null;
  status: string;
  source: string | null;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  hasLinkedin: boolean;
  seniority: string | null;
  matchedHubspotContactId: string | null;
  /** El país de la empresa de su búsqueda. */
  countryCode: string | null;
  /** Quien lanzó la búsqueda que lo encontró. */
  searchedBy: string | null;
}

/** El contacto oficial que salió de aprobar un candidato (lo que quedó en SellUp). */
export interface LinkedContactRow {
  candidateId: string;
  hasEmail: boolean;
  hasPhone: boolean;
  hasLinkedin: boolean;
  /** Propiedades de HubSpot que SellUp llenó (`metadata.hubspot_sync`). */
  filledHubspotProperties: string[];
}

/** Una búsqueda de empresas (`prospect_batches`). */
export interface CompanyBatchRow {
  id: string;
  createdBy: string | null;
  createdAt: string;
  countryCode: string | null;
}

/** Una empresa candidata (`prospect_candidates`). */
export interface CompanyCandidateRow {
  id: string;
  batchId: string | null;
  status: string;
  source: string | null;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  countryCode: string | null;
  industry: string | null;
  sizeBand: string;
  /** Quien lanzó la búsqueda que la encontró. */
  searchedBy: string | null;
}

/** «Enriquecer empresa de HubSpot» (#894): el último pedido de una empresa. */
export interface HubSpotEnrichmentRow {
  accountId: string;
  requestedBy: string | null;
  completedAt: string | null;
  status: string;
  filled: string[];
  countryCode: string | null;
  industry: string | null;
  sizeBand: string;
}

export interface DashboardInput {
  range: ResolvedRange;
  granularity: Granularity;
  /** Instante de «ahora» (ISO), para la antigüedad de lo pendiente. */
  now: string;
  filters: Pick<DashboardFilters, 'sources' | 'countries' | 'sourceView' | 'people'>;
  /** Las personas del alcance (después de los filtros de equipo y persona), en cero si no hicieron nada. */
  people: readonly DashboardPerson[];
  /** Búsquedas de contactos lanzadas en el periodo por gente del alcance. */
  contactRuns: readonly ContactRunRow[];
  /** Los candidatos que encontraron esas búsquedas. */
  foundContacts: readonly ContactCandidateRow[];
  /** Candidatos revisados en el periodo por gente del alcance (cualquiera los haya buscado). */
  reviewedContacts: readonly ContactCandidateRow[];
  linkedContacts: readonly LinkedContactRow[];
  /** Búsquedas de empresas lanzadas en el periodo por gente del alcance. */
  companyBatches: readonly CompanyBatchRow[];
  /** Las empresas que encontraron esas búsquedas. */
  foundCompanies: readonly CompanyCandidateRow[];
  /** Empresas revisadas en el periodo por gente del alcance. */
  reviewedCompanies: readonly CompanyCandidateRow[];
  /** Empresas de HubSpot enriquecidas en el periodo por gente del alcance. */
  hubspotEnrichments: readonly HubSpotEnrichmentRow[];
  /** Nombre de un país por su código (la UI lo inyecta). */
  countryLabel?: (code: string) => string;
}

// ── Salida ─────────────────────────────────────────────────────────────────────

export interface Series {
  key: string;
  label: string;
  values: (number | null)[];
}

export interface SeriesSet {
  buckets: Bucket[];
  series: Series[];
}

export interface CountItem {
  key: string;
  label: string;
  value: number;
}

export interface CompletenessBySource {
  source: string;
  label: string;
  total: number;
  parts: CountItem[];
}

export interface PersonRow {
  id: string;
  name: string;
  email: string | null;
  teamName: string;
  companySearches: number;
  contactRequests: number;
  companiesFound: number;
  contactsFound: number;
  pending: number;
  companiesEnriched: number;
  contactsEnriched: number;
  rejected: number;
  /** % aprobado sobre lo revisado (empresas y contactos). `null` = no revisó nada. */
  approvalRate: number | null;
  lastActivityAt: string | null;
}

export interface TeamRow {
  key: string;
  name: string;
  people: number;
  companySearches: number;
  contactRequests: number;
  found: number;
  pending: number;
  enriched: number;
  rejected: number;
  approvalRate: number | null;
}

export type PendingAgeKey = '0_2' | '3_7' | '8_plus';

export interface PendingAgeRow {
  key: PendingAgeKey;
  label: string;
  companies: number;
  contacts: number;
}

export interface DashboardData {
  buckets: Bucket[];
  usage: {
    companySearches: number;
    contactRequests: number;
    companiesFound: number;
    contactsFound: number;
    pendingCompanies: number;
    pendingContacts: number;
    activePeople: number;
    activeDays: number;
  };
  results: {
    /** Empresas aprobadas + empresas de HubSpot enriquecidas. */
    companiesEnriched: number;
    companiesApproved: number;
    hubspotCompaniesEnriched: number;
    hubspotNothingFound: number;
    companiesRejected: number;
    contactsEnriched: number;
    contactsFromHubspot: number;
    contactsNew: number;
    contactsRejected: number;
    /** % aprobado sobre todo lo revisado (empresas y contactos). */
    approvalRate: number | null;
    contactsFull: number;
    contactsFullRate: number | null;
  };
  pendingAging: PendingAgeRow[];
  /** Uso (encontrado) frente a resultado (enriquecido) por periodo. */
  overview: SeriesSet;
  companies: {
    results: SeriesSet;
    approvalRate: SeriesSet;
    bySource: CountItem[];
    byCountry: CountItem[];
    byIndustry: CountItem[];
    bySize: CountItem[];
    hubspotOutcome: CountItem[];
    filledFields: CountItem[];
  };
  contacts: {
    requestStates: SeriesSet;
    enrichmentRate: SeriesSet;
    results: SeriesSet;
    completeness: CountItem[];
    completenessBySource: CompletenessBySource[];
    seniority: CountItem[];
    origin: CountItem[];
    bySource: CountItem[];
    hubspotFilled: CountItem[];
  };
  people: PersonRow[];
  teams: TeamRow[];
  /** Resultados por persona y periodo, sólo con 2 a 8 personas elegidas. */
  comparison: SeriesSet | null;
}

export const COMPARISON_MIN_PEOPLE = 2;
export const COMPARISON_MAX_PEOPLE = 8;

const NO_TEAM_KEY = 'none';
const NO_TEAM_LABEL = 'Sin equipo';
const NO_COUNTRY_KEY = 'none';
const NO_COUNTRY_LABEL = 'Sin país';
const NO_INDUSTRY_LABEL = 'Sin industria';
const UNKNOWN_PERSON_LABEL = 'Persona sin acceso activo';

const PENDING_AGE_LABELS: Record<PendingAgeKey, string> = {
  '0_2': '0 a 2 días',
  '3_7': '3 a 7 días',
  '8_plus': 'Más de 7 días',
};

// ── Utilidades ─────────────────────────────────────────────────────────────────

/** Porcentaje con un decimal; `null` sin base. */
export function rate(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

class Counter {
  private readonly map = new Map<string, number>();
  add(key: string, amount = 1): void {
    this.map.set(key, (this.map.get(key) ?? 0) + amount);
  }
  get(key: string): number {
    return this.map.get(key) ?? 0;
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
  total(): number {
    let sum = 0;
    for (const value of this.map.values()) sum += value;
    return sum;
  }
}

/** Contador por (serie, cubeta). */
class BucketCounter {
  private readonly counters = new Map<string, Counter>();
  add(series: string, bucket: string | null, amount = 1): void {
    if (!bucket) return;
    const counter = this.counters.get(series) ?? new Counter();
    counter.add(bucket, amount);
    this.counters.set(series, counter);
  }
  seriesKeys(): string[] {
    return [...this.counters.keys()];
  }
  values(series: string, buckets: readonly Bucket[]): number[] {
    const counter = this.counters.get(series);
    return buckets.map((bucket) => counter?.get(bucket.key) ?? 0);
  }
}

function toItems(counter: Counter, label: (key: string) => string, order?: (a: string, b: string) => number): CountItem[] {
  const items = counter
    .keys()
    .map((key) => ({ key, label: label(key), value: counter.get(key) }))
    .filter((item) => item.value > 0);
  return items.sort(order ? (a, b) => order(a.key, b.key) : (a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

function pendingAgeKey(createdAt: string, today: string): PendingAgeKey {
  const day = bogotaDayOf(createdAt) ?? today;
  const age = daysBetween(day, today);
  if (age <= 2) return '0_2';
  if (age <= 7) return '3_7';
  return '8_plus';
}

// ── Cálculo ────────────────────────────────────────────────────────────────────

interface PersonAccumulator {
  companySearches: number;
  contactRequests: number;
  companiesFound: number;
  contactsFound: number;
  pending: number;
  companiesEnriched: number;
  contactsEnriched: number;
  rejected: number;
  lastActivityAt: string | null;
}

function emptyAccumulator(): PersonAccumulator {
  return {
    companySearches: 0,
    contactRequests: 0,
    companiesFound: 0,
    contactsFound: 0,
    pending: 0,
    companiesEnriched: 0,
    contactsEnriched: 0,
    rejected: 0,
    lastActivityAt: null,
  };
}

export function computeDashboard(input: DashboardInput): DashboardData {
  const { range, granularity, filters } = input;
  const buckets = listBuckets(range, granularity);
  const today = bogotaDayOf(input.now) ?? range.toDay;
  const countryLabel = input.countryLabel ?? ((code: string) => code);
  const grouped = filters.sourceView === 'grouped';
  const seriesKeyOf = (source: string) => (grouped ? GROUPED_SOURCE_KEY : source);

  const passesCountry = (code: string | null) =>
    filters.countries.length === 0 || (code !== null && filters.countries.includes(code.trim().toUpperCase()));
  /** La fuente normalizada si pasa el filtro de fuente; `null` si no cuenta. */
  const passingSource = (raw: string | null): string | null => {
    const source = normalizeDashboardSource(raw);
    if (source === null || !sourcePassesFilter(source, filters.sources)) return null;
    return source;
  };
  const inRange = (iso: string | null) => isWithinRange(iso, range);

  // ── Personas ──
  const accumulators = new Map<string, PersonAccumulator>();
  for (const person of input.people) accumulators.set(person.id, emptyAccumulator());
  const personAcc = (id: string | null): PersonAccumulator | null => {
    if (!id) return null;
    let acc = accumulators.get(id);
    if (!acc) {
      acc = emptyAccumulator();
      accumulators.set(id, acc);
    }
    return acc;
  };
  const touch = (acc: PersonAccumulator | null, at: string | null) => {
    if (acc) acc.lastActivityAt = laterOf(acc.lastActivityAt, at);
  };
  const activeDays = new Set<string>();
  const markDay = (iso: string | null) => {
    const day = bogotaDayOf(iso);
    if (day) activeDays.add(day);
  };

  const overview = new BucketCounter();
  const comparison = new BucketCounter();
  const comparing =
    filters.people.length >= COMPARISON_MIN_PEOPLE && filters.people.length <= COMPARISON_MAX_PEOPLE;
  const compareResult = (personId: string | null, iso: string | null) => {
    if (comparing && personId && filters.people.includes(personId)) {
      comparison.add(personId, bucketKeyForIso(iso, granularity));
    }
  };
  const pendingAging = new Map<PendingAgeKey, { companies: number; contacts: number }>([
    ['0_2', { companies: 0, contacts: 0 }],
    ['3_7', { companies: 0, contacts: 0 }],
    ['8_plus', { companies: 0, contacts: 0 }],
  ]);

  // ══ Empresas: uso ══
  let companySearches = 0;
  for (const batch of input.companyBatches) {
    if (!inRange(batch.createdAt) || !passesCountry(batch.countryCode)) continue;
    companySearches++;
    const acc = personAcc(batch.createdBy);
    if (acc) acc.companySearches++;
    touch(acc, batch.createdAt);
    markDay(batch.createdAt);
  }

  let companiesFound = 0;
  let pendingCompanies = 0;
  for (const company of input.foundCompanies) {
    if (!inRange(company.createdAt) || !passesCountry(company.countryCode)) continue;
    if (passingSource(company.source) === null) continue;
    companiesFound++;
    overview.add('found', bucketKeyForIso(company.createdAt, granularity));
    const acc = personAcc(company.searchedBy);
    if (acc) acc.companiesFound++;
    if (COMPANY_PENDING_STATUSES.has(company.status)) {
      pendingCompanies++;
      if (acc) acc.pending++;
      pendingAging.get(pendingAgeKey(company.createdAt, today))!.companies++;
    }
  }

  // ══ Empresas: resultado ══
  const companyResults = new BucketCounter();
  const companyApproved = new BucketCounter();
  const companyReviewed = new BucketCounter();
  const companiesBySource = new Counter();
  const companiesByCountry = new Counter();
  const companiesByIndustry = new Counter();
  const companiesBySize = new Counter();
  let companiesApproved = 0;
  let companiesRejected = 0;

  const countCompanyDimensions = (source: string, country: string | null, industry: string | null, size: string) => {
    companiesBySource.add(source);
    companiesByCountry.add(country?.trim().toUpperCase() || NO_COUNTRY_KEY);
    companiesByIndustry.add(industry?.trim() || NO_INDUSTRY_LABEL);
    companiesBySize.add(size || SIZE_UNKNOWN);
  };

  for (const company of input.reviewedCompanies) {
    if (!inRange(company.reviewedAt) || !passesCountry(company.countryCode)) continue;
    const source = passingSource(company.source);
    if (source === null) continue;
    const bucket = bucketKeyForIso(company.reviewedAt, granularity);
    const acc = personAcc(company.reviewedBy);
    touch(acc, company.reviewedAt);
    markDay(company.reviewedAt);
    if (COMPANY_APPROVED_STATUSES.has(company.status)) {
      companiesApproved++;
      if (acc) acc.companiesEnriched++;
      companyResults.add(seriesKeyOf(source), bucket);
      companyApproved.add('approved', bucket);
      companyReviewed.add('reviewed', bucket);
      overview.add('enriched', bucket);
      compareResult(company.reviewedBy, company.reviewedAt);
      countCompanyDimensions(source, company.countryCode, company.industry, company.sizeBand);
    } else if (COMPANY_REJECTED_STATUSES.has(company.status)) {
      companiesRejected++;
      if (acc) acc.rejected++;
      companyReviewed.add('reviewed', bucket);
    }
  }

  let hubspotCompaniesEnriched = 0;
  let hubspotNothingFound = 0;
  const hubspotOutcome = new Counter();
  const filledFields = new Counter();
  for (const enrichment of input.hubspotEnrichments) {
    if (!inRange(enrichment.completedAt) || !passesCountry(enrichment.countryCode)) continue;
    const source = passingSource('hubspot');
    if (source === null) continue;
    if (!(enrichment.status in HUBSPOT_OUTCOME_LABELS)) continue; // `running`: aún no terminó
    hubspotOutcome.add(enrichment.status);
    const acc = personAcc(enrichment.requestedBy);
    touch(acc, enrichment.completedAt);
    markDay(enrichment.completedAt);
    if (!HUBSPOT_ENRICHED_STATUSES.has(enrichment.status)) {
      hubspotNothingFound++;
      continue;
    }
    hubspotCompaniesEnriched++;
    if (acc) acc.companiesEnriched++;
    for (const field of new Set(enrichment.filled)) {
      if (field in COMPANY_FILLED_FIELD_LABELS) filledFields.add(field);
    }
    const bucket = bucketKeyForIso(enrichment.completedAt, granularity);
    companyResults.add(seriesKeyOf(source), bucket);
    overview.add('enriched', bucket);
    compareResult(enrichment.requestedBy, enrichment.completedAt);
    countCompanyDimensions(source, enrichment.countryCode, enrichment.industry, enrichment.sizeBand);
  }

  // ══ Contactos: uso ══
  const requestOf = new Map<string, string>(); // runId → requestKey
  const requests = new Map<string, { createdAt: string; searchedBy: string | null; countryCode: string | null; runStatuses: string[] }>();
  for (const run of input.contactRuns) {
    if (!inRange(run.createdAt)) continue;
    const key = run.requestId ?? run.id;
    requestOf.set(run.id, key);
    const current = requests.get(key);
    if (!current) {
      requests.set(key, {
        createdAt: run.createdAt,
        searchedBy: run.triggeredBy,
        countryCode: run.countryCode,
        runStatuses: [run.status],
      });
      continue;
    }
    current.runStatuses.push(run.status);
    current.countryCode = current.countryCode ?? run.countryCode;
    if (Date.parse(run.createdAt) < Date.parse(current.createdAt)) {
      current.createdAt = run.createdAt;
      current.searchedBy = run.triggeredBy ?? current.searchedBy;
    }
  }

  const candidateStatusesByRequest = new Map<string, string[]>();
  let contactsFound = 0;
  let pendingContacts = 0;
  for (const contact of input.foundContacts) {
    const requestKey = contact.runId ? requestOf.get(contact.runId) : undefined;
    if (!requestKey) continue;
    const request = requests.get(requestKey)!;
    if (!passesCountry(request.countryCode)) continue;
    if (passingSource(contact.source) === null) continue;
    const statuses = candidateStatusesByRequest.get(requestKey) ?? [];
    statuses.push(contact.status);
    candidateStatusesByRequest.set(requestKey, statuses);
    contactsFound++;
    overview.add('found', bucketKeyForIso(contact.createdAt, granularity));
    const acc = personAcc(contact.searchedBy ?? request.searchedBy);
    if (acc) acc.contactsFound++;
    if (CONTACT_PENDING_STATUSES.has(contact.status)) {
      pendingContacts++;
      if (acc) acc.pending++;
      pendingAging.get(pendingAgeKey(contact.createdAt, today))!.contacts++;
    }
  }

  const requestStates = new BucketCounter();
  const requestTotals = new BucketCounter();
  let contactRequests = 0;
  for (const [key, request] of requests) {
    if (!passesCountry(request.countryCode)) continue;
    contactRequests++;
    const acc = personAcc(request.searchedBy);
    if (acc) acc.contactRequests++;
    touch(acc, request.createdAt);
    markDay(request.createdAt);
    const state = contactRequestStateOf({
      runStatuses: request.runStatuses,
      candidateStatuses: candidateStatusesByRequest.get(key) ?? [],
    });
    const bucket = bucketKeyForIso(request.createdAt, granularity);
    requestStates.add(state, bucket);
    requestTotals.add('all', bucket);
  }

  // ══ Contactos: resultado ══
  const linkedByCandidate = new Map(input.linkedContacts.map((row) => [row.candidateId, row]));
  const contactResults = new BucketCounter();
  const contactsBySource = new Counter();
  const completeness = new Counter();
  const completenessPerSource = new Map<string, Counter>();
  const seniority = new Counter();
  const origin = new Counter();
  const hubspotFilled = new Counter();
  let contactsEnriched = 0;
  let contactsRejected = 0;
  let contactsFull = 0;
  const originCount: Record<ContactOrigin, number> = { hubspot_existing: 0, new: 0 };

  for (const contact of input.reviewedContacts) {
    if (!inRange(contact.reviewedAt) || !passesCountry(contact.countryCode)) continue;
    const source = passingSource(contact.source);
    if (source === null) continue;
    const acc = personAcc(contact.reviewedBy);
    touch(acc, contact.reviewedAt);
    markDay(contact.reviewedAt);
    if (CONTACT_REJECTED_STATUSES.has(contact.status)) {
      contactsRejected++;
      if (acc) acc.rejected++;
      continue;
    }
    if (!CONTACT_APPROVED_STATUSES.has(contact.status)) continue;

    contactsEnriched++;
    if (acc) acc.contactsEnriched++;
    const bucket = bucketKeyForIso(contact.reviewedAt, granularity);
    contactResults.add(seriesKeyOf(source), bucket);
    overview.add('enriched', bucket);
    compareResult(contact.reviewedBy, contact.reviewedAt);
    contactsBySource.add(source);

    const linked = linkedByCandidate.get(contact.id);
    const state: ContactCompleteness = completenessOf({
      hasEmail: contact.hasEmail || Boolean(linked?.hasEmail),
      hasPhone: contact.hasPhone || Boolean(linked?.hasPhone),
      hasLinkedin: contact.hasLinkedin || Boolean(linked?.hasLinkedin),
    });
    completeness.add(state);
    if (state === 'full') contactsFull++;
    const perSource = completenessPerSource.get(source) ?? new Counter();
    perSource.add(state);
    completenessPerSource.set(source, perSource);

    seniority.add(seniorityLabel(contact.seniority));
    const contactOrigin = contactOriginOf({ source, matchedHubspotContactId: contact.matchedHubspotContactId });
    origin.add(contactOrigin);
    originCount[contactOrigin]++;
    if (linked) for (const label of hubspotFilledDataOf(linked.filledHubspotProperties)) hubspotFilled.add(label);
  }

  // ── Series ──
  const sourceSeries = (counter: BucketCounter): Series[] =>
    sortSourceKeys(counter.seriesKeys()).map((key) => ({
      key,
      label: dashboardSourceLabel(key),
      values: counter.values(key, buckets),
    }));

  const approvedPerBucket = companyApproved.values('approved', buckets);
  const reviewedPerBucket = companyReviewed.values('reviewed', buckets);
  const requestTotalsPerBucket = requestTotals.values('all', buckets);
  const enrichedRequestsPerBucket = requestStates.values('enriched', buckets);

  // ── Personas y equipos ──
  const knownPeople = new Map(input.people.map((person) => [person.id, person]));
  const people: PersonRow[] = [...accumulators.entries()].map(([id, acc]) => {
    const person = knownPeople.get(id);
    const reviewed = acc.companiesEnriched + acc.contactsEnriched + acc.rejected;
    return {
      id,
      name: person?.name ?? UNKNOWN_PERSON_LABEL,
      email: person?.email ?? null,
      teamName: person?.groupName ?? NO_TEAM_LABEL,
      companySearches: acc.companySearches,
      contactRequests: acc.contactRequests,
      companiesFound: acc.companiesFound,
      contactsFound: acc.contactsFound,
      pending: acc.pending,
      companiesEnriched: acc.companiesEnriched,
      contactsEnriched: acc.contactsEnriched,
      rejected: acc.rejected,
      approvalRate: rate(acc.companiesEnriched + acc.contactsEnriched, reviewed),
      lastActivityAt: acc.lastActivityAt,
    };
  });
  people.sort(
    (a, b) =>
      b.companiesEnriched + b.contactsEnriched - (a.companiesEnriched + a.contactsEnriched) ||
      b.companiesFound + b.contactsFound - (a.companiesFound + a.contactsFound) ||
      a.name.localeCompare(b.name),
  );

  const teamMap = new Map<string, TeamRow & { reviewed: number }>();
  for (const row of people) {
    const person = knownPeople.get(row.id);
    const key = person?.groupId ?? NO_TEAM_KEY;
    const team = teamMap.get(key) ?? {
      key,
      name: person?.groupName ?? NO_TEAM_LABEL,
      people: 0,
      companySearches: 0,
      contactRequests: 0,
      found: 0,
      pending: 0,
      enriched: 0,
      rejected: 0,
      approvalRate: null,
      reviewed: 0,
    };
    team.people++;
    team.companySearches += row.companySearches;
    team.contactRequests += row.contactRequests;
    team.found += row.companiesFound + row.contactsFound;
    team.pending += row.pending;
    team.enriched += row.companiesEnriched + row.contactsEnriched;
    team.rejected += row.rejected;
    team.reviewed += row.companiesEnriched + row.contactsEnriched + row.rejected;
    teamMap.set(key, team);
  }
  const teams: TeamRow[] = [...teamMap.values()]
    .map(({ reviewed, ...team }) => ({ ...team, approvalRate: rate(team.enriched, reviewed) }))
    .sort((a, b) => b.enriched - a.enriched || b.found - a.found || a.name.localeCompare(b.name));

  const activePeople = people.filter(
    (row) =>
      row.companySearches + row.contactRequests + row.companiesEnriched + row.contactsEnriched + row.rejected > 0,
  ).length;

  const companiesEnriched = companiesApproved + hubspotCompaniesEnriched;
  const reviewedTotal = companiesEnriched + companiesRejected + contactsEnriched + contactsRejected;

  return {
    buckets,
    usage: {
      companySearches,
      contactRequests,
      companiesFound,
      contactsFound,
      pendingCompanies,
      pendingContacts,
      activePeople,
      activeDays: activeDays.size,
    },
    results: {
      companiesEnriched,
      companiesApproved,
      hubspotCompaniesEnriched,
      hubspotNothingFound,
      companiesRejected,
      contactsEnriched,
      contactsFromHubspot: originCount.hubspot_existing,
      contactsNew: originCount.new,
      contactsRejected,
      approvalRate: rate(companiesEnriched + contactsEnriched, reviewedTotal),
      contactsFull,
      contactsFullRate: rate(contactsFull, contactsEnriched),
    },
    pendingAging: (['0_2', '3_7', '8_plus'] as const).map((key) => ({
      key,
      label: PENDING_AGE_LABELS[key],
      ...pendingAging.get(key)!,
    })),
    overview: {
      buckets,
      series: [
        { key: 'found', label: 'Encontrado (uso)', values: overview.values('found', buckets) },
        { key: 'enriched', label: 'Enriquecido (resultado)', values: overview.values('enriched', buckets) },
      ],
    },
    companies: {
      results: { buckets, series: sourceSeries(companyResults) },
      approvalRate: {
        buckets,
        series: [
          {
            key: 'rate',
            label: 'Tasa de aprobación',
            values: buckets.map((_, i) => rate(approvedPerBucket[i], reviewedPerBucket[i])),
          },
        ],
      },
      bySource: toItems(companiesBySource, dashboardSourceLabel),
      byCountry: toItems(companiesByCountry, (key) => (key === NO_COUNTRY_KEY ? NO_COUNTRY_LABEL : countryLabel(key))),
      byIndustry: toItems(companiesByIndustry, (key) => key),
      bySize: toItems(companiesBySize, (key) => key, (a, b) => sizeBandRank(a) - sizeBandRank(b)),
      hubspotOutcome: toItems(hubspotOutcome, (key) => HUBSPOT_OUTCOME_LABELS[key] ?? key),
      filledFields: toItems(filledFields, (key) => COMPANY_FILLED_FIELD_LABELS[key] ?? key),
    },
    contacts: {
      requestStates: {
        buckets,
        series: CONTACT_REQUEST_STATE_ORDER.map((state: ContactRequestState) => ({
          key: state,
          label: CONTACT_REQUEST_STATE_LABELS[state],
          values: requestStates.values(state, buckets),
        })).filter((series) => series.values.some((value) => (value ?? 0) > 0)),
      },
      enrichmentRate: {
        buckets,
        series: [
          {
            key: 'rate',
            label: 'Tasa de enriquecimiento',
            values: buckets.map((_, i) => rate(enrichedRequestsPerBucket[i], requestTotalsPerBucket[i])),
          },
        ],
      },
      results: { buckets, series: sourceSeries(contactResults) },
      completeness: toItems(
        completeness,
        (key) => CONTACT_COMPLETENESS_LABELS[key as ContactCompleteness],
        (a, b) =>
          CONTACT_COMPLETENESS_ORDER.indexOf(a as ContactCompleteness) -
          CONTACT_COMPLETENESS_ORDER.indexOf(b as ContactCompleteness),
      ),
      completenessBySource: sortSourceKeys(completenessPerSource.keys()).map((source) => {
        const counter = completenessPerSource.get(source)!;
        return {
          source,
          label: dashboardSourceLabel(source),
          total: counter.total(),
          parts: CONTACT_COMPLETENESS_ORDER.map((state) => ({
            key: state,
            label: CONTACT_COMPLETENESS_LABELS[state],
            value: counter.get(state),
          })),
        };
      }),
      seniority: toItems(seniority, (key) => key, (a, b) => {
        if (a === SENIORITY_UNKNOWN) return 1;
        if (b === SENIORITY_UNKNOWN) return -1;
        return seniority.get(b) - seniority.get(a) || a.localeCompare(b);
      }),
      origin: toItems(origin, (key) => CONTACT_ORIGIN_LABELS[key as ContactOrigin]),
      bySource: toItems(contactsBySource, dashboardSourceLabel),
      hubspotFilled: toItems(hubspotFilled, (key) => key),
    },
    people,
    teams,
    comparison: comparing
      ? {
          buckets,
          series: filters.people.map((id) => ({
            key: id,
            label: knownPeople.get(id)?.name ?? UNKNOWN_PERSON_LABEL,
            values: comparison.values(id, buckets),
          })),
        }
      : null,
  };
}
