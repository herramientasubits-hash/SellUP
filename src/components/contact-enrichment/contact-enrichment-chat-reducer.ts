// Agente 2A — Conversational wizard reducer (Hito 17A.2B)
// Pure state machine. No React, no network. The async server actions are called
// by the wizard component, which then dispatches the resulting action here.

import type { AgentChatMessage, AgentChatRole, AgentChatTone } from '@/components/agent-chat';
import type { CompanyCandidate, CompanyResolutionResult } from '@/modules/contact-enrichment/types';
import { formatInAppZone } from '@/lib/format-date';
import type {
  AutomaticRoutingUiDiagnosis,
  AutomaticRoutingUiResult,
  ContactEnrichmentChatAction,
  ContactEnrichmentChatState,
  ContactEnrichmentInitialCompany,
  ExtraCompanyData,
  ExtraDataPrefill,
} from './contact-enrichment-chat-types';
import {
  contactsCountLabel,
  summarizeContactSearch,
  type ContactSearchSummary,
} from '@/modules/contact-enrichment/contact-search-summary';

// ── Copy ──────────────────────────────────────────────────────────────────────

const GREETING =
  'Hola. Puedo ayudarte a preparar una búsqueda de contactos para una empresa.\n\nPara empezar, dime el nombre, dominio o HubSpot ID de la empresa. También sirve el correo de alguien que trabaje allí.';

const PRELOADED_INTRO =
  'Voy a preparar el enriquecimiento de contactos para esta empresa.\n\n¿Confirmas que quieres preparar este enriquecimiento?';

const NEEDS_DATA =
  'No encontré esta empresa en SellUp ni en HubSpot.\n\nCompleta abajo su nombre, país y dominio: la vuelvo a buscar con esos datos y, si no aparece, la preparo como empresa nueva.';

const NEEDS_DATA_PERSONAL_EMAIL =
  'Ese correo es de un servicio personal, así que no me dice de qué empresa es.\n\nCompleta abajo su nombre, país y dominio y la busco.';

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
  'Listo. Preparé el contexto de esta empresa. Cuando quieras, busco contactos automáticamente.';

// ── Automatic routing copy (AGENT2-ROUTING-WIRE-1) ────────────────────────────

const AUTOMATIC_SEARCHING = 'Voy a buscar contactos automáticamente…';

const AUTOMATIC_ROUTING_DISABLED =
  'La búsqueda automática de contactos no está activada en este entorno. No se ejecutó ninguna búsqueda ni se crearon candidatos.';

const AUTOMATIC_BLOCKED =
  'No fue posible completar la búsqueda automática de contactos en este momento. No se crearon contactos finales.';

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

export type CompanyQueryKind = 'name' | 'domain' | 'hubspot_id' | 'personal_email';

