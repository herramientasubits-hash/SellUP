// Agente 2A — Conversational wizard reducer (Hito 17A.2B)
// Pure state machine. No React, no network. The async server actions are called
// by the wizard component, which then dispatches the resulting action here.

import type { AgentChatMessage, AgentChatRole, AgentChatTone } from '@/components/agent-chat';
import type { CompanyCandidate, CompanyResolutionResult } from '@/modules/contact-enrichment/types';
import type {
  ContactEnrichmentChatAction,
  ContactEnrichmentChatState,
  ContactEnrichmentInitialCompany,
} from './contact-enrichment-chat-types';

// ── Copy ──────────────────────────────────────────────────────────────────────

const GREETING =
  'Hola. Puedo ayudarte a preparar una búsqueda de contactos para una empresa.\n\nPara empezar, dime el nombre, dominio o HubSpot ID de la empresa.';

const PRELOADED_INTRO =
  'Voy a preparar el enriquecimiento de contactos para esta empresa.\n\n¿Confirmas que quieres preparar este enriquecimiento?';

const NEEDS_DATA =
  'No encontré coincidencias claras en SellUp ni HubSpot.\n\nPara buscar contactos con precisión necesito un dato adicional: dominio, país o HubSpot ID. ¿Qué dato quieres agregar?';

const SKIPPED_HUBSPOT_NOTE = 'HubSpot no disponible — resultados solo desde SellUp.';

const SINGLE_MATCH =
  'Encontré esta empresa. ¿Confirmas que quieres preparar el enriquecimiento de contactos?';

const MULTIPLE_MATCHES = 'Encontré varias coincidencias posibles. Elige cuál quieres usar:';

const MANUAL_PREPARED =
  'Perfecto. Prepararé el enriquecimiento como empresa manual. ¿Confirmas que quieres continuar?';

const SELECTED_CONFIRM =
  'Perfecto. ¿Confirmas que quieres preparar el enriquecimiento para esta empresa?';

const RUN_DONE = 'Listo. Creé el run y revisé los contactos existentes antes de enriquecer.';

const REQUEST_DONE =
  'Listo. Preparé el contexto de esta empresa. Elige un proveedor para buscar contactos.';

const APOLLO_SEARCHING = 'Voy a buscar perfiles relevantes en Apollo…';

const APOLLO_DONE_WITH_CANDIDATES =
  'Encontré candidatos relevantes y con datos de contacto suficientes. Los dejé listos para revisión. No creé contactos finales: requieren tu aprobación.';

const APOLLO_DONE_FILTERED =
  'Apollo encontró perfiles, pero ninguno tenía suficiente relevancia o datos completos para revisión. No se crearon contactos finales.';

const APOLLO_DONE_NO_ACTIONABLE =
  'Apollo encontró perfiles, pero ninguno tenía datos suficientes de contacto (email, LinkedIn o teléfono) para revisión. No se crearon contactos finales.';

const APOLLO_DONE_NO_CANDIDATES =
  'No encontré contactos con los criterios actuales. Puedes intentar con otra empresa o revisar la configuración de Apollo.';

const APOLLO_NOT_CONNECTED =
  'Apollo no está conectado o no tiene credenciales disponibles.\nNo se crearon candidatos.';

const APOLLO_SKIPPED =
  'No tengo datos suficientes (dominio o nombre) para buscar en Apollo de forma segura. No se crearon candidatos.';

const LUSHA_SEARCHING = 'Voy a buscar perfiles en Lusha…';

const LUSHA_DONE_WITH_CANDIDATES =
  'Encontré candidato(s) en Lusha con email corporativo. Quedaron listos para revisión. No creé contactos finales: requieren tu aprobación.';

const LUSHA_DONE_NO_CANDIDATES =
  'Lusha ejecutó la búsqueda correctamente, pero los perfiles encontrados no pasaron los filtros de relevancia o consistencia con la empresa. No se crearon candidatos, no se sincronizó nada a HubSpot y no se revelaron teléfonos.';

const LUSHA_NOT_CONNECTED =
  'Lusha no está disponible o no tiene credenciales configuradas.\nNo se crearon candidatos.';

