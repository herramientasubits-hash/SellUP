/**
 * Agente 3 · Primera llamada — leer y verificar el paquete del redactor (puro).
 *
 * Reglas sin IA: cada cifra con fuente (hechos o biblioteca), hechos citados que
 * existen, largo del guion y del mensaje por canal, frases prohibidas y nada de
 * teléfonos ni correos. Lo que falla vuelve al redactor una vez; si sigue
 * fallando, el paquete queda «para revisar» con los motivos a la vista.
 */

import { foreignWordsIn } from './country-style';
import { normalizeKeys } from './tool-input';
import { stripTrainingNormIds } from './country-training-context';
import type { AnthropicContentBlock } from '../prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { unsupportedNumbers as unsupportedNumbersIn } from './numbers';
import type { ApproachVariant, FirstCallChannel, FirstCallPackContent, PackObjection, PackTextWithRefs, ResearchFact } from './types';
import { BANNED_PHRASES, UBITS_CLAIMS, UBITS_OBJECTIONS, UBITS_PRODUCTS } from './ubits-messaging-library';
import { APPROACH_DEFINITIONS, FIRST_CONTACT_APPROACHES, type FirstContactApproach } from './approaches';
import {
  CALL_SCRIPT_MAX_WORDS,
  CALL_SCRIPT_MIN_WORDS,
  MAX_CAUTIONS,
  MAX_OBJECTIONS,
  MAX_QUESTIONS,
  EMAIL_BODY_MAX_WORDS,
  EMAIL_SUBJECT_MAX_WORDS,
  MIN_QUESTIONS,
  SHORT_MESSAGE_MAX_CHARS,
  WRITER_SUBMIT_TOOL,
} from './writer-prompt';

/** Margen sobre los topes de largo: un guion de 175 palabras no es un error. */
const LENGTH_TOLERANCE = 1.1;

export function extractWriterSubmission(content: readonly AnthropicContentBlock[]): Record<string, unknown> | null {
  const block = [...content].reverse().find((b) => b.type === 'tool_use' && b.name === WRITER_SUBMIT_TOOL);
  if (!block || typeof block.input !== 'object' || block.input === null) return null;
  return normalizeKeys(block.input) as Record<string, unknown>;
}

/**
 * Los modelos chicos (Haiku) a veces entregan una lista o un objeto como TEXTO JSON
 * («"messages": "[{…}]"») o con las claves en camelCase. Corrida real de Grupo Ciisa
 * (18-10): la entrega llegó sin mensajes, objeciones ni pedido de reunión. Antes de
 * leer, se desenvuelve el texto JSON y se pasan las claves a snake_case.
 */
/** Una lista, aunque llegue como objeto con claves (p. ej. un mensaje por canal: `{ "call": {…} }`). */
function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) =>
      item && typeof item === 'object' && !Array.isArray(item) ? { channel: key, ...(item as Record<string, unknown>) } : item,
    );
  }
  return [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strList(value: unknown, max: number): string[] {
  return list(value).map(str).filter((s) => s.length > 0).slice(0, max);
}

/** Un texto con sus hechos citados; si llega sólo el texto, sin citas. */
/**
 * Restos del otro formato de herramientas que Haiku a veces mete dentro del texto
 * (`<parameter name="text">…</parameter>`): no son parte del mensaje.
 */
const PARAMETER_TAG = /<\/?parameter(?:\s+name="[^"]*")?\s*>/g;

/**
 * Etiquetas internas que el redactor a veces deja al comienzo del texto («Mensaje de voz si
 * no contesta (enfoque insight): …», Pizza Pizza en Prod 19-10): el vendedor no las dice.
 */
const LEADING_LABEL =
  /^\s*(?:mensaje de voz(?: si no contesta)?|mensaje si no contesta|guion(?: de (?:la )?llamada)?|versi[oó]n[^:\n]{0,40}|nota de (?:conexi[oó]n|linkedin)|whatsapp|linkedin|correo)(?:\s*\([^)\n]{0,60}\))?\s*:\s*/i;

/**
 * «…un diagnóstico de su equipo, sin costo, para que…»: el redactor agrega «sin costo» a las
 * ofertas aunque la biblioteca no lo promete (banco 20-10, 4 preparaciones). Si va como inciso
 * (entre comas, o al comienzo de la frase), se quita; en otro lugar lo marca el verificador.
 */
const FREE_INCISO = /,\s*(?:sin costo alguno|sin costo|sin cargo|gratis|de forma gratuita)\s*(?=[,.;!?])/gi;
const FREE_OPENING = /(^|[.!?]\s+)(?:sin costo|sin cargo|gratis),\s*(\p{L})/giu;

export function cleanToolText(value: string): string {
  return value
    .replace(PARAMETER_TAG, '')
    .trim()
    .replace(LEADING_LABEL, '')
    .replace(FREE_INCISO, '')
    .replace(FREE_OPENING, (_m, start: string, first: string) => `${start}${first.toUpperCase()}`)
    .trim();
}

function refsFrom(value: unknown): string[] {
  return [...new Set(list(value).filter((r): r is string => typeof r === 'string').map((r) => r.trim()))];
}

