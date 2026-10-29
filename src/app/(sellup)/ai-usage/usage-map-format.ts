// «Mapa de uso»: colores (sólo tokens del sistema, como el mapa de Clima de UBITS),
// cifras y nombres de cada columna. Sin React, para probarlo.

import type { UsageMapDimension, UsageMapFormat, UsageMapTone } from '@/modules/ai-usage/usage-map';
import { NO_COUNTRY_KEY, NO_LEADER_KEY, NO_PERSON_KEY } from '@/modules/ai-usage/usage-map';
import { NO_GROUP_KEY, NO_ROLE_KEY } from '@/modules/ai-usage/usage-breakdowns';
import { countryLabel, formatCount, formatUsd } from './usage-labels';

/** Fondo y texto de cada tono: semáforo para «más es mejor», marca para el gasto. */
export const USAGE_MAP_TONE_CLASS: Record<UsageMapTone, string> = {
  'very-high': 'bg-success/35 text-success-foreground',
  high: 'bg-success/15 text-success-foreground',
  mid: 'bg-warning/30 text-warning-foreground',
  low: 'bg-destructive/15 text-destructive',
  'very-low': 'bg-destructive/35 text-destructive',
  'brand-1': 'bg-primary/10 text-primary',
  'brand-2': 'bg-primary/20 text-primary',
  'brand-3': 'bg-primary/30 text-primary',
  'brand-4': 'bg-primary/45 text-primary',
  none: 'bg-muted text-muted-foreground',
};

export const USAGE_MAP_DIMENSION_LABELS: Record<UsageMapDimension, { menu: string; title: string; plural: string }> = {
  rol: { menu: 'Por rol', title: 'por rol', plural: 'roles' },
  grupo: { menu: 'Por grupo', title: 'por grupo', plural: 'grupos' },
  pais: { menu: 'Por país', title: 'por país', plural: 'países' },
  persona: { menu: 'Por persona', title: 'por persona', plural: 'personas' },
  lider: { menu: 'Por líder', title: 'por líder', plural: 'líderes' },
};

export function formatUsageMapValue(value: number | null, format: UsageMapFormat): string {
  if (value === null) return '—';
  if (format === 'percent') return `${Math.round(value * 100)} %`;
  if (format === 'usd') return formatUsd(value);
  return formatCount(Math.round(value));
}

export interface UsageMapNames {
  roleLabels: Record<string, string>;
  groupNames: Record<string, string>;
  personNames: Record<string, string>;
}

/** El nombre legible de una columna. Lo que falta se dice con palabras. */
export function usageMapColumnLabel(dimension: UsageMapDimension, key: string, names: UsageMapNames): string {
  switch (dimension) {
    case 'rol':
      return key === NO_ROLE_KEY ? 'Sin rol' : (names.roleLabels[key] ?? key);
    case 'grupo':
      return key === NO_GROUP_KEY ? 'Sin grupo' : (names.groupNames[key] ?? 'Grupo eliminado');
    case 'pais':
      return key === NO_COUNTRY_KEY ? 'Sin país' : countryLabel(key);
    case 'persona':
      return key === NO_PERSON_KEY ? 'Sin persona (sistema)' : (names.personNames[key] ?? 'Persona sin nombre');
    case 'lider':
      return key === NO_LEADER_KEY ? 'Sin líder' : `Equipo de ${names.personNames[key] ?? 'líder sin nombre'}`;
  }
}

export const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;
const WEEKDAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;

/** «martes a las 10:00» — la hora con más consultas. `null` si no hubo ninguna. */
export function peakSlotLabel(weekHours: readonly (readonly number[])[]): string | null {
  let best = { day: -1, hour: -1, value: 0 };
  weekHours.forEach((hours, day) =>
    hours.forEach((value, hour) => {
      if (value > best.value) best = { day, hour, value };
    }),
  );
  if (best.day < 0) return null;
  return `${WEEKDAY_NAMES[best.day]} a las ${String(best.hour).padStart(2, '0')}:00`;
}
