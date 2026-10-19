/**
 * Agente 3 · Primera llamada — de filas de la base a tipos del agente (puro).
 */

import type { PriorClassificationEvidence } from './internal-facts';
import { FIRST_CONTACT_APPROACHES, FIRST_CONTACT_OUTCOMES, type FirstContactApproach, type FirstContactOutcome } from './approaches';
import {
  CONTACT_FACT_CATEGORIES,
  FIRST_CALL_CHANNELS,
  FIRST_CALL_GOALS,
  RESEARCH_TOPICS,
  type ContactFactCategory,
  type ContactInsight,
  type FirstCallChannel,
  type FirstCallGoal,
  type FirstCallPack,
  type FirstCallPackContent,
  type FirstCallPackStatus,
  type ResearchBrief,
  type ResearchBriefStatus,
  type ResearchFact,
  type ResearchHypothesis,
  type ResearchProgressStage,
  type ResearchSource,
} from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/**
 * La clasificación del Agente 1 guardada en la candidata de origen. Sólo se usa
 * lo que quedó con la cita comprobada (`quote_verified`).
 */
export function readPriorClassification(candidateMetadata: unknown): PriorClassificationEvidence | null {
  const classification = asRecord(asRecord(candidateMetadata)?.['claude_classification']);
  if (!classification) return null;
  const sector = asRecord(classification['sector']);
  const range = asRecord(classification['employee_range']);
  const verifiedSector =
    sector && sector['verification'] === 'quote_verified' && text(sector['quote']) && text(sector['source_url'])
      ? {
          label: text(sector['subindustry_name']) ?? text(sector['industry_name']),
          quote: sector['quote'] as string,
          sourceUrl: sector['source_url'] as string,
        }
      : null;
  const min = typeof range?.['min'] === 'number' ? (range['min'] as number) : null;
  const verifiedRange =
    range && min !== null && range['verification'] === 'quote_verified' && text(range['quote']) && text(range['source_url'])
      ? {
          min,
          max: typeof range['max'] === 'number' ? (range['max'] as number) : null,
          quote: range['quote'] as string,
          sourceUrl: range['source_url'] as string,
        }
      : null;
  if (!verifiedSector && !verifiedRange) return null;
  return { sector: verifiedSector, employeeRange: verifiedRange };
}

/** Nombres de las listas curadas de una fila de `source_company_snapshots`. */
export function curatedListLabels(rawData: unknown): string[] {
  const origins = asRecord(rawData)?.['origins'];
  if (!Array.isArray(origins)) return [];
  return origins
    .map((o) => {
      const origin = asRecord(o);
      const label = text(origin?.['label']);
      const year = typeof origin?.['year'] === 'number' ? (origin['year'] as number) : null;
      return label ? (year && !label.includes(String(year)) ? `${label} ${year}` : label) : null;
    })
    .filter((l): l is string => l !== null);
}

const BRIEF_STATUSES: readonly ResearchBriefStatus[] = ['running', 'sufficient', 'partial', 'failed'];
const PROGRESS_STAGES: readonly ResearchProgressStage[] = [
  'reading_sellup',
  'reading_site',
  'reading_news',
  'extracting',
  'writing',
  'done',
];
const PACK_STATUSES: readonly FirstCallPackStatus[] = ['draft', 'needs_review', 'used', 'discarded', 'failed'];

function factsFrom(value: unknown): ResearchFact[] {
  return (Array.isArray(value) ? value : [])
    .map(asRecord)
    .filter((f): f is Record<string, unknown> => !!f && !!text(f['id']) && !!text(f['statement']))
    .filter((f) => RESEARCH_TOPICS.includes(f['topic'] as ResearchFact['topic']))
    .map((f) => ({
      id: f['id'] as string,
      topic: f['topic'] as ResearchFact['topic'],
      statement: f['statement'] as string,
      quote: text(f['quote']),
      sourceKind: (text(f['sourceKind']) ?? 'sellup') as ResearchFact['sourceKind'],
      sourceUrl: text(f['sourceUrl']),
      sourceLabel: text(f['sourceLabel']) ?? '',
      publishedOn: text(f['publishedOn']),
      ...(CONTACT_FACT_CATEGORIES.includes(f['category'] as ContactFactCategory) ? { category: f['category'] as ContactFactCategory } : {}),
      ...(text(f['contactId']) ? { contactId: text(f['contactId']) } : {}),
    }));
}

/** La investigación del decisor guardada con la preparación (o `undefined` si no hubo). */
function contactInsightFrom(value: unknown): ContactInsight | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const leads = text(record['leadsTraining']);
  return {
    hook: text(record['hook']),
    priorities: stringsFrom(record['priorities']),
    unknowns: stringsFrom(record['unknowns']),
    leadsTraining: leads === 'yes' || leads === 'no' ? leads : 'unknown',
  };
}

function hypothesesFrom(value: unknown): ResearchHypothesis[] {
  return (Array.isArray(value) ? value : [])
    .map(asRecord)
    .filter((h): h is Record<string, unknown> => !!h && !!text(h['text']))
    .map((h) => ({
      text: h['text'] as string,
      productKey: text(h['productKey']),
      factRefs: Array.isArray(h['factRefs']) ? (h['factRefs'] as unknown[]).filter((r): r is string => typeof r === 'string') : [],
    }));
}