const LUSHA_DISABLED =
  'Lusha no está habilitado en este entorno. Usa Apollo para continuar.';

const LUSHA_PROVIDER_ERROR =
  'No fue posible completar la búsqueda con Lusha. El proveedor devolvió un error durante la búsqueda. Intenta nuevamente más tarde o revisa el estado de la integración.';

// ── Message minting helper ─────────────────────────────────────────────────────

type DraftMessage = { role: AgentChatRole; content: string; tone?: AgentChatTone };

function appendMessages(
  state: ContactEnrichmentChatState,
  drafts: DraftMessage[],
): Pick<ContactEnrichmentChatState, 'messages' | 'seq'> {
  let seq = state.seq;
  const added: AgentChatMessage[] = drafts.map((draft) => ({
    id: `cew-${seq++}`,
    role: draft.role,
    content: draft.content,
    tone: draft.tone,
  }));
  return { messages: [...state.messages, ...added], seq };
}

// ── Pure query classification + resolution planning ────────────────────────────

export type CompanyQueryKind = 'name' | 'domain' | 'hubspot_id';

export function classifyCompanyQuery(query: string): CompanyQueryKind {
  const q = query.trim();
  const isDomain = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(q) && !q.includes(' ');
  const isHubSpotId = /^\d{6,}$/.test(q);
  if (isHubSpotId) return 'hubspot_id';
  if (isDomain) return 'domain';
  return 'name';
}

/** Builds the resolver input from a free-text company query. */
export function buildResolveInput(query: string): Record<string, string> {
  const q = query.trim();
  const kind = classifyCompanyQuery(q);
  if (kind === 'hubspot_id') return { hubspotCompanyId: q };
  if (kind === 'domain') return { companyDomain: q };
  return { companyName: q };
}

/**
 * Decides which action the wizard should dispatch given the resolver result.
 * Pure — fully unit-testable without any network call.
 */
export function planResolution(
  query: string,
  result: CompanyResolutionResult,
): ContactEnrichmentChatAction {
  const { candidates, singleMatch, selected, skippedHubSpot } = result;
  const kind = classifyCompanyQuery(query);

  if (candidates.length === 0) {
    if (kind === 'name') {
      return { type: 'RESOLVED_NONE_NEEDS_DATA' };
    }
    const manual: CompanyCandidate = {
      source: 'manual',
      name: query.trim(),
      domain: kind === 'domain' ? query.trim() : undefined,
      hubspotCompanyId: kind === 'hubspot_id' ? query.trim() : undefined,
      matchConfidence: 0.5,
    };
    return { type: 'RESOLVED_MANUAL', candidate: manual, skippedHubSpot };
  }

  if (singleMatch && selected) {
    return { type: 'RESOLVED_SINGLE', candidate: selected, skippedHubSpot };
  }

  return { type: 'RESOLVED_MULTIPLE', candidates, skippedHubSpot };
}

// ── Initial state ──────────────────────────────────────────────────────────────

export function createInitialContactEnrichmentChatState(
  initialCompany?: ContactEnrichmentInitialCompany,
): ContactEnrichmentChatState {
  const base: ContactEnrichmentChatState = {
    step: 'await_company',
    seq: 0,
    messages: [],
    query: '',
    candidates: [],
    selectedCandidate: null,
    skippedHubSpot: false,
    runResult: null,
    requestId: null,
    selectedProvider: 'apollo',
    apolloResult: null,
    lushaResult: null,
    errorMessage: null,
  };

  if (initialCompany) {
    const preloaded: CompanyCandidate = {
      source: 'sellup',
      name: initialCompany.name,
      domain: initialCompany.domain ?? undefined,
      country: initialCompany.country ?? undefined,
      countryCode: initialCompany.countryCode ?? undefined,
      sellupAccountId: initialCompany.sellupAccountId,
      hubspotCompanyId: initialCompany.hubspotCompanyId ?? undefined,
      matchConfidence: 1,
    };
    return {
      ...base,
      step: 'confirming',
      selectedCandidate: preloaded,
      candidates: [preloaded],
      query: initialCompany.name,
      selectedProvider: 'apollo',
      lushaResult: null,
      ...appendMessages(base, [{ role: 'assistant', content: PRELOADED_INTRO }]),
    };
  }

  return {
    ...base,
    ...appendMessages(base, [{ role: 'assistant', content: GREETING }]),
  };
}

