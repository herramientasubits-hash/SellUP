/**
 * Agente 1 · Búsqueda en árbol — una corrida completa, por el camino del Agente 1
 * (AGENT1-CORPORATE-TREE-2; puro: todo lo que toca red o base se inyecta).
 *
 *   1. Valida lo que mandó el navegador.
 *   2. Reserva el lote del Agente 1 AL EMPEZAR (Búsquedas, Centro de procesos, Uso de IA).
 *   3. PRIMERO lo gratis: registros oficiales de cada país y banco, por nombre.
 *   4. Claude busca sólo lo que falta (matriz, filiales con otro nombre, otros países).
 *   5. Escribe por las vías de siempre: capa gratuita, escritor del Agente 1, y
 *      «Descartadas» sin web (el rescate les busca la web).
 *   6. Etiqueta cada fila con su rama, guarda las asociaciones, sella el lote y
 *      programa el rescate.
 *
 * Sin Apollo ni Lusha (decisión de la dueña, 14-10). Lo único que se paga es Claude,
 * y cada llamada queda en Uso de IA con el lote.
 */

import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import {
  CORPORATE_TREE_BRANCHES,
  CORPORATE_TREE_LIMITS,
  CORPORATE_TREE_METADATA_KEY,
  type CorporateTreeBranch,
  type CorporateTreeCandidateMetadata,
  type CorporateTreeRelation,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import type { CorporateTreeSearchInput, CorporateTreeSearchOutcome, TreeCountry } from './corporate-tree-search';
import type { CorporateTreeFreeHit } from './corporate-tree-free-lookup';
import {
  markKnownCompanies,
  planCorporateTreeWrites,
  promoteGroupCompaniesWithTaxIds,
  promoteRowsFoundInApollo,
  type CorporateTreeApolloMatch,
  type CorporateTreeKnownCompany,
  type CorporateTreePossibleDuplicate,
  type CorporateTreePlannedRow,
  type CorporateTreeRoot,
  type CorporateTreeWebItem,
  type CorporateTreeWritePlan,
} from './corporate-tree-plan';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export type CorporateTreeRequest = {
  clientRequestId: string;
  rootName: string;
  rootWebsite: string | null;
  rootCountryCode: string | null;
  rootCandidateId: string | null;
  rootAccountId: string | null;
  branches: CorporateTreeBranch[];
  countries: TreeCountry[];
};

export type CorporateTreeRequestError = 'invalid_request' | 'root_name_required' | 'branches_required' | 'countries_required';

function optionalString(value: unknown, max = 300): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(CONTROL_CHARS, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}

function optionalUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

/** Lo que llega del navegador es dato no confiable: se valida campo por campo. */
export function parseCorporateTreeRequest(raw: unknown): { ok: true; request: CorporateTreeRequest } | { ok: false; error: CorporateTreeRequestError } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid_request' };
  const body = raw as Record<string, unknown>;
  const clientRequestId = optionalUuid(body.clientRequestId);
  if (!clientRequestId) return { ok: false, error: 'invalid_request' };

  const rootName = optionalString(body.rootName, CORPORATE_TREE_LIMITS.rootNameMaxChars);
  if (!rootName || rootName.length < CORPORATE_TREE_LIMITS.rootNameMinChars) return { ok: false, error: 'root_name_required' };

  const branches = Array.isArray(body.branches)
    ? CORPORATE_TREE_BRANCHES.filter((b) => (body.branches as unknown[]).includes(b))
    : [];
  if (branches.length === 0) return { ok: false, error: 'branches_required' };

  const requestedCodes = Array.isArray(body.countryCodes) ? (body.countryCodes as unknown[]).filter((c): c is string => typeof c === 'string') : [];
  const countries = LATAM_COUNTRIES.filter((c) => requestedCodes.includes(c.code));
  if (countries.length === 0) return { ok: false, error: 'countries_required' };

  const rootCountry = optionalString(body.rootCountryCode, 2)?.toUpperCase() ?? null;
  return {
    ok: true,
    request: {
      clientRequestId,
      rootName,
      rootWebsite: optionalString(body.rootWebsite),
      rootCountryCode: rootCountry && LATAM_COUNTRIES.some((c) => c.code === rootCountry) ? rootCountry : null,
      rootCandidateId: optionalUuid(body.rootCandidateId),
      rootAccountId: optionalUuid(body.rootAccountId),
      branches,
      countries: countries.map((c) => ({ code: c.code, name: c.name })),
    },
  };
}

