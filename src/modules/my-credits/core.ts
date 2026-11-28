/**
 * «Mis créditos» (menú de cuenta) — núcleo PURO que arma las filas que ve cada persona.
 *
 * Decisiones del dueño (27-nov-2026):
 *   · Si a la persona se le mide en una fuente, la ve (IA incluida). Si además tiene
 *     límite, ve consumo frente a límite, para calcular cuándo pedir más.
 *   · Las reglas solo en USD se muestran en USD, con barra.
 *   · Solo cuenta lo GASTADO: los créditos apartados mientras corre un revelado de
 *     teléfono (`reservedCredits`) no suman hasta que se gastan de verdad.
 *   · El mes es el que ya aplica el presupuesto (mes calendario en UTC, `periods.ts`).
 *
 * Sin I/O: las cifras llegan ya leídas (`checkBudget` + consumo propio).
 */

import type { BudgetOnExceed, BudgetPeriodType } from '@/modules/budgets/types';

export type MyCreditsUnit = 'credits' | 'usd';
export type MyCreditsTone = 'normal' | 'warning' | 'danger';
export type MyCreditsScope = 'user' | 'group' | 'role' | 'global';

/** Fuentes de contactos: van primero en el menú. */
export const MY_CREDITS_CONTACT_SOURCES: readonly string[] = ['lusha', 'apollo'];

/** Desde aquí la barra avisa (75 %). */
export const MY_CREDITS_WARNING_PERCENT = 75;

export interface MyCreditsRuleInput {
  scope: MyCreditsScope;
  periodType: BudgetPeriodType;
  /** Tope vigente en créditos (base + recargas + aprobado + saldo anterior). null = sin tope. */
  limitCredits: number | null;
  limitUsd: number | null;
  onExceed: BudgetOnExceed;
  /** Desglose del tope en créditos, si lo hay. */
  balance: { base: number; topUps: number; grantsForUser: number; carriedIn: number } | null;
  /** Lo gastado por el pozo de la regla en su período (sin reservas en curso). */
  poolCredits: number;
  poolUsd: number;
}

export interface MyCreditsProviderInput {
  providerKey: string;
  displayName: string;
  /** null ⇒ ninguna regla le aplica a la persona en esta fuente. */
  rule: MyCreditsRuleInput | null;
  /** Lo gastado por la persona misma (en el período de su regla, o en el mes). */
  own: { credits: number; usd: number; rows: number };
}

export interface MyCreditsRow {
  providerKey: string;
  displayName: string;
  unit: MyCreditsUnit;
  /** Consumo que se compara con el límite (el del pozo si es compartido). */
  used: number;
  /** null ⇒ sin límite: se muestra solo el consumo, sin barra. */
  limit: number | null;
  /** 0–100+ (puede pasar de 100). null sin límite. */
  percent: number | null;
  tone: MyCreditsTone;
  /** El límite es de un equipo/rol/toda la organización, no solo de la persona. */
  shared: boolean;
  /** Lo que gastó la persona, cuando el cupo es compartido. */
  ownUsed: number | null;
  exhausted: boolean;
  onExceed: BudgetOnExceed | null;
  periodType: BudgetPeriodType | null;
  /** Lo que se suma a la base: aprobado para la persona y saldo del mes anterior. */
  extras: { grantsForUser: number; carriedIn: number; topUps: number } | null;
}

export function toneForPercent(percent: number | null): MyCreditsTone {
  if (percent === null) return 'normal';
  if (percent >= 100) return 'danger';
  if (percent >= MY_CREDITS_WARNING_PERCENT) return 'warning';
  return 'normal';
}

function percentOf(used: number, limit: number): number {
  if (limit <= 0) return used > 0 || limit === 0 ? 100 : 0;
  return (used / limit) * 100;
}

function safe(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Una fila, o null si la fuente no se le mide a la persona. */
export function buildMyCreditsRow(input: MyCreditsProviderInput): MyCreditsRow | null {
  const { rule, own } = input;
  const base = { providerKey: input.providerKey, displayName: input.displayName || input.providerKey };

  if (rule && (rule.limitCredits !== null || rule.limitUsd !== null)) {
    const unit: MyCreditsUnit = rule.limitCredits !== null ? 'credits' : 'usd';
    const limit = Math.max(0, unit === 'credits' ? (rule.limitCredits as number) : (rule.limitUsd as number));
    const used = safe(unit === 'credits' ? rule.poolCredits : rule.poolUsd);
    const shared = rule.scope !== 'user';
    const percent = percentOf(used, limit);
    const b = unit === 'credits' ? rule.balance : null;
    return {
      ...base,
      unit,
      used,
      limit,
      percent,
      tone: toneForPercent(percent),
      shared,
      ownUsed: shared ? safe(unit === 'credits' ? own.credits : own.usd) : null,
      exhausted: used >= limit,
      onExceed: rule.onExceed,
      periodType: rule.periodType,
      extras: b ? { grantsForUser: safe(b.grantsForUser), carriedIn: safe(b.carriedIn), topUps: safe(b.topUps) } : null,
    };
  }

  // Sin límite: solo se muestra si la persona gastó algo en la fuente.
  if (own.rows <= 0) return null;
  const credits = safe(own.credits);
  const usd = safe(own.usd);
  const unit: MyCreditsUnit = credits === 0 && usd > 0 ? 'usd' : 'credits';
  return {
    ...base,
    unit,
    used: unit === 'credits' ? credits : usd,
    limit: null,
    percent: null,
    tone: 'normal',
    shared: false,
    ownUsed: null,
    exhausted: false,
    onExceed: rule?.onExceed ?? null,
    periodType: rule?.periodType ?? null,
    extras: null,
  };
}

function contactRank(key: string): number {
  const i = MY_CREDITS_CONTACT_SOURCES.indexOf(key);
  return i === -1 ? MY_CREDITS_CONTACT_SOURCES.length : i;
}

/** Primero Lusha y Apollo; luego de mayor a menor % usado; sin límite al final. */
export function sortMyCreditsRows(rows: MyCreditsRow[]): MyCreditsRow[] {
  return [...rows].sort((a, b) => {
    const r = contactRank(a.providerKey) - contactRank(b.providerKey);
    if (r !== 0) return r;
    const pa = a.percent ?? -1;
    const pb = b.percent ?? -1;
    if (pa !== pb) return pb - pa;
    return a.displayName.localeCompare(b.displayName, 'es');
  });
}

export function buildMyCreditsRows(inputs: MyCreditsProviderInput[]): MyCreditsRow[] {
  return sortMyCreditsRows(
    inputs.map(buildMyCreditsRow).filter((r): r is MyCreditsRow => r !== null),
  );
}

/** Suma créditos y USD gastados de filas de `provider_usage_logs` (NULL = 0, no se inventa). */
export function sumOwnUsage(
  rows: Array<{ creditsUsed: number | null; estimatedCostUsd: number | null }>,
): { credits: number; usd: number; rows: number } {
  let credits = 0;
  let usd = 0;
  for (const r of rows) {
    if (typeof r.creditsUsed === 'number' && Number.isFinite(r.creditsUsed)) credits += r.creditsUsed;
    if (typeof r.estimatedCostUsd === 'number' && Number.isFinite(r.estimatedCostUsd)) usd += r.estimatedCostUsd;
  }
  return { credits, usd, rows: rows.length };
}

export interface MyCreditsResult {
  /** Mes en curso (UTC), para el título y «Se renueva…». */
  periodStart: string;
  periodEnd: string;
  rows: MyCreditsRow[];
  /** Alguna fuente no se pudo leer: las demás sí se muestran. */
  partial: boolean;
}
