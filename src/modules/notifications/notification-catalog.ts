// ============================================================
// Avisos de Slack configurables (dueña 11-11) — catálogo y reglas (puro).
// Cada aviso que manda el bot de SellUp tiene una clave, a qué roles aplica y
// su valor por defecto por rol. En Configuración se cambia por rol o por
// persona; la regla de la persona gana sobre la de su rol (tabla 165
// `slack_notification_settings`). La campanita de SellUp no cambia: esto sólo
// decide si también llega por Slack.
// ============================================================

export const ROLE_KEYS = ['admin', 'commercial_manager', 'commercial_lead', 'seller_bd', 'growth'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export type NotificationKey =
  | 'assignments'
  | 'credit_requests'
  | 'credit_decisions'
  | 'run_finished'
  | 'cost_alerts'
  | 'provider_blocked'
  | 'daily_reminder'
  | 'bulletin_daily'
  | 'bulletin_weekly'
  | 'bulletin_monthly'
  | 'bulletin_quarterly';

export type BulletinFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';

export interface NotificationDefinition {
  key: NotificationKey;
  group: 'avisos' | 'alertas' | 'boletin';
  label: string;
  description: string;
  /** Roles a los que puede llegar (los demás no lo ven en la configuración). */
  roles: readonly RoleKey[];
  /** Encendido por defecto para estos roles (sin regla guardada). */
  defaultOn: readonly RoleKey[];
}

const ALL: readonly RoleKey[] = ROLE_KEYS;
const LEADERS: readonly RoleKey[] = ['admin', 'commercial_manager', 'commercial_lead'];

export const NOTIFICATION_CATALOG: readonly NotificationDefinition[] = [
  {
    key: 'assignments',
    group: 'avisos',
    label: 'Te asignaron empresas o prospectos',
    description: 'Cuando alguien te asigna empresas o prospectos de «Por revisar».',
    roles: ALL,
    defaultOn: ALL,
  },
  {
    key: 'credit_requests',
    group: 'avisos',
    label: 'Solicitudes de créditos para aprobar',
    description: 'A quien aprueba una regla de presupuesto, con botones para dar los créditos o rechazar.',
    roles: ALL,
    defaultOn: ALL,
  },
  {
    key: 'credit_decisions',
    group: 'avisos',
    label: 'Respuesta a tu solicitud de créditos',
    description: 'Cuando pides más créditos y cuando deciden tu solicitud.',
    roles: ALL,
    defaultOn: ALL,
  },
  {
    key: 'run_finished',
    group: 'avisos',
    label: 'Tu búsqueda terminó',
    description: 'Cuando termina (o falla) una búsqueda de empresas o de contactos que lanzaste.',
    roles: ALL,
    defaultOn: ALL,
  },
  {
    key: 'daily_reminder',
    group: 'avisos',
    label: 'Recordatorio diario de pendientes',
    description: 'De lunes a viernes a las 8:15 a. m.: cuántas empresas tienes por revisar y las más antiguas.',
    roles: ['commercial_manager', 'commercial_lead', 'seller_bd', 'growth'],
    defaultOn: [],
  },
  {
    key: 'cost_alerts',
    group: 'alertas',
    label: 'Consumo de proveedores (80 % y 100 %)',
    description: 'Cuando un proveedor pasa el 80 % o llega al 100 % de su cuota del mes, con el día proyectado de agotamiento.',
    roles: ['admin'],
    defaultOn: ['admin'],
  },
  {
    key: 'provider_blocked',
    group: 'alertas',
    label: 'Proveedor sin créditos o con la llave rechazada',
    description: 'En el momento en que un proveedor deja de responder por saldo o por la conexión.',
    roles: ['admin'],
    defaultOn: ['admin'],
  },
  {
    key: 'bulletin_daily',
    group: 'boletin',
    label: 'Boletín diario',
    description: 'Cada mañana (lun–vie): lo que pasó ayer en tu equipo y sus equipos.',
    roles: ALL,
    defaultOn: [],
  },
  {
    key: 'bulletin_weekly',
    group: 'boletin',
    label: 'Boletín semanal',
    description: 'Los lunes: la semana anterior de tu equipo, comparada con la semana previa.',
    roles: ALL,
    defaultOn: LEADERS,
  },
  {
    key: 'bulletin_monthly',
    group: 'boletin',
    label: 'Boletín mensual',
    description: 'El primer día del mes: el mes anterior, comparado con el previo.',
    roles: ALL,
    defaultOn: [],
  },
  {
    key: 'bulletin_quarterly',
    group: 'boletin',
    label: 'Boletín trimestral',
    description: 'El primer día de cada trimestre: el trimestre anterior, comparado con el previo.',
    roles: ALL,
    defaultOn: [],
  },
];

export const BULLETIN_KEY_BY_FREQUENCY: Readonly<Record<BulletinFrequency, NotificationKey>> = {
  daily: 'bulletin_daily',
  weekly: 'bulletin_weekly',
  monthly: 'bulletin_monthly',
  quarterly: 'bulletin_quarterly',
};

export interface NotificationSettingRow {
  scope_type: 'role' | 'user';
  scope_id: string;
  notification_key: string;
  enabled: boolean;
}

export function notificationDefinition(key: string): NotificationDefinition | null {
  return NOTIFICATION_CATALOG.find((d) => d.key === key) ?? null;
}

function asRole(roleKey: string | null | undefined): RoleKey | null {
  return (ROLE_KEYS as readonly string[]).includes(roleKey ?? '') ? (roleKey as RoleKey) : null;
}

/** Valor por defecto para un rol (sin reglas guardadas). */
export function defaultEnabled(key: NotificationKey, roleKey: string | null): boolean {
  const def = notificationDefinition(key);
  const role = asRole(roleKey);
  return Boolean(def && role && def.defaultOn.includes(role));
}

export function appliesToRole(key: NotificationKey, roleKey: string | null): boolean {
  const def = notificationDefinition(key);
  const role = asRole(roleKey);
  return Boolean(def && role && def.roles.includes(role));
}

/** Lo que vale para el ROL: su regla guardada o el valor por defecto. */
export function roleEnabled(key: NotificationKey, roleKey: string | null, rows: readonly NotificationSettingRow[]): boolean {
  if (!appliesToRole(key, roleKey)) return false;
  const row = rows.find((r) => r.scope_type === 'role' && r.scope_id === roleKey && r.notification_key === key);
  return row ? row.enabled : defaultEnabled(key, roleKey);
}

/**
 * ¿Le llega a esta persona? Su regla personal gana; si no tiene, la de su rol;
 * si no hay, el valor por defecto. Un aviso que no aplica a su rol nunca llega.
 */
export function isNotificationEnabled(
  key: NotificationKey,
  person: { userId: string; roleKey: string | null },
  rows: readonly NotificationSettingRow[],
): boolean {
  if (!appliesToRole(key, person.roleKey)) return false;
  const own = rows.find((r) => r.scope_type === 'user' && r.scope_id === person.userId && r.notification_key === key);
  return own ? own.enabled : roleEnabled(key, person.roleKey, rows);
}

/** De dónde sale el valor (para mostrarlo en Configuración). */
export function notificationSource(
  key: NotificationKey,
  person: { userId: string; roleKey: string | null },
  rows: readonly NotificationSettingRow[],
): 'personal' | 'rol' | 'por_defecto' | 'no_aplica' {
  if (!appliesToRole(key, person.roleKey)) return 'no_aplica';
  if (rows.some((r) => r.scope_type === 'user' && r.scope_id === person.userId && r.notification_key === key)) return 'personal';
  if (rows.some((r) => r.scope_type === 'role' && r.scope_id === person.roleKey && r.notification_key === key)) return 'rol';
  return 'por_defecto';
}