export type CorporateTreeStage =
  | 'tree_free'
  | 'tree_searching'
  | 'tree_branch_1'
  | 'tree_branch_2'
  | 'tree_checking'
  | 'tree_saving';

/** La etapa que se anota cuando termina la rama número `done` (de `total`). */
export function branchDoneStage(done: number, total: number): CorporateTreeStage | null {
  if (done >= total) return null;
  return done === 1 ? 'tree_branch_1' : done === 2 ? 'tree_branch_2' : null;
}

export type CorporateTreeBatchCandidate = {
  id: string;
  name: string;
  country_code: string | null;
  domain: string | null;
  status: string;
  matched_hubspot_company_id: string | null;
  metadata: Record<string, unknown> | null;
};

export type CorporateTreeRelationshipRow = {
  batch_id: string;
  run_id: string;
  root_name: string;
  root_country_code: string | null;
  root_domain: string | null;
  root_candidate_id: string | null;
  root_account_id: string | null;
  related_candidate_id: string | null;
  related_name: string;
  related_country_code: string | null;
  related_domain: string | null;
  relation_type: CorporateTreeRelation;
  relation_detail: string | null;
  evidence_url: string | null;
  matched_hubspot_company_id: string | null;
  created_by: string;
};

export type CorporateTreeReservation = { status: 'reserved' | 'already_reserved'; batchId: string };

