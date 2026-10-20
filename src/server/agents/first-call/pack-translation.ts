/**
 * Agente 3 · la versión en el idioma del país (puro).
 *
 * Dueña 20-10: «para esos casos que son otros idiomas debería escribirlas en español y en
 * el idioma del país, tener las dos versiones». En Brasil y Estados Unidos la preparación
 * se escribe y se verifica en español (el vendedor la entiende y la revisa) y, aparte, se
 * adapta al portugués de Brasil o al inglés de EE. UU. lo que se DICE o se ENVÍA al
 * cliente: guion, mensajes, versiones, pedido de reunión, preguntas y objeciones. Las
 * notas para el vendedor (motivo, ángulo, cuidados) quedan en español.
 *
 * Se adapta, no se traduce palabra por palabra, y un verificador sin IA revisa que no
 * falte nada y que no aparezcan cifras que no estaban en la versión en español.
 */

import type { AnthropicContentBlock } from '../prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { normalizeKeys } from './tool-input';
import type { FirstCallPackContent, LocalLanguage, LocalPackVersion } from './types';

export type { LocalLanguage, LocalPackVersion } from './types';

/** El nombre del idioma, en español, para la tarjeta y los avisos. */
export const LOCAL_LANGUAGE_LABELS: Readonly<Record<LocalLanguage, string>> = {
  'pt-BR': 'Portugués',
  'en-US': 'Inglés',
};

const COUNTRY_LANGUAGE: Readonly<Record<string, LocalLanguage>> = { BR: 'pt-BR', US: 'en-US' };

/** El idioma del país si no es el español (o `null`: se escribe sólo en español). */
export function localLanguageFor(countryCode: string | null | undefined): LocalLanguage | null {
  return (countryCode && COUNTRY_LANGUAGE[countryCode.toUpperCase()]) || null;
}

/** Un texto a adaptar, con su clave y cómo se llama para el vendedor. */
export interface TranslationSegment {
  id: string;
  label: string;
  text: string;
}

/**
 * «No aplica en este enfoque: …» es una nota para el vendedor, no algo que se dice: no se
 * adapta (Magalu, banco 20-10: el traductor la convirtió en un pedido de reunión inventado).
 */
const SELLER_NOTE = /^\s*no aplica\b/i;

export function isSellerNote(text: string): boolean {
  return SELLER_NOTE.test(text);
}

/** Los textos de una preparación que van al cliente, en orden. */
export function translationSegments(content: FirstCallPackContent): TranslationSegment[] {
  const segments: TranslationSegment[] = [];
  const add = (id: string, label: string, text: string | undefined) => {
    if (text && text.trim() && !isSellerNote(text)) segments.push({ id, label, text });
  };
  add('script', 'el guion', content.callScript.text);
  add('message', 'el mensaje', content.shortMessage.text);
  (content.variants ?? []).forEach((v, i) => {
    add(`variant${i + 1}`, `la versión ${i + 1}`, v.text);
    add(`variant${i + 1}_voicemail`, `el mensaje de voz de la versión ${i + 1}`, v.voicemail);
  });
  add('meeting', 'el pedido de reunión', content.meetingAsk);
  add('if_no', 'qué decir si dice que no', content.ifNo);
  add('confirmation', 'la confirmación', content.confirmation);
  content.questions.forEach((q, i) => add(`question${i + 1}`, `la pregunta ${i + 1}`, q));
  content.objections.forEach((o, i) => {
    add(`objection${i + 1}`, `la objeción ${i + 1}`, o.objection);
    add(`response${i + 1}`, `la respuesta a la objeción ${i + 1}`, o.response);
  });
  return segments;
}

export const TRANSLATION_SUBMIT_TOOL = 'submit_local_version';
/** Una preparación entera (guion, 3 versiones, preguntas y objeciones) cabe holgada. */
export const TRANSLATION_MAX_OUTPUT_TOKENS = 6_000;

export function buildTranslationSubmitTool() {
  return {
    name: TRANSLATION_SUBMIT_TOOL,
    description: 'Entrega cada texto adaptado al idioma del país, con la misma clave (id) que el original.',
    input_schema: {
      type: 'object',
      properties: {
        segments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'La misma clave del texto original.' },
              text: { type: 'string', description: 'El texto adaptado.' },
            },
            required: ['id', 'text'],
          },
        },
      },
      required: ['segments'],
    },
  } as const;
}

