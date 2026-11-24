/**
 * Cotizador · versión 2027 (nueva versión de precios).
 *
 * Productos: Aprendizaje por licencia (LMS Creator y, opcional, Contenido), LMS
 * AI y Selección por plan de créditos, y Desempeño y Cultura con precio fijo
 * anual (requiere Aprendizaje). El descuento se arma con cinco partes —plazo,
 * cobertura, paquete, pagos y manual— y cada línea tiene un mínimo: si el
 * descuento lo pasa, la cotización necesita aprobación.
 *
 * Es la misma matemática del cotizador original de Ventas, con su aritmética
 * exacta (`decimal.ts`); `__tests__/engine-2027.test.ts` lo compara caso a caso.
 */
import { CREDIT_PACK_2027, CREDIT_TIER_PLANS, clampPacks, type CreditSelection } from './credits';
import { Dec, dec, roundUnit } from './decimal';
import { QUOTE_COUNTRIES, findQuoteCountry, type QuoteCountry } from './markets';
import { PAYMENT_DISCOUNTS, type PaymentCount, type QuoteWarning } from './shared';

export const TERM_OPTIONS_2027 = [1, 2, 3, 4] as const;
/** Descuento por plazo (multianual). */
export const MULTI_YEAR_DISCOUNTS_2027: Record<number, number> = { 1: 0, 2: 0.2, 3: 0.3, 4: 0.4 };

/** Cobertura: si las licencias pasan el 90 % de los empleados, 10 % de descuento. */
export const COVERAGE_DISCOUNT = { threshold: 0.9, discount: 0.1 };
/** Paquete: Aprendizaje + Selección + Desempeño y Cultura juntos, 5 %. */
export const PACKAGE_DISCOUNT_2027 = 0.05;

/** Parte del precio de lista que es piso (sin plazo): el resto es margen para descontar. */
const FLOOR_RATIO = { learning: 0.8, performanceCulture: 0.8, credits: 0.75 };

/** Rango de licencias de la curva de precios. */
export const LICENSE_RANGE = { min: 40, max: 10_000, extrapolatedFrom: 8_200 };

/** Curva del precio por licencia (log-cúbica, referencia 250 licencias). */
const LICENSE_CURVE = { a: 3.875317, b: -0.715883, c: -0.007557, d: 0.008934, ref: 250 };
/** Parte del precio por licencia que es LMS Creator (el resto es Contenido). */
const CREATOR_SHARE = { max: 0.75, min: 0.575, k: 0.0638, ref: 90 };

/** Desempeño y Cultura: precio fijo anual según el número de licencias. */
const PERFORMANCE_CULTURE_STEPS = [
  { upTo: 100, list: 2_000 },
  { upTo: 250, list: 2_000 },
  { upTo: 500, list: 3_000 },
  { upTo: 1_000, list: 6_000 },
  { upTo: 2_500, list: 8_000 },
  { upTo: 10_000, list: 8_000 },
];

/** Tolerancia para decidir si un descuento pasa el máximo. */
const EPSILON = 1e-9;

export type Line2027Id = 'creator' | 'contenido' | 'lmsai' | 'lmsai_topup' | 'hiring' | 'hiring_topup' | 'dc';

export interface Quote2027Input {
  country: string;
  employees: number;
  licenses: number;
  payments: PaymentCount;
  years: number;
  includeLearning: boolean;
  /** Contenido junto a LMS Creator. */
  content: boolean;
  /** Desempeño y Cultura. */
  performanceCulture: boolean;
  lmsAi: CreditSelection;
  /** Selección (antes «Hiring»). */
  selection: CreditSelection;
  /** Descuento manual por línea, sumado al automático (puede ser negativo). */
  manualDiscounts: Partial<Record<Line2027Id, number>>;
}