export type CorporateTreeRunDeps = {
  /** La empresa de partida cuando viene de una fila (sólo se leen sus datos). */
  loadExistingRoot: (ref: { candidateId: string | null; accountId: string | null }) => Promise<Partial<CorporateTreeRoot> | null>;
  /** El lote del Agente 1 de esta corrida (idempotente por usuario + clientRequestId). */
  reserveBatch: (input: {
    root: CorporateTreeRoot;
    batchCountry: TreeCountry;
    branches: readonly CorporateTreeBranch[];
    countryCodes: readonly string[];
  }) => Promise<CorporateTreeReservation>;
  findFreeHits: (input: {
    rootName: string;
    rootCountryCode: string | null;
    countryCodes: readonly string[];
  }) => Promise<{ hits: CorporateTreeFreeHit[]; rootCountryCode: string | null; queries: number; errors: number }>;
  resolveActiveModel: () => Promise<{ model: string; apiKey: string } | { error: string }>;
  checkQuota: () => Promise<{ allowed: boolean }>;
  searchBranch: (input: CorporateTreeSearchInput, model: string, apiKey: string) => Promise<CorporateTreeSearchOutcome>;
  /** Registra lo pagado de cada llamada apenas termina, con el lote. */
  logBranchUsage: (outcome: CorporateTreeSearchOutcome, ctx: { runId: string; batchId: string }) => Promise<void>;
  /** Capa gratuita: registros oficiales con web. */
  writeFreeCatalog: (batchId: string, country: TreeCountry, companies: CountrySourceCompany[]) => Promise<{ written: number; failed: boolean }>;
  /** Escritor del Agente 1 (Claude y banco con web). */
  writeWeb: (batchId: string, country: TreeCountry, items: CorporateTreeWebItem[]) => Promise<{ written: number; errors: string[] }>;
  /**
   * ¿Ya está en HubSpot o en SellUp por su nombre exacto y país? Se pregunta antes de mandar
   * al rescate (que es pagado). `null` = no se sabe (la fila sigue su camino).
   */
  findKnownCompany?: (query: { name: string; countryCode: string | null }) => Promise<CorporateTreeKnownCompany | null>;
  /**
   * Número fiscal oficial por nombre (el mismo buscador de la capa gratuita). Para las
   * filiales con la web del grupo: con número entran a «Por revisar» sin web propia.
   */
  fillOfficialTaxIds?: (companies: CountrySourceCompany[]) => Promise<CountrySourceCompany[]>;
  /**
   * Apollo por nombre, para las que siguen sin web antes del rescate. `undefined` = apagado
   * (bandera o cuota). Cada llamada es pagada: se registra con el lote.
   */
  findInApollo?: (
    query: { name: string; countryCode: string; rootDomain: string | null },
    ctx: { batchId: string },
  ) => Promise<CorporateTreeApolloMatch | null>;
  /** Posible duplicado en HubSpot ⇒ «Descartadas» como duplicado (el rescate no las toma). */
  recordPossibleDuplicates?: (batchId: string, countryCode: string, items: CorporateTreePossibleDuplicate[]) => Promise<number>;
  /** Sin web ⇒ «Descartadas» con `missing_domain_final`; el rescate les busca la web. */
  recordWithoutWebsite: (batchId: string, countryCode: string, companies: CountrySourceCompany[]) => Promise<number>;
  /** `null` si no se pudo leer (no se sella como vacío un lote que sí tiene filas). */
  loadBatchCandidates: (batchId: string) => Promise<CorporateTreeBatchCandidate[] | null>;
  tagCandidate: (candidateId: string, metadata: Record<string, unknown>) => Promise<void>;
  /**
   * La etiqueta de industria del lote sólo sirve para escribir: en TODO el lote se deja
   * sin industria pedida antes del rescate (también lo que no se reencontró por nombre).
   */
  clearBatchIndustryLabel: (batchId: string) => Promise<void>;
  /** `false` si la tabla de asociaciones no está: la corrida sigue. */
  insertRelationships: (rows: CorporateTreeRelationshipRow[]) => Promise<boolean>;
  /** Sella el estado del lote (la misma máquina de estados que la capa gratuita) y su metadata. */
  sealBatch: (
    batchId: string,
    input: { persisted: number; failed: boolean; metadata: Record<string, unknown>; country?: TreeCountry | null },
  ) => Promise<void>;
  /** El rescate de siempre (sector, tamaño y web de las que quedaron sin web). */
  scheduleRescue: (batchId: string) => void;
  report: (stage: CorporateTreeStage) => void;
  newRunId: () => string;
  nowIso: () => string;
  nowMs: () => number;
};

export type CorporateTreeRunResult =
  | {
      ok: true;
      batchId: string;
      alreadyStarted: boolean;
      /** Las que quedaron para revisar. */
      inReview: number;
      /** Sin web: esperan en «Descartadas» a que el rescate se la busque. */
      waitingWebsite: number;
      /** Sólo con la web del grupo: quedan en el lote como referencia. */
      groupReferences: number;
      /** Sin web pero ya en HubSpot: no fueron al rescate. */
      alreadyKnown: number;
      /** Sin web y con un nombre parecido en HubSpot: en «Descartadas», sin rescate. */
      possibleKnown: number;
      redirectPath: string;
      estimatedCostUsd: number;
    }
  | {
      ok: false;
      code: 'reservation_failed' | 'nothing_found' | 'run_failed';
      message: string;
      /** El lote ya existe (se reservó al empezar): se puede abrir. */
      batchId: string | null;
      estimatedCostUsd: number;
    };

/** «cencosud» ⇒ «Cencosud»: lo escrito todo en minúsculas se muestra con mayúscula inicial. */
export function displayCompanyName(name: string): string {
  if (name !== name.toLowerCase()) return name;
  return name.replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, letter: string) => `${sep}${letter.toUpperCase()}`);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Une cada fila del lote con su fila planeada (nombre × país; si no, dominio). */
