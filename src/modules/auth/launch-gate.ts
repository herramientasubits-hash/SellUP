/**
 * LAUNCH-GATE-2026-11 — ingreso cerrado hasta el lanzamiento (decisión de la dueña, 05-11-2026).
 *
 * Mientras la puerta está puesta sólo entran las cuentas de la lista (egarcia, brcastro y fpico,
 * este último agregado por la dueña el 05-11). El resto
 * ve un aviso en el login:
 *   · Líderes (y managers) comerciales: cuenta regresiva hasta su apertura (miércoles 11-11,
 *     8:00 a. m. Bogotá). Al llegar a cero, entran solos.
 *   · Todos los demás (vendedores, Growth, otros admins): «hasta la reunión de lanzamiento
 *     interno». Se abre para ellos quitando la puerta (`SELLUP_LAUNCH_GATE=off` en Vercel).
 *
 * Entorno (Vercel): `SELLUP_LAUNCH_GATE` (`off` la quita), `SELLUP_LAUNCH_GATE_ALLOW` (correos
 * extra, separados por coma), `SELLUP_LAUNCH_LEADERS_AT` (fecha ISO de apertura de líderes).
 *
 * Lógica pura salvo `readLaunchGateConfig`, que lee `process.env`.
 */

export const LAUNCH_GATE_ENV = 'SELLUP_LAUNCH_GATE';
export const LAUNCH_GATE_ALLOW_ENV = 'SELLUP_LAUNCH_GATE_ALLOW';
export const LAUNCH_LEADERS_AT_ENV = 'SELLUP_LAUNCH_LEADERS_AT';

/** Siempre entran mientras la puerta está puesta. */
export const LAUNCH_GATE_ALWAYS_ALLOWED = ['egarcia@ubits.co', 'brcastro@ubits.co', 'fpico@ubits.co'] as const;

/** Miércoles 11-11-2026, 8:00 a. m. en Bogotá (UTC-5). */
export const DEFAULT_LEADERS_OPEN_AT = '2026-11-11T13:00:00.000Z';

/** Roles que ven la cuenta regresiva y entran cuando llega a cero. */
export const LAUNCH_LEADER_ROLE_KEYS: ReadonlySet<string> = new Set(['commercial_lead', 'commercial_manager']);

export type LaunchAudience = 'leaders' | 'team';

export interface LaunchGateConfig {
  enabled: boolean;
  allowedEmails: ReadonlySet<string>;
  leadersOpenAt: string;
}

export type LaunchGateDecision =
  | { allowed: true }
  | { allowed: false; audience: LaunchAudience };

export function parseLaunchGateConfig(env: Readonly<Record<string, string | undefined>>): LaunchGateConfig {
  const enabled = env[LAUNCH_GATE_ENV]?.trim().toLowerCase() !== 'off';
  const extra = (env[LAUNCH_GATE_ALLOW_ENV] ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));
  const rawLeadersAt = env[LAUNCH_LEADERS_AT_ENV]?.trim();
  const leadersMs = rawLeadersAt ? Date.parse(rawLeadersAt) : Number.NaN;
  return {
    enabled,
    allowedEmails: new Set([...LAUNCH_GATE_ALWAYS_ALLOWED, ...extra]),
    leadersOpenAt: Number.isNaN(leadersMs) ? DEFAULT_LEADERS_OPEN_AT : new Date(leadersMs).toISOString(),
  };
}

export function readLaunchGateConfig(): LaunchGateConfig {
  return parseLaunchGateConfig(process.env);
}

export function audienceForRole(roleKey: string | null | undefined): LaunchAudience {
  return roleKey && LAUNCH_LEADER_ROLE_KEYS.has(roleKey) ? 'leaders' : 'team';
}

export function leadersAreOpen(config: LaunchGateConfig, now: Date): boolean {
  return now.getTime() >= Date.parse(config.leadersOpenAt);
}

/**
 * ¿Entra esta persona? `roleKey` desconocido (`undefined`) = todavía no se sabe el rol: se decide
 * sólo con lo que se sabe (antes de la apertura de líderes, nadie fuera de la lista entra).
 */
export function evaluateLaunchGate(input: {
  config: LaunchGateConfig;
  email: string | null | undefined;
  roleKey?: string | null;
  now: Date;
}): LaunchGateDecision {
  const { config, email, roleKey, now } = input;
  if (!config.enabled) return { allowed: true };
  if (email && config.allowedEmails.has(email.trim().toLowerCase())) return { allowed: true };
  const audience = audienceForRole(roleKey);
  if (audience === 'leaders' && leadersAreOpen(config, now)) return { allowed: true };
  return { allowed: false, audience };
}

/**
 * Para el proxy, que sólo conoce el correo: `true` cuando YA se sabe que la persona no entra
 * (antes de la apertura de líderes nadie fuera de la lista entra, sea cual sea su rol). Después
 * de la apertura el rol importa y decide el layout de la app.
 */
export function isBlockedRegardlessOfRole(config: LaunchGateConfig, email: string | null | undefined, now: Date): boolean {
  if (!config.enabled) return false;
  if (email && config.allowedEmails.has(email.trim().toLowerCase())) return false;
  return !leadersAreOpen(config, now);
}

export function parseLaunchAudience(raw: string | null | undefined): LaunchAudience | null {
  return raw === 'leaders' || raw === 'team' ? raw : null;
}
