// ============================================================
// Configuración › Avisos de Slack — tipos y ayudas puras de la pantalla.
// Las acciones de servidor llegan por props desde la página (así el cliente no
// importa el módulo 'use server' y las pruebas inyectan espías).
// ============================================================

import type { BulletinModel } from '@/modules/bulletin/bulletin-model';
import type { BulletinDeliveryRow } from '@/modules/bulletin/bulletin-send.server';
import {
  BULLETIN_KEY_BY_FREQUENCY,
  isNotificationEnabled,
  type BulletinFrequency,
  type NotificationSettingRow,
} from '@/modules/notifications/notification-catalog';
import type { NotificationSettingsData } from '@/modules/notifications/notification-settings-actions';

export type { BulletinDeliveryRow, NotificationSettingsData };

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export interface RuleInput {
  scopeType: 'role' | 'user';
  scopeId: string;
  notificationKey: string;
  enabled: boolean | null;
}

export interface BulletinRequest {
  userId: string;
  frequency: BulletinFrequency;
}

/** Vista previa: sin `day`, el que le llegaría hoy; con `day` (AAAA-MM-DD), el del período que la contiene. */
export interface BulletinPreviewRequest extends BulletinRequest {
  day?: string | null;
}

export interface NotificationSettingsActions {
  setNotificationSetting: (input: RuleInput) => Promise<ActionResult>;
  previewBulletin: (input: BulletinPreviewRequest) => Promise<ActionResult<BulletinModel>>;
  sendBulletinPreviewToMe: (input: BulletinRequest) => Promise<ActionResult>;
  getBulletinHistory: (userId?: string | null) => Promise<ActionResult<BulletinDeliveryRow[]>>;
  getBulletinDelivery: (id: string) => Promise<ActionResult<BulletinModel>>;
}

export const FREQUENCY_OPTIONS: ReadonlyArray<{ value: BulletinFrequency; label: string; when: string }> = [
  { value: 'daily', label: 'Diario', when: 'De lunes a viernes a las 8:15 a. m.' },
  { value: 'weekly', label: 'Semanal', when: 'Los lunes a las 8:15 a. m.' },
  { value: 'monthly', label: 'Mensual', when: 'El día 1 de cada mes' },
  { value: 'quarterly', label: 'Trimestral', when: 'El día 1 de cada trimestre' },
];

/** Las frecuencias de boletín que le llegan a esta persona (su regla, la de su rol o el valor por defecto). */
export function activeFrequencies(
  person: { id: string; roleKey: string | null },
  rows: readonly NotificationSettingRow[],
): BulletinFrequency[] {
  const who = { userId: person.id, roleKey: person.roleKey };
  return FREQUENCY_OPTIONS.map((o) => o.value).filter((f) => isNotificationEnabled(BULLETIN_KEY_BY_FREQUENCY[f], who, rows));
}

export function frequencyLabel(frequency: string): string {
  return FREQUENCY_OPTIONS.find((o) => o.value === frequency)?.label ?? frequency;
}

export const GROUP_LABEL: Readonly<Record<'avisos' | 'alertas' | 'boletin', { title: string; description: string }>> = {
  avisos: { title: 'Avisos', description: 'Lo que le pasa a cada persona en su trabajo diario.' },
  alertas: { title: 'Alertas', description: 'Consumo y estado de los proveedores (sólo administración).' },
  boletin: { title: 'Boletín', description: 'El resumen de su equipo y sus sub-equipos. Se pueden elegir varias frecuencias.' },
};

/** Las reglas con esta regla aplicada (sin tocar el arreglo original). `enabled: null` la quita. */
export function withRule(rows: readonly NotificationSettingRow[], input: RuleInput): NotificationSettingRow[] {
  const rest = rows.filter(
    (r) => !(r.scope_type === input.scopeType && r.scope_id === input.scopeId && r.notification_key === input.notificationKey),
  );
  if (input.enabled === null) return rest;
  return [...rest, { scope_type: input.scopeType, scope_id: input.scopeId, notification_key: input.notificationKey, enabled: input.enabled }];
}

/** La regla guardada (si existe) para ese alcance y aviso. */
export function findRule(rows: readonly NotificationSettingRow[], scopeType: 'role' | 'user', scopeId: string, key: string): NotificationSettingRow | null {
  return rows.find((r) => r.scope_type === scopeType && r.scope_id === scopeId && r.notification_key === key) ?? null;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «2026-11-03» → «3 nov 2026» (fecha de calendario, sin zona horaria). */
export function formatCalendarDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? ''} ${match[1]}`;
}

export function formatPeriod(start: string, end: string): string {
  return start === end ? formatCalendarDay(start) : `${formatCalendarDay(start)} – ${formatCalendarDay(end)}`;
}