export function matchPlannedRows(
  rows: readonly CorporateTreePlannedRow[],
  candidates: readonly CorporateTreeBatchCandidate[],
  keyOf: (name: string, countryCode: string | null) => string,
): Map<string, CorporateTreeBatchCandidate> {
  const byKey = new Map<string, CorporateTreeBatchCandidate>();
  const byDomain = new Map<string, CorporateTreeBatchCandidate>();
  for (const c of candidates) {
    const key = keyOf(c.name, c.country_code);
    if (!byKey.has(key)) byKey.set(key, c);
    if (c.domain && !byDomain.has(`${c.domain}|${c.country_code ?? ''}`)) byDomain.set(`${c.domain}|${c.country_code ?? ''}`, c);
  }
  const matched = new Map<string, CorporateTreeBatchCandidate>();
  for (const row of rows) {
    const candidate = byKey.get(row.key) ?? (row.domain ? byDomain.get(`${row.domain}|${row.countryCode ?? ''}`) : undefined);
    if (candidate) matched.set(row.key, candidate);
  }
  return matched;
}

type ClaudePhase = {
  outcomes: CorporateTreeSearchOutcome[];
  skipped: string | null;
};

async function runClaudePhase(
  request: CorporateTreeRequest,
  root: CorporateTreeRoot,
  freeHits: readonly CorporateTreeFreeHit[],
  ctx: { runId: string; batchId: string },
  deps: CorporateTreeRunDeps,
): Promise<ClaudePhase> {
  const active = await deps.resolveActiveModel();
  if ('error' in active) return { outcomes: [], skipped: 'model_not_configured' };
  if (!(await deps.checkQuota()).allowed) return { outcomes: [], skipped: 'quota_exhausted' };

  deps.report('tree_searching');
  const rootCountry =
    request.countries.find((c) => c.code === root.countryCode) ?? (root.countryCode ? { code: root.countryCode, name: root.countryCode } : null);
  const knownCompanies = freeHits.map((h) => ({ name: h.name, countryCode: h.countryCode, confirmed: h.confirmation === 'confirmed' }));
  let branchesDone = 0;
  const outcomes = await Promise.all(
    request.branches.map(async (branch) => {
      const outcome = await deps.searchBranch(
        {
          branch,
          rootName: root.name,
          rootWebsite: root.website,
          rootCountry,
          countries: request.countries,
          maxCompanies: CORPORATE_TREE_LIMITS.companiesPerBranch,
          knownCompanies,
        },
        active.model,
        active.apiKey,
      );
      branchesDone++;
      const stage = branchDoneStage(branchesDone, request.branches.length);
      if (stage) deps.report(stage);
      await deps.logBranchUsage(outcome, ctx).catch(() => undefined);
      return outcome;
    }),
  );
  return { outcomes, skipped: null };
}

/** Como mucho, búsquedas pagadas en Apollo por corrida. */
export const CORPORATE_TREE_APOLLO_MAX_LOOKUPS = 5;

async function withGroupTaxIds(plan: CorporateTreeWritePlan, deps: CorporateTreeRunDeps): Promise<CorporateTreeWritePlan> {
  const pendingKeys = plan.rows.filter((row) => row.route === 'group_reference' && plan.groupCompanies.has(row.key)).map((row) => row.key);
  if (pendingKeys.length === 0) return plan;
  const companies = pendingKeys.map((key) => plan.groupCompanies.get(key) as CountrySourceCompany);
  const filled = deps.fillOfficialTaxIds ? await deps.fillOfficialTaxIds(companies).catch(() => companies) : companies;
  const byKey = new Map<string, CountrySourceCompany>();
  pendingKeys.forEach((key, index) => {
    const company = filled[index];
    if (company?.taxId) byKey.set(key, company);
  });
  return promoteGroupCompaniesWithTaxIds(plan, byKey);
}