export function defaultQuote2027Input(): Quote2027Input {
  return {
    country: 'CO',
    employees: 0,
    licenses: 0,
    payments: 1,
    years: 1,
    includeLearning: true,
    content: false,
    performanceCulture: false,
    lmsAi: { tier: null, packs: 0 },
    selection: { tier: null, packs: 0 },
    manualDiscounts: {},
  };
}

/**
 * Reglas de la pantalla: siempre hay Aprendizaje o Selección (si se quitan los
 * dos, vuelve Aprendizaje) y Desempeño y Cultura exige Aprendizaje.
 */
export function normalizeQuote2027Input(input: Quote2027Input): Quote2027Input {
  const next = { ...input };
  if (!next.includeLearning && !next.selection.tier) next.includeLearning = true;
  if (!next.includeLearning) next.performanceCulture = false;
  return next;
}

export type Quote2027WarningCode =
  | 'below_license_range'
  | 'extrapolated_licenses'
  | 'above_license_range'
  | 'more_licenses_than_employees';

export interface DiscountBreakdown {
  multiYear: number;
  coverage: number;
  package: number;
  payments: number;
  manual: number;
}

export interface Quote2027Line {
  id: Line2027Id;
  name: string;
  detail: string;
  qty: number;
  listUnit: number;
  minUnit: number;
  priceUnit: number;
  /** Descuento automático (plazo + cobertura + paquete + pagos). */
  autoDiscount: number;
  /** Descuento total aplicado, entre 0 y 1. */
  discount: number;
  manualDiscount: number;
  /** Máximo descuento sin aprobación. */
  maxDiscount: number;
  belowMinimum: boolean;
  breakdown: DiscountBreakdown;
  totalBefore: number;
  totalAfter: number;
}

export interface QuoteTotals {
  beforePerYear: number;
  afterPerYear: number;
  contract: number;
  savings: number;
}

export interface Quote2027OtherTerm extends QuoteTotals {
  years: number;
  multiYear: number;
}

export interface Quote2027Result {
  lines: Quote2027Line[];
  totals: QuoteTotals;
  multiYear: number;
  /** Licencias / empleados; `null` si no aplica. */
  coverage: number | null;
  coverageApplies: boolean;
  packageApplies: boolean;
  paymentsDiscount: number;
  factor: number;
  warnings: QuoteWarning<Quote2027WarningCode>[];
  /** Más de 10.000 licencias: Aprendizaje se cotiza con Operaciones. */
  blockedByOperations: boolean;
  belowMinimum: Quote2027Line[];
  otherTerms: Quote2027OtherTerm[];
}

const fmtInt = (value: number) => value.toLocaleString('es-CO');

function licensePrice(licenses: number) {
  const { a, b, c, d, ref } = LICENSE_CURVE;
  const l = dec(licenses).div(ref).ln();
  return dec(a).plus(dec(b).times(l)).plus(dec(c).times(l.pow(2))).plus(dec(d).times(l.pow(3))).exp();
}

function creatorShare(licenses: number) {
  const { max, min, k, ref } = CREATOR_SHARE;
  const share = dec(max).minus(dec(k).times(dec(licenses).div(ref).ln()));
  return Dec.max(min, Dec.min(max, share));
}

function learningListPrices(licenses: number, factor: number) {
  const priced = Math.max(licenses, LICENSE_RANGE.min);
  const perLicense = licensePrice(priced).times(factor);
  const share = creatorShare(priced);
  return { creator: perLicense.times(share), content: perLicense.times(dec(1).minus(share)) };
}

function performanceCultureList(licenses: number): number {
  return PERFORMANCE_CULTURE_STEPS.find((step) => licenses <= step.upTo)?.list ?? 0;
}

interface RawLine {
  id: Line2027Id;
  name: string;
  detail: string;
  qty: number;
  list: Dec;
  floorRatio: number;
}

