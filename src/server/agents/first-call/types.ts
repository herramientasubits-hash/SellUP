/**
 * Agente 3 · Primera llamada — tipos compartidos (puro, apto para cliente y servidor).
 *
 * El agente investiga una empresa (ficha) y con eso prepara al vendedor para la
 * primera llamada (paquete). Cada dato de la ficha guarda su fuente; cada dato
 * del paquete apunta a un hecho de la ficha o a la biblioteca de UBITS.
 */

/** Versión del agente: se guarda en cada ficha y paquete para comparar resultados. */
export const AGENT3_VERSION = 'agent3-first-call-v1';

/** Clave del agente en `provider_usage_logs.agent_key` (Uso de IA). */
export const AGENT3_USAGE_AGENT_KEY = 'agent3';

/** Una ficha vale 30 días: otro decisor o canal no paga otra investigación. */
export const RESEARCH_BRIEF_TTL_DAYS = 30;

/** Las seis preguntas que la investigación intenta responder. */
export type ResearchTopic =
  | 'business'
  | 'size_presence'
  | 'recent_signal'
  | 'talent'
  | 'ubits_relation'
  | 'decision_maker';

export const RESEARCH_TOPICS: readonly ResearchTopic[] = [
  'business',
  'size_presence',
  'recent_signal',
  'talent',
  'ubits_relation',
  'decision_maker',
];

export const RESEARCH_TOPIC_LABELS: Readonly<Record<ResearchTopic, string>> = {
  business: 'Qué hace',
  size_presence: 'Tamaño y presencia',
  recent_signal: 'Qué le está pasando ahora',
  talent: 'Talento y formación',
  ubits_relation: 'Relación con UBITS',
  decision_maker: 'Decisor',
};

/**
 * De dónde sale un hecho:
 *  - `sellup`: un dato que SellUp ya tenía (tamaño oficial, catálogo, árbol, HubSpot, contacto).
 *  - `official_site`: el sitio oficial de la empresa, que descargamos nosotros.
 *  - `news`: una noticia (Tavily, modo noticias, último año).
 *  - `web_search`: una fuente que devolvió la búsqueda web de Claude.
 *  - `curated_list`: una lista curada (Merco, Great Place to Work, reguladores…).
 */
export type FactSourceKind = 'sellup' | 'official_site' | 'news' | 'web_search' | 'curated_list';

export interface ResearchFact {
  /** «F1», «F2»…: estable dentro de la ficha; el paquete cita estos IDs. */
  id: string;
  topic: ResearchTopic;
  /** El dato, en una frase corta en español. */
  statement: string;
  /** Frase literal de la fuente (idioma original). `null` en datos internos de SellUp. */
  quote: string | null;
  sourceKind: FactSourceKind;
  /** URL de la fuente, o `null` en datos internos. */
  sourceUrl: string | null;
  /** Nombre legible de la fuente («Sitio oficial», «Merco Talento 2025»…). */
  sourceLabel: string;
  /** Fecha de publicación (AAAA-MM-DD) si la fuente la da. */
  publishedOn: string | null;
}

export interface ResearchHypothesis {
  /** Qué dolor o necesidad podría tener, escrito como hipótesis. */
  text: string;
  /** Producto UBITS que conecta (clave de la biblioteca), o `null`. */
  productKey: string | null;
  /** Hechos que la sostienen. */
  factRefs: string[];
}

export type ResearchBriefStatus = 'running' | 'sufficient' | 'partial' | 'failed';

/** Etapas visibles mientras investiga (avance en vivo). */
export type ResearchProgressStage =
  | 'reading_sellup'
  | 'reading_site'
  | 'reading_news'
  | 'extracting'
  | 'writing'
  | 'done';

export const RESEARCH_PROGRESS_LABELS: Readonly<Record<ResearchProgressStage, string>> = {
  reading_sellup: 'Revisando lo que SellUp y HubSpot ya saben',
  reading_site: 'Leyendo el sitio oficial',
  reading_news: 'Buscando noticias del último año',
  extracting: 'Verificando cada dato contra su fuente',
  writing: 'Escribiendo la preparación de la llamada',
  done: 'Listo',
};

