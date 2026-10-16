/**
 * Agente 3 · Primera llamada — verificar la investigación (puro).
 *
 * Nada de lo que dice Claude entra a la ficha sin pasar por aquí:
 *  - la cita tiene que aparecer en el texto de su fuente (un documento que
 *    descargamos, el `cited_text` de la búsqueda web o una página que bajamos);
 *  - el dato no puede traer cifras que no estén en la cita;
 *  - una señal «reciente» de hace más de 18 meses se descarta;
 *  - una hipótesis sin hechos que la sostengan se descarta.
 */

import type { AnthropicContentBlock } from '../prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { canonicalUrl } from '../prospecting-toolkit/claude-classifier/evidence-verifier';
import { quoteMatchKind } from '../prospecting-toolkit/claude-classifier/page-text';
import { normalizeDomain } from '../prospecting-toolkit/normalization';
import { unsupportedNumbers } from './numbers';
import { MAX_GAPS, MAX_HYPOTHESES, MAX_WEB_FACTS, RESEARCH_SUBMIT_TOOL, type ResearchDocument } from './research-prompt';
import { RESEARCH_TOPICS, type ResearchFact, type ResearchHypothesis, type ResearchTopic } from './types';
import { UBITS_PRODUCTS } from './ubits-messaging-library';

export interface RawResearchFact {
  ref?: unknown;
  topic?: unknown;
  statement?: unknown;
  quote?: unknown;
  doc_id?: unknown;
  source_url?: unknown;
  published_on?: unknown;
}

export interface RawResearchSubmission {
  summary?: unknown;
  facts?: unknown;
  hypotheses?: unknown;
  gaps?: unknown;
}

/** Más viejo que esto no es una señal reciente: 12 meses + margen para fechas aproximadas. */
export const MAX_SIGNAL_AGE_DAYS = 450;
const STATEMENT_MAX_CHARS = 300;
const SUMMARY_MAX_CHARS = 700;
const GAP_MAX_CHARS = 200;

export type FactRejectionReason =
  | 'invalid_shape'
  | 'unknown_source'
  | 'quote_not_found'
  | 'statement_numbers_unsupported'
  | 'signal_too_old'
  | 'duplicate';

export interface FactRejection {
  ref: string | null;
  reason: FactRejectionReason;
  sourceUrl: string | null;
}

export interface VerifiedResearch {
  /** Hechos internos (F1…Fk) y luego los verificados de la web, numerados seguidos. */
  facts: ResearchFact[];
  hypotheses: ResearchHypothesis[];
  gaps: string[];
  summary: string | null;
  rejected: FactRejection[];
}