function stringsFrom(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

function sourcesFrom(value: unknown): ResearchSource[] {
  return (Array.isArray(value) ? value : [])
    .map(asRecord)
    .filter((s): s is Record<string, unknown> => !!s && !!text(s['url']))
    .map((s) => ({
      url: s['url'] as string,
      label: text(s['label']) ?? (s['url'] as string),
      kind: (text(s['kind']) ?? 'official_site') as ResearchSource['kind'],
    }));
}

export function mapBriefRow(row: Record<string, unknown>): ResearchBrief {
  const status = row['status'] as ResearchBriefStatus;
  const stage = row['progress_stage'] as ResearchProgressStage | null;
  return {
    id: row['id'] as string,
    accountId: row['account_id'] as string,
    status: BRIEF_STATUSES.includes(status) ? status : 'failed',
    progressStage: stage && PROGRESS_STAGES.includes(stage) ? stage : null,
    summary: text(row['summary']),
    facts: factsFrom(row['facts']),
    hypotheses: hypothesesFrom(row['hypotheses']),
    gaps: stringsFrom(row['gaps']),
    sources: sourcesFrom(row['sources']),
    rejectedFacts: num(row['rejected_facts']),
    costUsd: num(row['cost_usd']),
    model: text(row['model']),
    createdAt: row['created_at'] as string,
    completedAt: text(row['completed_at']),
    expiresAt: text(row['expires_at']),
    errorCode: text(row['error_code']),
  };
}

function packContentFrom(value: unknown): FirstCallPackContent | null {
  const pack = asRecord(value);
  if (!pack || !asRecord(pack['callScript'])) return null;
  const withRefs = (v: unknown) => {
    const r = asRecord(v);
    return { text: text(r?.['text']) ?? '', factRefs: stringsFrom(r?.['factRefs']) };
  };
  return {
    reasonToCall: withRefs(pack['reasonToCall']),
    angle: text(pack['angle']) ?? '',
    callScript: withRefs(pack['callScript']),
    shortMessage: withRefs(pack['shortMessage']),
    questions: stringsFrom(pack['questions']),
    objections: (Array.isArray(pack['objections']) ? pack['objections'] : [])
      .map(asRecord)
      .filter((o): o is Record<string, unknown> => !!o && !!text(o['objection']))
      .map((o) => ({
        objection: o['objection'] as string,
        response: text(o['response']) ?? '',
        libraryKey: text(o['libraryKey']),
      })),
    nextStep: text(pack['nextStep']) ?? '',
    cautions: stringsFrom(pack['cautions']),
    productKey: text(pack['productKey']),
    approach: approachFrom(pack['approach']),
    approachReason: text(pack['approachReason']),
    variants: (Array.isArray(pack['variants']) ? pack['variants'] : [])
      .map(asRecord)
      .filter((v): v is Record<string, unknown> => !!v && approachFrom(v['approach']) !== null && !!text(v['text']))
      .map((v) => ({
        approach: approachFrom(v['approach'])!,
        text: v['text'] as string,
        factRefs: stringsFrom(v['factRefs']),
        ...(text(v['voicemail']) ? { voicemail: text(v['voicemail'])! } : {}),
      })),
    meetingAsk: text(pack['meetingAsk']) ?? undefined,
    ifNo: text(pack['ifNo']) ?? undefined,
    confirmation: text(pack['confirmation']) ?? undefined,
    contactInsight: contactInsightFrom(pack['contactInsight']),
    contactResearch: contactResearchFrom(pack['contactResearch']),
  };
}

/** Lo investigado del decisor guardado con la preparación (o `undefined`). */
function contactResearchFrom(value: unknown): FirstCallPackContent['contactResearch'] {
  const record = asRecord(value);
  const researchedAt = text(record?.['researchedAt']);
  if (!record || !researchedAt || Number.isNaN(Date.parse(researchedAt))) return undefined;
  return { facts: factsFrom(record['facts']), researchedAt };
}

function approachFrom(value: unknown): FirstContactApproach | null {
  return typeof value === 'string' && (FIRST_CONTACT_APPROACHES as readonly string[]).includes(value)
    ? (value as FirstContactApproach)
    : null;
}

function outcomeFrom(value: unknown): FirstCallPack['outcome'] {
  const record = asRecord(value);
  const result = text(record?.['result']);
  const at = text(record?.['at']);
  if (!result || !at || !(FIRST_CONTACT_OUTCOMES as readonly string[]).includes(result)) return null;
  return { result: result as FirstContactOutcome, at, approach: approachFrom(record?.['approach']) };
}

export function mapPackRow(row: Record<string, unknown>): FirstCallPack {
  const status = row['status'] as FirstCallPackStatus;
  const channel = row['channel'] as FirstCallChannel;
  const goals = String(row['goal'] ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter((g): g is FirstCallGoal => FIRST_CALL_GOALS.includes(g as FirstCallGoal));
  return {
    id: row['id'] as string,
    accountId: row['account_id'] as string,
    briefId: text(row['brief_id']),
    contactId: text(row['contact_id']),
    targetName: text(row['target_name']),
    targetTitle: text(row['target_title']),
    channel: FIRST_CALL_CHANNELS.includes(channel) ? channel : 'call',
    goal: goals[0] ?? 'book_meeting',
    goals: goals.length > 0 ? goals : ['book_meeting'],
    productFocus: text(row['product_focus']),
    content: packContentFrom(row['pack']),
    facts: factsFrom(asRecord(row['pack'])?.['facts']),
    status: PACK_STATUSES.includes(status) ? status : 'failed',
    verifierIssues: stringsFrom(row['verifier_issues']),
    editedScript: text(row['edited_script']),
    regenerationReason: text(row['regeneration_reason']),
    costUsd: num(row['cost_usd']),
    model: text(row['model']),
    createdAt: row['created_at'] as string,
    usedAt: text(row['used_at']),
    discardedAt: text(row['discarded_at']),
    outcome: outcomeFrom(asRecord(row['pack'])?.['outcome']),
  };
}