function buildLines(input: Quote2027Input, factor: number) {
  const lines: RawLine[] = [];
  const warnings: QuoteWarning<Quote2027WarningCode>[] = [];
  const licenses = Math.max(0, Math.floor(input.licenses));
  const learning = input.includeLearning;
  const blocked = learning && licenses > LICENSE_RANGE.max;

  if (learning && !blocked && licenses > 0) {
    if (licenses < LICENSE_RANGE.min) {
      warnings.push({
        code: 'below_license_range',
        message: `Con menos de ${LICENSE_RANGE.min} licencias, el precio por licencia se calcula como si fueran ${LICENSE_RANGE.min}.`,
      });
    }
    if (licenses > LICENSE_RANGE.extrapolatedFrom) {
      warnings.push({
        code: 'extrapolated_licenses',
        message: `Entre ${fmtInt(LICENSE_RANGE.extrapolatedFrom)} y ${fmtInt(LICENSE_RANGE.max)} licencias el precio es una estimación: el cliente más grande de referencia tiene ${fmtInt(LICENSE_RANGE.extrapolatedFrom)}.`,
      });
    }
    const prices = learningListPrices(licenses, factor);
    const detail = `${fmtInt(licenses)} licencias`;
    lines.push({ id: 'creator', name: 'LMS Creator', detail, qty: licenses, list: prices.creator, floorRatio: FLOOR_RATIO.learning });
    if (input.content) {
      lines.push({ id: 'contenido', name: 'Contenido', detail, qty: licenses, list: prices.content, floorRatio: FLOOR_RATIO.learning });
    }
  }
  if (blocked) {
    warnings.push({
      code: 'above_license_range',
      message: `Más de ${fmtInt(LICENSE_RANGE.max)} licencias: Aprendizaje se cotiza con Operaciones.`,
    });
  }

  const addCredits = (id: 'lmsai' | 'hiring', name: string, selection: CreditSelection) => {
    if (!selection.tier) return;
    const plan = CREDIT_TIER_PLANS[selection.tier];
    lines.push({
      id,
      name,
      detail: `Plan ${plan.label} · ${plan.credits / 1000}K créditos`,
      qty: 1,
      list: dec(plan.list),
      floorRatio: FLOOR_RATIO.credits,
    });
    const packs = clampPacks(selection.packs, CREDIT_PACK_2027);
    if (packs > 0) {
      lines.push({
        id: `${id}_topup`,
        name: `Paquetes adicionales de ${CREDIT_PACK_2027.credits / 1000}K · ${name}`,
        detail: `${packs} ${packs === 1 ? 'paquete' : 'paquetes'}`,
        qty: packs,
        list: dec(CREDIT_PACK_2027.list),
        floorRatio: FLOOR_RATIO.credits,
      });
    }
  };
  addCredits('lmsai', 'LMS AI', input.lmsAi);
  addCredits('hiring', 'Selección', input.selection);

  if (input.performanceCulture && learning && !blocked && licenses > 0) {
    lines.push({
      id: 'dc',
      name: 'Desempeño y Cultura',
      detail: 'Precio fijo anual',
      qty: 1,
      list: dec(performanceCultureList(licenses)).times(factor),
      floorRatio: FLOOR_RATIO.performanceCulture,
    });
  }

  if (input.employees > 0 && licenses > input.employees && learning) {
    warnings.push({ code: 'more_licenses_than_employees', message: 'Hay más licencias que empleados.' });
  }

  return { lines, warnings, blocked };
}

