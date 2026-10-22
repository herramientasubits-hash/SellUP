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
 * Se paga Claude (cada llamada en Uso de IA con el lote) y, con su bandera, UNA ficha de
 * Apollo de la empresa de partida (1 crédito: sus filiales). Nunca Lusha.
 *
 * FASE A/B (dueña 21-10): las ramas pedidas valen también para lo gratis; el árbol de un
 * grupo se guarda 30 días y se reutiliza sin pagar; las del grupo sin web propia pero con
 * número fiscal y 200+ trabajadores entran a «Por revisar» con la web del grupo como
 * referencia (antes, «Descartadas» y rescate pagado).
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
  CORPORATE_TREE_GROUP_HUBSPOT_MAX_READS,
  corporateTreeGroupOpportunity,
  summarizeCorporateTreeGroup,
  type CorporateTreeGroupMemberStatus,
  type CorporateTreeGroupSignal,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-group-signal';
import {
  corporateTreeRootKey,
  pickSavedTree,
  serializeSavedTree,
  type CorporateTreeSavedHubSpotMember,
  type CorporateTreeSavedTree,
} from './corporate-tree-saved';
import type { CorporateTreeNotWritten } from '@/modules/prospect-batches/corporate-tree/corporate-tree-batch-groups';
import {
  markKnownCompanies,
  mergeRootFindings,
  planCorporateTreeWrites,
  promoteGroupCompaniesWithTaxIds,
  promoteSizedCompaniesWithoutWebsite,
  applyApolloFamily,
  type CorporateTreeApolloSubsidiary,
  type CorporateTreeKnownCompany,
  type CorporateTreePossibleDuplicate,
  type CorporateTreePlannedRow,
  type CorporateTreeRoot,
  type CorporateTreeWebItem,
  type CorporateTreeWritePlan,
} from './corporate-tree-plan';

/** Apollo no se consultó porque no hay cuota (no es «Apollo no la conoce»). */
export const APOLLO_QUOTA_EXHAUSTED = 'quota_exhausted' as const;

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
  /** `true` = no reutilizar el árbol guardado: buscar (y pagar) de nuevo. */
  refresh?: boolean;
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
      refresh: body.refresh === true,
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
  writeWeb: (
    batchId: string,
    country: TreeCountry,
    items: CorporateTreeWebItem[],
  ) => Promise<{ written: number; errors: string[]; skipped?: readonly { name: string; domain?: string | null; reason: string }[] }>;
  /**
   * ¿Ya está en HubSpot o en SellUp por su nombre exacto y país? Se pregunta antes de mandar
   * al rescate (que es pagado). `null` = no se sabe (la fila sigue su camino).
   */
  findKnownCompany?: (query: { name: string; countryCode: string | null }) => Promise<CorporateTreeKnownCompany | null>;
  /**
   * Las que el control de propiedad del escritor rechazó, a «Descartadas» con su web (sin
   * rescate, sin costo): una persona decide si la web es suya. Ausente = se pierden.
   */
  recordOwnershipRejected?: (batchId: string, countryCode: string, items: readonly CorporateTreeNotWritten[]) => Promise<number>;
  /**
   * Número fiscal oficial por nombre (el mismo buscador de la capa gratuita). Para las
   * filiales con la web del grupo: con número entran a «Por revisar» sin web propia.
   */
  fillOfficialTaxIds?: (companies: CountrySourceCompany[]) => Promise<CountrySourceCompany[]>;
  /**
   * Apollo: la ficha de la empresa de partida (por su web) y sus filiales
   * (`suborganizations`). UNA llamada por corrida (1 crédito). `undefined` = apagado
   * (bandera o cuota); `null` = Apollo no la conoce. Se registra con el lote.
   */
  findApolloFamily?: (
    query: { rootDomain: string; rootName: string },
    ctx: { batchId: string },
  ) => Promise<CorporateTreeApolloSubsidiary[] | null | typeof APOLLO_QUOTA_EXHAUSTED>;
  /**
   * Los lotes del árbol de este grupo (por `corporateTreeRootKey`) de los últimos 30 días, el
   * más reciente primero. Ausente = no se reutiliza nada.
   */
  findSavedTrees?: (rootKey: string) => Promise<{ batchId: string; createdAt: string; metadata: unknown }[]>;
  /**
   * El registro oficial de una empresa por su nombre exacto en su país (número fiscal y
   * tamaño). Gratis. Para las que quedaron sin web ni número fiscal.
   */
  findOfficialRecord?: (query: { name: string; countryCode: string }) => Promise<CountrySourceCompany | null>;
  /**
   * FASE D — qué dice HubSpot (SÓLO lectura) de las empresas del grupo que ya están allí:
   * cliente, negocio abierto, trabajada por un vendedor, libre. Las que no se pudieron leer
   * no vienen. Ausente = no se mira.
   */
  readGroupHubSpotStatus?: (hubspotCompanyIds: readonly string[]) => Promise<ReadonlyMap<string, CorporateTreeGroupMemberStatus>>;
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
      /** Se reutilizó el árbol guardado del grupo (sin pagar la búsqueda). */
      reusedSavedTree?: boolean;
      /** FASE D: si el grupo ya es cliente de UBITS o lo trabaja alguien (HubSpot, sólo lectura). */
      groupSignal?: CorporateTreeGroupSignal | null;
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