async function withApolloByName(
  plan: CorporateTreeWritePlan,
  root: CorporateTreeRoot,
  batchId: string,
  deps: CorporateTreeRunDeps,
  deadlineAtMs: number,
): Promise<{ plan: CorporateTreeWritePlan; lookups: number }> {
  if (!deps.findInApollo) return { plan, lookups: 0 };
  const pending = plan.rows
    .filter((row) => row.route === 'without_website' && row.relation !== 'root' && !!row.countryCode)
    .slice(0, CORPORATE_TREE_APOLLO_MAX_LOOKUPS);
  const found = new Map<string, CorporateTreeApolloMatch>();
  let lookups = 0;
  for (const row of pending) {
    if (deps.nowMs() >= deadlineAtMs) break;
    lookups++;
    const match = await deps
      .findInApollo({ name: row.name, countryCode: row.countryCode as string, rootDomain: root.domain }, { batchId })
      .catch(() => null);
    if (match) found.set(row.key, match);
  }
  return { plan: promoteRowsFoundInApollo(plan, found), lookups };
}

/** Cuántas consultas a HubSpot/SellUp a la vez (y cuántas como mucho). */
const KNOWN_CHECK_CONCURRENCY = 4;

async function withKnownCompanies(
  plan: CorporateTreeWritePlan,
  deps: CorporateTreeRunDeps,
  deadlineAtMs: number,
): Promise<CorporateTreeWritePlan> {
  if (!deps.findKnownCompany) return plan;
  const pending = plan.rows.filter((row) => row.route === 'without_website');
  const known = new Map<string, CorporateTreeKnownCompany>();
  for (let i = 0; i < pending.length; i += KNOWN_CHECK_CONCURRENCY) {
    if (deps.nowMs() >= deadlineAtMs) break;
    const slice = pending.slice(i, i + KNOWN_CHECK_CONCURRENCY);
    const found = await Promise.all(
      slice.map((row) => deps.findKnownCompany!({ name: row.name, countryCode: row.countryCode }).catch(() => null)),
    );
    slice.forEach((row, index) => {
      const match = found[index];
      // Con su ficha de HubSpot: así el lote y la ficha pueden decir «Ya en HubSpot» (o
      // «posible duplicado», que va a «Descartadas» sin rescate).
      if (match?.hubspotCompanyId) known.set(row.key, match);
    });
  }
  return markKnownCompanies(plan, known);
}

async function writePlan(
  plan: CorporateTreeWritePlan,
  batchId: string,
  countries: readonly TreeCountry[],
  deps: CorporateTreeRunDeps,
  deadlineAtMs: number,
): Promise<{ written: number; withoutWebsite: number; errors: string[] }> {
  const countryOf = (code: string): TreeCountry => countries.find((c) => c.code === code) ?? { code, name: code };
  let written = 0;
  let withoutWebsite = 0;
  const errors: string[] = [];
  // Sin tiempo para otra escritura: lo que falta se anota y la corrida cierra el lote a tiempo.
  const outOfTime = (what: string) => {
    if (deps.nowMs() < deadlineAtMs) return false;
    errors.push(`time_budget:${what}`);
    return true;
  };
  // Uno a uno por país: el escritor adopta el lote y aplica las compuertas del país.
  for (const [code, companies] of plan.freeCatalog) {
    if (outOfTime(`free_catalog:${code}`)) continue;
    const result = await deps.writeFreeCatalog(batchId, countryOf(code), companies).catch(() => ({ written: 0, failed: true }));
    written += result.written;
    if (result.failed) errors.push(`free_catalog:${code}`);
  }
  for (const [code, items] of plan.web) {
    if (outOfTime(`writer:${code}`)) continue;
    const result = await deps.writeWeb(batchId, countryOf(code), items).catch((err: unknown) => ({
      written: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    }));
    written += result.written;
    errors.push(...result.errors.map((e) => `writer:${code}:${e}`.slice(0, 200)));
  }
  for (const [code, items] of plan.possibleDuplicates) {
    if (outOfTime(`possible_duplicate:${code}`) || !deps.recordPossibleDuplicates) continue;
    await deps.recordPossibleDuplicates(batchId, code, items).catch(() => 0);
  }
  for (const [code, companies] of plan.withoutWebsite) {
    if (outOfTime(`without_website:${code}`)) continue;
    withoutWebsite += await deps.recordWithoutWebsite(batchId, code, companies).catch(() => 0);
  }
  return { written, withoutWebsite, errors };
}