export function extractResearchSubmission(content: readonly AnthropicContentBlock[]): RawResearchSubmission | null {
  const block = [...content].reverse().find((b) => b.type === 'tool_use' && b.name === RESEARCH_SUBMIT_TOOL);
  if (!block || typeof block.input !== 'object' || block.input === null) return null;
  return block.input as RawResearchSubmission;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isoDate(value: unknown): string | null {
  const text = str(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return Number.isNaN(Date.parse(`${text}T00:00:00Z`)) ? null : text;
}

function ageInDays(isoDay: string, today: string): number {
  return (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${isoDay}T00:00:00Z`)) / 86_400_000;
}

function hostLabel(url: string): string {
  return normalizeDomain(url) ?? url;
}

interface SourceTexts {
  documents: readonly ResearchDocument[];
  /** `cited_text` de la búsqueda web, por URL canónica. */
  citedTextsByUrl: ReadonlyMap<string, readonly string[]>;
  /** Páginas que descargamos nosotros para comprobar una cita, por URL canónica. */
  fetchedTexts: ReadonlyMap<string, string>;
}

type Located = { url: string; label: string; kind: ResearchFact['sourceKind']; texts: string[]; publishedOn: string | null };

function locateSource(raw: RawResearchFact, sources: SourceTexts): Located | null {
  const docId = str(raw.doc_id);
  if (docId) {
    const doc = sources.documents.find((d) => d.docId === docId);
    if (!doc) return null;
    return { url: doc.url, label: doc.label, kind: doc.kind, texts: [doc.text], publishedOn: doc.publishedOn };
  }
  const url = str(raw.source_url);
  if (!url) return null;
  // Una URL de un documento se trata como ese documento.
  const key = canonicalUrl(url);
  if (!key) return null;
  const doc = sources.documents.find((d) => canonicalUrl(d.url) === key);
  if (doc) return { url: doc.url, label: doc.label, kind: doc.kind, texts: [doc.text], publishedOn: doc.publishedOn };
  const texts = [...(sources.citedTextsByUrl.get(key) ?? []), ...(sources.fetchedTexts.has(key) ? [sources.fetchedTexts.get(key)!] : [])];
  return { url, label: hostLabel(url), kind: 'web_search', texts, publishedOn: null };
}

/** URLs de búsqueda cuyas citas no se pudieron comprobar: vale la pena descargarlas. */
export function unverifiedSearchUrls(submission: RawResearchSubmission | null, sources: SourceTexts): string[] {
  if (!submission || !Array.isArray(submission.facts)) return [];
  const urls: string[] = [];
  for (const raw of submission.facts as RawResearchFact[]) {
    if (str(raw?.doc_id)) continue;
    const quote = str(raw?.quote);
    const located = raw ? locateSource(raw, sources) : null;
    if (!quote || !located || located.kind !== 'web_search') continue;
    if (located.texts.some((t) => quoteMatchKind(quote, t) !== null)) continue;
    urls.push(located.url);
  }
  return [...new Set(urls)];
}

function verifyFact(
  raw: RawResearchFact,
  sources: SourceTexts,
  today: string,
): { fact: Omit<ResearchFact, 'id'> & { ref: string | null } } | { rejection: FactRejection } {
  const ref = str(raw.ref);
  const topic = str(raw.topic) as ResearchTopic | null;
  const statement = str(raw.statement);
  const quote = str(raw.quote);
  if (!topic || !RESEARCH_TOPICS.includes(topic) || !statement || !quote || statement.length > STATEMENT_MAX_CHARS) {
    return { rejection: { ref, reason: 'invalid_shape', sourceUrl: null } };
  }
  const located = locateSource(raw, sources);
  if (!located) return { rejection: { ref, reason: 'unknown_source', sourceUrl: str(raw.source_url) } };
  if (!located.texts.some((text) => quoteMatchKind(quote, text) !== null)) {
    return { rejection: { ref, reason: 'quote_not_found', sourceUrl: located.url } };
  }
  const publishedOn = located.publishedOn ?? isoDate(raw.published_on);
  // Las cifras del dato salen de la cita (o de la fecha del documento, nunca de una
  // fecha que escribió el modelo).
  if (unsupportedNumbers(statement, [quote, located.publishedOn ?? ''], { strict: true }).length > 0) {
    return { rejection: { ref, reason: 'statement_numbers_unsupported', sourceUrl: located.url } };
  }
  if (topic === 'recent_signal' && publishedOn && ageInDays(publishedOn, today) > MAX_SIGNAL_AGE_DAYS) {
    return { rejection: { ref, reason: 'signal_too_old', sourceUrl: located.url } };
  }
  return {
    fact: {
      ref,
      topic,
      statement,
      quote,
      sourceKind: located.kind,
      sourceUrl: located.url,
      sourceLabel: located.label,
      publishedOn,
    },
  };
}

function quoteKey(quote: string | null): string {
  return (quote ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Arma la ficha verificada. `internalFacts` ya traen sus IDs (F1…Fk) y se
 * conservan; los de la web siguen la numeración.
 */
export function verifyResearch(params: {
  submission: RawResearchSubmission | null;
  internalFacts: readonly ResearchFact[];
  sources: SourceTexts;
  today: string;
}): VerifiedResearch {
  const { submission, internalFacts, sources, today } = params;
  const facts: ResearchFact[] = [...internalFacts];
  const rejected: FactRejection[] = [];
  const refToId = new Map<string, string>(internalFacts.map((f) => [f.id, f.id]));
  const seenQuotes = new Set(internalFacts.filter((f) => f.quote).map((f) => quoteKey(f.quote)));

  const rawFacts = Array.isArray(submission?.facts) ? (submission!.facts as RawResearchFact[]) : [];
  for (const raw of rawFacts.slice(0, MAX_WEB_FACTS)) {
    const result = verifyFact(raw ?? {}, sources, today);
    if ('rejection' in result) {
      rejected.push(result.rejection);
      continue;
    }
    const key = quoteKey(result.fact.quote);
    if (seenQuotes.has(key)) {
      rejected.push({ ref: result.fact.ref, reason: 'duplicate', sourceUrl: result.fact.sourceUrl });
      continue;
    }
    seenQuotes.add(key);
    const id = `F${facts.length + 1}`;
    const { ref, ...fact } = result.fact;
    facts.push({ id, ...fact });
    if (ref) refToId.set(ref, id);
  }

  const factTexts = new Map(facts.map((f) => [f.id, `${f.statement} ${f.quote ?? ''} ${f.publishedOn ?? ''}`]));
  const productKeys = new Set(UBITS_PRODUCTS.map((p) => p.key));
  const hypotheses: ResearchHypothesis[] = [];
  const rawHypotheses = Array.isArray(submission?.hypotheses) ? (submission!.hypotheses as Record<string, unknown>[]) : [];
  for (const raw of rawHypotheses.slice(0, MAX_HYPOTHESES)) {
    const text = str(raw?.text);
    if (!text) continue;
    const refs = Array.isArray(raw.fact_refs) ? (raw.fact_refs as unknown[]) : [];
    const factRefs = [...new Set(refs.map((r) => (typeof r === 'string' ? refToId.get(r.trim()) : undefined)).filter((r): r is string => !!r))];
    if (factRefs.length === 0) continue;
    if (unsupportedNumbers(text, factRefs.map((id) => factTexts.get(id) ?? ''), { strict: true }).length > 0) continue;
    const productKey = str(raw.product_key);
    hypotheses.push({ text, productKey: productKey && productKeys.has(productKey) ? productKey : null, factRefs });
  }

  const gaps = (Array.isArray(submission?.gaps) ? (submission!.gaps as unknown[]) : [])
    .map(str)
    .filter((g): g is string => !!g && g.length <= GAP_MAX_CHARS)
    .slice(0, MAX_GAPS);

  const rawSummary = str(submission?.summary);
  const summary =
    rawSummary &&
    rawSummary.length <= SUMMARY_MAX_CHARS &&
    unsupportedNumbers(rawSummary, [...factTexts.values()], { strict: true }).length === 0
      ? rawSummary
      : null;

  return { facts, hypotheses, gaps, summary, rejected };
}

/**
 * ¿Alcanza para llamar? Se sabe qué hace, su tamaño o presencia, y hay al menos
 * una señal reciente o un dato de talento.
 */
export function isResearchSufficient(facts: readonly ResearchFact[]): boolean {
  const has = (topic: ResearchTopic) => facts.some((f) => f.topic === topic);
  return has('business') && has('size_presence') && (has('recent_signal') || has('talent'));
}