function quoteForTerm(input: Quote2027Input, years: number) {
  const country: QuoteCountry = findQuoteCountry(input.country) ?? QUOTE_COUNTRIES[0];
  const built = buildLines(input, country.factor);
  const multiYear = MULTI_YEAR_DISCOUNTS_2027[years] ?? 0;
  const coverage = input.employees > 0 && input.includeLearning ? input.licenses / input.employees : null;
  const coverageApplies = coverage !== null && coverage > COVERAGE_DISCOUNT.threshold;
  const has = (id: Line2027Id) => built.lines.some((line) => line.id === id);
  const packageApplies = has('creator') && has('hiring') && has('dc');
  const paymentsDiscount = PAYMENT_DISCOUNTS[input.payments] ?? 0;
  const coverageDiscount = coverageApplies ? COVERAGE_DISCOUNT.discount : 0;
  const packageDiscount = packageApplies ? PACKAGE_DISCOUNT_2027 : 0;
  const auto = dec(multiYear).plus(coverageDiscount).plus(packageDiscount).plus(paymentsDiscount);

  const lines: Quote2027Line[] = built.lines.map((line) => {
    let total = auto.plus(dec(input.manualDiscounts[line.id] ?? 0));
    if (total.lt(0)) total = dec(0);
    if (total.gt(1)) total = dec(1);
    const margin = dec(1).minus(line.floorRatio);
    const listUnit = roundUnit(line.list);
    const minUnit = roundUnit(line.list.times(dec(line.floorRatio).minus(multiYear)));
    const priceUnit = roundUnit(line.list.times(dec(1).minus(total)));
    const manual = total.minus(auto).toNumber();
    return {
      id: line.id,
      name: line.name,
      detail: line.detail,
      qty: line.qty,
      listUnit: listUnit.toNumber(),
      minUnit: minUnit.toNumber(),
      priceUnit: priceUnit.toNumber(),
      autoDiscount: auto.toNumber(),
      discount: total.toNumber(),
      manualDiscount: manual,
      maxDiscount: dec(multiYear).plus(margin).toNumber(),
      belowMinimum: total.minus(multiYear).minus(margin).gt(EPSILON),
      breakdown: {
        multiYear,
        coverage: coverageDiscount,
        package: packageDiscount,
        payments: paymentsDiscount,
        manual,
      },
      totalBefore: listUnit.times(line.qty).toNumber(),
      totalAfter: priceUnit.times(line.qty).toNumber(),
    };
  });

  const before = lines.reduce((sum, line) => sum.plus(line.totalBefore), dec(0));
  const after = lines.reduce((sum, line) => sum.plus(line.totalAfter), dec(0));
  const totals: QuoteTotals = {
    beforePerYear: before.toNumber(),
    afterPerYear: after.toNumber(),
    contract: after.times(years).toNumber(),
    savings: before.minus(after).times(years).toNumber(),
  };

  return {
    lines,
    totals,
    multiYear,
    coverage,
    coverageApplies,
    packageApplies,
    paymentsDiscount,
    factor: country.factor,
    warnings: built.warnings,
    blocked: built.blocked,
  };
}

/** La cotización con el plazo elegido y, como referencia, los otros plazos. */
export function quote2027(rawInput: Quote2027Input): Quote2027Result {
  const input = normalizeQuote2027Input(rawInput);
  const main = quoteForTerm(input, input.years);
  const otherTerms = TERM_OPTIONS_2027.filter((years) => years !== input.years).map((years) => {
    const term = quoteForTerm(input, years);
    return { years, multiYear: term.multiYear, ...term.totals };
  });
  return {
    lines: main.lines,
    totals: main.totals,
    multiYear: main.multiYear,
    coverage: main.coverage,
    coverageApplies: main.coverageApplies,
    packageApplies: main.packageApplies,
    paymentsDiscount: main.paymentsDiscount,
    factor: main.factor,
    warnings: main.warnings,
    blockedByOperations: main.blocked,
    belowMinimum: main.lines.filter((line) => line.belowMinimum),
    otherTerms,
  };
}

/**
 * El vendedor escribe el descuento TOTAL de una línea; se guarda solo la parte
 * manual (lo que pasa del automático). El total queda entre 0 y 100 %.
 */
export function manualDiscountFor(totalDiscount: number, autoDiscount: number): number {
  const total = Math.min(1, Math.max(0, totalDiscount));
  return dec(total).minus(autoDiscount).toNumber();
}