export async function runCorporateTreeSearch(
  request: CorporateTreeRequest,
  context: {
    internalUserId: string;
    keyOf: (name: string, countryCode: string | null) => string;
    /** Hasta cuándo se puede empezar a escribir (deja tiempo para sellar dentro de los 300 s). */
    writeDeadlineAtMs: number;
  },
  deps: CorporateTreeRunDeps,
): Promise<CorporateTreeRunResult> {
  const existing =
    request.rootCandidateId || request.rootAccountId
      ? await deps.loadExistingRoot({ candidateId: request.rootCandidateId, accountId: request.rootAccountId }).catch(() => null)
      : null;
  const rootWebsite = existing?.website ?? request.rootWebsite;
  let root: CorporateTreeRoot = {
    name: existing?.name ?? displayCompanyName(request.rootName),
    website: rootWebsite,
    domain: rootWebsite ? normalizeDomain(rootWebsite) : null,
    countryCode: existing?.countryCode ?? request.rootCountryCode,
    candidateId: existing ? request.rootCandidateId : null,
    accountId: existing ? request.rootAccountId : null,
  };

  // 1. PRIMERO lo gratis (no cuesta nada): así el lote nace con el país real de la
  //    empresa (Prod 14-10: Cencosud quedó en Colombia, la primera opción de la lista).
  deps.report('tree_free');
  const free = await deps
    .findFreeHits({ rootName: root.name, rootCountryCode: root.countryCode, countryCodes: request.countries.map((c) => c.code) })
    .catch(() => ({ hits: [] as CorporateTreeFreeHit[], rootCountryCode: root.countryCode, queries: 0, errors: 1 }));
  root = { ...root, countryCode: root.countryCode ?? free.rootCountryCode };

  // 2. El lote, ANTES de cualquier gasto: es del Agente 1 desde el primer instante.
  const batchCountry =
    request.countries.find((c) => c.code === root.countryCode) ?? request.countries[0];
  let reservation: CorporateTreeReservation;
  try {
    reservation = await deps.reserveBatch({
      root,
      batchCountry,
      branches: request.branches,
      countryCodes: request.countries.map((c) => c.code),
    });
  } catch {
    return { ok: false, code: 'reservation_failed', message: 'No se pudo iniciar la búsqueda. Inténtalo de nuevo.', batchId: null, estimatedCostUsd: 0 };
  }
  const batchId = reservation.batchId;
  if (reservation.status === 'already_reserved') {
    return { ok: true, batchId, alreadyStarted: true, inReview: 0, waitingWebsite: 0, groupReferences: 0, alreadyKnown: 0, possibleKnown: 0, redirectPath: `/prospect-batches/${batchId}`, estimatedCostUsd: 0 };
  }
  const runId = deps.newRunId();
  try {
    return await runAfterReservation(request, context, deps, { root, batchId, runId, free });
  } catch (err) {
    // Nunca queda un lote colgado en curso: se cierra y se puede abrir desde la bandeja.
    const detail = err instanceof Error ? err.message : String(err);
    await deps
      .sealBatch(batchId, {
        persisted: 0,
        failed: true,
        metadata: { [CORPORATE_TREE_METADATA_KEY]: { run_id: runId, root_name: root.name, error: detail.slice(0, 200), searched_at: deps.nowIso() } },
      })
      .catch(() => undefined);
    return { ok: false, code: 'run_failed', message: 'No fue posible completar la búsqueda en árbol. Inténtalo de nuevo.', batchId, estimatedCostUsd: 0 };
  }
}

