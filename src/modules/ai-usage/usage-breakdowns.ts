// ============================================================
// /ai-usage — tablas de la fase 3 (agregados puros)
//
//   «Por agente»       → aggregateAgentSteps
//   «Por país»         → aggregateCountryTools
//   «Por rol y grupo»  → aggregateRoleGroups
//   «Por búsqueda»     → aggregateSearchBatches
//
// Dinero: igual que el resto de la página, SÓLO de provider_usage_logs; un costo
// NULL es «sin tarifa» y nunca un 0 (has_unknown_cost lo dice). Empresas: sólo
// las de corridas reales (company-outcomes.ts).
// ============================================================

import { knownCost } from './usage-aggregators';
import type { DimensionedLogRow } from './usage-dimension-scope';
import {
  COMPANY_TOOLS,
  providerTool,
  type CompanyBatchRow,
  type CompanyOutcome,
  type CompanyTool,
} from './company-outcomes';
import { resolveUsageCredits } from '@/modules/usage-tracking/credits-display';
import { resolveBatchDimensions } from '@/modules/usage-tracking/usage-dimensions';

const LOG_ERROR_STATUSES: ReadonlySet<string> = new Set(['error', 'rate_limited', 'quota_exceeded']);

interface MoneyAcc {
  cost: number;
  unknown: boolean;
}

function newMoney(): MoneyAcc {
  return { cost: 0, unknown: false };
}

function addMoney(acc: MoneyAcc, value: number | string | null): void {
  const cost = knownCost(value);
  if (cost === null) acc.unknown = true;
  else acc.cost += cost;
}

function perUnit(cost: number, units: number): number | null {
  return units > 0 ? cost / units : null;
}

// ============================================================
// Por agente: cada agente con sus pasos
// ============================================================

/** Resultado medible de un paso: qué se cuenta y de dónde sale. */
export type StepResultMetric = 'webs_found' | 'companies_proposed' | 'results';

export const STEP_RESULT_METRICS: Readonly<Record<string, StepResultMetric>> = {
  rescate_web: 'webs_found',
  claude_busca_empresas: 'companies_proposed',
  busqueda_web: 'results',
  apollo: 'results',
  lusha: 'results',
};

export const STEP_RESULT_LABELS: Readonly<Record<StepResultMetric, string>> = {
  webs_found: 'Webs encontradas',
  companies_proposed: 'Empresas propuestas',
  results: 'Resultados',
};

export interface AgentStepRow {
  id: string;
  agentKey: string | null;
  agentStep: string | null;
  calls: number;
  errors: number;
  /** Créditos conocidos; las consultas con crédito indeterminado van aparte. */
  credits: number;
  unknownCreditCalls: number;
  tokens: number;
  costUsd: number | null;
  hasUnknownCost: boolean;
  resultMetric: StepResultMetric | null;
  resultCount: number | null;
  costPerResultUsd: number | null;
}

export interface AgentSummaryRow {
  agentKey: string | null;
  calls: number;
  errors: number;
  credits: number;
  costUsd: number | null;
  hasUnknownCost: boolean;
  steps: number;
}

interface StepAcc {
  agentKey: string | null;
  agentStep: string | null;
  calls: number;
  errors: number;
  credits: number;
  unknownCreditCalls: number;
  tokens: number;
  money: MoneyAcc;
  found: number;
  returned: number;
}

function resultCountOf(acc: StepAcc, metric: StepResultMetric | null): number | null {
  if (metric === null) return null;
  return metric === 'webs_found' ? acc.found : acc.returned;
}

