/**
 * Cotizador · versión 2026 (vigente hasta el 31 de diciembre de 2026).
 *
 * Aprendizaje (Executive o Standard) es obligatorio y se cobra por licencia
 * según tramos; los módulos (Diagnóstico, Desempeño, Planes y Tareas,
 * Encuestas) cuestan una fracción del precio de Aprendizaje. Selección y LMS AI
 * van por plan de créditos. Ningún precio baja del mínimo: si el descuento lo
 * pasa, el precio se queda en el mínimo (no hay aprobación en esta versión).
 *
 * Es la misma matemática del cotizador original de Ventas, con su aritmética
 * exacta (`decimal.ts`); `__tests__/engine-2026.test.ts` lo compara caso a caso.
 */
import { CREDIT_PACK_2026, CREDIT_TIER_PLANS, clampPacks, type CreditPack, type CreditSelection } from './credits';
import { Dec, dec, roundUnit } from './decimal';
import { QUOTE_COUNTRIES, type QuoteCountry } from './markets';
import { PAYMENT_DISCOUNTS, type PaymentCount, type QuoteWarning } from './shared';

/** Factores de mercado de la versión 2026 (distintos a los de 2027). */
const MARKET_FACTORS_2026: Record<string, number> = {
  CO: 1, PE: 0.75, BO: 0.75, EC: 1, VE: 1, CL: 1.05, AR: 1.05, MX: 1.1, DO: 1.5, PA: 1.25,
  CR: 1.5, HN: 1.1, SV: 1.1, GT: 1.1, NI: 1.1, BZ: 1.1, PR: 1.1, BR: 1, PY: 1, UY: 1,
};

/** Los países que se cotizan en 2026, con su factor de esa versión. */
export const QUOTE_COUNTRIES_2026: readonly QuoteCountry[] = QUOTE_COUNTRIES.filter(
  (country) => country.code in MARKET_FACTORS_2026,
).map((country) => ({ ...country, factor: MARKET_FACTORS_2026[country.code] }));

export type LearningPlan = 'executive' | 'standard';
export const MODULES_2026 = ['assessments', 'desempeno', 'planes', 'encuestas'] as const;
export type Module2026 = (typeof MODULES_2026)[number];

/** Cada producto vale una fracción del precio por licencia de Aprendizaje. */
const PRODUCTS_2026: Record<LearningPlan | Module2026, { label: string; influence: number }> = {
  executive: { label: 'Aprendizaje Executive', influence: 1 },
  standard: { label: 'Aprendizaje Standard', influence: 0.8 },
  desempeno: { label: 'Desempeño', influence: 0.2 },
  planes: { label: 'Planes y Tareas', influence: 0.15 },
  encuestas: { label: 'Encuestas', influence: 0.05 },
  assessments: { label: 'Diagnóstico', influence: 0.1 },
};

export function productLabel2026(id: LearningPlan | Module2026): string {
  return PRODUCTS_2026[id].label;
}

/** Precio por licencia (USD al año) según el número de licencias. */
const LICENSE_STEPS_2026 = [
  { from: 0, to: 50, min: 128, list: 154 },
  { from: 51, to: 60, min: 115, list: 128 },
  { from: 61, to: 70, min: 102, list: 115 },
  { from: 71, to: 80, min: 90, list: 102 },
  { from: 81, to: 90, min: 77, list: 90 },
  { from: 91, to: 100, min: 64, list: 84 },
  { from: 101, to: 250, min: 42, list: 51 },
  { from: 251, to: 500, min: 26, list: 28 },
  { from: 501, to: 1_000, min: 17, list: 19 },
  { from: 1_001, to: 2_500, min: 12, list: 13 },
  { from: 2_501, to: 5_000, min: 5, list: 6 },
  { from: 5_001, to: 10_000, min: 4, list: 5 },
  { from: 10_001, to: 25_000, min: 3, list: 4 },
];

export const MAX_LICENSES_2026 = 25_000;

export const TERM_OPTIONS_2026 = [1, 2, 3, 4, 5] as const;
export const MULTI_YEAR_DISCOUNTS_2026: Record<number, number> = { 1: 0, 2: 0.25, 3: 0.4, 4: 0.5, 5: 0.55 };

/** Paquete: desde 3 productos (Aprendizaje cuenta como uno), 5 %. */
export const PACKAGE_DISCOUNT_2026 = { minProducts: 3, discount: 0.05 };

/** Parte del precio de lista de los planes de créditos que es piso. */
const CREDITS_FLOOR_RATIO = 0.75;

export type Line2026Kind = 'license' | 'selection' | 'service';

