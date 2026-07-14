// ============================================================
// budgets — provider usage log display helpers (Q3F-13S)
// ============================================================
// Pure, dependency-free display resolution for the provider Logs tab's
// usage-log table. Never surfaces a raw user UUID or agent_run_id — every
// unresolved identity resolves to explicit copy instead. Mirrors the Q3F-9
// userConsumptionIdentity matrix (provider-detail-sidepanel.tsx) and the
// batch-resolution pattern in modules/ai-usage/queries.ts
// (getProviderUserConsumption).

export interface ResolvedUserRef {
  fullName: string | null;
  email: string | null;
}

export interface ResolvedAgentRunRef {
  agentKey: string | null;
  agentName: string | null;
}

export interface UsageLogUserDisplay {
  primary: string;
  secondary: string | null;
}

export interface UsageLogErrorDetail {
  message: string | null;
  code: string | null;
}

export interface UsageLogDisplayContext {
  user: UsageLogUserDisplay;
  agent: string;
  errorDetail: UsageLogErrorDetail | null;
}

const NULL_USER_DISPLAY: UsageLogUserDisplay = {
  primary: 'Sin usuario identificado',
  secondary: 'Consumo sin atribución de usuario',
};

const MISSING_USER_DISPLAY: UsageLogUserDisplay = { primary: 'Usuario no disponible', secondary: null };

const NULL_AGENT_DISPLAY = 'Manual';
const MISSING_AGENT_DISPLAY = 'Agente no disponible';

/**
 * A null triggeredBy is unattributed consumption (no user in the loop at
 * all). A non-null id with no matching internal_users row is an unresolved
 * reference, not "no user" — the two must never collapse into one label.
 */
export function resolveTriggeredByDisplay(
  triggeredBy: string | null,
  resolvedUser: ResolvedUserRef | undefined,
): UsageLogUserDisplay {
  if (triggeredBy === null) return NULL_USER_DISPLAY;
  if (!resolvedUser) return MISSING_USER_DISPLAY;
  if (resolvedUser.fullName && resolvedUser.email) {
    return { primary: resolvedUser.fullName, secondary: resolvedUser.email };
  }
  if (resolvedUser.fullName) return { primary: resolvedUser.fullName, secondary: null };
  if (resolvedUser.email) return { primary: resolvedUser.email, secondary: null };
  return MISSING_USER_DISPLAY;
}

/**
 * A null agentRunId means the operation was not attributed to an agent run
 * (manual/direct trigger). A non-null id with no matching agent_runs row is
 * unresolved, not "no agent".
 */
export function resolveAgentDisplay(
  agentRunId: string | null,
  resolvedAgentRun: ResolvedAgentRunRef | undefined,
): string {
  if (agentRunId === null) return NULL_AGENT_DISPLAY;
  if (!resolvedAgentRun) return MISSING_AGENT_DISPLAY;
  return resolvedAgentRun.agentName ?? resolvedAgentRun.agentKey ?? MISSING_AGENT_DISPLAY;
}

/**
 * Uses only persisted error_message/error_code — never fabricates failure
 * detail from status. A technically successful row has neither field set,
 * so it must resolve to null here rather than invented text.
 */
export function resolveErrorDetail(
  errorMessage: string | null,
  errorCode: string | null,
): UsageLogErrorDetail | null {
  if (!errorMessage && !errorCode) return null;
  return { message: errorMessage || null, code: errorCode || null };
}

export function resolveUsageLogDisplayContext(input: {
  triggeredBy: string | null;
  resolvedUser: ResolvedUserRef | undefined;
  agentRunId: string | null;
  resolvedAgentRun: ResolvedAgentRunRef | undefined;
  errorMessage: string | null;
  errorCode: string | null;
}): UsageLogDisplayContext {
  return {
    user: resolveTriggeredByDisplay(input.triggeredBy, input.resolvedUser),
    agent: resolveAgentDisplay(input.agentRunId, input.resolvedAgentRun),
    errorDetail: resolveErrorDetail(input.errorMessage, input.errorCode),
  };
}

/** Render-ready text for the "Detalle de error" column/cell. */
export function formatUsageLogErrorDetailText(detail: UsageLogErrorDetail | null): string {
  if (!detail) return '—';
  if (detail.message) return detail.code ? `${detail.message} (${detail.code})` : detail.message;
  if (detail.code) return detail.code;
  return '—';
}
