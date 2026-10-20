/**
 * Agente 3 (Rumbo) · métricas del banco de evaluación (puro, con pruebas).
 *
 * Qué tan buena salió una preparación, en números que se pueden comparar antes y
 * después de un cambio: datos verificados, de qué fuentes, qué tan recientes, lo del
 * decisor, los canales que salieron y lo que costó.
 */

import type { BriefPatch, PackInsert, UsageLogInput } from '../../src/server/agents/first-call/run-first-call';
import type { FirstCallChannel, ResearchFact } from '../../src/server/agents/first-call/types';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Una señal sirve para abrir si tiene fecha de los últimos 12 meses. */
export const RECENT_SIGNAL_EVAL_DAYS = 365;

export interface ResearchMetrics {
  status: string | null;
  facts: number;
  externalFacts: number;
  factsBySource: Record<string, number>;
  datedExternalFacts: number;
  recentSignalWithin365: boolean;
  newestDate: string | null;
  talentFacts: number;
  curatedListFacts: number;
  gaps: number;
  rejectedFacts: number;
  hosts: string[];
  contactFacts: number;
  contactHook: boolean;
  channelsOk: FirstCallChannel[];
  channelsFailed: FirstCallChannel[];
  fallbackChannels: string[];
  versionsByChannel: Partial<Record<FirstCallChannel, number>>;
  costUsd: number;
  tavilyCredits: number;
  /** Preparaciones listas («draft») y «para revisar», y por qué quedaron para revisar. */
  packsReady: number;
  packsNeedsReview: number;
  issueKinds: Record<string, number>;
  /** Brasil y EE. UU.: preparaciones que traen la versión en el idioma del país. */
  packsWithLocalVersion?: number;
}

/** El motivo de un aviso del verificador, agrupado (para comparar el redactor). */
export function issueKind(issue: string): string {
  if (/^En (inglés|portugués),|en (inglés|portugués)\.$|versión en (inglés|portugués)/.test(issue)) return 'idioma_pais';
  if (/experiencia, clientes o casos/.test(issue)) return 'afirma_clientes';
  if (/cifras/.test(issue)) return 'cifras_sin_fuente';
  if (/pasa de \d+ caracteres|es muy largo|es largo/.test(issue)) return 'largo';
  if (/^Falta|Hacen falta/.test(issue)) return 'faltan_partes';
  if (/Tutea|suenan a otro|signo de apertura|frases que no conviene/.test(issue)) return 'estilo';
  return 'otro';
}

export interface EvalCompanyResult {
  name: string;
  contact: string;
  error?: string;
  resultCode?: string;
  durationMs?: number;
  brief?: BriefPatch;
  packs?: PackInsert[];
  logs?: UsageLogInput[];
  metrics?: ResearchMetrics;
}