export function aggregateAgentSteps(logs: readonly DimensionedLogRow[]): {
  agents: AgentSummaryRow[];
  steps: AgentStepRow[];
} {
  const byStep = new Map<string, StepAcc>();
  for (const log of logs) {
    const id = `${log.agent_key ?? '-'}:${log.agent_step ?? '-'}`;
    const acc: StepAcc = byStep.get(id) ?? {
      agentKey: log.agent_key,
      agentStep: log.agent_step,
      calls: 0,
      errors: 0,
      credits: 0,
      unknownCreditCalls: 0,
      tokens: 0,
      money: newMoney(),
      found: 0,
      returned: 0,
    };
    acc.calls++;
    if (LOG_ERROR_STATUSES.has(log.status)) acc.errors++;
    const credits = resolveUsageCredits(log.credits_used);
    if (credits.state === 'unknown') acc.unknownCreditCalls++;
    else acc.credits += credits.credits;
    acc.tokens += Number(log.input_tokens ?? 0) + Number(log.output_tokens ?? 0);
    addMoney(acc.money, log.estimated_cost_usd);
    if (log.found === true) acc.found++;
    acc.returned += Number(log.results_returned ?? 0);
    byStep.set(id, acc);
  }

  const steps: AgentStepRow[] = [...byStep.entries()].map(([id, acc]) => {
    const metric = acc.agentStep ? STEP_RESULT_METRICS[acc.agentStep] ?? null : null;
    const resultCount = resultCountOf(acc, metric);
    return {
      id,
      agentKey: acc.agentKey,
      agentStep: acc.agentStep,
      calls: acc.calls,
      errors: acc.errors,
      credits: acc.credits,
      unknownCreditCalls: acc.unknownCreditCalls,
      tokens: acc.tokens,
      costUsd: acc.money.cost,
      hasUnknownCost: acc.money.unknown,
      resultMetric: metric,
      resultCount,
      costPerResultUsd: resultCount === null ? null : perUnit(acc.money.cost, resultCount),
    };
  });
  steps.sort((a, b) => {
    const agent = (a.agentKey ?? '~').localeCompare(b.agentKey ?? '~');
    if (agent !== 0) return agent;
    return (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.calls - a.calls;
  });

  const byAgent = new Map<string, AgentSummaryRow>();
  for (const step of steps) {
    const key = step.agentKey ?? '-';
    const row = byAgent.get(key) ?? {
      agentKey: step.agentKey,
      calls: 0,
      errors: 0,
      credits: 0,
      costUsd: 0,
      hasUnknownCost: false,
      steps: 0,
    };
    row.calls += step.calls;
    row.errors += step.errors;
    row.credits += step.credits;
    row.costUsd = (row.costUsd ?? 0) + (step.costUsd ?? 0);
    row.hasUnknownCost = row.hasUnknownCost || step.hasUnknownCost;
    row.steps++;
    byAgent.set(key, row);
  }
  const agents = [...byAgent.values()].sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));
  return { agents, steps };
}

// ============================================================
// Por país: matriz país × herramienta
// ============================================================

export interface ResolvedDiscard {
  countryCode: string | null;
  tool: CompanyTool;
}

export type CountryToolKey = CompanyTool | 'total';

export interface CountryToolRow {
  id: string;
  countryCode: string | null;
  tool: CountryToolKey;
  reachedReview: number;
  approved: number;
  converted: number;
  withTaxId: number;
  withWebsite: number;
  discarded: number;
  costUsd: number | null;
  hasUnknownCost: boolean;
  costPerApprovedUsd: number | null;
}

interface CountryAcc {
  reachedReview: number;
  approved: number;
  converted: number;
  withTaxId: number;
  withWebsite: number;
  discarded: number;
  money: MoneyAcc;
}

function newCountryAcc(): CountryAcc {
  return { reachedReview: 0, approved: 0, converted: 0, withTaxId: 0, withWebsite: 0, discarded: 0, money: newMoney() };
}

const TOOL_ORDER: readonly CountryToolKey[] = ['total', ...COMPANY_TOOLS];

