/**
 * Agente 1 · Búsqueda en árbol — una corrida completa (puro; todo lo que toca
 * red o base se inyecta).
 *
 *   1. Valida lo que mandó el navegador.
 *   2. Claude busca cada rama pedida, en paralelo (una llamada por rama).
 *   3. Planea las filas (sin repetidas, web del grupo como referencia).
 *   4. Las manda por la importación: mismas compuertas que cualquier búsqueda.
 *   5. Marca el lote y cada fila con su rama y guarda las asociaciones.
 *
 * Sin Apollo ni Lusha (decisión de la dueña, 14-10): no toca créditos del pool.
 * Lo único que se paga es Claude, y cada llamada queda en Uso de IA al terminar.
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
import type { CorporateTreeSearchInput, CorporateTreeSearchOutcome, TreeCountry } from './corporate-tree-search';
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import { planCorporateTreeImport, type CorporateTreeImportCandidate, type CorporateTreePlan, type CorporateTreeRoot } from './corporate-tree-plan';

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

export type CorporateTreeStage = 'tree_searching' | 'tree_checking';

export type CorporateTreeBatchCandidate = {
  id: string;
  name: string;
  country_code: string | null;
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

export type CorporateTreeImportOutcome =
  | { ok: true; batchId: string; candidatesCreated: number }
  | { ok: false; message: string };

export type CorporateTreeRunDeps = {
  /** La empresa de partida cuando viene de una fila (sólo se leen sus datos). */
  loadExistingRoot: (ref: { candidateId: string | null; accountId: string | null }) => Promise<Partial<CorporateTreeRoot> | null>;
  resolveActiveModel: () => Promise<{ model: string; apiKey: string } | { error: string }>;
  checkQuota: () => Promise<{ allowed: boolean }>;
  searchBranch: (input: CorporateTreeSearchInput, model: string, apiKey: string) => Promise<CorporateTreeSearchOutcome>;
  /** Registra lo pagado de cada llamada apenas termina. */
  logBranchUsage: (outcome: CorporateTreeSearchOutcome, runId: string) => Promise<void>;
  importRows: (candidates: CorporateTreeImportCandidate[]) => Promise<CorporateTreeImportOutcome>;
  markBatch: (batchId: string, params: { name: string; clientRequestId: string; metadata: Record<string, unknown> }) => Promise<void>;
  loadBatchCandidates: (batchId: string) => Promise<CorporateTreeBatchCandidate[]>;
  tagCandidate: (candidateId: string, metadata: Record<string, unknown>) => Promise<void>;
  /** `false` si la tabla de asociaciones no está (migración 148 sin aplicar): la corrida sigue. */
  insertRelationships: (rows: CorporateTreeRelationshipRow[]) => Promise<boolean>;
  report: (stage: CorporateTreeStage) => void;
  newRunId: () => string;
  nowIso: () => string;
};

export type CorporateTreeRunResult =
  | {
      ok: true;
      batchId: string;
      candidateCount: number;
      inReview: number;
      redirectPath: string;
      estimatedCostUsd: number;
    }
  | {
      ok: false;
      code: 'model_not_configured' | 'quota_exhausted' | 'search_failed' | 'nothing_found' | 'import_failed';
      message: string;
      estimatedCostUsd: number;
    };

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function corporateTreeBatchName(rootName: string): string {
  return `Árbol · ${rootName}`;
}