const LANGUAGE_GUIDE: Readonly<Record<LocalLanguage, string>> = {
  'en-US': [
    'Inglés de Estados Unidos, como lo escribe un vendedor de allá:',
    '- Muy directo: el valor en la primera línea, frases cortas, un solo pedido.',
    '- Nombre de pila, sin títulos ni «Dear Mr.». Saludo «Hi [nombre],» y despedida «Best,».',
    '- Horarios en el formato de allá (3:00 p.m.) y fechas como «Tuesday, October 21».',
    '- La primera línea del correo «Asunto: …» pasa a «Subject: …».',
  ].join('\n'),
  'pt-BR': [
    'Portugués de Brasil, como lo escribe un vendedor de allá:',
    '- Cálido y cercano: un saludo amable antes del motivo, sin perder la claridad.',
    '- Trato con «você» (nunca el portugués de Portugal: nada de «tu» con verbo en segunda persona ni «telemóvel»).',
    '- Saludo «Olá, [nombre], tudo bem?» y despedida «Abraço,» o «Atenciosamente,».',
    '- Horarios como «15h» y fechas como «terça-feira, 21 de outubro».',
    '- La primera línea del correo «Asunto: …» pasa a «Assunto: …».',
  ].join('\n'),
};

const LANGUAGE_NAME: Readonly<Record<LocalLanguage, string>> = { 'en-US': 'inglés de Estados Unidos', 'pt-BR': 'portugués de Brasil' };

export function buildTranslationSystemPrompt(language: LocalLanguage): string {
  return [
    'Adaptas al idioma del país los textos de primer contacto que un vendedor de UBITS dirá o enviará a una persona de Recursos Humanos o Formación.',
    'No traduces palabra por palabra: escribes LO MISMO como lo escribiría alguien de ese país, natural y sin sonar a traducción.',
    '',
    LANGUAGE_GUIDE[language],
    '',
    'Reglas:',
    `- Escribe SIEMPRE en ${LANGUAGE_NAME[language]}, aunque la empresa, los datos o el vendedor sean de otro país: la persona lee en ese idioma. Nunca devuelvas el texto en español.`,
    '- Mismo contenido: no agregues ni quites datos, cifras, nombres, empresas, fechas ni pedidos. Si el original no pide una reunión, la versión tampoco.',
    '- Nombres propios, de empresas y de productos (UBITS) sin traducir.',
    '- Largo parecido o menor; conserva los saltos de línea.',
    '- Sin jerga, sin superlativos y sin frases de plantilla.',
    `- Entrega con ${TRANSLATION_SUBMIT_TOOL} un texto por CADA clave (id) recibida, con la misma clave.`,
  ].join('\n');
}

export function buildTranslationUserMessage(segments: readonly TranslationSegment[], countryName: string | null, language: LocalLanguage): string {
  return [
    `País del cliente: ${countryName ?? 'sin país'}. Escribe cada texto en ${LANGUAGE_NAME[language]}.`,
    'Textos (clave, luego el texto entre líneas):',
    ...segments.map((s) => `\n[${s.id}]\n${s.text}`),
  ].join('\n');
}

/** Lo que entregó el modelo: clave → texto (o `null` si no entregó). */
export function extractTranslation(content: readonly AnthropicContentBlock[]): Map<string, string> | null {
  const block = [...content].reverse().find((b) => b.type === 'tool_use' && b.name === TRANSLATION_SUBMIT_TOOL);
  if (!block || typeof block.input !== 'object' || block.input === null) return null;
  const input = normalizeKeys(block.input) as Record<string, unknown>;
  const list = Array.isArray(input['segments']) ? input['segments'] : [];
  const out = new Map<string, string>();
  for (const item of list) {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    const id = typeof record?.['id'] === 'string' ? record['id'].trim().replace(/^\[|\]$/g, '') : '';
    const text = typeof record?.['text'] === 'string' ? record['text'].trim() : '';
    if (id && text) out.set(id, text);
  }
  return out;
}

/** Horas del día: cambian de formato entre países (15:00 → 3:00 p.m. → 15h), no son cifras. */
const TIME_OF_DAY = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?)(?![\p{L}])|\b\d{1,2}h(?:\d{2})?\b|\b\d{1,2}:\d{2}\b/giu;
const NUMBER = /\d[\d.,]*\d|\d/g;

/** Las cifras de un texto, sin separadores («1.500» y «1,500» son la misma). */
export function numbersIn(text: string): string[] {
  return (text.replace(TIME_OF_DAY, ' ').match(NUMBER) ?? []).map((n) => n.replace(/\D/g, ''));
}

/** Una cifra que se pierde importa si es grande o un porcentaje (no «2 horarios»). */
function isKeyNumber(raw: string, text: string): boolean {
  return raw.length >= 3 || new RegExp(`${raw}\\s*%`).test(text.replace(/[.,]/g, ''));
}

/** Palabras de un texto (sin importar el verificador del redactor: esto también lo usa la tarjeta). */
function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Cuánto más largo puede salir un texto adaptado antes de avisar. */
const MAX_LENGTH_RATIO = 1.5;
const LENGTH_SLACK_WORDS = 6;

/** Palabras de 3 letras o más, sin tildes ni mayúsculas (para comparar dos textos). */
function contentWords(text: string): string[] {
  return (text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/\p{L}{3,}/gu) ?? []);
}

/** Un texto «adaptado» que repite casi todas las palabras del español (Coca-Cola, banco 20-10). */
const UNTRANSLATED_SHARE = 0.75;
const UNTRANSLATED_MIN_WORDS = 6;

