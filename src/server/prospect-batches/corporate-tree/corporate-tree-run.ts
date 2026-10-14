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
  planCorporateTreeWrites,
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
  /** Sin web ⇒ «Descartadas» con `missing_domain_final`; el rescate les busca la web. */
  recordWithoutWebsite: (batchId: string, countryCode: string, companies: CountrySourceCompany[]) => Promise<number>;
  loadBatchCandidates: (batchId: string) => Promise<CorporateTreeBatchCandidate[]>;
  tagCandidate: (candidateId: string, metadata: Record<string, unknown>) => Promise<void>;
  /** `false` si la tabla de asociaciones no está: la corrida sigue. */
  insertRelationships: (rows: CorporateTreeRelationshipRow[]) => Promise<boolean>;
  /** Sella el estado del lote (la misma máquina de estados que la capa gratuita) y su metadata. */
  sealBatch: (batchId: string, input: { persisted: number; failed: boolean; metadata: Record<string, unknown> }) => Promise<void>;
  /** El rescate de siempre (sector, tamaño y web de las que quedaron sin web). */
  scheduleRescue: (batchId: string) => void;
  report: (stage: CorporateTreeStage) => void;
  newRunId: () => string;
  nowIso: () => string;
};

export type CorporateTreeRunResult =
  | {
      ok: true;
      batchId: string;
      alreadyStarted: boolean;
      /** Las que quedaron para revisar. */
      inReview: number;
      redirectPath: string;
      estimatedCostUsd: number;
    }
  | {
      ok: false;
      code: 'reservation_failed' | 'nothing_found';
      message: string;
      /** El lote ya existe (se reservó al empezar): se puede abrir. */
      batchId: string | null;
      estimatedCostUsd: number;
    };

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
  const knownCompanies = freeHits.map((h) => ({ name: h.name, countryCode: h.countryCode }));
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

async function writePlan(
  plan: CorporateTreeWritePlan,
  batchId: string,
  countries: readonly TreeCountry[],
  deps: CorporateTreeRunDeps,
): Promise<{ written: number; withoutWebsite: number; errors: string[] }> {
  const countryOf = (code: string): TreeCountry => countries.find((c) => c.code === code) ?? { code, name: code };
  let written = 0;
  let withoutWebsite = 0;
  const errors: string[] = [];
  // Uno a uno por país: el escritor adopta el lote y aplica las compuertas del país.
  for (const [code, companies] of plan.freeCatalog) {
    const result = await deps.writeFreeCatalog(batchId, countryOf(code), companies).catch(() => ({ written: 0, failed: true }));
    written += result.written;
    if (result.failed) errors.push(`free_catalog:${code}`);
  }
  for (const [code, items] of plan.web) {
    const result = await deps.writeWeb(batchId, countryOf(code), items).catch((err: unknown) => ({
      written: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    }));
    written += result.written;
    errors.push(...result.errors.map((e) => `writer:${code}:${e}`.slice(0, 200)));
  }
  for (const [code, companies] of plan.withoutWebsite) {
    withoutWebsite += await deps.recordWithoutWebsite(batchId, code, companies).catch(() => 0);
  }
  return { written, withoutWebsite, errors };
}

export async function runCorporateTreeSearch(
  request: CorporateTreeRequest,
  context: { internalUserId: string; keyOf: (name: string, countryCode: string | null) => string },
  deps: CorporateTreeRunDeps,
): Promise<CorporateTreeRunResult> {
  const existing =
    request.rootCandidateId || request.rootAccountId
      ? await deps.loadExistingRoot({ candidateId: request.rootCandidateId, accountId: request.rootAccountId }).catch(() => null)
      : null;
  const rootWebsite = existing?.website ?? request.rootWebsite;
  let root: CorporateTreeRoot = {
    name: existing?.name ?? request.rootName,
    website: rootWebsite,
    domain: rootWebsite ? normalizeDomain(rootWebsite) : null,
    countryCode: existing?.countryCode ?? request.rootCountryCode,
    candidateId: existing ? request.rootCandidateId : null,
    accountId: existing ? request.rootAccountId : null,
  };

  // 1. El lote, ANTES de cualquier gasto: es del Agente 1 desde el primer instante.
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
    return { ok: true, batchId, alreadyStarted: true, inReview: 0, redirectPath: `/prospect-batches/${batchId}`, estimatedCostUsd: 0 };
  }
  const runId = deps.newRunId();

  // 2. PRIMERO lo gratis.
  deps.report('tree_free');
  const free = await deps
    .findFreeHits({ rootName: root.name, rootCountryCode: root.countryCode, countryCodes: request.countries.map((c) => c.code) })
    .catch(() => ({ hits: [] as CorporateTreeFreeHit[], rootCountryCode: root.countryCode, queries: 0, errors: 1 }));
  root = { ...root, countryCode: root.countryCode ?? free.rootCountryCode };

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
  const plan = planCorporateTreeWrites({ root, freeHits: free.hits, nodes });
  const writes = await writePlan(plan, batchId, request.countries, deps);

  // 5. Rama de cada fila y asociaciones.
  deps.report('tree_saving');
  const candidates = await deps.loadBatchCandidates(batchId).catch(() => [] as CorporateTreeBatchCandidate[]);
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
      dropped_by_cap: plan.droppedByCap,
      shared_websites: plan.sharedWebsites,
      write_errors: writes.errors.slice(0, 10),
      searched_at: deps.nowIso(),
    },
  };
  await deps
    .sealBatch(batchId, { persisted: candidates.length, failed: candidates.length === 0 && writes.errors.length > 0, metadata: treeMetadata })
    .catch(() => undefined);
  if (plan.rows.length > 0) deps.scheduleRescue(batchId);

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
  return { ok: true, batchId, alreadyStarted: false, inReview, redirectPath: `/prospect-batches/${batchId}`, estimatedCostUsd };
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
      matched_hubspot_company_id: candidate?.matched_hubspot_company_id ?? null,
      created_by: params.createdBy,
    };
  });
}