/**
 * Un texto con sus citas. La forma nueva es plana (el texto y, aparte, `refs`); la de
 * antes, un objeto `{text, fact_refs}` — las preparaciones guardadas siguen leyéndose.
 */
function withRefs(value: unknown, refs?: unknown): PackTextWithRefs {
  if (typeof value === 'string') return { text: cleanToolText(value), factRefs: refsFrom(refs) };
  const record = (value ?? {}) as Record<string, unknown>;
  return { text: cleanToolText(str(record.text)), factRefs: refsFrom(record.fact_refs ?? refs) };
}

/**
 * Qué trajo la entrega, sin el contenido: cada campo y su tipo. Va al registro de uso
 * cuando falla, para diagnosticar sin guardar el texto.
 */
export function describeSubmissionShape(raw: Record<string, unknown> | null): Record<string, string> {
  if (!raw) return { submission: 'missing' };
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length})` : v === null ? 'null' : typeof v]),
  );
}

/** De la respuesta cruda a un paquete con forma fija (sin validar el contenido). */
export function parsePackSubmission(raw: Record<string, unknown>): FirstCallPackContent {
  const libraryKeys = new Set(UBITS_OBJECTIONS.map((o) => o.key));
  const objections: PackObjection[] = list(raw.objections)
    .map((o) => (o ?? {}) as Record<string, unknown>)
    .map((o) => {
      const key = str(o.library_key);
      return { objection: str(o.objection), response: str(o.response), libraryKey: libraryKeys.has(key) ? key : null };
    })
    .filter((o) => o.objection && o.response)
    .slice(0, MAX_OBJECTIONS);
  const productKey = str(raw.product_key);
  const approach = str(raw.approach);
  return {
    productKey: productKey && UBITS_PRODUCTS.some((p) => p.key === productKey) ? productKey : null,
    approach: isApproach(approach) ? approach : null,
    approachReason: str(raw.approach_reason) || null,
    meetingAsk: str(raw.meeting_ask),
    ifNo: str(raw.if_no),
    confirmation: str(raw.confirmation),
    // `fact_refs` suelto arriba: lo que dejó la entrega rota de Davivienda (19-10).
    reasonToCall: withRefs(raw.reason_to_call, raw.reason_to_call_refs ?? raw.fact_refs),
    angle: str(raw.angle),
    callScript: withRefs(raw.call_script, raw.call_script_refs),
    shortMessage: withRefs(raw.short_message),
    questions: strList(raw.questions, MAX_QUESTIONS),
    objections,
    nextStep: str(raw.next_step),
    cautions: strList(raw.cautions, MAX_CAUTIONS),
  };
}

const EMPTY_TEXT: PackTextWithRefs = { text: '', factRefs: [] };

function isApproach(value: string): value is FirstContactApproach {
  return (FIRST_CONTACT_APPROACHES as readonly string[]).includes(value);
}

function variantsFrom(value: unknown, exclude: FirstContactApproach | null | undefined): ApproachVariant[] {
  const seen = new Set<string>();
  const out: ApproachVariant[] = [];
  for (const item of list(value)) {
    const record = (item ?? {}) as Record<string, unknown>;
    const approach = str(record.approach);
    const text = cleanToolText(str(record.text));
    if (!isApproach(approach) || !text || approach === exclude || seen.has(approach)) continue;
    seen.add(approach);
    const voicemail = cleanToolText(str(record.voicemail));
    out.push({ approach, text, factRefs: withRefs(record).factRefs, ...(voicemail ? { voicemail } : {}) });
  }
  return out;
}

/** La línea para dejar de recibir correos (Chile, Colombia): la agrega el sistema, no el modelo. */
export const EMAIL_OPT_OUT_LINE = 'Si prefiere no recibir más mensajes míos, me lo dice y no le escribo más.';

function withOptOut(text: string): string {
  if (!text || normalizeForBan(text).includes('no le escribo mas')) return text;
  return `${text.trimEnd()}\n\n${EMAIL_OPT_OUT_LINE}`;
}

/** Lo que entrega el redactor para un decisor: lo común y un mensaje por canal. */
export interface WriterSubmission {
  shared: FirstCallPackContent;
  messages: Partial<Record<FirstCallChannel, PackTextWithRefs>>;
  /** Versiones por enfoque extra: de cada mensaje y del guion completo de la llamada. */
  messageVariants: Partial<Record<FirstCallChannel, ApproachVariant[]>>;
  callScriptVariants: ApproachVariant[];
}

/** Lee la entrega con varios canales (la v1 traía un solo `short_message`). */
export function parseWriterSubmission(raw: Record<string, unknown>, channels: readonly FirstCallChannel[]): WriterSubmission {
  const shared = parsePackSubmission(raw);
  const messages: Partial<Record<FirstCallChannel, PackTextWithRefs>> = {};
  const messageVariants: Partial<Record<FirstCallChannel, ApproachVariant[]>> = {};
  for (const item of list(raw.messages)) {
    const record = (item ?? {}) as Record<string, unknown>;
    const channel = str(record.channel) as FirstCallChannel;
    if (channels.includes(channel) && !messages[channel]) {
      messages[channel] = withRefs(record);
      messageVariants[channel] = variantsFrom(record.variants, shared.approach);
    }
  }
  // Una entrega de un solo canal con `short_message` (forma v1) también vale.
  if (channels.length === 1 && !messages[channels[0]] && shared.shortMessage.text) messages[channels[0]] = shared.shortMessage;
  // `call_opener_variants` es la forma anterior (sólo la apertura): también se lee.
  const callScriptVariants = variantsFrom(raw.call_script_variants ?? raw.call_opener_variants, shared.approach);
  return { shared, messages, messageVariants, callScriptVariants };
}

/** ¿Una versión afirma clientes o experiencia de UBITS, o atribuye algo a «la mayoría»? */
function variantClaims(variant: ApproachVariant): boolean {
  const text = normalizeForBan(`${variant.text} ${variant.voicemail ?? ''}`);
  return UNSUPPORTED_UBITS_CLAIMS.some((re) => re.test(text)) || MAJORITY_CLAIM.test(text);
}

/**
 * Lo que queda si, YA corregida, una versión alternativa sigue afirmando clientes o
 * experiencia de UBITS (auditoría 21-10: el aviso n.º 1 de Prod, siempre en versiones
 * alternativas). Es mejor una versión menos que un cliente inventado: se quita y la
 * preparación ya no queda «para revisar» por eso. La versión principal no se toca.
 */
export function withoutClaimingVariants(submission: WriterSubmission): { submission: WriterSubmission; dropped: FirstContactApproach[] } {
  const dropped = new Set<FirstContactApproach>();
  const keep = (variants: readonly ApproachVariant[]) =>
    variants.filter((v) => {
      if (!variantClaims(v)) return true;
      dropped.add(v.approach);
      return false;
    });
  const messageVariants = Object.fromEntries(
    Object.entries(submission.messageVariants).map(([channel, variants]) => [channel, keep(variants ?? [])]),
  ) as WriterSubmission['messageVariants'];
  const callScriptVariants = keep(submission.callScriptVariants);
  if (dropped.size === 0) return { submission, dropped: [] };
  return { submission: { ...submission, messageVariants, callScriptVariants }, dropped: [...dropped] };
}

/** Tope de frases que se mandan a corregir (las demás salen en la siguiente corrida). */
const CLAIM_SENTENCES_MAX = 8;

/**
 * Las frases de la versión principal (y de lo que se dice al pedir la reunión) que afirman
 * clientes o experiencia de UBITS, o atribuyen algo a «la mayoría», tal como se escribieron
 * (Binga!, Prod 21-10: «cómo otras empresas de su tamaño en la región están resolviendo…»
 * siguió tras la corrección). Van textuales al redactor para que las reescriba.
 */
export function claimingSentences(pack: FirstCallPackContent): string[] {
  const texts = [
    pack.reasonToCall.text,
    pack.callScript.text,
    pack.shortMessage.text,
    pack.angle,
    pack.nextStep,
    ...pack.questions,
    ...pack.objections.map((o) => o.response),
    pack.meetingAsk ?? '',
    pack.ifNo ?? '',
    pack.confirmation ?? '',
  ];
  const sentences = texts
    .flatMap((t) => (t ?? '').split(/(?<=[.?!])\s+|\n+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => {
      const n = normalizeForBan(s);
      return UNSUPPORTED_UBITS_CLAIMS.some((re) => re.test(n)) || MAJORITY_CLAIM.test(n);
    });
  return [...new Set(sentences)].slice(0, CLAIM_SENTENCES_MAX);
}

const ACCENT_CLASS: Readonly<Record<string, string>> = {
  a: '[aáàä]', e: '[eéèë]', i: '[iíìï]', o: '[oóòö]', u: '[uúùü]', n: '[nñ]',
  A: '[AÁÀÄ]', E: '[EÉÈË]', I: '[IÍÌÏ]', O: '[OÓÒÖ]', U: '[UÚÙÜ]', N: '[NÑ]',
};

/**
 * El nombre del decisor tal como está en la ficha (Binga!, Prod 21-10: la ficha dice
 * «Julian» y dos textos decían «Julián»). Cada palabra del nombre que aparezca con otras
 * tildes se escribe como en la ficha; el resto del texto no cambia.
 */
export function withRecordNameSpelling<T>(value: T, recordName: string | null | undefined): T {
  const words = (recordName ?? '').split(/\s+/).filter((w) => w.length >= 3 && /^[\p{L}'-]+$/u.test(w));
  if (words.length === 0) return value;
  const patterns = words.map((word) => {
    const body = [...word.normalize('NFD').replace(/[\u0300-\u036f]/g, '')]
      .map((ch) => ACCENT_CLASS[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('');
    // Con mayúsculas tal cual: «paz» o «rosa» en minúscula son palabras, no el nombre.
    return { word, re: new RegExp(`(?<![\\p{L}])${body}(?![\\p{L}])`, 'gu') };
  });
  const fix = (text: string) => patterns.reduce((acc, { word, re }) => acc.replace(re, () => word), text);
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return fix(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    return node;
  };
  return walk(value) as T;
}

/** La preparación de un canal: el guion sólo existe en la llamada. */
export function contentForChannel(submission: WriterSubmission, channel: FirstCallChannel): FirstCallPackContent {
  const message = submission.messages[channel] ?? EMPTY_TEXT;
  const variants = channel === 'call' ? submission.callScriptVariants : submission.messageVariants[channel] ?? [];
  const isEmail = channel === 'email';
  return {
    ...submission.shared,
    callScript: channel === 'call' ? submission.shared.callScript : EMPTY_TEXT,
    shortMessage: isEmail ? { ...message, text: withOptOut(message.text) } : message,
    variants: isEmail ? variants.map((v) => ({ ...v, text: withOptOut(v.text) })) : variants,
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
    // El dato y su fuente por nombre: «según el LinkedIn Workplace Learning Report 2025» no es
    // una cifra sin fuente (Auteco, 19-10: el año del informe marcaba 3 de 4 preparaciones).
    ...UBITS_CLAIMS.map((c) => `${c.text} ${c.source}`),
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
  // Asdeporte (19-10): «trabajo con empresas que…», «otros equipos de RR. HH. me comentan».
  /\btrabajo con (muchas |varias |otras )?(empresas|compa[nñ]ias|equipos|organizaciones|clientes)\b/,
  // Auteco (19-10): «algo que muchas empresas de manufactura usan…».
  /\bmuchas (empresas|compa[nñ]ias|organizaciones|areas de talento)\b[^?!\n]{0,50}\b(usan|ya usan|eligen|prefieren|confian)\b/,
  // Sin cortar en los puntos de «RR. HH.»: hasta 40 caracteres de la misma frase.
  /\botr[oa]s (equipos|lideres|líderes|empresas|clientes|gerentes|directores)[^?!\n]{0,40}\b(me (comentan|cuentan|dicen)|lo resuelven|lo resolvieron|ya lo hacen)\b/,
  // Davivienda en Prod (19-10): «otros bancos de la región lo han resuelto», «otros bancos
  // están capacitando…», «trabajo con bancos…», «ayudando a otros bancos…».
  /\botr[oa]s (bancos|empresas|compa[nñ]ias|organizaciones|aseguradoras|cadenas|equipos|lideres|clientes)\b[^?!\n]{0,60}\b(han resuelto|resolvieron|lo resuelven|estan resolviendo|lo estan haciendo|lo hacen|estan (capacitando|acelerando|alineando|formando|usando))\b/,
  /\b(trabajo|trabajamos) con (bancos|lideres|aseguradoras|cadenas|retailers|equipos de|areas de)\b/,
  /\bayud(o|amos|ando|amos a|ando a) (a )?(otr[oa]s )?(bancos|empresas|compa[nñ]ias|aseguradoras)\b/,
  // Teamcore y Davivienda en Prod (19/20-10): «mi equipo trabaja con CEOs en tecnología»,
  // «lo que hemos visto en bancos que atraviesan esto».
  /\b(mi|nuestro) equipo (trabaja|ha trabajado|acompana|apoya|ayuda) (con|a)\b/,
  // «Vemos que en empresas de su tamaño…» es una observación general: sólo la experiencia propia.
  /\b(lo que )?(hemos visto|hemos aprendido)\b[^?!\n]{0,20}\b(en|con) (otr[oa]s |muchos |muchas |varios |varias )?(bancos|empresas|compa[nñ]ias|organizaciones|aseguradoras|cadenas|retailers|clientes)\b/,
  /\bvemos (con|en) (nuestros clientes|otr[oa]s (bancos|empresas|compa[nñ]ias|organizaciones|aseguradoras|cadenas|retailers|clientes))\b/,
  // Binga! (Prod 21-10): «qué están haciendo otros líderes de marketplaces…» (el verbo antes).
  /\b(que|como|lo que) (estan|han estado|vienen) (haciendo|resolviendo|logrando|implementando|usando|aplicando|formando)\b[^?!\n]{0,20}\botr[oa]s (bancos|empresas|compa[nñ]ias|organizaciones|aseguradoras|cadenas|retailers|clientes|lideres|equipos|gerentes|directores|marcas)\b/,
  /\botr[oa]s (lideres|equipos|empresas|compa[nñ]ias|gerentes|directores|marcas)\b[^?!\n]{0,60}\b(estan (haciendo|logrando|implementando|aplicando)|han logrado|lograron)\b/,
];

/**
 * Cifras de la biblioteca dichas con otro sentido (Binga!, Prod 21-10: «El 88 % dice que
 * la formación rápida en los primeros meses es clave»; la fuente habla de retener talento).
 * Si una frase usa la cifra de una afirmación, tiene que nombrar su tema, salvo que la cifra
 * salga de un hecho de la ficha. Devuelve las afirmaciones deformadas.
 */
export function distortedLibraryClaims(texts: readonly string[], facts: readonly ResearchFact[]): UbitsClaimLike[] {
  const factText = normalizeForBan(facts.map((f) => `${f.statement} ${f.quote ?? ''}`).join(' '));
  const sentences = texts.flatMap((t) => (t ?? '').split(/(?<=[.?!])\s+|\n+/)).map((s) => normalizeForBan(s));
  return UBITS_CLAIMS.filter((claim) => {
    const anchor = claim.anchor;
    if (!anchor || anchor.pattern.test(factText)) return false;
    return sentences.some((s) => anchor.pattern.test(s) && !anchor.topic.some((word) => s.includes(word)));
  });
}

type UbitsClaimLike = (typeof UBITS_CLAIMS)[number];

/** «por qué la llamo», «por qué lo contacto»: el pronombre dice el género del decisor. */
const GENDERED_CALL_REASON = /\bpor que (la|lo) (llamo|llame|contacto|busco|escribo)\b/g;

/** La clave de un dato de la ficha o del decisor («F12», «C3»), tal como la cita el redactor. */
const FACT_ID_REF = /\b[FC]\d{1,3}\b/g;

/**
 * Sally Beauty en Prod (20-10): «La mayoría de CEOs de retail con múltiples sedes dice que…».
 * Atribuir una opinión a «la mayoría» sin fuente es inventar un dato.
 */
const MAJORITY_CLAIM =
  /\bla mayoria de (los |las )?(ceos?|empresas|compa[nñ]ias|organizaciones|lideres|gerentes|directores|directivos|retailers|areas de talento|equipos)\b[^?!\n]{0,80}\b(dice|dicen|coincide|coinciden|reconoce|reconocen|afirma|afirman|cree|creen|considera|consideran|asegura|aseguran)\b/;

const LIBRARY_CLAIM_KEYS: ReadonlySet<string> = new Set(UBITS_CLAIMS.map((c) => c.key));

/** Cargo en femenino o masculino (en español); `null` si el cargo no lo dice («Gerente», «HR Director»). */
export function genderFromTitle(title: string | null | undefined): 'f' | 'm' | null {
  const t = normalizeForBan(title ?? '');
  // Un cargo en inglés («Human Resources Director») no dice el género.
  if (/\b(human|resources|manager|officer|head|chief|people|learning|development)\b/.test(t)) return null;
  if (/\b(directora|gerenta|jefa|coordinadora|subdirectora|vicepresidenta|presidenta|ejecutiva|licenciada|ingeniera|doctora|psicologa|abogada|administradora|encargada|subgerenta|supervisora|asesora|consultora)\b/.test(t)) return 'f';
  if (/\b(director|jefe|coordinador|subdirector|ejecutivo|licenciado|ingeniero|doctor|psicologo|abogado|administrador|encargado|supervisor|asesor|consultor)\b/.test(t)) return 'm';
  return null;
}

/** «Estimada Juvenal» (Pizza Pizza, Prod 19-10): el género no se adivina por el nombre. */
const GENDERED_GREETING = /\b(estimad[oa]|querid[oa])\b/g;

/** En el primer contacto por WhatsApp o LinkedIn no se pide reunión ni minutos. */
const FIRST_TOUCH_MEETING = /\b(\d{1,3}\s*min(utos)?|reunion|nos veamos|vernos|agend(ar|emos|amos)|una llamada|videollamada)\b/;

/** «Gratis», «sin costo»…: ninguna oferta de la biblioteca lo promete. */
const FREE_PROMISE = /\b(gratis|gratuit[oa]s?|sin costo|sin cargo|cero costo|no tiene costo)\b/;

/** Un primer mensaje escrito que da por hecho un contacto anterior. */
const PRIOR_CONTACT = /\b(llame porque|le llame|ya le llame|como le comente|como le dije|como hablamos|segun hablamos)\b/;

/** ¿El mensaje de voz es el guion otra vez? (Asdeporte, 18-10: lo copió entero.) */
function repeatsScript(voicemail: string, script: string): boolean {
  if (!voicemail || !script) return false;
  const a = normalizeForBan(voicemail).replace(/\s+/g, ' ').trim();
  const b = normalizeForBan(script).replace(/\s+/g, ' ').trim();
  return a === b || (a.length >= 120 && b.startsWith(a.slice(0, 120)));
}

export interface VerifyPackOptions {
  /** Nombre del decisor, si se conoce: el texto no debería decir «[nombre]». */
  decisionMakerName?: string | null;
  /** Hoy (ms): con el enfoque «evento reciente», la noticia citada debe ser de los últimos 90 días. */
  nowMs?: number;
  /** País de la empresa: marca las palabras que allí suenan a otro país (dueña 19-10). */
  countryCode?: string | null;
  /** Nombre de la empresa: no se revisa como tuteo ni como palabra de otro país («Aldeas Infantiles SOS»). */
  companyName?: string | null;
  /** Cargo del decisor: si dice el género («Directora»), el saludo tiene que coincidir. */
  decisionMakerTitle?: string | null;
}

/** Una noticia para «Por un evento reciente» sirve hasta 90 días. */
export const RECENT_SIGNAL_MAX_DAYS = 90;
/** Un dato con fecha de hace más de esto no se presenta como actual sin su año. */
export const OLD_FACT_MAX_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/** El primer contacto va sin enlaces ni calendario. */
const LINK = /(https?:\/\/|www\.|calendly|cal\.com|bit\.ly)/i;
/** Tuteo (ya normalizado, sin tildes): en el primer contacto va «usted». */
const INFORMAL = /\b(tu|tus|tienes|puedes|quieres|cuentame|dime|contigo|te parece|te sirve|te escribo|te comparto|te llamo|te cuento|te llevare|te envio|te mando|te confirmo|vos|tenes|podes|queres|contame|decime)\b/;

/**
 * Binga! (Prod 21-10): el «!» del nombre de la empresa no es una exclamación. Cada palabra
 * del nombre que trae signos (y el nombre entero) se cuenta sin ellos.
 */
export function withoutNameSigns(text: string, companyName: string | null | undefined): string {
  if (!companyName) return text;
  const signed = [...new Set([companyName.trim(), ...companyName.split(/\s+/)])].filter((w) => /[!?¡¿]/.test(w));
  return signed
    .sort((a, b) => b.length - a.length)
    .reduce(
      // Sin importar mayúsculas («BINGA!»); cada aparición pierde sólo sus propios signos.
      (acc, word) => acc.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (found) => found.replace(/[!?¡¿]/g, '')),
      text,
    );
}

/** Una pregunta o exclamación sin su signo de apertura (marca de texto traducido). */
function missingOpeningSign(text: string): boolean {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  return count(/\?/g) > count(/¿/g) || count(/!/g) > count(/¡/g);
}

/** «Asunto: …» y el cuerpo, sin la línea para dejar de recibir correos. */
export function splitEmail(text: string): { subject: string | null; body: string } {
  const lines = text.split('\n');
  const first = lines.findIndex((l) => l.trim().length > 0);
  const match = first >= 0 ? lines[first].match(/^\s*asunto\s*:\s*(.*)$/i) : null;
  const body = (match ? lines.slice(first + 1) : lines).join('\n').replace(EMAIL_OPT_OUT_LINE, '').trim();
  return { subject: match ? match[1].trim() : null, body };
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
  // Nombrar una norma del país («NOM-035») no es una cifra sin fuente; sus otras cifras sí.
  // Tampoco la referencia a un dato: «(F8, F12)» no es la cifra 12 (Sally Beauty, Prod 20-10).
  const unsupportedNumbers = (text: string, sources: readonly string[]) =>
    unsupportedNumbersIn(stripTrainingNormIds(text, options.countryCode).replace(FACT_ID_REF, ' '), sources);
  const factIds = new Set(facts.map((f) => f.id));
  const isCall = channel === 'call';

  if (!pack.reasonToCall.text) issues.push('Falta la razón para contactarlo.');
  if (isCall && !pack.callScript.text) issues.push('Falta el guion de la llamada.');
  if (!pack.shortMessage.text) issues.push(isCall ? 'Falta el mensaje para dejar si no contesta.' : 'Falta el mensaje del canal.');
  if (!pack.nextStep) issues.push('Falta el siguiente paso.');
  if (pack.questions.length < MIN_QUESTIONS) issues.push(`Hacen falta al menos ${MIN_QUESTIONS} preguntas.`);
  if (pack.objections.length === 0) issues.push('Faltan las objeciones y sus respuestas.');

  const allRefs = [...pack.reasonToCall.factRefs, ...pack.callScript.factRefs, ...pack.shortMessage.factRefs];
  // Una cifra de la biblioteca citada por su clave («linkedin_wlr_2025_retention») no es un hecho
  // inexistente: es una afirmación permitida (Pizza Pizza, Prod 19-10).
  const unknownRefs = [...new Set(allRefs.filter((r) => !factIds.has(r) && !LIBRARY_CLAIM_KEYS.has(r)))];
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

  // ── Lo que mostró la corrida de Asdeporte (18-10) ────────────────────────────
  const variantList = pack.variants ?? [];
  if (isCall && repeatsScript(pack.shortMessage.text, pack.callScript.text)) {
    issues.push('El mensaje si no contesta repite el guion: va uno distinto y corto (menos de 30 segundos).');
  }
  if (isCall && variantList.some((v) => v.voicemail && repeatsScript(v.voicemail, v.text))) {
    issues.push('En otro tipo, el mensaje si no contesta repite su guion.');
  }
  const everything = normalizeForBan(
    [said, pack.meetingAsk ?? '', pack.ifNo ?? '', pack.confirmation ?? '', ...variantList.flatMap((v) => [v.text, v.voicemail ?? ''])].join(' '),
  );
  if (MAJORITY_CLAIM.test(everything)) {
    issues.push('Atribuye una opinión a «la mayoría» sin fuente: usa un dato de la biblioteca o quítalo.');
  }
  if (FREE_PROMISE.test(everything)) {
    issues.push('Promete que algo es gratis o sin costo: la biblioteca no lo dice.');
  }
  if (!isCall && [pack.shortMessage.text, ...variantList.map((v) => v.text)].some((t) => PRIOR_CONTACT.test(normalizeForBan(t)))) {
    issues.push('Dice que ya hubo contacto («llamé», «como le comenté») y es el primero.');
  }

  // ── Manual del primer contacto (17-10-2026) ──────────────────────────────────
  const variants = pack.variants ?? [];
  const isWritten = channel !== 'call';
  if (pack.meetingAsk !== undefined && !pack.meetingAsk) issues.push('Falta cómo pedir la reunión (dos horarios y lo que se lleva).');
  if (pack.ifNo !== undefined && !pack.ifNo) issues.push('Falta qué hacer si dice que no.');
  if (pack.confirmation !== undefined && !pack.confirmation) issues.push('Falta el mensaje para confirmar la reunión.');

  const firstTouch = [pack.shortMessage.text, ...(isWritten ? variants.map((v) => v.text) : [])];
  if (isWritten && firstTouch.some((t) => LINK.test(t))) {
    issues.push('El mensaje lleva un enlace: el primer contacto va sin enlaces ni calendario.');
  }
  if (isWritten && firstTouch.some((t) => (t.match(/\?/g) ?? []).length > 2)) {
    issues.push('El mensaje hace más de un pedido: deja uno solo.');
  }
  if (channel === 'email') {
    for (const text of firstTouch) {
      const { subject, body } = splitEmail(text);
      if (!subject) {
        issues.push('Al correo le falta la línea «Asunto: …».');
        break;
      }
      const subjectWords = countWords(subject);
      // Un asunto de 5 a 8 palabras concreto también funciona; sólo se marca el que se alarga (banco 20-10).
      if (subjectWords > EMAIL_SUBJECT_MAX_WORDS + 4) {
        issues.push(`El asunto es largo (${subjectWords} palabras; se buscan 1 a ${EMAIL_SUBJECT_MAX_WORDS}).`);
        break;
      }
      const bodyWords = countWords(body);
      if (bodyWords > Math.round(EMAIL_BODY_MAX_WORDS * 1.25)) {
        issues.push(`El correo es largo (${bodyWords} palabras; se buscan 50 a ${EMAIL_BODY_MAX_WORDS}).`);
        break;
      }
    }
  }

  const sellerTexts: Array<[string, readonly string[]]> = [
    ['el motivo', [pack.reasonToCall.text]],
    ['el guion', [pack.callScript.text]],
    ['el mensaje', [pack.shortMessage.text]],
    ['el cierre', [pack.nextStep]],
    ['las preguntas', pack.questions],
    ['las objeciones', pack.objections.map((o) => o.response)],
    ['el pedido de reunión', [pack.meetingAsk ?? '']],
    ['el plan si dice que no', [pack.ifNo ?? '']],
    ['la confirmación', [pack.confirmation ?? '']],
    ['las otras versiones', variants.flatMap((v) => [v.text, v.voicemail ?? ''])],
  ];
  // Los nombres propios no cuentan: «Aldeas Infantiles SOS» no es voseo (revisión 19-10).
  const properNames = [options.companyName, options.decisionMakerName].filter((n): n is string => !!n && n.trim().length > 0);
  const withoutNames = (text: string) =>
    properNames.reduce((acc, name) => acc.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' '), text);
  const informalIn = sellerTexts
    .filter(([, texts]) => texts.some((t) => INFORMAL.test(normalizeForBan(withoutNames(t)))))
    .map(([where]) => where);
  if (informalIn.length > 0) {
    issues.push(`Tutea al decisor en ${informalIn.join(', ')}: en el primer contacto va «usted».`);
  }

  // Pizza Pizza (Prod 19-10): «Estimada Juvenal». Sin el género en el cargo, saludo neutro.
  if (options.decisionMakerTitle !== undefined) {
    const gender = genderFromTitle(options.decisionMakerTitle);
    const greetings = [...firstTouch, pack.confirmation ?? '']
      .flatMap((t) => [...normalizeForBan(t).matchAll(GENDERED_GREETING)].map((m) => (m[1].endsWith('a') ? 'f' : 'm')));
    if (greetings.length > 0 && gender === null) {
      issues.push('Saluda con «Estimado/a» sin saber el género (el cargo no lo dice): usa un saludo neutro («Buenos días, Nombre:»).');
    } else if (greetings.some((g) => g !== gender)) {
      issues.push(`El saludo no coincide con el cargo («${options.decisionMakerTitle}»).`);
    }
  }
  const distorted = distortedLibraryClaims(
    [...sellerTexts.flatMap(([, texts]) => texts), ...variants.flatMap((v) => [v.text, v.voicemail ?? ''])],
    facts,
  );
  if (distorted.length > 0) {
    issues.push(
      `Usa una cifra de la biblioteca con otro sentido: dila como en la fuente (${distorted.map((c) => `«${c.text}»`).join('; ')}) o quítala.`,
    );
  }
  // Binga! (Prod 21-10): «por qué la llamo» a Julián. Sin el género en el cargo, va neutro
  // («el motivo de mi llamada»); con el género, tiene que coincidir.
  if (options.decisionMakerTitle !== undefined) {
    const gender = genderFromTitle(options.decisionMakerTitle);
    const pronouns = sellerTexts
      .flatMap(([, texts]) => texts)
      .flatMap((t) => [...normalizeForBan(t).matchAll(GENDERED_CALL_REASON)].map((m) => (m[1] === 'la' ? 'f' : 'm')));
    if (gender === null && pronouns.length > 0) {
      issues.push('Dice «por qué la/lo llamo» sin saber el género del decisor: usa «el motivo de mi llamada» (o «de mi mensaje»).');
    } else if (pronouns.some((p) => p !== gender)) {
      issues.push(`Dice «por qué la/lo llamo» con el género que no coincide con el cargo («${options.decisionMakerTitle}»): usa «el motivo de mi llamada».`);
    }
  }
  // Sólo el mensaje principal: es el del primer contacto (las otras versiones son alternativas).
  if ((channel === 'whatsapp' || channel === 'linkedin') && FIRST_TOUCH_MEETING.test(normalizeForBan(pack.shortMessage.text))) {
    issues.push(channel === 'whatsapp' ? 'El primer WhatsApp pide reunión: sólo pide permiso para escribir por ahí.' : 'La nota de LinkedIn pide reunión: sólo el motivo para conectar.');
  }

  // Estilo del país (dueña 19-10): palabras que allí suenan a otro país y signos de apertura.
  const sellerSaid = sellerTexts.flatMap(([, texts]) => texts).filter(Boolean);
  if (options.countryCode !== undefined) {
    const foreign = [...new Set(sellerSaid.flatMap((t) => foreignWordsIn(withoutNames(t), options.countryCode)))];
    if (foreign.length > 0) issues.push(`Usa palabras que en este país suenan a otro: «${foreign.join('», «')}».`);
  }
  if ([pack.callScript.text, pack.shortMessage.text, ...variants.map((v) => v.text)].some((t) => t && missingOpeningSign(withoutNameSigns(t, options.companyName)))) {
    issues.push('A una pregunta o exclamación le falta el signo de apertura («¿», «¡»).');
  }

  const variantText = normalizeForBan([...variants.flatMap((v) => [v.text, v.voicemail ?? '']), pack.meetingAsk ?? '', pack.confirmation ?? ''].join(' '));
  const bannedExtra = BANNED_PHRASES.filter((p) => variantText.includes(normalizeForBan(p)) && !banned.includes(p));
  if (bannedExtra.length > 0) issues.push(`Usa frases que no conviene decir: «${bannedExtra.join('», «')}».`);
  // Dice en qué versiones (la corrección automática necesita saber cuáles rehacer).
  const claimingVariants = variants.filter((v) =>
    UNSUPPORTED_UBITS_CLAIMS.some((re) => re.test(normalizeForBan(`${v.text} ${v.voicemail ?? ''}`))),
  );
  if (claimingVariants.length > 0) {
    issues.push(
      `Las versiones «${claimingVariants.map((v) => APPROACH_DEFINITIONS[v.approach].label).join('», «')}» afirman experiencia o clientes de UBITS que la biblioteca no respalda («trabajamos con…», «otros líderes me comentan…»).`,
    );
  } else if (UNSUPPORTED_UBITS_CLAIMS.some((re) => re.test(variantText)) && !UNSUPPORTED_UBITS_CLAIMS.some((re) => re.test(said))) {
    issues.push('Afirma experiencia, clientes o casos de UBITS que la biblioteca no respalda.');
  }
  const variantNumbers = [
    ...new Set(
      [...variants.flatMap((v) => [v.text, v.voicemail ?? '']), pack.meetingAsk ?? '', pack.ifNo ?? '', pack.confirmation ?? ''].flatMap((t) =>
        unsupportedNumbers(t, allSources),
      ),
    ),
  ].filter((n) => !unsupported.includes(n));
  if (variantNumbers.length > 0) {
    issues.push(`Las otras versiones usan cifras sin fuente: ${variantNumbers.join(', ')}.`);
  }

  if (options.nowMs !== undefined && pack.approach === 'trigger') {
    const stale = pack.reasonToCall.factRefs
      .map((r) => byId.get(r))
      .filter((f): f is ResearchFact => !!f && !!f.publishedOn)
      .filter((f) => options.nowMs! - Date.parse(`${f.publishedOn}T12:00:00Z`) > RECENT_SIGNAL_MAX_DAYS * DAY_MS);
    if (stale.length > 0) {
      issues.push(`La noticia citada tiene más de ${RECENT_SIGNAL_MAX_DAYS} días (${stale.map((f) => f.publishedOn).join(', ')}): ya no es un evento reciente.`);
    }
  }

  // Auteco (19-10): el motivo de hoy se apoyaba en un dato de octubre de 2024 dicho como actual.
  if (options.nowMs !== undefined && pack.approach !== 'trigger') {
    const opening = [pack.reasonToCall.text, pack.callScript.text, pack.shortMessage.text].join(' ');
    const old = pack.reasonToCall.factRefs
      .map((r) => byId.get(r))
      .filter((f): f is ResearchFact => !!f && !!f.publishedOn && f.sourceKind !== 'sellup' && f.sourceKind !== 'seller')
      .filter((f) => options.nowMs! - Date.parse(`${f.publishedOn}T12:00:00Z`) > OLD_FACT_MAX_DAYS * DAY_MS)
      .filter((f) => !opening.includes(f.publishedOn!.slice(0, 4)));
    if (old.length > 0) {
      issues.push(
        `El motivo se apoya en un dato de hace más de un año (${old.map((f) => f.publishedOn).join(', ')}) dicho como actual: menciona su año o usa uno más reciente.`,
      );
    }
  }

  if (options.decisionMakerName && /\[nombre\]/i.test([pack.callScript.text, pack.shortMessage.text].join(' '))) {
    issues.push(`Dice «[nombre]» aunque el decisor se llama ${options.decisionMakerName}.`);
  }

  if ([...texts, ...pack.cautions].some((t) => EMAIL.test(t) || containsPhone(t))) {
    issues.push('Incluye un correo o un teléfono.');
  }

  return issues;
}