export interface Quote2026Input {
  country: string;
  employees: number;
  licenses: number;
  learningPlan: LearningPlan;
  modules: Record<Module2026, boolean>;
  /** Precio por licencia pedido (USD); se ajusta entre el mínimo y la lista. */
  priceOverride: number | null;
  payments: PaymentCount;
  years: number;
  selection: CreditSelection;
  lmsAi: CreditSelection;
}

export function defaultQuote2026Input(): Quote2026Input {
  return {
    country: 'CO',
    employees: 0,
    licenses: 0,
    learningPlan: 'executive',
    modules: { assessments: false, desempeno: false, planes: false, encuestas: false },
    priceOverride: null,
    payments: 1,
    years: 1,
    selection: { tier: null, packs: 0 },
    lmsAi: { tier: null, packs: 0 },
  };
}

export type Quote2026WarningCode = 'above_license_range' | 'no_licenses' | 'more_licenses_than_employees';

export interface Quote2026Line {
  id: string;
  name: string;
  detail: string;
  kind: Line2026Kind;
  qty: number;
  listUnit: number;
  minUnit: number;
  /** Precio por licencia antes de descuentos (lista o el pedido). */
  startUnit: number;
  priceUnit: number;
  discount: number;
  /** El descuento pasaba el mínimo y el precio quedó en el mínimo. */
  floored: boolean;
  listTotal: number;
  minTotal: number;
  total: number;
}

export interface Quote2026Term {
  years: number;
  multiYear: number;
  lines: Quote2026Line[];
  /** Licencias y Selección por año. */
  subscriptionPerYear: number;
  /** LMS AI por año. */
  servicesPerYear: number;
  totalPerYear: number;
  listPerYear: number;
  contract: number;
}

export interface Quote2026Result {
  main: Quote2026Term;
  oneYear: Quote2026Term;
  /** Los demás plazos, como referencia. */
  terms: Quote2026Term[];
  factor: number;
  productCount: number;
  packageApplies: boolean;
  paymentsDiscount: number;
  /** Rango del precio por licencia de Aprendizaje (USD, con factor). */
  priceRange: { min: number; list: number } | null;
  blocked: boolean;
  warnings: QuoteWarning<Quote2026WarningCode>[];
}

interface RawLine {
  id: string;
  name: string;
  detail: string;
  kind: Line2026Kind;
  qty: number;
  list: Dec;
  floorRatio: Dec;
  start: Dec;
}

const fmtInt = (value: number) => value.toLocaleString('es-CO');

function countryFor(code: string): QuoteCountry {
  return QUOTE_COUNTRIES_2026.find((country) => country.code === code) ?? QUOTE_COUNTRIES_2026[0];
}

function licenseStep(licenses: number) {
  return LICENSE_STEPS_2026.find((step) => licenses >= step.from && licenses <= step.to);
}

/** Productos que cuentan para el paquete: Aprendizaje + módulos + Selección. */
export function productCount2026(input: Quote2026Input): number {
  return 1 + MODULES_2026.filter((module) => input.modules[module]).length + (input.selection.tier ? 1 : 0);
}

function buildLines(input: Quote2026Input, factor: number) {
  const lines: RawLine[] = [];
  const licenses = Math.max(0, Math.floor(input.licenses));
  const step = licenses > 0 ? licenseStep(licenses) : undefined;
  const blocked = licenses > MAX_LICENSES_2026;
  let priceRange: Quote2026Result['priceRange'] = null;

  if (step) {
    const list = dec(step.list).times(factor);
    const min = dec(step.min).times(factor);
    priceRange = { min: min.toNumber(), list: list.toNumber() };
    const floorRatio = min.div(list);
    const start = input.priceOverride === null ? list : Dec.min(list, Dec.max(min, dec(input.priceOverride)));
    for (const id of [input.learningPlan, ...MODULES_2026.filter((module) => input.modules[module])]) {
      const product = PRODUCTS_2026[id];
      lines.push({
        id,
        name: product.label,
        detail: `${fmtInt(licenses)} licencias`,
        kind: 'license',
        qty: licenses,
        list: list.times(product.influence),
        floorRatio,
        start: start.times(product.influence),
      });
    }
  }

  const addCredits = (id: 'hiring' | 'lmsai', name: string, kind: Line2026Kind, selection: CreditSelection, pack: CreditPack) => {
    if (!selection.tier) return;
    const plan = CREDIT_TIER_PLANS[selection.tier];
    lines.push({
      id,
      name,
      detail: `Plan ${plan.label} · ${plan.credits / 1000}K créditos`,
      kind,
      qty: 1,
      list: dec(plan.list),
      floorRatio: dec(CREDITS_FLOOR_RATIO),
      start: dec(plan.list),
    });
    const packs = clampPacks(selection.packs, pack);
    if (packs > 0) {
      lines.push({
        id: `${id}_topup`,
        name: `Paquetes adicionales de ${pack.credits / 1000}K · ${name}`,
        detail: `${packs} ${packs === 1 ? 'paquete' : 'paquetes'}`,
        kind,
        qty: packs,
        list: dec(pack.list),
        floorRatio: dec(CREDITS_FLOOR_RATIO),
        start: dec(pack.list),
      });
    }
  };
  addCredits('hiring', 'Selección', 'selection', input.selection, CREDIT_PACK_2026);
  addCredits('lmsai', 'LMS AI', 'service', input.lmsAi, CREDIT_PACK_2026);

  return { lines, priceRange, blocked };
}