export function aggregateCountryTools(
  outcomes: readonly CompanyOutcome[],
  discards: readonly ResolvedDiscard[],
  logs: readonly DimensionedLogRow[],
): CountryToolRow[] {
  const cells = new Map<string, CountryAcc>();
  const cellOf = (country: string | null, tool: CountryToolKey) => {
    const id = `${country ?? '-'}:${tool}`;
    const acc = cells.get(id) ?? newCountryAcc();
    cells.set(id, acc);
    return acc;
  };
  const both = (country: string | null, tool: CompanyTool, apply: (acc: CountryAcc) => void) => {
    apply(cellOf(country, tool));
    apply(cellOf(country, 'total'));
  };

  for (const o of outcomes) {
    both(o.countryCode, o.tool, (acc) => {
      acc.reachedReview++;
      if (o.approved) acc.approved++;
      if (o.converted) acc.converted++;
      if (o.hasTaxId) acc.withTaxId++;
      if (o.hasWebsite) acc.withWebsite++;
    });
  }
  for (const d of discards) both(d.countryCode, d.tool, (acc) => acc.discarded++);
  for (const log of logs) {
    // Sólo el dinero que se puede poner en un país.
    if (!log.country_code) continue;
    both(log.country_code, providerTool(log.provider_key), (acc) => addMoney(acc.money, log.estimated_cost_usd));
  }

  const rows: CountryToolRow[] = [...cells.entries()].map(([id, acc]) => {
    const [country, tool] = id.split(':') as [string, CountryToolKey];
    return {
      id,
      countryCode: country === '-' ? null : country,
      tool,
      reachedReview: acc.reachedReview,
      approved: acc.approved,
      converted: acc.converted,
      withTaxId: acc.withTaxId,
      withWebsite: acc.withWebsite,
      discarded: acc.discarded,
      costUsd: acc.money.cost,
      hasUnknownCost: acc.money.unknown,
      costPerApprovedUsd: perUnit(acc.money.cost, acc.approved),
    };
  });
  return rows.sort((a, b) => {
    const country = (a.countryCode ?? '~').localeCompare(b.countryCode ?? '~');
    if (country !== 0) return country;
    return TOOL_ORDER.indexOf(a.tool) - TOOL_ORDER.indexOf(b.tool);
  });
}

// ============================================================
// Por rol y grupo
// ============================================================

export const NO_ROLE_KEY = 'sin_rol';
export const NO_GROUP_KEY = 'sin_grupo';

export interface UsagePersonInfo {
  id: string;
  name: string | null;
  email: string | null;
  roleKey: string | null;
  groupId: string | null;
}

export interface RoleGroupRow {
  id: string;
  people: number;
  calls: number;
  credits: number;
  costUsd: number | null;
  hasUnknownCost: boolean;
  approved: number;
  costPerApprovedUsd: number | null;
}

export interface PersonUsageRow {
  userId: string;
  name: string | null;
  email: string | null;
  roleKey: string;
  groupId: string;
  calls: number;
  credits: number;
  costUsd: number | null;
  hasUnknownCost: boolean;
  approved: number;
  costPerApprovedUsd: number | null;
}

interface RoleAcc {
  people: Set<string>;
  calls: number;
  credits: number;
  money: MoneyAcc;
  approved: number;
}

function newRoleAcc(): RoleAcc {
  return { people: new Set(), calls: 0, credits: 0, money: newMoney(), approved: 0 };
}

function finishRoleRows(map: Map<string, RoleAcc>): RoleGroupRow[] {
  return [...map.entries()]
    .map(([id, acc]) => ({
      id,
      people: acc.people.size,
      calls: acc.calls,
      credits: acc.credits,
      costUsd: acc.money.cost,
      hasUnknownCost: acc.money.unknown,
      approved: acc.approved,
      costPerApprovedUsd: perUnit(acc.money.cost, acc.approved),
    }))
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.calls - a.calls);
}

/**
 * Consultas: rol y grupo del MOMENTO de la consulta (triggered_by_role_key /
 * triggered_by_group_id) cuando existen; si no, los de hoy de la persona.
 * Empresas aprobadas: de quien creó el lote, con su rol y grupo de hoy (las
 * candidatas no guardan esa foto).
 */