/** Correos de servicios personales: su dominio no dice de qué empresa es la persona. */
export const PERSONAL_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'live.com',
  'msn.com', 'yahoo.com', 'yahoo.es', 'ymail.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me',
  'protonmail.com', 'gmx.com', 'zoho.com',
]);

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const EMAIL_RE = /^[^\s@]+@([^\s@]+)$/;
const URL_RE = /^(?:https?:\/\/)?(?:www\.)?([^\s/?#:]+)(?::\d+)?(?:[/?#].*)?$/i;

/**
 * Lo escrito, leído como dominio cuando se puede: un correo de empresa
 * (`ana.gomez@acmelatam.co`) o un enlace (`https://www.acmelatam.co/`)
 * se buscan por su dominio (`acmelatam.co`). Antes el correo se buscaba como
 * NOMBRE de empresa y nunca aparecía (feedback 29-10).
 */
export function companyQueryDomain(query: string): { domain: string; personal: boolean } | null {
  const q = query.trim().toLowerCase();
  const email = EMAIL_RE.exec(q);
  if (email) {
    const domain = email[1].replace(/^www\./, '');
    return DOMAIN_RE.test(domain) ? { domain, personal: PERSONAL_EMAIL_DOMAINS.has(domain) } : null;
  }
  if (q.includes(' ')) return null;
  const url = URL_RE.exec(q);
  const host = url?.[1]?.replace(/^www\./, '') ?? null;
  return host && DOMAIN_RE.test(host) ? { domain: host, personal: false } : null;
}

export function classifyCompanyQuery(query: string): CompanyQueryKind {
  const q = query.trim();
  if (/^\d{6,}$/.test(q)) return 'hubspot_id';
  const domain = companyQueryDomain(q);
  if (domain?.personal) return 'personal_email';
  if (domain) return 'domain';
  return 'name';
}

/** Builds the resolver input from a free-text company query. */
export function buildResolveInput(query: string): Record<string, string> {
  const q = query.trim();
  const kind = classifyCompanyQuery(q);
  if (kind === 'hubspot_id') return { hubspotCompanyId: q };
  if (kind === 'domain') return { companyDomain: companyQueryDomain(q)?.domain ?? q };
  return { companyName: q };
}

/** Lo que el formulario «nombre, país y dominio» trae ya escrito, según lo que se buscó. */
export function extraDataPrefill(query: string): ExtraDataPrefill {
  const q = query.trim();
  const kind = classifyCompanyQuery(q);
  const found = companyQueryDomain(q);
  return {
    name: kind === 'name' ? q : '',
    domain: found && !found.personal ? found.domain : '',
  };
}

/** Los datos del formulario, como entrada de la búsqueda de empresa. */
export function buildExtraDataResolveInput(data: ExtraCompanyData): Record<string, string> {
  const input: Record<string, string> = {};
  const name = data.name.trim();
  const domain = companyQueryDomain(data.domain)?.domain ?? data.domain.trim();
  if (name) input.companyName = name;
  if (domain) input.companyDomain = domain;
  if (data.countryCode) input.companyCountryCode = data.countryCode;
  return input;
}

/** La empresa nueva (manual) armada con el formulario, cuando tampoco aparece con esos datos. */
export function manualCandidateFromExtraData(data: ExtraCompanyData): CompanyCandidate {
  const domain = companyQueryDomain(data.domain)?.domain ?? (data.domain.trim() || undefined);
  return {
    source: 'manual',
    name: data.name.trim() || domain || 'Empresa sin nombre',
    domain,
    country: data.countryName || undefined,
    countryCode: data.countryCode || undefined,
    matchConfidence: 0.5,
  };
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

  // Sin coincidencias, se piden nombre, país y dominio (ya precargados con lo que se
  // sepa) y se vuelve a buscar con ellos: antes un dominio o un ID sin coincidencia
  // pasaba directo a «empresa manual» con el texto escrito como nombre.
  if (candidates.length === 0) {
    return { type: 'RESOLVED_NONE_NEEDS_DATA', prefill: extraDataPrefill(query) };
  }

  if (singleMatch && selected) {
    return { type: 'RESOLVED_SINGLE', candidate: selected, skippedHubSpot };
  }

  return { type: 'RESOLVED_MULTIPLE', candidates, skippedHubSpot };
}

/**
 * Tras completar nombre, país y dominio: si con esos datos aparece, se elige como
 * siempre; si no, se prepara como empresa nueva con SU nombre (no con lo escrito).
 */
export function planExtraDataResolution(
  data: ExtraCompanyData,
  result: CompanyResolutionResult,
): ContactEnrichmentChatAction {
  const { candidates, singleMatch, selected, skippedHubSpot } = result;
  if (candidates.length === 0) {
    return { type: 'RESOLVED_MANUAL', candidate: manualCandidateFromExtraData(data), skippedHubSpot };
  }
  if (singleMatch && selected) return { type: 'RESOLVED_SINGLE', candidate: selected, skippedHubSpot };
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
    automaticResult: null,
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

// ── Automatic routing result message (backlog A3/A6) ──────────────────────────

/** "Fuente Lusha falló." / "Fuentes Apollo y Lusha fallaron." — '' when none failed. */
function failedSourcesNote(failed: readonly string[] | undefined): string {
  if (!failed || failed.length === 0) return '';
  if (failed.length === 1) return ` Fuente ${failed[0]} falló.`;
  return ` Fuentes ${failed.slice(0, -1).join(', ')} y ${failed.at(-1)} fallaron.`;
}

/*
 * Mensaje final de la búsqueda automática (AGENT2A-COMPANY-SEARCH-COUNTS, Bryan 29-10):
 *
 *  • bandera apagada                 → aviso de búsqueda desactivada (warning)
 *  • bloqueada antes de buscar       → aviso de que no se pudo completar (warning)
 *  • hay algo (nuevo o de antes)     → tres líneas: HubSpot (tenía / traje / a dónde fueron),
 *                                      otras fuentes y «Por revisar» de búsquedas anteriores
 *  • nada de nada                    → «No se encontraron contactos.» con el porqué (warning)
 *
 * Una fuente sólo se nombra como fallida al final, cuando falló.
 */

/** «14 de octubre» — fecha corta para el chat. */
function shortDate(iso: string): string {
  return formatInAppZone(iso, { day: 'numeric', month: 'long' }, 'es-CO', iso.slice(0, 10));
}

const SITE_ZERO_COPY: Record<string, string> = {
  site_unreachable: 'El sitio web de la empresa no respondió.',
  site_no_text: 'El sitio web no tiene texto legible (está armado sólo con JavaScript).',
  no_domain: 'No hay dominio para leer el sitio web de la empresa.',
  budget_blocked: 'No leí el sitio web: no queda presupuesto de IA.',
};

/**
 * AGENT2-AUDIT-FIXES-1 — por qué una búsqueda quedó en cero y qué puede hacer el vendedor.
 * Antes el chat decía sólo «No se encontraron contactos.» y el vendedor repetía la búsqueda
 * (Tostadas Charras 14 veces, Papa Johns 10). Devuelve '' cuando no hay nada que explicar.
 */
export function explainZeroResult(d: AutomaticRoutingUiDiagnosis | undefined): string {
  if (!d) return '';
  const why: string[] = [];
  let next = '';

  if (d.apolloSkipped) {
    why.push('Faltan el dominio y el nombre de la empresa para buscar en Apollo.');
    next = 'Agrega el dominio de la empresa y vuelve a buscar.';
  } else if (d.apolloOrganization === 'not_found') {
    why.push('Apollo no reconoce esta empresa ni por su dominio ni por su nombre.');
    next = 'Revisa que el dominio de la ficha sea el sitio real de la empresa.';
  } else if (d.apolloPeopleFound === 0) {
    why.push(
      d.apolloOrganization === 'found_by_name'
        ? 'Apollo sólo encontró la empresa por el nombre y no tiene personas registradas en ella.'
        : 'Apollo no tiene personas registradas en esta empresa.',
    );
    if (d.apolloOrganization === 'found_by_name') next = 'Si el dominio de la ficha está mal, corrígelo y vuelve a buscar.';
  } else if (d.apolloPeopleFound !== null && d.apolloPeopleFound > 0) {
    const found = d.apolloPeopleFound === 1 ? '1 persona' : `${d.apolloPeopleFound} personas`;
    why.push(
      d.apolloAlreadyKnown > 0
        ? `Apollo trajo ${found}: ${d.apolloAlreadyKnown} ya ${d.apolloAlreadyKnown === 1 ? 'era contacto' : 'eran contactos'} y el resto no era de RR. HH., formación o dirección, o no tenía datos de contacto.`
        : `Apollo trajo ${found}, pero ninguna es de RR. HH., formación o dirección con datos de contacto.`,
    );
  }

  const site = SITE_ZERO_COPY[d.freeStages.companySite];
  if (site) why.push(site);

  if (d.lushaRecentZeroAt) {
    why.push(`No volví a gastar Lusha: el ${shortDate(d.lushaRecentZeroAt)} ya buscó en esta empresa sin resultados.`);
  } else if (d.lushaRan) {
    why.push('Lusha tampoco encontró a nadie nuevo.');
  }

  if (why.length === 0) return '';
  return `\n\n${why.join(' ')}${next ? `\n\n${next}` : ''}`;
}

/**
 * AGENT2-HUBSPOT-FIRST-WHY-ZERO-1 — por qué no se usó ningún contacto de HubSpot cuando la
 * empresa sí tiene contactos ahí (Grupo LALA 21-10: ~100 en HubSpot, 0 usados). '' si no aplica.
 */
export function explainHubSpotFirstZero(d: AutomaticRoutingUiDiagnosis | undefined): string {
  const hs = d?.hubspotFirst;
  if (!hs || hs.hubspotContacts === 0) return '';
  const parts: string[] = [];
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  if (hs.otherSeller > 0) parts.push(`${hs.otherSeller} ${plural(hs.otherSeller, 'es', 'son')} de otro vendedor`);
  if (hs.notRelevant > 0)
    parts.push(`${hs.notRelevant} no ${plural(hs.notRelevant, 'es', 'son')} de RR. HH., formación o dirección`);
  if (hs.knownInSellUp > 0) parts.push(`${hs.knownInSellUp} ya ${plural(hs.knownInSellUp, 'está', 'están')} en SellUp`);
  if (hs.noName > 0) parts.push(`${hs.noName} no ${plural(hs.noName, 'tiene', 'tienen')} nombre`);
  const total = hs.hubspotContacts === 1 ? '1 contacto' : `${hs.hubspotContacts} contactos`;
  const detail = parts.length > 0 ? `: ${parts.slice(0, -1).join(', ')}${parts.length > 1 ? ' y ' : ''}${parts.at(-1)}` : '';
  return `\n\nHubSpot tiene ${total} de esta empresa y no usé ninguno${detail}.`;
}

/** «3 de otro vendedor, 2 ya están en SellUp y 1 ya estaba en «Por revisar»». '' si no hay motivos. */
function hubspotSkippedDetail(hs: NonNullable<AutomaticRoutingUiDiagnosis['hubspotFirst']>): string {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const parts: string[] = [];
  const pending = hs.alreadyPending ?? 0;
  if (pending > 0) parts.push(`${pending} ya ${plural(pending, 'estaba', 'estaban')} en «Por revisar»`);
  if (hs.knownInSellUp > 0) parts.push(`${hs.knownInSellUp} ya ${plural(hs.knownInSellUp, 'está', 'están')} en SellUp`);
  if (hs.otherSeller > 0) parts.push(`${hs.otherSeller} ${plural(hs.otherSeller, 'es', 'son')} de otro vendedor`);
  if (hs.notRelevant > 0)
    parts.push(`${hs.notRelevant} no ${plural(hs.notRelevant, 'es', 'son')} de RR. HH., formación o dirección`);
  if (hs.noName > 0) parts.push(`${hs.noName} no ${plural(hs.noName, 'tiene', 'tienen')} nombre`);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`;
}

/**
 * AGENT2A-COMPANY-SEARCH-COUNTS — la línea de HubSpot: cuántos tiene allá, cuántos traje y a
 * dónde fueron (Contactos o «Por revisar»). null cuando no hay nada que decir de HubSpot.
 */
function hubspotSummaryLine(result: AutomaticRoutingUiResult, s: ContactSearchSummary): string | null {
  const stage = result.diagnosis?.freeStages?.hubspotFirst;
  const hs = result.diagnosis?.hubspotFirst ?? null;
  if (!hs) {
    if (s.hubspotBrought > 0) return `De HubSpot: traje ${contactsCountLabel(s.hubspotBrought)}.`;
    if (stage === 'no_hubspot_company') return 'De HubSpot: esta empresa no está vinculada a HubSpot.';
    if (stage === 'hubspot_unavailable' || stage === 'error') return 'De HubSpot: no pude leerlo esta vez.';
    return null;
  }
  if (hs.hubspotContacts === 0) return 'De HubSpot: no tiene contactos de esta empresa.';
  const had = `tiene ${contactsCountLabel(hs.hubspotContacts)} de esta empresa`;
  const skipped = hubspotSkippedDetail(hs);
  if (s.hubspotBrought === 0) {
    return `De HubSpot: ${had} y no traje ninguno${skipped ? ` (${skipped})` : ''}.`;
  }
  let where: string;
  if (s.hubspotToContacts === 0) where = 'quedaron en «Por revisar»';
  else if (s.hubspotToReview === 0)
    where = 'pasaron directo a Contactos porque ya tenían correo, teléfono y LinkedIn';
  else
    where = `${s.hubspotToContacts} pasaron directo a Contactos porque ya tenían correo, teléfono y LinkedIn, y ${s.hubspotToReview} quedaron en «Por revisar»`;
  const rest = hs.hubspotContacts - s.hubspotBrought;
  const restNote = rest > 0 && skipped ? ` Los otros no los traje: ${skipped}.` : '';
  return `De HubSpot: ${had} y traje ${s.hubspotBrought}: ${where}.${restNote}`;
}

/** La línea de las otras fuentes: Apollo, Lusha, lo que SellUp ya conocía y el sitio web. */
function otherSourcesLine(s: ContactSearchSummary): string {
  if (s.otherSources === 0) return 'De otras fuentes: no encontré contactos nuevos.';
  const parts: string[] = [];
  if (s.apollo > 0) parts.push(`${s.apollo} de Apollo`);
  if (s.lusha > 0) parts.push(`${s.lusha} de Lusha`);
  if (s.contactBank > 0) parts.push(`${s.contactBank} que SellUp ya conocía de otra ficha`);
  if (s.companySite > 0) parts.push(`${s.companySite} del sitio web, sin correo`);
  const detail = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`;
  return `De otras fuentes: ${contactsCountLabel(s.otherSources)} ${s.otherSources === 1 ? 'nuevo' : 'nuevos'} en «Por revisar» (${detail}).`;
}

/** La línea de lo que ya esperaba de búsquedas anteriores. */
function previousPendingLine(s: ContactSearchSummary): string {
  const earlier =
    s.earlierToContacts > 0
      ? ` Además pasé ${s.earlierToContacts} de HubSpot a Contactos porque ya ${s.earlierToContacts === 1 ? 'estaba completo' : 'estaban completos'}.`
      : '';
  if (s.previousPending === 0) return `De búsquedas anteriores: no tenías ninguno en «Por revisar».${earlier}`;
  return `De búsquedas anteriores: ya tenías ${contactsCountLabel(s.previousPending)} en «Por revisar».${earlier}`;
}

export function buildAutomaticRoutingMessage(
  result: AutomaticRoutingUiResult,
): { content: string; tone?: AgentChatTone } {
  if (!result.automaticRoutingEnabled) {
    return { content: AUTOMATIC_ROUTING_DISABLED, tone: 'warning' };
  }

  const apollo = result.providerCandidatesCreated?.apollo ?? null;
  const lusha = result.providerCandidatesCreated?.lusha ?? null;
  const free =
    (result.hubspotFirstCandidates ?? 0) + (result.contactBankCandidates ?? 0) + (result.companySiteCandidates ?? 0);
  if (result.attempt1AttemptId == null || (apollo === null && lusha === null && free === 0)) {
    return { content: AUTOMATIC_BLOCKED, tone: 'warning' };
  }

  const failed = failedSourcesNote(result.failedProviders);
  const s = summarizeContactSearch(result);

  // Nada nuevo, nada a Contactos y nada pendiente de antes: un cero explicado, como siempre.
  if (s.hubspotBrought === 0 && s.otherSources === 0 && s.previousPending === 0 && s.earlierToContacts === 0) {
    return {
      content: `No se encontraron contactos.${failed}${explainHubSpotFirstZero(result.diagnosis)}${explainZeroResult(result.diagnosis)}`,
      tone: 'warning',
    };
  }

  // AGENT2A-COMPANY-SEARCH-COUNTS (Bryan 29-10): un solo total confundía. Se separa lo de
  // HubSpot, lo de las otras fuentes y lo que ya estaba en «Por revisar» de antes.
  const lines = [hubspotSummaryLine(result, s), otherSourcesLine(s), previousPendingLine(s)].filter(
    (line): line is string => !!line,
  );
  const header = s.newForReview + s.hubspotToContacts > 0 ? 'Terminé la búsqueda:' : 'Esta búsqueda no trajo contactos nuevos:';
  const note = s.totalForReview > 0 ? `\n\nLos de «Por revisar» requieren tu aprobación.` : '';
  const why = s.newForReview + s.hubspotToContacts === 0 ? explainZeroResult(result.diagnosis) : '';
  return {
    content: `${header}\n\n${lines.map((line) => `• ${line}`).join('\n')}${note}${failed ? `\n\n${failed.trim()}` : ''}${why}`,
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
      const personal = classifyCompanyQuery(state.query) === 'personal_email';
      return {
        ...state,
        step: 'needs_extra_data',
        candidates: [],
        selectedCandidate: null,
        extraDataPrefill: action.prefill,
        ...appendMessages(state, [{ role: 'assistant', content: personal ? NEEDS_DATA_PERSONAL_EMAIL : NEEDS_DATA }]),
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
      // Se vuelve a buscar con los datos completos; el resultado llega como RESOLVED_*.
      const { data } = action;
      const parts: string[] = [];
      if (data.name.trim()) parts.push(data.name.trim());
      if (data.countryName) parts.push(data.countryName);
      if (data.domain.trim()) parts.push(data.domain.trim());
      return {
        ...state,
        step: 'resolving',
        candidates: [],
        selectedCandidate: null,
        errorMessage: null,
        ...appendMessages(state, [{ role: 'user', content: parts.join(' · ') || 'Sin datos adicionales' }]),
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

    case 'AUTOMATIC_ROUTING_START': {
      if (state.step !== 'done') return state;
      return {
        ...state,
        step: 'searching_contacts',
        errorMessage: null,
        ...appendMessages(state, [
          { role: 'user', content: 'Buscar contactos con IA' },
          { role: 'assistant', content: AUTOMATIC_SEARCHING },
        ]),
      };
    }

    case 'AUTOMATIC_ROUTING_SETTLED': {
      const { content, tone } = buildAutomaticRoutingMessage(action.result);
      return {
        ...state,
        step: 'done',
        automaticResult: action.result,
        ...appendMessages(state, [{ role: 'assistant', content, tone }]),
      };
    }

    case 'RESET': {
      return createInitialContactEnrichmentChatState();
    }

    default:
      return state;
  }
}