export interface EvalRun {
  label: string;
  createdAt: string;
  writer: boolean;
  channels: FirstCallChannel[];
  companies: EvalCompanyResult[];
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function daysAgo(isoDay: string, nowMs: number): number {
  return (nowMs - Date.parse(`${isoDay}T00:00:00Z`)) / DAY_MS;
}

export function computeResearchMetrics(input: {
  brief: BriefPatch;
  packs: readonly PackInsert[];
  logs: readonly UsageLogInput[];
  nowMs: number;
}): ResearchMetrics {
  const facts: ResearchFact[] = input.brief.facts ?? [];
  const external = facts.filter((f) => f.sourceKind !== 'sellup' && f.sourceKind !== 'curated_list' && f.sourceKind !== 'seller');
  const bySource: Record<string, number> = {};
  for (const fact of facts) bySource[fact.sourceKind] = (bySource[fact.sourceKind] ?? 0) + 1;
  const dated = external.filter((f) => !!f.publishedOn);
  const newest = dated.map((f) => f.publishedOn as string).sort().at(-1) ?? null;
  const recentSignal = facts.some(
    (f) => f.topic === 'recent_signal' && !!f.publishedOn && daysAgo(f.publishedOn, input.nowMs) <= RECENT_SIGNAL_EVAL_DAYS,
  );
  const hosts = [...new Set(external.map((f) => hostOf(f.sourceUrl)).filter((h): h is string => !!h))].sort();

  // Lo del decisor viaja en cada preparación: se mira la primera que trae contenido.
  const withContent = input.packs.find((p) => p.content);
  // Sin redactor (--writer=off) no hay preparación con contenido: lo del decisor sale del registro.
  const contactLog = input.logs.find((l) => l.operationKey === 'contact_research');
  const contactFacts = withContent
    ? (withContent.facts ?? []).filter((f) => f.topic === 'decision_maker' && f.sourceKind !== 'sellup').length
    : (contactLog?.resultsReturned ?? 0);
  const insight = withContent
    ? (withContent.content as { contactInsight?: { hook?: string | null } } | null | undefined)?.contactInsight
    : contactLog?.metadata.has_hook
      ? { hook: 'sí' }
      : undefined;

  const channelsOk = input.packs.filter((p) => p.status !== 'failed').map((p) => p.channel);
  const channelsFailed = input.packs.filter((p) => p.status === 'failed').map((p) => p.channel);
  const versionsByChannel: Partial<Record<FirstCallChannel, number>> = {};
  for (const pack of input.packs) {
    const variants = (pack.content as { variants?: unknown[] } | null)?.variants ?? [];
    versionsByChannel[pack.channel] = pack.content ? 1 + variants.length : 0;
  }
  const writerLog = input.logs.find((l) => l.operationKey === 'first_call_pack');
  const fallbackChannels = Array.isArray(writerLog?.metadata.fallback_channels) ? (writerLog?.metadata.fallback_channels as string[]) : [];

  return {
    status: input.brief.status ?? null,
    facts: facts.length,
    externalFacts: external.length,
    factsBySource: bySource,
    datedExternalFacts: dated.length,
    recentSignalWithin365: recentSignal,
    newestDate: newest,
    talentFacts: facts.filter((f) => f.topic === 'talent').length,
    curatedListFacts: facts.filter((f) => f.sourceKind === 'curated_list').length,
    gaps: input.brief.gaps?.length ?? 0,
    rejectedFacts: input.brief.rejectedFacts ?? 0,
    hosts,
    contactFacts,
    contactHook: !!insight?.hook,
    channelsOk,
    channelsFailed,
    fallbackChannels,
    versionsByChannel,
    packsReady: input.packs.filter((p) => p.status === 'draft').length,
    packsNeedsReview: input.packs.filter((p) => p.status === 'needs_review').length,
    packsWithLocalVersion: input.packs.filter((p) => !!(p.content as { localVersion?: unknown } | null)?.localVersion).length,
    issueKinds: input.packs
      .flatMap((p) => p.verifierIssues ?? [])
      .reduce<Record<string, number>>((acc, issue) => {
        const kind = issueKind(issue);
        acc[kind] = (acc[kind] ?? 0) + 1;
        return acc;
      }, {}),
    costUsd: Math.round(input.logs.reduce((sum, l) => sum + (l.costUsd ?? 0), 0) * 10_000) / 10_000,
    tavilyCredits: input.logs.filter((l) => l.providerKey === 'tavily').reduce((sum, l) => sum + (l.credits ?? 0), 0),
  };
}

function row(c: EvalCompanyResult): string {
  const m = c.metrics;
  if (!m) return `| ${c.name} | ${c.error ?? c.resultCode ?? '—'} | | | | | | | | |`;
  return [
    c.name,
    m.status ?? '—',
    `${m.externalFacts}/${m.facts}`,
    m.datedExternalFacts,
    m.recentSignalWithin365 ? `sí (${m.newestDate})` : 'no',
    m.talentFacts,
    m.curatedListFacts,
    m.gaps,
    `${m.contactFacts}${m.contactHook ? ' + gancho' : ''}`,
    `${m.channelsOk.length}/${m.channelsOk.length + m.channelsFailed.length}`,
    `US$${m.costUsd.toFixed(3)} · ${m.tavilyCredits} cr`,
  ].join(' | ').replace(/^/, '| ').concat(' |');
}

/** Tabla del corrido (y, con dos, la diferencia en totales). */
export function compareRuns(a: EvalRun, b: EvalRun | null): string {
  const header =
    '| Empresa | Estado | Externos/total | Con fecha | Señal ≤12m | Talento | Listas | Faltantes | Decisor | Canales | Costo |\n|---|---|---|---|---|---|---|---|---|---|---|';
  const table = (run: EvalRun) => [`### ${run.label} (${run.createdAt.slice(0, 16)})`, header, ...run.companies.map(row)].join('\n');
  const totals = (run: EvalRun) => {
    const ms = run.companies.map((c) => c.metrics).filter((m): m is ResearchMetrics => !!m);
    return {
      empresas: ms.length,
      externos: ms.reduce((s, m) => s + m.externalFacts, 0),
      conFecha: ms.reduce((s, m) => s + m.datedExternalFacts, 0),
      conSenal: ms.filter((m) => m.recentSignalWithin365).length,
      talento: ms.reduce((s, m) => s + m.talentFacts, 0),
      listas: ms.reduce((s, m) => s + m.curatedListFacts, 0),
      faltantes: ms.reduce((s, m) => s + m.gaps, 0),
      decisorConDatos: ms.filter((m) => m.contactFacts > 0).length,
      canalesFallidos: ms.reduce((s, m) => s + m.channelsFailed.length, 0),
      listas_para_usar: ms.reduce((s, m) => s + (m.packsReady ?? 0), 0),
      para_revisar: ms.reduce((s, m) => s + (m.packsNeedsReview ?? 0), 0),
      aviso_afirma_clientes: ms.reduce((s, m) => s + (m.issueKinds?.afirma_clientes ?? 0), 0),
      aviso_cifras: ms.reduce((s, m) => s + (m.issueKinds?.cifras_sin_fuente ?? 0), 0),
      aviso_largo: ms.reduce((s, m) => s + (m.issueKinds?.largo ?? 0), 0),
      aviso_faltan_partes: ms.reduce((s, m) => s + (m.issueKinds?.faltan_partes ?? 0), 0),
      aviso_estilo: ms.reduce((s, m) => s + (m.issueKinds?.estilo ?? 0), 0),
      con_idioma_pais: ms.reduce((s, m) => s + (m.packsWithLocalVersion ?? 0), 0),
      aviso_idioma_pais: ms.reduce((s, m) => s + (m.issueKinds?.idioma_pais ?? 0), 0),
      costo: Math.round(ms.reduce((s, m) => s + m.costUsd, 0) * 1000) / 1000,
      creditos: ms.reduce((s, m) => s + m.tavilyCredits, 0),
    };
  };
  const parts = [table(a)];
  if (b) parts.push(table(b));
  const ta = totals(a);
  const tb = b ? totals(b) : null;
  parts.push('### Totales');
  parts.push(
    Object.entries(ta)
      .map(([k, v]) => `- ${k}: ${v}${tb ? ` → ${(tb as Record<string, number>)[k]}` : ''}`)
      .join('\n'),
  );
  return parts.join('\n\n');
}