// ── Reducer ─────────────────────────────────────────────────────────────────────

export function contactEnrichmentChatReducer(
  state: ContactEnrichmentChatState,
  action: ContactEnrichmentChatAction,
): ContactEnrichmentChatState {
  switch (action.type) {
    case 'SUBMIT_QUERY': {
      const query = action.query.trim();
      if (!query) return state;
      return {
        ...state,
        step: 'resolving',
        query,
        errorMessage: null,
        ...appendMessages(state, [{ role: 'user', content: query }]),
      };
    }

    case 'RESOLVED_NONE_NEEDS_DATA': {
      return {
        ...state,
        step: 'needs_extra_data',
        candidates: [],
        selectedCandidate: null,
        ...appendMessages(state, [{ role: 'assistant', content: NEEDS_DATA }]),
      };
    }

    case 'RESOLVED_MANUAL': {
      const drafts: DraftMessage[] = [];
      if (action.skippedHubSpot) {
        drafts.push({ role: 'system', content: SKIPPED_HUBSPOT_NOTE, tone: 'warning' });
      }
      drafts.push({ role: 'assistant', content: MANUAL_PREPARED });
      return {
        ...state,
        step: 'confirming',
        candidates: [],
        selectedCandidate: action.candidate,
        skippedHubSpot: action.skippedHubSpot,
        ...appendMessages(state, drafts),
      };
    }

    case 'RESOLVED_SINGLE': {
      const drafts: DraftMessage[] = [];
      if (action.skippedHubSpot) {
        drafts.push({ role: 'system', content: SKIPPED_HUBSPOT_NOTE, tone: 'warning' });
      }
      drafts.push({ role: 'assistant', content: SINGLE_MATCH });
      return {
        ...state,
        step: 'confirming',
        candidates: [action.candidate],
        selectedCandidate: action.candidate,
        skippedHubSpot: action.skippedHubSpot,
        ...appendMessages(state, drafts),
      };
    }

    case 'RESOLVED_MULTIPLE': {
      const drafts: DraftMessage[] = [];
      if (action.skippedHubSpot) {
        drafts.push({ role: 'system', content: SKIPPED_HUBSPOT_NOTE, tone: 'warning' });
      }
      drafts.push({ role: 'assistant', content: MULTIPLE_MATCHES });
      return {
        ...state,
        step: 'selecting_company',
        candidates: action.candidates,
        selectedCandidate: null,
        skippedHubSpot: action.skippedHubSpot,
        ...appendMessages(state, drafts),
      };
    }

    case 'RESOLVE_FAILED': {
      return {
        ...state,
        step: 'error',
        errorMessage: action.message,
        ...appendMessages(state, [{ role: 'system', content: action.message, tone: 'error' }]),
      };
    }

    case 'SELECT_CANDIDATE': {
      return {
        ...state,
        step: 'confirming',
        selectedCandidate: action.candidate,
        ...appendMessages(state, [
          { role: 'user', content: action.candidate.name },
          { role: 'assistant', content: SELECTED_CONFIRM },
        ]),
      };
    }

    case 'SUBMIT_EXTRA_DATA': {
      const domain = action.domain.trim();
      const country = action.country.trim();
      const parts: string[] = [];
      if (domain) parts.push(`Dominio: ${domain}`);
      if (country) parts.push(`País: ${country}`);
      const manual: CompanyCandidate = {
        source: 'manual',
        name: state.query.trim(),
        domain: domain || undefined,
        country: country || undefined,
        countryCode: country || undefined,
        matchConfidence: 0.5,
      };
      return {
        ...state,
        step: 'confirming',
        candidates: [],
        selectedCandidate: manual,
        ...appendMessages(state, [
          { role: 'user', content: parts.join(' · ') || 'Sin datos adicionales' },
          { role: 'assistant', content: MANUAL_PREPARED },
        ]),
      };
    }

    case 'CONFIRM': {
      if (!state.selectedCandidate) return state;
      return {
        ...state,
        step: 'creating_run',
        errorMessage: null,
        ...appendMessages(state, [{ role: 'user', content: 'Confirmar empresa' }]),
      };
    }

    case 'RUN_SUCCEEDED': {
      return {
        ...state,
        step: 'done',
        runResult: action.result,
        ...appendMessages(state, [{ role: 'assistant', content: RUN_DONE }]),
      };
    }

    case 'REQUEST_CREATED': {
      return {
        ...state,
        step: 'done',
        requestId: action.requestId,
        ...appendMessages(state, [{ role: 'assistant', content: REQUEST_DONE }]),
      };
    }

    case 'RUN_FAILED': {
      return {
        ...state,
        step: 'error',
        errorMessage: action.message,
        ...appendMessages(state, [{ role: 'system', content: action.message, tone: 'error' }]),
      };
    }

    case 'APOLLO_START': {
      if (state.step !== 'done') return state;
      return {
        ...state,
        step: 'searching_apollo',
        errorMessage: null,
        ...appendMessages(state, [
          { role: 'user', content: 'Buscar contactos ahora' },
          { role: 'assistant', content: APOLLO_SEARCHING },
        ]),
      };
    }

    case 'APOLLO_SUCCEEDED': {
      const created = action.result.candidatesCreated;
      const content =
        created > 0
          ? APOLLO_DONE_WITH_CANDIDATES
          : action.result.noActionableContactsFound
            ? APOLLO_DONE_NO_ACTIONABLE
            : action.result.noReviewableContactsFound
              ? APOLLO_DONE_FILTERED
              : APOLLO_DONE_NO_CANDIDATES;
      return {
        ...state,
        step: 'done',
        apolloResult: action.result,
        ...(action.runResult ? { runResult: action.runResult } : {}),
        ...appendMessages(state, [{ role: 'assistant', content }]),
      };
    }

    case 'APOLLO_FAILED': {
      const reason = action.result.providerStatus === 'skipped' ? APOLLO_SKIPPED : APOLLO_NOT_CONNECTED;
      return {
        ...state,
        step: 'done',
        apolloResult: action.result,
        ...(action.runResult ? { runResult: action.runResult } : {}),
        ...appendMessages(state, [{ role: 'system', content: reason, tone: 'warning' }]),
      };
    }

    case 'SELECT_PROVIDER': {
      if (state.step !== 'done') return state;
      return { ...state, selectedProvider: action.provider };
    }

    case 'LUSHA_START': {
      if (state.step !== 'done') return state;
      return {
        ...state,
        step: 'searching_lusha',
        errorMessage: null,
        ...appendMessages(state, [
          { role: 'user', content: 'Buscar contactos con Lusha' },
          { role: 'assistant', content: LUSHA_SEARCHING },
        ]),
      };
    }

    case 'LUSHA_SUCCEEDED': {
      const created = action.result.candidatesCreated;
      const content = created > 0 ? LUSHA_DONE_WITH_CANDIDATES : LUSHA_DONE_NO_CANDIDATES;
      return {
        ...state,
        step: 'done',
        lushaResult: action.result,
        ...(action.runResult ? { runResult: action.runResult } : {}),
        ...appendMessages(state, [{ role: 'assistant', content }]),
      };
    }

    case 'LUSHA_FAILED': {
      // Only 'disabled'/'missing_api_key' are genuine credentials/availability
      // failures. Every other real-failure status (provider_error, not_found,
      // invalid_account, invalid_run_status, not_implemented, generic error)
      // falls back to the provider-error copy — never to the "sin
      // credenciales" message, which would misreport an unrelated failure as
      // a credentials problem (Hito 17B.4X.7C.3D).
      const reason =
        action.result.status === 'disabled' ? LUSHA_DISABLED
          : action.result.status === 'missing_api_key' ? LUSHA_NOT_CONNECTED
            : LUSHA_PROVIDER_ERROR;
      return {
        ...state,
        step: 'done',
        lushaResult: action.result,
        ...(action.runResult ? { runResult: action.runResult } : {}),
        ...appendMessages(state, [{ role: 'system', content: reason, tone: 'warning' }]),
      };
    }

    case 'RESET': {
      return createInitialContactEnrichmentChatState();
    }

    default:
      return state;
  }
}