export function looksUntranslated(source: string, translated: string): boolean {
  const words = contentWords(source);
  if (words.length < UNTRANSLATED_MIN_WORDS) return false;
  const kept = new Set(contentWords(translated));
  return words.filter((w) => kept.has(w)).length / words.length >= UNTRANSLATED_SHARE;
}

/** Problemas de la versión adaptada, en palabras para el vendedor. Vacío = sirve. */
export function verifyTranslation(
  segments: readonly TranslationSegment[],
  translated: ReadonlyMap<string, string>,
  language: LocalLanguage,
): string[] {
  const issues: string[] = [];
  const name = LOCAL_LANGUAGE_LABELS[language].toLowerCase();
  for (const segment of segments) {
    const text = translated.get(segment.id);
    if (!text) {
      issues.push(`Falta ${segment.label} en ${name}.`);
      continue;
    }
    const source = new Set(numbersIn(segment.text));
    const invented = numbersIn(text).filter((n) => !source.has(n));
    if (invented.length > 0) issues.push(`En ${name}, ${segment.label} trae cifras que no están en español (${[...new Set(invented)].join(', ')}).`);
    const kept = new Set(numbersIn(text));
    const lost = numbersIn(segment.text).filter((n) => !kept.has(n) && isKeyNumber(n, segment.text));
    if (lost.length > 0) issues.push(`En ${name}, ${segment.label} perdió cifras de la versión en español (${[...new Set(lost)].join(', ')}).`);
    if (looksUntranslated(segment.text, text)) issues.push(`En ${name}, ${segment.label} quedó en español.`);
    if (countWords(text) > countWords(segment.text) * MAX_LENGTH_RATIO + LENGTH_SLACK_WORDS) {
      issues.push(`En ${name}, ${segment.label} quedó mucho más largo que en español.`);
    }
  }
  return issues;
}

/** Arma la versión en el idioma del país; lo que falte queda vacío (y el verificador ya avisó). */
export function buildLocalVersion(
  content: FirstCallPackContent,
  translated: ReadonlyMap<string, string>,
  language: LocalLanguage,
): LocalPackVersion {
  const get = (id: string) => translated.get(id) ?? '';
  const optional = (id: string, source: string | undefined) => (source && translated.get(id) ? translated.get(id) : undefined);
  return {
    language,
    callScript: content.callScript.text ? get('script') : '',
    shortMessage: content.shortMessage.text ? get('message') : '',
    variants: (content.variants ?? []).map((v, i) => ({
      approach: v.approach,
      text: get(`variant${i + 1}`),
      ...(v.voicemail && translated.get(`variant${i + 1}_voicemail`) ? { voicemail: get(`variant${i + 1}_voicemail`) } : {}),
    })),
    ...(optional('meeting', content.meetingAsk) ? { meetingAsk: get('meeting') } : {}),
    ...(optional('if_no', content.ifNo) ? { ifNo: get('if_no') } : {}),
    ...(optional('confirmation', content.confirmation) ? { confirmation: get('confirmation') } : {}),
    // En el mismo orden que en español (un texto que falte queda vacío y se muestra en español).
    questions: content.questions.map((_, i) => get(`question${i + 1}`)),
    objections: content.objections.map((_, i) => ({ objection: get(`objection${i + 1}`), response: get(`response${i + 1}`) })),
  };
}

/**
 * La preparación como se ve en el idioma del país: lo que se dice o se envía cambia; las
 * notas para el vendedor (motivo, ángulo, cuidados, siguiente paso) siguen en español.
 * Un texto que no se adaptó queda en español en vez de quedar vacío.
 */
export function localizedContent(content: FirstCallPackContent): FirstCallPackContent {
  const local = content.localVersion;
  if (!local) return content;
  const or = (translated: string | undefined, original: string) => (translated && translated.trim() ? translated : original);
  return {
    ...content,
    callScript: { ...content.callScript, text: or(local.callScript, content.callScript.text) },
    shortMessage: { ...content.shortMessage, text: or(local.shortMessage, content.shortMessage.text) },
    variants: (content.variants ?? []).map((v) => {
      const lv = local.variants.find((x) => x.approach === v.approach);
      return { ...v, text: or(lv?.text, v.text), ...(v.voicemail ? { voicemail: or(lv?.voicemail, v.voicemail) } : {}) };
    }),
    meetingAsk: content.meetingAsk ? or(local.meetingAsk, content.meetingAsk) : content.meetingAsk,
    ifNo: content.ifNo ? or(local.ifNo, content.ifNo) : content.ifNo,
    confirmation: content.confirmation ? or(local.confirmation, content.confirmation) : content.confirmation,
    questions: content.questions.map((q, i) => or(local.questions[i], q)),
    objections: content.objections.map((o, i) => ({
      ...o,
      objection: or(local.objections[i]?.objection, o.objection),
      response: or(local.objections[i]?.response, o.response),
    })),
  };
}