/** Une cada fila del lote con su fila planeada (por nombre × país). */
export function matchPlannedRows(
  plan: CorporateTreePlan,
  candidates: readonly CorporateTreeBatchCandidate[],
  keyOf: (name: string, countryCode: string | null) => string,
): Map<string, CorporateTreeBatchCandidate> {
  const byKey = new Map<string, CorporateTreeBatchCandidate>();
  for (const c of candidates) {
    const key = keyOf(c.name, c.country_code);
    if (!byKey.has(key)) byKey.set(key, c);
  }
  const matched = new Map<string, CorporateTreeBatchCandidate>();
  for (const row of plan.rows) {
    const candidate = byKey.get(row.key);
    if (candidate) matched.set(row.key, candidate);
  }
  return matched;
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

  const active = await deps.resolveActiveModel();
  if ('error' in active) {
    return { ok: false, code: 'model_not_configured', message: 'Claude no está configurado en Configuración → IA.', estimatedCostUsd: 0 };
  }
  if (!(await deps.checkQuota()).allowed) {
    return { ok: false, code: 'quota_exhausted', message: 'Se agotó la cuota de Claude de este mes.', estimatedCostUsd: 0 };
  }

  const runId = deps.newRunId();
  deps.report('tree_searching');
  const rootCountry = request.countries.find((c) => c.code === root.countryCode)
    ?? (root.countryCode ? { code: root.countryCode, name: root.countryCode } : null);
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
        },
        active.model,
        active.apiKey,
      );
      await deps.logBranchUsage(outcome, runId).catch(() => undefined);
      return outcome;
    }),
  );
  const estimatedCostUsd = roundUsd(outcomes.reduce((acc, o) => acc + (o.usage?.estimatedCostUsd ?? 0), 0));
  if (outcomes.every((o) => o.errorCode !== null)) {
    return { ok: false, code: 'search_failed', message: 'Claude no respondió. Inténtalo de nuevo en unos minutos.', estimatedCostUsd };
  }

  // Lo que Claude confirmó de la empresa de partida completa lo que no se sabía.
  const rootFinding = outcomes.map((o) => o.root).find((r) => r && (r.domain || r.countryCode)) ?? null;
  if (rootFinding) {
    root = {
      ...root,
      website: root.website ?? rootFinding.website,
      domain: root.domain ?? rootFinding.domain,
      countryCode: root.countryCode ?? rootFinding.countryCode,
    };
  }

  const nodes = outcomes.flatMap((o) => o.nodes);
  const plan = planCorporateTreeImport({ root, nodes, countries: request.countries });
  if (plan.rows.length === 0 || nodes.length === 0) {
    return {
      ok: false,
      code: 'nothing_found',
      message: `No encontramos empresas relacionadas con ${root.name} con una fuente que lo pruebe.`,
      estimatedCostUsd,
    };
  }

  deps.report('tree_checking');
  const imported = await deps.importRows(plan.rows.map((r) => r.candidate));
  if (!imported.ok) {
    return { ok: false, code: 'import_failed', message: imported.message, estimatedCostUsd };
  }

  const at = deps.nowIso();
  await deps.markBatch(imported.batchId, {
    name: corporateTreeBatchName(root.name),
    clientRequestId: request.clientRequestId,
    metadata: {
      source_label: 'Árbol de empresa',
      [CORPORATE_TREE_METADATA_KEY]: {
        run_id: runId,
        root_name: root.name,
        root_country_code: root.countryCode,
        root_domain: root.domain,
        root_candidate_id: root.candidateId,
        root_account_id: root.accountId,
        branches: request.branches,
        country_codes: request.countries.map((c) => c.code),
        proposed: outcomes.reduce((acc, o) => acc + o.proposed, 0),
        accepted: nodes.length,
        rows: plan.rows.length,
        dropped_by_cap: plan.droppedByCap,
        shared_websites: plan.sharedWebsites,
        websites_dropped: outcomes.reduce((acc, o) => acc + o.websitesDropped, 0),
        rejected: Object.fromEntries(outcomes.map((o) => [o.branch, o.rejected])),
        errors: outcomes.filter((o) => o.errorCode).map((o) => ({ branch: o.branch, code: o.errorCode })),
        estimated_cost_usd: estimatedCostUsd,
        searched_at: at,
      },
    },
  });

  const candidates = await deps.loadBatchCandidates(imported.batchId);
  const matched = matchPlannedRows(plan, candidates, context.keyOf);
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
    .insertRelationships(
      buildRelationshipRows({ plan, matched, root, runId, batchId: imported.batchId, createdBy: context.internalUserId }),
    )
    .catch(() => false);

  const inReview = candidates.filter((c) => c.status === 'needs_review').length;
  return {
    ok: true,
    batchId: imported.batchId,
    candidateCount: candidates.length,
    inReview,
    redirectPath: `/prospect-batches/${imported.batchId}`,
    estimatedCostUsd,
  };
}

/** Una asociación por fila planeada (también las que ya estaban en HubSpot). */
export function buildRelationshipRows(params: {
  plan: CorporateTreePlan;
  matched: ReadonlyMap<string, CorporateTreeBatchCandidate>;
  root: CorporateTreeRoot;
  runId: string;
  batchId: string;
  createdBy: string;
}): CorporateTreeRelationshipRow[] {
  const { plan, matched, root } = params;
  const rootRow = plan.rows.find((r) => r.relation === 'root');
  const rootCandidateId = root.candidateId ?? (rootRow ? matched.get(rootRow.key)?.id ?? null : null);
  return plan.rows.map((row) => {
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
