/**
 * El modelo de una conversación con el agente (Thema · `lib/chat/types`).
 *
 * Es independiente de quién responde. Lo que un mensaje puede traer (fuentes,
 * sugerencias, una pregunta con opciones, una tarjeta) es siempre lo mismo, y
 * de eso viven el panel, el hilo y los asistentes de SellUp.
 */

export type ChatRole = "user" | "agent";

/** De dónde sacó el agente lo que dice. */
export interface ChatSource {
  label: string;
  detail?: string;
}

/**
 * Una opción con más que su texto. Thema solo pide `string`; SellUp añade la
 * forma larga para las preguntas que explican cada opción o que tienen alguna
 * que todavía no se puede elegir.
 */
export interface ChatQuestionOptionDetail {
  /** Lo que se devuelve en `onAnswer` y lo que se compara con `answer`. */
  value: string;
  label: string;
  description?: string;
  /** Una nota a la derecha del texto («Próximamente»). */
  hint?: string;
  /** Se pinta apagada; al tocarla se avisa igual, para que quien la monta explique por qué. */
  unavailable?: boolean;
}

export type ChatQuestionOption = string | ChatQuestionOptionDetail;

/**
 * Una pregunta del agente con opciones numeradas. La persona elige una (con
 * el ratón o con la tecla del número) o escribe la suya en «Otro».
 */
export interface ChatQuestion {
  options: readonly ChatQuestionOption[];
  /** Placeholder de «Otro»; sin él no hay campo libre. */
  otherPlaceholder?: string;
  /** La respuesta que se dio, si ya se respondió. */
  answer?: string;
}

/** Una fila «rótulo · valor» de la tarjeta de detalle, con una línea de explicación opcional. */
export interface ChatCardRow {
  /** Identifica la fila; también nombra sus `data-testid` (`<prefijo>-row-<key>`). */
  key: string;
  label: string;
  value: string;
  hint?: string | null;
  /** `data-testid` propio del valor, cuando la fila ya tenía uno que otras piezas buscan. */
  testId?: string;
}

/**
 * Una tarjeta con datos dentro de la respuesta. `bars` y `metrics` son las de
 * Thema. `rows` es de SellUp: los resultados de una corrida son pares
 * «qué se contó · cuánto» con rótulos largos y una aclaración debajo, que no
 * caben en la rejilla de cifras grandes de `metrics`.
 */
export type ChatCard =
  | { kind: "bars"; title: string; rows: readonly { label: string; value: number; display?: string }[] }
  | {
      kind: "metrics";
      title?: string;
      items: readonly { label: string; value: string; delta?: string; tone?: "positive" | "negative" | "neutral" }[];
    }
  | { kind: "rows"; title?: string; rows: readonly ChatCardRow[] };

/** Un enlace que la respuesta ofrece («Ver el artículo completo»). */
export interface ChatLink {
  label: string;
  href: string;
}

export type ChatMessageStatus =
  /** El agente aún no ha contestado. */
  | "pending"
  /** La respuesta llegó y se está escribiendo en pantalla. */
  | "streaming"
  | "done"
  /** La persona la detuvo a medias. */
  | "stopped"
  | "error";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** Markdown ligero: negritas, listas, enlaces. */
  text: string;
  createdAt: number;
  status: ChatMessageStatus;
  sources?: readonly ChatSource[];
  /** Preguntas para seguir; se muestran solo en la última respuesta. */
  followups?: readonly string[];
  question?: ChatQuestion;
  card?: ChatCard;
  link?: ChatLink;
  /** Qué le pareció a la persona. */
  feedback?: "up" | "down";
  /** Quién respondió, para que el siguiente turno siga con el mismo. */
  via?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: readonly ChatMessage[];
  /** Llegó una respuesta mientras no se estaba mirando. */
  unread: boolean;
}

export interface ChatConnector {
  id: string;
  label: string;
  connected: boolean;
}

export interface ChatNews {
  /** «Ya ejecuta acciones en **Selección**.» El Markdown ligero vale. */
  text: string;
  onOpen?: () => void;
  onDismiss?: () => void;
}