/** Vías en que la `domain` de la fila es la web PROPIA de la empresa (no la del grupo). */
const OWN_DOMAIN_ROUTES: ReadonlySet<CorporateTreePlannedRow['route']> = new Set(['agent1_writer', 'free_catalog']);

/**
 * Une cada fila del lote con su fila planeada: primero por nombre × país; si no, por dominio
 * × país, pero SÓLO las filas escritas con su web propia. Una referencia del grupo lleva la
 * web del grupo (Zenú y Colcafé con gruponutresa.com): por dominio se unía a la empresa de
 * partida, la etiquetaba como filial y desaparecía del lote. Un candidato nunca se une a dos
 * filas.
 */
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
  const usedCandidateIds = new Set<string>();
  const link = (row: CorporateTreePlannedRow, candidate: CorporateTreeBatchCandidate | undefined) => {
    if (!candidate || usedCandidateIds.has(candidate.id)) return;
    matched.set(row.key, candidate);
    usedCandidateIds.add(candidate.id);
  };
  for (const row of rows) link(row, byKey.get(row.key));
  for (const row of rows) {
    if (matched.has(row.key) || !row.domain || row.groupWebsite || !OWN_DOMAIN_ROUTES.has(row.route)) continue;
    link(row, byDomain.get(`${row.domain}|${row.countryCode ?? ''}`));
  }
  return matched;
}

/**
 * Pasada la hora límite de escritura, cuánto más se espera a una escritura YA empezada. Luego
 * la corrida deja de esperarla y va a sellar: la función muere a los 300 s y un lote sin
 * sellar queda «en curso» para siempre.
 */
export const CORPORATE_TREE_WRITE_GRACE_MS = 20_000;
/**
 * Pasada la hora límite de escritura, lo más que se espera antes de sellar (lectura del lote,
 * etiquetas, asociaciones). Con la hora límite de la ruta (240 s) el sellado empieza a más
 * tardar a los 275 s.
 */
export const CORPORATE_TREE_SEAL_START_GRACE_MS = 35_000;
/** El mayor plazo que acepta `setTimeout` (más que eso dispara enseguida). */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Espera a `promise` hasta `deadlineAtMs`; si no termina, sigue sin ella (`settled: false`).
 * No la cancela: lo que no se esperó se anota y la corrida cierra el lote a tiempo.
 */