async function runAfterReservation(
  request: CorporateTreeRequest,
  context: { internalUserId: string; keyOf: (name: string, countryCode: string | null) => string; writeDeadlineAtMs: number },
  deps: CorporateTreeRunDeps,
  start: {
    root: CorporateTreeRoot;
    batchId: string;
    runId: string;
    free: { hits: CorporateTreeFreeHit[]; rootCountryCode: string | null; queries: number; errors: number };
  },
): Promise<CorporateTreeRunResult> {
  const { batchId, runId, free } = start;
  let root = start.root;

  // 3. Claude, sólo por lo que falta.
  const claude = await runClaudePhase(request, root, free.hits, { runId, batchId }, deps);
  const estimatedCostUsd = roundUsd(claude.outcomes.reduce((acc, o) => acc + (o.usage?.estimatedCostUsd ?? 0), 0));
  const rootFinding = claude.outcomes.map((o) => o.root).find((r) => r && (r.domain || r.countryCode)) ?? null;
  if (rootFinding) {
    root = {
      ...root,
      website: root.website ?? rootFinding.website,
      domain: root.domain ?? rootFinding.domain,
      countryCode: root.countryCode ?? rootFinding.countryCode,
    };
  }
  const nodes = claude.outcomes.flatMap((o) => o.nodes);

  // 4. Escribir por las vías de siempre.
  deps.report('tree_checking');
  const withKnown = await withKnownCompanies(planCorporateTreeWrites({ root, freeHits: free.hits, nodes }), deps, context.writeDeadlineAtMs);
  const withGroupFiscal = await withGroupTaxIds(withKnown, deps);
  const apollo = await withApolloByName(withGroupFiscal, root, batchId, deps, context.writeDeadlineAtMs);
  const plan = apollo.plan;
  const writes = await writePlan(plan, batchId, request.countries, deps, context.writeDeadlineAtMs);

  // 5. Rama de cada fila y asociaciones.
  deps.report('tree_saving');
  const loaded = await deps.loadBatchCandidates(batchId).catch(() => null);
  const candidates = loaded ?? [];
  const matched = matchPlannedRows(plan.rows, candidates, context.keyOf);
  await Promise.all(
    plan.rows.map(async (row) => {
      const candidate = matched.get(row.key);
      if (!candidate) return;
      const tree: CorporateTreeCandidateMetadata = {
        run_id: runId,
        relation: row.relation,
        root_name: root.name,
        relation_detail: row.relationDetail,
        evidence_url: row.evidenceUrl,
        group_website: row.groupWebsite,
        ...(row.websiteUnverified ? { website_unverified: true } : {}),
        ...(row.foundInApollo ? { found_in_apollo: true } : {}),
      };
      await deps.tagCandidate(candidate.id, { ...(candidate.metadata ?? {}), [CORPORATE_TREE_METADATA_KEY]: tree }).catch(() => undefined);
    }),
  );
  await deps
    .insertRelationships(buildRelationshipRows({ rows: plan.rows, matched, root, runId, batchId, createdBy: context.internalUserId }))
    .catch(() => false);

  // 6. Sellado y rescate.
  const inReview = candidates.filter((c) => c.status === 'needs_review').length;
  const treeMetadata = {
    [CORPORATE_TREE_METADATA_KEY]: {
      run_id: runId,
      root_name: root.name,
      root_country_code: root.countryCode,
      root_domain: root.domain,
      root_candidate_id: root.candidateId,
      root_account_id: root.accountId,
      branches: request.branches,
      country_codes: request.countries.map((c) => c.code),
      free_first: {
        queries: free.queries,
        errors: free.errors,
        hits: free.hits.length,
        from_catalog: free.hits.filter((h) => h.origin === 'catalog').length,
        from_bank: free.hits.filter((h) => h.origin === 'bank').length,
      },
      claude: {
        skipped: claude.skipped,
        proposed: claude.outcomes.reduce((acc, o) => acc + o.proposed, 0),
        accepted: nodes.length,
        rejected: Object.fromEntries(claude.outcomes.map((o) => [o.branch, o.rejected])),
        errors: claude.outcomes.filter((o) => o.errorCode).map((o) => ({ branch: o.branch, code: o.errorCode })),
        estimated_cost_usd: estimatedCostUsd,
      },
      rows: plan.rows.length,
      written: writes.written,
      without_website: writes.withoutWebsite,
      group_references: plan.rows.filter((r) => r.route === 'group_reference').length,
      already_known: plan.rows.filter((r) => r.route === 'already_known').length,
      possible_known: plan.rows.filter((r) => r.route === 'possible_known').length,
      group_with_tax_id: plan.rows.filter((r) => r.route === 'free_catalog' && !!r.groupWebsite).length,
      apollo: { lookups: apollo.lookups, found: plan.rows.filter((r) => r.foundInApollo).length },
      dropped_by_cap: plan.droppedByCap,
      unconfirmed_dropped: plan.unconfirmedDropped,
      shared_websites: plan.sharedWebsites,
      write_errors: writes.errors.slice(0, 10),
      searched_at: deps.nowIso(),
    },
  };
  await deps
    .sealBatch(batchId, {
      // Lo escrito según los escritores, o lo que el lote tiene si se pudo leer (lo mayor).
      persisted: Math.max(writes.written, candidates.length),
      // El país de la empresa de partida, ya resuelto (lo gratis o Claude).
      country: root.countryCode ? (request.countries.find((c) => c.code === root.countryCode) ?? null) : null,
      failed: loaded !== null && candidates.length === 0 && writes.errors.length > 0,
      metadata: treeMetadata,
    })
    .catch(() => undefined);
  await deps.clearBatchIndustryLabel(batchId).catch(() => undefined);
  // El rescate sólo tiene trabajo si alguna quedó sin web (las del grupo no lo necesitan).
  if (writes.withoutWebsite > 0) deps.scheduleRescue(batchId);

  if (plan.rows.length === 0) {
    return {
      ok: false,
      code: 'nothing_found',
      message: claude.skipped === 'quota_exhausted'
        ? `No encontramos a ${root.name} en los registros gratuitos y se agotó la cuota de Claude de este mes.`
        : `No encontramos empresas relacionadas con ${root.name} con una fuente que lo pruebe.`,
      batchId,
      estimatedCostUsd,
    };
  }
  return {
    ok: true,
    batchId,
    alreadyStarted: false,
    inReview,
    waitingWebsite: writes.withoutWebsite,
    groupReferences: plan.rows.filter((r) => r.route === 'group_reference').length,
    alreadyKnown: plan.rows.filter((r) => r.route === 'already_known').length,
    possibleKnown: plan.rows.filter((r) => r.route === 'possible_known').length,
    redirectPath: `/prospect-batches/${batchId}`,
    estimatedCostUsd,
  };
}