export function aggregateRoleGroups(
  logs: readonly DimensionedLogRow[],
  outcomes: readonly CompanyOutcome[],
  batchesById: ReadonlyMap<string, Pick<CompanyBatchRow, 'created_by'>>,
  people: readonly UsagePersonInfo[],
): { roles: RoleGroupRow[]; groups: RoleGroupRow[]; people: PersonUsageRow[] } {
  const personById = new Map(people.map((p) => [p.id, p]));
  const roles = new Map<string, RoleAcc>();
  const groups = new Map<string, RoleAcc>();
  const persons = new Map<string, RoleAcc>();
  const acc = (map: Map<string, RoleAcc>, key: string) => {
    const cur = map.get(key) ?? newRoleAcc();
    map.set(key, cur);
    return cur;
  };

  for (const log of logs) {
    const person = log.triggered_by ? personById.get(log.triggered_by) : undefined;
    const roleKey = log.triggered_by_role_key ?? person?.roleKey ?? NO_ROLE_KEY;
    const groupId = log.triggered_by_group_id ?? person?.groupId ?? NO_GROUP_KEY;
    const credits = resolveUsageCredits(log.credits_used);
    const targets = [acc(roles, roleKey), acc(groups, groupId)];
    if (log.triggered_by) targets.push(acc(persons, log.triggered_by));
    for (const t of targets) {
      if (log.triggered_by) t.people.add(log.triggered_by);
      t.calls++;
      if (credits.state === 'known') t.credits += credits.credits;
      addMoney(t.money, log.estimated_cost_usd);
    }
  }

  for (const o of outcomes) {
    if (!o.approved) continue;
    const createdBy = batchesById.get(o.batchId)?.created_by ?? null;
    if (!createdBy) continue;
    const person = personById.get(createdBy);
    for (const t of [
      acc(roles, person?.roleKey ?? NO_ROLE_KEY),
      acc(groups, person?.groupId ?? NO_GROUP_KEY),
      acc(persons, createdBy),
    ]) {
      t.people.add(createdBy);
      t.approved++;
    }
  }

  const peopleRows: PersonUsageRow[] = finishRoleRows(persons).map((row) => {
    const person = personById.get(row.id);
    return {
      userId: row.id,
      name: person?.name ?? null,
      email: person?.email ?? null,
      roleKey: person?.roleKey ?? NO_ROLE_KEY,
      groupId: person?.groupId ?? NO_GROUP_KEY,
      calls: row.calls,
      credits: row.credits,
      costUsd: row.costUsd,
      hasUnknownCost: row.hasUnknownCost,
      approved: row.approved,
      costPerApprovedUsd: row.costPerApprovedUsd,
    };
  });

  return { roles: finishRoleRows(roles), groups: finishRoleRows(groups), people: peopleRows };
}

// ============================================================
// Por búsqueda: una fila por lote
// ============================================================

export const OTHER_STEP_KEY = 'otro';

export interface SearchBatchRow {
  batchId: string;
  createdAt: string;
  createdBy: string | null;
  countryCode: string | null;
  macroIndustryKey: string | null;
  searchMode: string | null;
  companiesByTool: Partial<Record<CompanyTool, number>>;
  reachedReview: number;
  approved: number;
  calls: number;
  credits: number;
  /** Costo por paso del agente (clave del paso u «otro»). */
  costByStep: Record<string, number>;
  totalCostUsd: number | null;
  hasUnknownCost: boolean;
  costPerApprovedUsd: number | null;
}

export function aggregateSearchBatches(
  batches: readonly CompanyBatchRow[],
  outcomes: readonly CompanyOutcome[],
  logs: readonly DimensionedLogRow[],
): SearchBatchRow[] {
  const rows = new Map<string, SearchBatchRow & { money: MoneyAcc }>();
  for (const batch of batches) {
    const dims = resolveBatchDimensions(batch);
    rows.set(batch.id, {
      batchId: batch.id,
      createdAt: batch.created_at,
      createdBy: batch.created_by,
      countryCode: dims.countryCode,
      macroIndustryKey: dims.macroIndustryKey,
      searchMode: dims.searchMode,
      companiesByTool: {},
      reachedReview: 0,
      approved: 0,
      calls: 0,
      credits: 0,
      costByStep: {},
      totalCostUsd: 0,
      hasUnknownCost: false,
      costPerApprovedUsd: null,
      money: newMoney(),
    });
  }
  for (const o of outcomes) {
    const row = rows.get(o.batchId);
    if (!row) continue;
    row.reachedReview++;
    if (o.approved) row.approved++;
    row.companiesByTool[o.tool] = (row.companiesByTool[o.tool] ?? 0) + 1;
  }
  for (const log of logs) {
    const row = log.batch_id ? rows.get(log.batch_id) : undefined;
    if (!row) continue;
    row.calls++;
    const credits = resolveUsageCredits(log.credits_used);
    if (credits.state === 'known') row.credits += credits.credits;
    addMoney(row.money, log.estimated_cost_usd);
    const cost = knownCost(log.estimated_cost_usd);
    if (cost !== null) {
      const step = log.agent_step ?? OTHER_STEP_KEY;
      row.costByStep[step] = (row.costByStep[step] ?? 0) + cost;
    }
  }
  return [...rows.values()]
    .map(({ money, ...row }) => ({
      ...row,
      totalCostUsd: money.cost,
      hasUnknownCost: money.unknown,
      costPerApprovedUsd: perUnit(money.cost, row.approved),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
