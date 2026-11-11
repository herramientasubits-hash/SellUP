// ============================================================
// Guía de uso — buscar la ficha que responde una pregunta (puro).
// El asistente responde SÓLO con estas fichas; si no hay ficha, lo dice.
// ============================================================

import type { HelpRole, HelpTopic } from './types';

export interface HelpAnswer {
  encontrada: boolean;
  fichas: Array<{
    titulo: string;
    disponibleParaTi: boolean;
    /** `false` si algún interruptor de la función está apagado en este entorno. */
    activa: boolean;
    contenido: string;
    limites: string | null;
    enlace: string | null;
  }>;
  /** Otros temas que la guía sí cubre (para ofrecerlos). */
  temasDisponibles: string[];
  nota: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(['como', 'que', 'para', 'por', 'los', 'las', 'del', 'una', 'uno', 'con', 'puedo', 'hago', 'hacer', 'donde', 'cual', 'cuales', 'sellup', 'mis', 'mi', 'se', 'de', 'la', 'el', 'en', 'y', 'o', 'a', 'un', 'es', 'lo', 'le']);

/** Puntaje de una ficha para la consulta: clave exacta > palabras clave > título. */
export function scoreTopic(topic: HelpTopic, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  if (q === topic.key || q === normalize(topic.titulo)) return 100;
  const words = q.split(' ').filter((w) => w.length > 2 && !STOPWORDS.has(w));
  let score = 0;
  for (const keyword of topic.palabrasClave.map(normalize)) {
    if (q.includes(keyword)) score += keyword.includes(' ') ? 6 : 4;
    else if (words.some((w) => keyword.split(' ').some((k) => k.startsWith(w) || w.startsWith(k)))) score += 1;
  }
  const title = normalize(topic.titulo);
  for (const w of words) if (title.includes(w)) score += 2;
  return score;
}

/** Todos sus interruptores encendidos (exactamente `true`, como en feature-flags.server.ts). */
export function isTopicActive(topic: HelpTopic, env: Readonly<Record<string, string | undefined>>): boolean {
  return (topic.requiere ?? []).every((flag) => env[flag]?.trim().toLowerCase() === 'true');
}

export function canUseTopic(topic: HelpTopic, roleKey: string | null, isAdmin: boolean): boolean {
  if (topic.roles === 'todos' || isAdmin) return true;
  return roleKey !== null && (topic.roles as readonly string[]).includes(roleKey as HelpRole);
}

/** Las fichas que responden la consulta (máximo 2), marcadas según el rol. */
export function lookupHelp(
  topics: readonly HelpTopic[],
  query: string,
  context: { roleKey: string | null; isAdmin: boolean; appUrl: string; env?: Readonly<Record<string, string | undefined>> },
): HelpAnswer {
  const env = context.env ?? {};
  const ranked = topics
    .map((topic) => ({ topic, score: scoreTopic(topic, query) }))
    .filter((r) => r.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  const base = context.appUrl.replace(/\/+$/, '');
  return {
    encontrada: ranked.length > 0,
    fichas: ranked.map(({ topic }) => {
      const allowed = canUseTopic(topic, context.roleKey, context.isAdmin);
      const active = isTopicActive(topic, env);
      const usable = allowed && active;
      return {
        titulo: topic.titulo,
        disponibleParaTi: allowed,
        activa: active,
        // Sin rol o apagada no se dan los pasos: se dice por qué.
        contenido: !active
          ? 'Esta función todavía no está activa en SellUp. Un administrador puede encenderla cuando el equipo la necesite.'
          : allowed
            ? topic.contenido
            : `Esta función no está disponible para tu rol. La usan: ${rolesText(topic)}.`,
        limites: usable ? topic.limites ?? null : null,
        enlace: usable && topic.ruta ? `${base}${topic.ruta}` : null,
      };
    }),
    temasDisponibles: topics.filter((t) => canUseTopic(t, context.roleKey, context.isAdmin)).map((t) => t.titulo),
    nota:
      ranked.length > 0
        ? 'Responde SÓLO con lo que dicen estas fichas (pasos y nombres tal cual). No agregues pasos que no estén aquí.'
        : 'La guía no tiene este tema. Dilo así («eso no lo tengo documentado») y ofrece los temas disponibles; NO inventes pasos.',
  };
}

const ROLE_NAMES: Record<string, string> = {
  admin: 'administradores',
  commercial_lead: 'líderes comerciales',
  commercial_manager: 'managers comerciales',
  seller_bd: 'vendedores',
  growth: 'Growth',
};

function rolesText(topic: HelpTopic): string {
  return topic.roles === 'todos' ? 'todos los roles' : topic.roles.map((r) => ROLE_NAMES[r] ?? r).join(', ');
}
