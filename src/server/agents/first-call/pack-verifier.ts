/**
 * Agente 3 · Primera llamada — leer y verificar el paquete del redactor (puro).
 *
 * Reglas sin IA: cada cifra con fuente (hechos o biblioteca), hechos citados que
 * existen, largo del guion y del mensaje por canal, frases prohibidas y nada de
 * teléfonos ni correos. Lo que falla vuelve al redactor una vez; si sigue
 * fallando, el paquete queda «para revisar» con los motivos a la vista.
 */

import type { AnthropicContentBlock } from '../prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { unsupportedNumbers } from './numbers';
import type { FirstCallChannel, FirstCallPackContent, PackObjection, PackTextWithRefs, ResearchFact } from './types';
import { BANNED_PHRASES, UBITS_CLAIMS, UBITS_OBJECTIONS } from './ubits-messaging-library';
import {
  CALL_SCRIPT_MAX_WORDS,
  CALL_SCRIPT_MIN_WORDS,
  MAX_CAUTIONS,
  MAX_OBJECTIONS,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  SHORT_MESSAGE_MAX_CHARS,
  WRITER_SUBMIT_TOOL,
} from './writer-prompt';

/** Margen sobre los topes de largo: un guion de 175 palabras no es un error. */
const LENGTH_TOLERANCE = 1.1;

export function extractWriterSubmission(content: readonly AnthropicContentBlock[]): Record<string, unknown> | null {
  const block = [...content].reverse().find((b) => b.type === 'tool_use' && b.name === WRITER_SUBMIT_TOOL);
  if (!block || typeof block.input !== 'object' || block.input === null) return null;
  return block.input as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strList(value: unknown, max: number): string[] {
  return (Array.isArray(value) ? value : []).map(str).filter((s) => s.length > 0).slice(0, max);
}

function withRefs(value: unknown): PackTextWithRefs {
  const record = (value ?? {}) as Record<string, unknown>;
  const refs = Array.isArray(record.fact_refs) ? record.fact_refs : [];
  return {
    text: str(record.text),
    factRefs: [...new Set(refs.filter((r): r is string => typeof r === 'string').map((r) => r.trim()))],
  };
}

/** De la respuesta cruda a un paquete con forma fija (sin validar el contenido). */
export function parsePackSubmission(raw: Record<string, unknown>): FirstCallPackContent {
  const libraryKeys = new Set(UBITS_OBJECTIONS.map((o) => o.key));
  const objections: PackObjection[] = (Array.isArray(raw.objections) ? raw.objections : [])
    .map((o) => (o ?? {}) as Record<string, unknown>)
    .map((o) => {
      const key = str(o.library_key);
      return { objection: str(o.objection), response: str(o.response), libraryKey: libraryKeys.has(key) ? key : null };
    })
    .filter((o) => o.objection && o.response)
    .slice(0, MAX_OBJECTIONS);
  return {
    reasonToCall: withRefs(raw.reason_to_call),
    angle: str(raw.angle),
    callScript: withRefs(raw.call_script),
    shortMessage: withRefs(raw.short_message),
    questions: strList(raw.questions, MAX_QUESTIONS),
    objections,
    nextStep: str(raw.next_step),
    cautions: strList(raw.cautions, MAX_CAUTIONS),
  };
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{6,}\d/g;
/** Un teléfono tiene 9 o más dígitos seguidos (con espacios o guiones); «2024-2025» no. */
const PHONE_MIN_DIGITS = 9;

export function containsPhone(text: string): boolean {
  return (text.match(PHONE_CANDIDATE) ?? []).some((c) => c.replace(/\D/g, '').length >= PHONE_MIN_DIGITS);
}

function normalizeForBan(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Textos contra los que se comprueban las cifras: hechos y biblioteca. */
export function numberSources(facts: readonly ResearchFact[]): string[] {
  return [
    ...facts.map((f) => `${f.statement} ${f.quote ?? ''} ${f.publishedOn ?? ''}`),
    ...UBITS_CLAIMS.map((c) => c.text),
    ...UBITS_OBJECTIONS.map((o) => o.response),
  ];
}

/**
 * Problemas del paquete, en palabras para el vendedor. Vacío = listo para usar.
 */
export function verifyPack(
  pack: FirstCallPackContent,
  facts: readonly ResearchFact[],
  channel: FirstCallChannel,
): string[] {
  const issues: string[] = [];
  const factIds = new Set(facts.map((f) => f.id));
  const sources = numberSources(facts);

  if (!pack.reasonToCall.text) issues.push('Falta la razón para llamar.');
  if (!pack.callScript.text) issues.push('Falta el guion de la llamada.');
  if (!pack.shortMessage.text) issues.push('Falta el mensaje corto.');
  if (!pack.nextStep) issues.push('Falta el siguiente paso.');
  if (pack.questions.length < MIN_QUESTIONS) issues.push(`Hacen falta al menos ${MIN_QUESTIONS} preguntas.`);
  if (pack.objections.length === 0) issues.push('Faltan las objeciones y sus respuestas.');

  const allRefs = [...pack.reasonToCall.factRefs, ...pack.callScript.factRefs, ...pack.shortMessage.factRefs];
  const unknownRefs = [...new Set(allRefs.filter((r) => !factIds.has(r)))];
  if (unknownRefs.length > 0) issues.push(`Cita hechos que no existen en la ficha: ${unknownRefs.join(', ')}.`);
  if (facts.length > 0 && pack.reasonToCall.text && pack.reasonToCall.factRefs.length === 0) {
    issues.push('La razón para llamar no dice en qué hecho se basa.');
  }

  const words = countWords(pack.callScript.text);
  if (pack.callScript.text && words < CALL_SCRIPT_MIN_WORDS / LENGTH_TOLERANCE) {
    issues.push(`El guion es muy corto (${words} palabras; se buscan ${CALL_SCRIPT_MIN_WORDS} a ${CALL_SCRIPT_MAX_WORDS}).`);
  }
  if (words > CALL_SCRIPT_MAX_WORDS * LENGTH_TOLERANCE) {
    issues.push(`El guion es muy largo (${words} palabras; se buscan ${CALL_SCRIPT_MIN_WORDS} a ${CALL_SCRIPT_MAX_WORDS}).`);
  }
  const maxChars = SHORT_MESSAGE_MAX_CHARS[channel];
  if (pack.shortMessage.text.length > maxChars * LENGTH_TOLERANCE) {
    issues.push(`El mensaje corto pasa de ${maxChars} caracteres (${pack.shortMessage.text.length}).`);
  }

  const texts = [
    pack.reasonToCall.text,
    pack.angle,
    pack.callScript.text,
    pack.shortMessage.text,
    pack.nextStep,
    ...pack.questions,
    ...pack.objections.flatMap((o) => [o.objection, o.response]),
  ];
  const unsupported = [...new Set(texts.flatMap((t) => unsupportedNumbers(t, sources)))];
  if (unsupported.length > 0) {
    issues.push(`Usa cifras sin fuente en la ficha ni en la biblioteca: ${unsupported.join(', ')}.`);
  }

  const spoken = normalizeForBan([pack.reasonToCall.text, pack.callScript.text, pack.shortMessage.text].join(' '));
  const banned = BANNED_PHRASES.filter((p) => spoken.includes(normalizeForBan(p)));
  if (banned.length > 0) issues.push(`Usa frases que no conviene decir: «${banned.join('», «')}».`);

  if ([...texts, ...pack.cautions].some((t) => EMAIL.test(t) || containsPhone(t))) {
    issues.push('Incluye un correo o un teléfono.');
  }

  return issues;
}