/** Una asociación por fila planeada (también las que ya estaban en HubSpot o quedaron sin web). */
export function buildRelationshipRows(params: {
  rows: readonly CorporateTreePlannedRow[];
  matched: ReadonlyMap<string, CorporateTreeBatchCandidate>;
  root: CorporateTreeRoot;
  runId: string;
  batchId: string;
  createdBy: string;
}): CorporateTreeRelationshipRow[] {
  const { rows, matched, root } = params;
  const rootRow = rows.find((r) => r.relation === 'root');
  const rootCandidateId = root.candidateId ?? (rootRow ? matched.get(rootRow.key)?.id ?? null : null);
  return rows.map((row) => {
    const candidate = matched.get(row.key) ?? null;
    return {
      batch_id: params.batchId,
      run_id: params.runId,
      root_name: root.name,
      root_country_code: root.countryCode,
      root_domain: root.domain,
      root_candidate_id: rootCandidateId,
      root_account_id: root.accountId,
      related_candidate_id: candidate?.id ?? null,
      related_name: row.name,
      related_country_code: row.countryCode,
      related_domain: row.domain,
      relation_type: row.relation,
      relation_detail: row.relationDetail,
      evidence_url: row.evidenceUrl,
      matched_hubspot_company_id:
        candidate?.matched_hubspot_company_id ?? (row.route === 'already_known' ? row.knownHubspotCompanyId ?? null : null),
      created_by: params.createdBy,
    };
  });
}