export async function settleBy<T>(
  promise: Promise<T>,
  deadlineAtMs: number,
  nowMs: () => number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  const remainingMs = deadlineAtMs - nowMs();
  if (remainingMs <= 0) {
    promise.catch(() => undefined);
    return { settled: false };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ settled: false }>((resolve) => {
    timer = setTimeout(() => resolve({ settled: false }), Math.min(remainingMs, MAX_TIMER_MS));
  });
  try {
    return await Promise.race([promise.then((value) => ({ settled: true as const, value })), timeout]);
  } finally {
    clearTimeout(timer);
  }
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


async function withGroupTaxIds(
  plan: CorporateTreeWritePlan,
  deps: CorporateTreeRunDeps,
  deadlineAtMs: number,
): Promise<CorporateTreeWritePlan> {
  const pendingKeys = plan.rows.filter((row) => row.route === 'group_reference' && plan.groupCompanies.has(row.key)).map((row) => row.key);
  if (pendingKeys.length === 0 || !deps.fillOfficialTaxIds || deps.nowMs() >= deadlineAtMs) return plan;
  const companies = pendingKeys.map((key) => plan.groupCompanies.get(key) as CountrySourceCompany);
  // Sin respuesta antes de la hora límite, siguen como referencia: escribir y sellar va primero.
  const lookup = await settleBy(deps.fillOfficialTaxIds(companies).catch(() => companies), deadlineAtMs, deps.nowMs);
  const filled = lookup.settled ? lookup.value : companies;
  const byKey = new Map<string, CountrySourceCompany>();
  pendingKeys.forEach((key, index) => {
    const company = filled[index];
    if (company?.taxId) byKey.set(key, company);
  });
  return promoteGroupCompaniesWithTaxIds(plan, byKey);
}

type ApolloFamilyOutcome = {
  plan: CorporateTreeWritePlan;
  /** Se llamó a Apollo en ESTA corrida (antes decía `true` también sin cuota o con error). */
  asked: boolean;
  /** Por qué no se llamó, o qué salió mal. */
  skipped: 'disabled' | 'no_root_domain' | 'time_budget' | 'quota_exhausted' | 'saved_tree' | null;
  failed: boolean;
  subsidiaries: number;
  matched: number;
  added: number;
  /** Lo que devolvió Apollo (para guardarlo con el árbol); `null` = no respondió. */
  answered: CorporateTreeApolloSubsidiary[] | null;
};

async function withApolloFamily(
  plan: CorporateTreeWritePlan,
  root: CorporateTreeRoot,
  request: CorporateTreeRequest,
  batchId: string,
  deps: CorporateTreeRunDeps,
  deadlineAtMs: number,
  saved: CorporateTreeSavedTree | null,
): Promise<ApolloFamilyOutcome> {
  const none = { plan, asked: false, failed: false, subsidiaries: 0, matched: 0, added: 0, answered: null };
  const apply = (subsidiaries: CorporateTreeApolloSubsidiary[], base: Omit<ApolloFamilyOutcome, 'plan' | 'matched' | 'added'>) => {
    // Sin la rama «filiales» Apollo sólo completa webs: no agrega empresas que no se pidieron.
    const applied = applyApolloFamily({
      plan,
      root,
      subsidiaries,
      countryCodes: request.countries.map((c) => c.code),
      addNew: request.branches.includes('subsidiary'),
    });
    return { ...base, plan: applied.plan, matched: applied.matched, added: applied.added };
  };
  // El árbol guardado trae las filiales de Apollo de la misma web: no se vuelve a pagar el crédito.
  if (saved?.apolloSubsidiaries && saved.root.domain && saved.root.domain === root.domain) {
    const subs = saved.apolloSubsidiaries;
    return apply(subs, { asked: false, skipped: 'saved_tree', failed: false, subsidiaries: subs.length, answered: subs });
  }
  if (!deps.findApolloFamily) return { ...none, skipped: 'disabled' };
  if (!root.domain) return { ...none, skipped: 'no_root_domain' };
  if (deps.nowMs() >= deadlineAtMs) return { ...none, skipped: 'time_budget' };
  let failed = false;
  const result = await deps.findApolloFamily({ rootDomain: root.domain, rootName: root.name }, { batchId }).catch(() => {
    failed = true;
    return null;
  });
  if (result === APOLLO_QUOTA_EXHAUSTED) return { ...none, skipped: 'quota_exhausted' };
  if (!result || result.length === 0) return { ...none, asked: true, skipped: null, failed, answered: result ? [] : null };
  return apply(result, { asked: true, skipped: null, failed: false, subsidiaries: result.length, answered: result });
}

/** Lo más que se espera la lectura del árbol guardado. */
const CORPORATE_TREE_SAVED_READ_TIMEOUT_MS = 5_000;

/** Cuántas búsquedas en los registros oficiales a la vez (gratis, nuestras tablas). */
const OFFICIAL_RECORD_CONCURRENCY = 4;

/**
 * FASE B: el número fiscal y el tamaño oficiales de las del grupo que quedaron sin web ni
 * número (casi siempre las que trajo Claude), por su nombre exacto en su país. Con número, una
 * referencia del grupo entra por la capa gratuita (como `withGroupTaxIds`, ahora en todos los
 * países) y una sin web con 200+ trabajadores también (`promoteSizedCompaniesWithoutWebsite`).
 */
async function withOfficialRecords(
  plan: CorporateTreeWritePlan,
  root: CorporateTreeRoot,
  deps: CorporateTreeRunDeps,
  deadlineAtMs: number,
): Promise<{ plan: CorporateTreeWritePlan; looked: number; found: number; promoted: number }> {
  const pending = plan.rows.filter(
    (row) => !row.taxId && !!row.countryCode && (row.route === 'without_website' || row.route === 'group_reference'),
  );
  const records = new Map<string, CountrySourceCompany>();
  let looked = 0;
  if (deps.findOfficialRecord) {
    for (let i = 0; i < pending.length; i += OFFICIAL_RECORD_CONCURRENCY) {
      if (deps.nowMs() >= deadlineAtMs) break;
      const slice = pending.slice(i, i + OFFICIAL_RECORD_CONCURRENCY);
      const answered = await settleBy(
        Promise.all(slice.map((row) => deps.findOfficialRecord!({ name: row.name, countryCode: row.countryCode! }).catch(() => null))),
        deadlineAtMs,
        deps.nowMs,
      );
      if (!answered.settled) break;
      looked += slice.length;
      slice.forEach((row, index) => {
        const record = answered.value[index];
        if (record?.taxId) records.set(row.key, record);
      });
    }
  }
  const groupWithTax = new Map(
    [...records].filter(([key]) => plan.groupCompanies.has(key)).map(([key, record]) => {
      const base = plan.groupCompanies.get(key)!;
      return [key, { ...base, ...record, legalName: base.legalName, countryCode: base.countryCode }] as const;
    }),
  );
  const withGroup = promoteGroupCompaniesWithTaxIds(plan, groupWithTax);
  const sized = promoteSizedCompaniesWithoutWebsite(withGroup, { groupWebsite: root.website, officialRecords: records });
  return { plan: sized.plan, looked, found: records.size, promoted: sized.promoted };
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
    const answered = await settleBy(
      Promise.all(slice.map((row) => deps.findKnownCompany!({ name: row.name, countryCode: row.countryCode }).catch(() => null))),
      deadlineAtMs,
      deps.nowMs,
    );
    // Sin respuesta a tiempo: las que faltan siguen su camino (van al rescate como siempre).
    if (!answered.settled) break;
    const found = answered.value;
    slice.forEach((row, index) => {
      const match = found[index];
      // Con su ficha de HubSpot: así el lote y la ficha pueden decir «Ya en HubSpot» (o
      // «posible duplicado», que va a «Descartadas» sin rescate).
      if (match?.hubspotCompanyId) known.set(row.key, match);
    });
  }
  return markKnownCompanies(plan, known);
}

