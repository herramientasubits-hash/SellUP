/**
 * Agente 3 · Primer contacto — enfoques para abrir, horarios y resultados (puro).
 *
 * Sale del «Manual del primer contacto» (investigación del 17-10-2026): cada enfoque
 * tiene para quién sirve, la regla que sigue el redactor y su riesgo. El objetivo de
 * todos es el mismo: conseguir la primera reunión.
 */

import type { FirstCallChannel } from './types';

export type FirstContactApproach =
  | 'trigger'
  | 'problem'
  | 'insight'
  | 'value_first'
  | 'permission'
  | 'referral'
  | 'peers'
  | 'who_decides';

export const FIRST_CONTACT_APPROACHES: readonly FirstContactApproach[] = [
  'trigger',
  'problem',
  'insight',
  'value_first',
  'permission',
  'referral',
  'peers',
  'who_decides',
];

export interface ApproachDefinition {
  label: string;
  /** Para quién y por dónde, en una línea (lo ve el vendedor). */
  bestFor: string;
  /** Lo que el redactor tiene que hacer con este enfoque. */
  rule: string;
  /** Si no se puede ofrecer todavía, por qué (se muestra apagado). */
  unavailableReason?: string;
}

export const APPROACH_DEFINITIONS: Readonly<Record<FirstContactApproach, ApproachDefinition>> = {
  trigger: {
    label: 'Por un evento reciente',
    bestFor: 'Todos los cargos. Lo más efectivo cuando hay una noticia de los últimos 90 días.',
    rule:
      'Abre con un hecho público y reciente de la ficha (con fecha, de los últimos 90 días): fusión, líder nuevo, aperturas, vacantes. Dilo como algo relevante para ella («en procesos así suele pasar…»), no para demostrar cuánto sabes.',
  },
  problem: {
    label: 'Por el problema',
    bestFor: 'Directores y gerentes que viven el problema. Llamada y correo.',
    rule:
      'Nombra un problema probable con una pregunta neutral, sin vender («los equipos de talento suelen tardar meses en…; ¿cómo lo están viviendo ustedes?»). Siempre como pregunta, nunca como afirmación sobre la empresa.',
  },
  insight: {
    label: 'Con un dato',
    bestFor: 'CHRO y CEO. Correo y LinkedIn.',
    rule:
      'Abre con un dato de la industria de la biblioteca (con su fuente) que cambie cómo ve su problema y conéctalo con su momento. Ofrece compartir lo que se ve en su sector, no una reunión.',
  },
  value_first: {
    label: 'Dar valor primero',
    bestFor: 'Gerentes de formación. Correo y LinkedIn.',
    rule:
      'Ofrece algo útil de la lista de ofertas de UBITS sin pedir nada a cambio, y pregunta si le sirve. Nunca ofrezcas algo que no esté en esa lista.',
  },
  permission: {
    label: 'Directo y con permiso',
    bestFor: 'Ejecutivos con poco tiempo. Llamada (y la única forma en Perú).',
    rule:
      'Di quién eres, reconoce que el contacto es inesperado y pide permiso para explicar el motivo en 30 segundos («¿me regala 30 segundos y usted decide si seguimos?»). Nada de «¿lo agarro en mal momento?».',
  },
  referral: {
    label: 'Por referencia',
    bestFor: 'Todos. El más fuerte en Latinoamérica, sólo si la referencia es real.',
    rule:
      'Menciona a la persona que sugirió el contacto, tal como la escribió el vendedor, y por qué. No inventes ni amplíes la referencia.',
  },
  peers: {
    label: 'Pares del sector',
    bestFor: 'Compradores cautos (bancos, gobierno).',
    rule: 'Cuenta qué hicieron empresas parecidas, sólo con clientes de la lista aprobada.',
    unavailableReason: 'Falta la lista de clientes que autorizan ser nombrados.',
  },
  who_decides: {
    label: 'Pedir a quién dirigirse',
    bestFor: 'CEO o cuando no hay decisor claro. Correo.',
    rule:
      'Mensaje corto, uno o dos niveles arriba, sólo para pedir que te refiera a quien lleva la formación y el talento. Sin vender.',
  },
};

/** Opción «que elija el agente» en el asistente. */
export const RECOMMENDED_APPROACH = 'recommended';

/** Cuántos enfoques como máximo por preparación (cada uno es una versión del mensaje). */
export const MAX_APPROACHES = 3;

