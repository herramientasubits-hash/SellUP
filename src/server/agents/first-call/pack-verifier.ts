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
import { BANNED_PHRASES, UBITS_CLAIMS, UBITS_OBJECTIONS, UBITS_PRODUCTS } from './ubits-messaging-library';
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
  const productKey = str(raw.product_key);
  return {
    productKey: productKey && UBITS_PRODUCTS.some((p) => p.key === productKey) ? productKey : null,
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

const EMPTY_TEXT: PackTextWithRefs = { text: '', factRefs: [] };

/** Lo que entrega el redactor para un decisor: lo común y un mensaje por canal. */
export interface WriterSubmission {
  shared: FirstCallPackContent;
  messages: Partial<Record<FirstCallChannel, PackTextWithRefs>>;
}

/** Lee la entrega con varios canales (la v1 traía un solo `short_message`). */
export function parseWriterSubmission(raw: Record<string, unknown>, channels: readonly FirstCallChannel[]): WriterSubmission {
  const shared = parsePackSubmission(raw);
  const messages: Partial<Record<FirstCallChannel, PackTextWithRefs>> = {};
  for (const item of Array.isArray(raw.messages) ? raw.messages : []) {
    const record = (item ?? {}) as Record<string, unknown>;
    const channel = str(record.channel) as FirstCallChannel;
    if (channels.includes(channel) && !messages[channel]) messages[channel] = withRefs(record);
  }
  // Una entrega de un solo canal con `short_message` (forma v1) también vale.
  if (channels.length === 1 && !messages[channels[0]] && shared.shortMessage.text) messages[channels[0]] = shared.shortMessage;
  return { shared, messages };
}

/** La preparación de un canal: el guion sólo existe en la llamada. */
export function contentForChannel(submission: WriterSubmission, channel: FirstCallChannel): FirstCallPackContent {
  return {
    ...submission.shared,
    callScript: channel === 'call' ? submission.shared.callScript : EMPTY_TEXT,
    shortMessage: submission.messages[channel] ?? EMPTY_TEXT,
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
function factNumberText(fact: ResearchFact): string {
  return `${fact.statement} ${fact.quote ?? ''} ${fact.publishedOn ?? ''}`;
}

export function numberSources(facts: readonly ResearchFact[]): string[] {
  return [
    ...facts.map(factNumberText),
    ...UBITS_CLAIMS.map((c) => c.text),
    ...UBITS_OBJECTIONS.map((o) => o.response),
  ];
}

/** Afirmaciones sobre UBITS que la biblioteca no respalda (experiencia, clientes, casos). */
const UNSUPPORTED_UBITS_CLAIMS: readonly RegExp[] = [
  /\btrabajamos con (muchos |varios |otros )?(bancos|empresas|compa[nñ]ias|clientes|organizaciones|entidades)/,
  /\b(trabajamos|ayudamos|acompanamos|atendemos|apoyamos)\b[^.?!]{0,40}\b(bancos|empresas|compa[nñ]ias|organizaciones|entidades) como (usted|ustedes|la suya|la tuya|tu empresa|su empresa)\b/,
  /\b(bancos|empresas|compa[nñ]ias|organizaciones|entidades) como (usted|ustedes|la suya|la tuya|tu empresa|su empresa)\b[^.?!]{0,30}\b(lo resuelven|lo resolvieron|ya usan|nos eligen|confian en nosotros|trabajan con nosotros)/,
  /\bnuestros clientes\b/,
  /\bcasos? de [eé]xito\b/,
  /\b(otros|muchos) (bancos|clientes) (ya )?(nos usan|usan ubits|trabajan con nosotros)/,
];

export interface VerifyPackOptions {
  /** Nombre del decisor, si se conoce: el texto no debería decir «[nombre]». */
  decisionMakerName?: string | null;
}

/**
 * Problemas del paquete, en palabras para el vendedor. Vacío = listo para usar.
 */
export function verifyPack(
  pack: FirstCallPackContent,
  facts: readonly ResearchFact[],
  channel: FirstCallChannel,
  options: VerifyPackOptions = {},
): string[] {
  const issues: string[] = [];
  const factIds = new Set(facts.map((f) => f.id));
  const isCall = channel === 'call';

  if (!pack.reasonToCall.text) issues.push('Falta la razón para contactarlo.');
  if (isCall && !pack.callScript.text) issues.push('Falta el guion de la llamada.');
  if (!pack.shortMessage.text) issues.push(isCall ? 'Falta el mensaje para dejar si no contesta.' : 'Falta el mensaje del canal.');
  if (!pack.nextStep) issues.push('Falta el siguiente paso.');
  if (pack.questions.length < MIN_QUESTIONS) issues.push(`Hacen falta al menos ${MIN_QUESTIONS} preguntas.`);
  if (pack.objections.length === 0) issues.push('Faltan las objeciones y sus respuestas.');

  const allRefs = [...pack.reasonToCall.factRefs, ...pack.callScript.factRefs, ...pack.shortMessage.factRefs];
  const unknownRefs = [...new Set(allRefs.filter((r) => !factIds.has(r)))];
  if (unknownRefs.length > 0) issues.push(`Cita hechos que no existen en la ficha: ${unknownRefs.join(', ')}.`);
  if (facts.length > 0 && pack.reasonToCall.text && pack.reasonToCall.factRefs.length === 0) {
    issues.push('La razón para contactarlo no dice en qué hecho se basa.');
  }

  if (isCall) {
    const words = countWords(pack.callScript.text);
    if (pack.callScript.text && words < CALL_SCRIPT_MIN_WORDS / LENGTH_TOLERANCE) {
      issues.push(`El guion es muy corto (${words} palabras; se buscan ${CALL_SCRIPT_MIN_WORDS} a ${CALL_SCRIPT_MAX_WORDS}).`);
    }
    if (words > CALL_SCRIPT_MAX_WORDS * LENGTH_TOLERANCE) {
      issues.push(`El guion es muy largo (${words} palabras; se buscan ${CALL_SCRIPT_MIN_WORDS} a ${CALL_SCRIPT_MAX_WORDS}).`);
    }
  }
  const maxChars = SHORT_MESSAGE_MAX_CHARS[channel];
  if (pack.shortMessage.text.length > maxChars * LENGTH_TOLERANCE) {
    issues.push(`El mensaje pasa de ${maxChars} caracteres (${pack.shortMessage.text.length}).`);
  }

  // Las cifras de un texto con fuentes tienen que estar en los hechos que ESE texto cita
  // (o en la biblioteca): así no se cuela una comparación entre hechos que miden cosas distintas.
  const library = numberSources([]);
  const byId = new Map(facts.map((f) => [f.id, f]));
  // El guion y el mensaje pueden repetir la cifra de la razón para contactarlo aunque no la vuelvan a citar.
  const reasonRefs = pack.reasonToCall.factRefs;
  const citedSources = (refs: readonly string[]) => [
    ...refs.map((r) => byId.get(r)).filter((f): f is ResearchFact => f !== undefined).map(factNumberText),
    ...library,
  ];
  const referenced = [pack.reasonToCall, pack.callScript, pack.shortMessage];
  const free = [pack.angle, pack.nextStep, ...pack.questions, ...pack.objections.flatMap((o) => [o.objection, o.response])];
  const allSources = numberSources(facts);
  const unsupported = [
    ...new Set([
      ...unsupportedNumbers(pack.reasonToCall.text, citedSources(reasonRefs)),
      ...[pack.callScript, pack.shortMessage].flatMap((block) => unsupportedNumbers(block.text, citedSources([...block.factRefs, ...reasonRefs]))),
      ...free.flatMap((t) => unsupportedNumbers(t, allSources)),
    ]),
  ];
  if (unsupported.length > 0) {
    issues.push(`Usa cifras que no están en los hechos que cita ni en la biblioteca: ${unsupported.join(', ')}.`);
  }

  const texts = [...referenced.map((b) => b.text), ...free];
  const spoken = normalizeForBan([pack.reasonToCall.text, pack.callScript.text, pack.shortMessage.text].join(' '));
  const banned = BANNED_PHRASES.filter((p) => spoken.includes(normalizeForBan(p)));
  if (banned.length > 0) issues.push(`Usa frases que no conviene decir: «${banned.join('», «')}».`);

  // Sólo lo que dice el vendedor: la objeción es lo que dice el prospecto («ya trabajamos con…»).
  const said = normalizeForBan(
    [
      ...referenced.map((b) => b.text),
      pack.angle,
      pack.nextStep,
      ...pack.questions,
      ...pack.objections.map((o) => o.response),
    ].join(' '),
  );
  if (UNSUPPORTED_UBITS_CLAIMS.some((re) => re.test(said))) {
    issues.push('Afirma experiencia, clientes o casos de UBITS que la biblioteca no respalda.');
  }

  if (options.decisionMakerName && /\[nombre\]/i.test([pack.callScript.text, pack.shortMessage.text].join(' '))) {
    issues.push(`Dice «[nombre]» aunque el decisor se llama ${options.decisionMakerName}.`);
  }

  if ([...texts, ...pack.cautions].some((t) => EMAIL.test(t) || containsPhone(t))) {
    issues.push('Incluye un correo o un teléfono.');
  }

  return issues;
}