/** Las que el escritor no escribió, con su motivo: a lo sumo esto se guarda en el lote. */
const CORPORATE_TREE_NOT_WRITTEN_KEPT = 40;

async function writePlan(
  plan: CorporateTreeWritePlan,
  batchId: string,
  countries: readonly TreeCountry[],
  deps: CorporateTreeRunDeps,
  deadlineAtMs: number,
): Promise<{ written: number; withoutWebsite: number; errors: string[]; notWritten: CorporateTreeNotWritten[] }> {
  const countryOf = (code: string): TreeCountry => countries.find((c) => c.code === code) ?? { code, name: code };
  let written = 0;
  let withoutWebsite = 0;
  const errors: string[] = [];
  const notWritten: CorporateTreeNotWritten[] = [];
  // Sin tiempo para otra escritura: lo que falta se anota y la corrida cierra el lote a tiempo.
  const outOfTime = (what: string) => {
    if (deps.nowMs() < deadlineAtMs) return false;
    errors.push(`time_budget:${what}`);
    return true;
  };
  // Una escritura empezada justo antes de la hora límite tampoco puede comerse el sellado:
  // se espera hasta la gracia y, si no terminó, se anota como pendiente y se sigue.
  const waitUntilMs = deadlineAtMs + CORPORATE_TREE_WRITE_GRACE_MS;
  const bounded = async <T>(what: string, write: Promise<T>): Promise<T | null> => {
    const outcome = await settleBy(write, waitUntilMs, deps.nowMs);
    if (outcome.settled) return outcome.value;
    errors.push(`time_budget:${what}:pending`);
    return null;
  };
  // Uno a uno por país: el escritor adopta el lote y aplica las compuertas del país.
  for (const [code, companies] of plan.freeCatalog) {
    if (outOfTime(`free_catalog:${code}`)) continue;
    const result = await bounded(
      `free_catalog:${code}`,
      deps.writeFreeCatalog(batchId, countryOf(code), companies).catch(() => ({ written: 0, failed: true })),
    );
    if (!result) continue;
    written += result.written;
    if (result.failed) errors.push(`free_catalog:${code}`);
  }
  for (const [code, items] of plan.web) {
    if (outOfTime(`writer:${code}`)) continue;
    const result = await bounded(
      `writer:${code}`,
      deps.writeWeb(batchId, countryOf(code), items).catch((err: unknown) => ({
        written: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      })),
    );
    if (!result) continue;
    written += result.written;
    errors.push(...result.errors.map((e) => `writer:${code}:${e}`.slice(0, 200)));
    // Por qué el escritor no escribió cada una (Prod 15-10: Purina, HSBC Bank USA… sin motivo).
    // El escritor casi nunca devuelve la web (Prod 15-10: todas sin web): sale de la fila.
    const domainByName = new Map(
      items.map((item) => [(item.node?.name ?? item.bankCandidate?.name ?? '').trim().toLowerCase(), item.node?.domain ?? item.bankCandidate?.domain ?? null]),
    );
    const countryNotWritten: CorporateTreeNotWritten[] = [];
    for (const skip of 'skipped' in result ? (result.skipped ?? []) : []) {
      const domain = skip.domain ?? domainByName.get(skip.name.trim().toLowerCase()) ?? null;
      countryNotWritten.push({ name: skip.name, countryCode: code, domain, reason: skip.reason.slice(0, 120) });
    }
    notWritten.push(...countryNotWritten);
    const ownershipRejected = countryNotWritten.filter((n) => n.domain && n.reason.startsWith('company_ownership'));
    if (ownershipRejected.length > 0 && deps.recordOwnershipRejected && !outOfTime(`ownership_rejected:${code}`)) {
      await bounded(`ownership_rejected:${code}`, deps.recordOwnershipRejected(batchId, code, ownershipRejected).catch(() => 0));
    }
  }
  for (const [code, items] of plan.possibleDuplicates) {
    if (outOfTime(`possible_duplicate:${code}`) || !deps.recordPossibleDuplicates) continue;
    await bounded(`possible_duplicate:${code}`, deps.recordPossibleDuplicates(batchId, code, items).catch(() => 0));
  }
  for (const [code, companies] of plan.withoutWebsite) {
    if (outOfTime(`without_website:${code}`)) continue;
    withoutWebsite += (await bounded(`without_website:${code}`, deps.recordWithoutWebsite(batchId, code, companies).catch(() => 0))) ?? 0;
  }
  return { written, withoutWebsite, errors, notWritten };
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

  // 3. El árbol guardado de este grupo (30 días) o Claude, sólo por lo que falta.
  const saved = await findSavedTree(request, root, deps);
  const claude: ClaudePhase = saved
    ? { outcomes: [], skipped: 'saved_tree' }
    : await runClaudePhase(request, root, free.hits, { runId, batchId }, deps);
  const estimatedCostUsd = roundUsd(claude.outcomes.reduce((acc, o) => acc + (o.usage?.estimatedCostUsd ?? 0), 0));
  root = mergeRootFindings(root, saved ? [saved.root] : claude.outcomes.map((o) => o.root), free.hits);
  const nodes = saved ? saved.nodes : claude.outcomes.flatMap((o) => o.nodes);

  // 4. Escribir por las vías de siempre.
  deps.report('tree_checking');
  const withKnown = await withKnownCompanies(
    planCorporateTreeWrites({ root, freeHits: free.hits, nodes, branches: request.branches }),
    deps,
    context.writeDeadlineAtMs,
  );
  const withGroupFiscal = await withGroupTaxIds(withKnown, deps, context.writeDeadlineAtMs);
  const apollo = await withApolloFamily(withGroupFiscal, root, request, batchId, deps, context.writeDeadlineAtMs, saved);
  const official = await withOfficialRecords(apollo.plan, root, deps, context.writeDeadlineAtMs);
  const plan = official.plan;
  const writes = await writePlan(plan, batchId, request.countries, deps, context.writeDeadlineAtMs);

  // 5. Rama de cada fila y asociaciones. Todo acotado: lo que no termine antes del sellado
  //    se deja (el lote se sella igual; sin lectura no se sella como vacío).
  deps.report('tree_saving');
  const sealStartAtMs = context.writeDeadlineAtMs + CORPORATE_TREE_SEAL_START_GRACE_MS;
  const loadedOutcome = await settleBy(deps.loadBatchCandidates(batchId).catch(() => null), sealStartAtMs, deps.nowMs);
  const loaded = loadedOutcome.settled ? loadedOutcome.value : null;
  const candidates = loaded ?? [];
  const matched = matchPlannedRows(plan.rows, candidates, context.keyOf);
  const relationshipRows = buildRelationshipRows({ rows: plan.rows, matched, root, runId, batchId, createdBy: context.internalUserId });
  const groupSignal = await readGroupSignal(relationshipRows, deps, sealStartAtMs, saved?.hubspotMembers ?? []);
  const groupOpportunity = corporateTreeGroupOpportunity(groupSignal);
  const tagging = Promise.all(
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
        // Sólo las que el vendedor tiene que trabajar (las de «Por revisar»).
        ...(groupOpportunity && candidate.status === 'needs_review' ? { group_opportunity: groupOpportunity } : {}),
      };
      await deps.tagCandidate(candidate.id, { ...(candidate.metadata ?? {}), [CORPORATE_TREE_METADATA_KEY]: tree }).catch(() => undefined);
    }),
  );
  await settleBy(tagging, sealStartAtMs, deps.nowMs);
  const relationships = await settleBy(
    deps.insertRelationships(relationshipRows).catch(() => false),
    sealStartAtMs,
    deps.nowMs,
  );
  // Sin asociaciones el lote no muestra su árbol y el rescate no reconoce la web del grupo:
  // queda dicho en el lote (antes sólo en el log del servidor).
  const relationshipsSaved: boolean | 'timeout' = relationships.settled ? relationships.value : 'timeout';

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
      root_key: corporateTreeRootKey(root.name),
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
        ...(saved ? { reused_from: saved.batchId, reused_searched_at: saved.searchedAt } : {}),
        proposed: claude.outcomes.reduce((acc, o) => acc + o.proposed, 0),
        accepted: nodes.length,
        rejected: Object.fromEntries(claude.outcomes.map((o) => [o.branch, o.rejected])),
        errors: claude.outcomes.filter((o) => o.errorCode).map((o) => ({ branch: o.branch, code: o.errorCode })),
        // Las webs que Claude propuso y no se aceptaron, con su motivo (para diagnosticar).
        dropped_websites: claude.outcomes.flatMap((o) => o.droppedWebsites ?? []).slice(0, 30),
        estimated_cost_usd: estimatedCostUsd,
      },
      rows: plan.rows.length,
      written: writes.written,
      without_website: writes.withoutWebsite,
      group_references: plan.rows.filter((r) => r.route === 'group_reference').length,
      already_known: plan.rows.filter((r) => r.route === 'already_known').length,
      possible_known: plan.rows.filter((r) => r.route === 'possible_known').length,
      group_with_tax_id: plan.rows.filter((r) => r.route === 'free_catalog' && !!r.groupWebsite).length,
      apollo: {
        asked: apollo.asked,
        skipped: apollo.skipped,
        failed: apollo.failed,
        subsidiaries: apollo.subsidiaries,
        matched: apollo.matched,
        added: apollo.added,
      },
      official_records: { looked: official.looked, found: official.found },
      sized_without_website: official.promoted,
      dropped_by_cap: plan.droppedByCap,
      dropped_by_branch: plan.droppedByBranch ?? 0,
      relationships_saved: relationshipsSaved,
      // Se pidió desde «Buscar de nuevo» (no se miró el árbol guardado): queda dicho en el lote.
      ...(request.refresh ? { refresh_requested: true } : {}),
      ...(groupSignal ? { group_hubspot: groupSignal } : {}),
      unconfirmed_dropped: plan.unconfirmedDropped,
      shared_websites: plan.sharedWebsites,
      write_errors: writes.errors.slice(0, 10),
      not_written: writes.notWritten.slice(0, CORPORATE_TREE_NOT_WRITTEN_KEPT),
      searched_at: deps.nowIso(),
      // Lo encontrado se guarda para reutilizarlo 30 días. No se guarda lo reutilizado (el
      // plazo cuenta desde la búsqueda real) ni una búsqueda que Claude no hizo o con errores.
      ...(!saved && claude.skipped === null && claude.outcomes.every((o) => !o.errorCode)
        ? {
            saved: serializeSavedTree({
              root: { website: root.website, domain: root.domain, countryCode: root.countryCode },
              nodes,
              apolloSubsidiaries: apollo.answered,
              hubspotMembers: hubspotMembersOf(relationshipRows),
            }),
          }
        : {}),
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
    reusedSavedTree: !!saved,
    groupSignal,
  };
}