function quoteTerm(years: number, lines: RawLine[], paymentsDiscount: number, packageDiscount: number): Quote2026Term {
  const multiYear = MULTI_YEAR_DISCOUNTS_2026[years] ?? 0;
  const priced: Quote2026Line[] = lines.map((line) => {
    // LMS AI es un servicio: no recibe el descuento de paquete.
    const discount = Dec.min(
      1,
      Dec.max(0, dec(multiYear).plus(paymentsDiscount).plus(line.kind === 'service' ? 0 : packageDiscount)),
    );
    const listUnit = roundUnit(line.list);
    const minUnit = roundUnit(Dec.max(0, line.list.times(line.floorRatio.minus(multiYear))));
    const wanted = roundUnit(line.start.times(dec(1).minus(discount)));
    const floored = wanted.lt(minUnit);
    const priceUnit = floored ? minUnit : wanted;
    return {
      id: line.id,
      name: line.name,
      detail: line.detail,
      kind: line.kind,
      qty: line.qty,
      listUnit: listUnit.toNumber(),
      minUnit: minUnit.toNumber(),
      startUnit: roundUnit(line.start).toNumber(),
      priceUnit: priceUnit.toNumber(),
      discount: discount.toNumber(),
      floored,
      listTotal: listUnit.times(line.qty).toNumber(),
      minTotal: minUnit.times(line.qty).toNumber(),
      total: priceUnit.times(line.qty).toNumber(),
    };
  });
  const sum = (filter: (line: Quote2026Line) => boolean, field: 'total' | 'listTotal') =>
    priced.filter(filter).reduce((acc, line) => acc.plus(line[field]), dec(0));
  const subscription = sum((line) => line.kind !== 'service', 'total');
  const services = sum((line) => line.kind === 'service', 'total');
  const total = subscription.plus(services);
  return {
    years,
    multiYear,
    lines: priced,
    subscriptionPerYear: subscription.toNumber(),
    servicesPerYear: services.toNumber(),
    totalPerYear: total.toNumber(),
    listPerYear: sum(() => true, 'listTotal').toNumber(),
    contract: total.times(years).toNumber(),
  };
}

export function quote2026(input: Quote2026Input): Quote2026Result {
  const country = countryFor(input.country);
  const built = buildLines(input, country.factor);
  const productCount = productCount2026(input);
  const packageApplies = productCount >= PACKAGE_DISCOUNT_2026.minProducts;
  const packageDiscount = packageApplies ? PACKAGE_DISCOUNT_2026.discount : 0;
  const paymentsDiscount = PAYMENT_DISCOUNTS[input.payments] ?? 0;
  const terms = TERM_OPTIONS_2026.map((years) => quoteTerm(years, built.lines, paymentsDiscount, packageDiscount));

  const warnings: QuoteWarning<Quote2026WarningCode>[] = [];
  if (built.blocked) {
    warnings.push({
      code: 'above_license_range',
      message: `Más de ${fmtInt(MAX_LICENSES_2026)} licencias: esta versión no las cotiza; habla con Operaciones.`,
    });
  }
  if (input.licenses <= 0) {
    warnings.push({ code: 'no_licenses', message: 'Escribe cuántas licencias se cotizan para ver el precio de cada producto.' });
  }
  if (input.employees > 0 && input.licenses > input.employees) {
    warnings.push({ code: 'more_licenses_than_employees', message: 'Hay más licencias que empleados.' });
  }

  return {
    main: terms.find((term) => term.years === input.years) ?? terms[0],
    oneYear: terms[0],
    terms: terms.filter((term) => term.years !== input.years),
    factor: country.factor,
    productCount,
    packageApplies,
    paymentsDiscount,
    priceRange: built.priceRange,
    blocked: built.blocked,
    warnings,
  };
}