export function isApproachAvailable(approach: FirstContactApproach): boolean {
  return !APPROACH_DEFINITIONS[approach].unavailableReason;
}

/**
 * El enfoque que recomienda el manual según el cargo, si hay señal reciente y si hay
 * decisor. Lo usa el redactor cuando el vendedor deja que el agente elija.
 */
export function recommendApproach(input: {
  title: string | null;
  hasRecentSignal: boolean;
  hasDecisionMaker: boolean;
  countryCode: string | null;
}): FirstContactApproach {
  if (input.countryCode?.toUpperCase() === 'PE') return 'permission';
  if (!input.hasDecisionMaker) return 'who_decides';
  if (input.hasRecentSignal) return 'trigger';
  const title = (input.title ?? '').toLowerCase();
  if (/\b(ceo|chro|presidente|gerente general|director general|vicepresident|vp\b|country manager)/.test(title)) return 'insight';
  return 'problem';
}

/**
 * «Todos» (el vendedor no eligió): el recomendado primero y luego una versión con
 * cada enfoque que aplique, para comparar y elegir en la tarjeta (dueña 18-10).
 * Fuera: los apagados, «Por referencia» sin referencia y «Por un evento reciente»
 * sin una noticia de los últimos 90 días. En Perú sólo el directo con permiso.
 */
export function allApplicableApproaches(
  recommended: FirstContactApproach,
  options: { hasRecentSignal: boolean; hasReferral: boolean; countryCode: string | null },
): FirstContactApproach[] {
  if (options.countryCode?.toUpperCase() === 'PE') return ['permission'];
  const others = FIRST_CONTACT_APPROACHES.filter(
    (a) =>
      a !== recommended &&
      isApproachAvailable(a) &&
      (a !== 'referral' || options.hasReferral) &&
      (a !== 'trigger' || options.hasRecentSignal),
  );
  return [recommended, ...others];
}

// ── Cuándo contactar (hora local) ─────────────────────────────────────────────

const COUNTRY_CLOCK: Readonly<Record<string, string>> = {
  CO: 'Colombia',
  MX: 'Ciudad de México',
  PE: 'Perú',
  CL: 'Chile',
  EC: 'Ecuador',
  AR: 'Argentina',
  BO: 'Bolivia',
  PY: 'Paraguay',
  UY: 'Uruguay',
  VE: 'Venezuela',
  CR: 'Costa Rica',
  PA: 'Panamá',
  GT: 'Guatemala',
  HN: 'Honduras',
  SV: 'El Salvador',
  NI: 'Nicaragua',
  DO: 'República Dominicana',
  ES: 'España',
  US: 'la zona del contacto',
  BR: 'Brasil',
};

/**
 * Cuándo conviene contactar: las franjas con más conversación (10–11 y 14–15, Cognism
 * 2025) en la hora del país, dentro del límite legal más estricto de la región (Colombia,
 * Ley 2300: L–V 7:00–19:00, sábados 8:00–15:00, nunca domingos ni festivos).
 */
export function bestContactWindow(countryCode: string | null, channel: FirstCallChannel): string {
  const clock = COUNTRY_CLOCK[countryCode?.toUpperCase() ?? ''] ?? 'el país del contacto';
  const prime = channel === 'call' ? 'Llamar de 10:00 a 11:00 o de 14:00 a 15:00' : 'Enviar entre 8:00 y 10:00';
  return `${prime}, hora de ${clock}, de lunes a jueves. Nunca fuera de lunes a viernes 7:00–19:00 o sábados 8:00–15:00, ni domingos o festivos.`;
}

// ── Resultado del contacto (lo marca el vendedor) ─────────────────────────────

export type FirstContactOutcome = 'meeting_booked' | 'interested' | 'not_now' | 'wrong_person' | 'no_answer';

export const FIRST_CONTACT_OUTCOMES: readonly FirstContactOutcome[] = [
  'meeting_booked',
  'interested',
  'not_now',
  'wrong_person',
  'no_answer',
];

export const FIRST_CONTACT_OUTCOME_LABELS: Readonly<Record<FirstContactOutcome, string>> = {
  meeting_booked: 'Reunión agendada',
  interested: 'Interesado, sin fecha',
  not_now: 'No por ahora',
  wrong_person: 'No es la persona',
  no_answer: 'No respondió',
};