export interface ResearchSource {
  url: string;
  label: string;
  kind: FactSourceKind;
}

export interface ResearchBrief {
  id: string;
  accountId: string;
  status: ResearchBriefStatus;
  progressStage: ResearchProgressStage | null;
  summary: string | null;
  facts: ResearchFact[];
  hypotheses: ResearchHypothesis[];
  gaps: string[];
  sources: ResearchSource[];
  rejectedFacts: number;
  costUsd: number;
  model: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  errorCode: string | null;
}

// ── Paquete de primera llamada ───────────────────────────────────────────────

export type FirstCallChannel = 'call' | 'whatsapp' | 'email' | 'linkedin';

export const FIRST_CALL_CHANNELS: readonly FirstCallChannel[] = ['call', 'whatsapp', 'email', 'linkedin'];

export const FIRST_CALL_CHANNEL_LABELS: Readonly<Record<FirstCallChannel, string>> = {
  call: 'Llamada',
  whatsapp: 'WhatsApp',
  email: 'Correo',
  linkedin: 'LinkedIn',
};

export type FirstCallGoal = 'book_meeting' | 'open_conversation' | 'validate_owner';

export const FIRST_CALL_GOALS: readonly FirstCallGoal[] = ['book_meeting', 'open_conversation', 'validate_owner'];

export const FIRST_CALL_GOAL_LABELS: Readonly<Record<FirstCallGoal, string>> = {
  book_meeting: 'Conseguir una reunión',
  open_conversation: 'Abrir la conversación',
  validate_owner: 'Saber quién decide',
};

export interface PackTextWithRefs {
  text: string;
  factRefs: string[];
}

export interface PackObjection {
  objection: string;
  response: string;
  /** Clave de la objeción en la biblioteca, si la respuesta sale de ahí. */
  libraryKey: string | null;
}

export interface FirstCallPackContent {
  /** Producto de UBITS que el redactor eligió para este decisor (clave de la biblioteca). */
  productKey?: string | null;
  reasonToCall: PackTextWithRefs;
  angle: string;
  callScript: PackTextWithRefs;
  shortMessage: PackTextWithRefs;
  questions: string[];
  objections: PackObjection[];
  nextStep: string;
  cautions: string[];
}

export type FirstCallPackStatus = 'draft' | 'needs_review' | 'used' | 'discarded' | 'failed';

export interface FirstCallPack {
  id: string;
  accountId: string;
  briefId: string | null;
  contactId: string | null;
  targetName: string | null;
  targetTitle: string | null;
  channel: FirstCallChannel;
  goal: FirstCallGoal;
  productFocus: string | null;
  content: FirstCallPackContent | null;
  /** Los hechos con los que se escribió: sus IDs son los que cita el texto. */
  facts: ResearchFact[];
  status: FirstCallPackStatus;
  verifierIssues: string[];
  editedScript: string | null;
  regenerationReason: string | null;
  costUsd: number;
  model: string | null;
  createdAt: string;
  usedAt: string | null;
  discardedAt: string | null;
}

/** Topes de una corrida: cada decisor es una llamada al redactor. */
export const MAX_CONTACTS_PER_RUN = 5;

/**
 * Lo que pide el vendedor al preparar el primer contacto. Cascada:
 *  1. una investigación por empresa (se reutiliza 30 días);
 *  2. un ángulo por decisor (una llamada al redactor por decisor);
 *  3. dentro de esa llamada, un mensaje por canal elegido.
 * Cada decisor × canal queda como una preparación propia.
 */
export interface FirstCallRequest {
  accountId: string;
  /** Decisores elegidos; vacío = sin decisor (el guion pide averiguar quién decide). */
  contactIds: string[];
  /** Canales elegidos (al menos uno). */
  channels: FirstCallChannel[];
  goal: FirstCallGoal;
  /** Productos de UBITS en los que enfocarse; vacío = el que mejor conecte. */
  productKeys: string[];
  /** true = investigar de nuevo aunque haya una ficha vigente. */
  refreshResearch: boolean;
  /** Paquete que se regenera, y por qué. */
  regenerateFromPackId: string | null;
  regenerationReason: string | null;
}