/**
 * FASE D: lee en HubSpot (sólo lectura, como mucho 12 fichas, acotado al sellado) las empresas
 * del grupo que ya están allí y resume si el grupo ya es cliente o lo trabaja alguien. `null`
 * si no hay ninguna en HubSpot, si no se pudo leer o si no hubo tiempo.
 */
/** Las empresas del grupo con ficha de HubSpot en esta corrida (para guardarlas con el árbol). */
function hubspotMembersOf(rows: readonly CorporateTreeRelationshipRow[]): CorporateTreeSavedHubSpotMember[] {
  const seen = new Set<string>();
  const members: CorporateTreeSavedHubSpotMember[] = [];
  for (const row of rows) {
    const id = row.matched_hubspot_company_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    members.push({ hubspotCompanyId: id, name: row.related_name, countryCode: row.related_country_code });
  }
  return members;
}

async function readGroupSignal(
  rows: readonly CorporateTreeRelationshipRow[],
  deps: CorporateTreeRunDeps,
  deadlineAtMs: number,
  /** Las del árbol guardado: se vuelven a leer aunque en esta corrida no quedaran ligadas. */
  savedMembers: readonly CorporateTreeSavedHubSpotMember[] = [],
): Promise<CorporateTreeGroupSignal | null> {
  if (!deps.readGroupHubSpotStatus) return null;
  const byId = new Map<string, { related_name: string; related_country_code: string | null; isRoot: boolean }>();
  for (const row of rows) {
    // La empresa de partida primero: si ella es cliente, eso es lo que más importa.
    if (row.matched_hubspot_company_id && !byId.has(row.matched_hubspot_company_id)) {
      byId.set(row.matched_hubspot_company_id, { related_name: row.related_name, related_country_code: row.related_country_code, isRoot: row.relation_type === 'root' });
    }
  }
  for (const member of savedMembers) {
    if (!byId.has(member.hubspotCompanyId)) {
      byId.set(member.hubspotCompanyId, { related_name: member.name, related_country_code: member.countryCode, isRoot: false });
    }
  }
  const ordered = [...byId.entries()].sort(([, a], [, b]) => Number(b.isRoot) - Number(a.isRoot));
  const ids = ordered.slice(0, CORPORATE_TREE_GROUP_HUBSPOT_MAX_READS).map(([id]) => id);
  if (ids.length === 0) return null;
  const read = await settleBy(deps.readGroupHubSpotStatus(ids).catch(() => new Map()), deadlineAtMs, deps.nowMs);
  if (!read.settled || read.value.size === 0) return null;
  const statuses = read.value;
  return summarizeCorporateTreeGroup(
    ids.map((id) => ({
      name: byId.get(id)!.related_name,
      countryCode: byId.get(id)!.related_country_code,
      status: statuses.get(id) ?? 'unknown',
    })),
  );
}

/**
 * El árbol guardado de este grupo que cubre lo pedido, o `null` (sin guardado, `refresh`, o la
 * lectura falló: entonces se busca como siempre).
 */
async function findSavedTree(
  request: CorporateTreeRequest,
  root: CorporateTreeRoot,
  deps: CorporateTreeRunDeps,
): Promise<CorporateTreeSavedTree | null> {
  const rootKey = corporateTreeRootKey(root.name);
  if (request.refresh || !deps.findSavedTrees || !rootKey) return null;
  // Una lectura colgada no frena la corrida: sin respuesta a tiempo, se busca como siempre.
  const read = await settleBy(
    deps.findSavedTrees(rootKey).catch(() => []),
    deps.nowMs() + CORPORATE_TREE_SAVED_READ_TIMEOUT_MS,
    deps.nowMs,
  );
  if (!read.settled) return null;
  return pickSavedTree(read.value, {
    branches: request.branches,
    countryCodes: request.countries.map((c) => c.code),
    rootCountryCode: root.countryCode,
    rootDomain: root.domain,
    nowMs: deps.nowMs(),
  });
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
