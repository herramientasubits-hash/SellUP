import { formatAppDateTime } from '@/lib/format-date';

/**
 * Notas de etapa (puro): cuando una persona mueve una empresa de etapa pegando
 * lo que pasó, o sin acción con un motivo, ese contexto se ANEXA a
 * `accounts.notes` con una cabecera reconocible. Nunca se borra lo anterior.
 *
 *   [Inteligencia de cuenta · Lista para investigar · 2 oct 2026, 9:05 a. m. · Ana Pérez]
 *   Lo que la persona pegó.
 *
 * La fecha va en la zona de la aplicación (America/Bogota).
 */

/** Lo mínimo que tiene que tener un texto de contexto para que diga algo. */
export const STAGE_NOTE_MIN_LENGTH = 10;
/** Lo máximo que se guarda de una vez. */
export const STAGE_NOTE_MAX_LENGTH = 5000;

export type StageNoteKind = 'paste' | 'none';

export interface StageNoteEntry {
  kind: StageNoteKind;
  /** Lo que pegó la persona, o el motivo de mover sin acción. */
  text: string;
  /** El nombre de la etapa destino: «Inteligencia de cuenta». */
  stageName: string;
  /** El estado destino: «Lista para investigar». */
  statusLabel: string;
  at: Date;
  author: string | null;
}

/** El texto limpio y si alcanza el mínimo. */
export function normalizeStageNoteText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim().slice(0, STAGE_NOTE_MAX_LENGTH);
}

export function isStageNoteTextValid(text: string): boolean {
  return normalizeStageNoteText(text).length >= STAGE_NOTE_MIN_LENGTH;
}

export function formatStageNoteHeader(entry: Pick<StageNoteEntry, 'stageName' | 'statusLabel' | 'at' | 'author'>): string {
  const parts = [entry.stageName, entry.statusLabel, formatAppDateTime(entry.at)];
  if (entry.author && entry.author.trim()) parts.push(entry.author.trim());
  return `[${parts.join(' · ')}]`;
}

export function formatStageNoteBlock(entry: StageNoteEntry): string {
  const text = normalizeStageNoteText(entry.text);
  const body = entry.kind === 'none' ? `Movida sin acción. Motivo: ${text}` : text;
  return `${formatStageNoteHeader(entry)}\n${body}`;
}

/** Las notas de antes, intactas, con el bloque nuevo al final. */
export function appendStageNote(previous: string | null | undefined, entry: StageNoteEntry): string {
  const block = formatStageNoteBlock(entry);
  const prior = (previous ?? '').trimEnd();
  return prior ? `${prior}\n\n${block}` : block;
}

const HEADER_LINE = /^\[[^\]\n]+\]$/;

/** La última nota de etapa de las notas de la empresa (cabecera sin corchetes + cuerpo), o `null`. */
export function latestStageNote(notes: string | null | undefined): { header: string; body: string } | null {
  if (!notes) return null;
  const lines = notes.replace(/\r\n/g, '\n').split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (HEADER_LINE.test(lines[index].trim())) {
      const body = lines.slice(index + 1).join('\n').trim();
      return { header: lines[index].trim().slice(1, -1), body };
    }
  }
  return null;
}
