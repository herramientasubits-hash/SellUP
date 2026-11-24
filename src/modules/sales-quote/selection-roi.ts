/**
 * Retorno del cliente con Selección (versión 2027).
 *
 * Estima cuánto ahorra el cliente al año: horas que su equipo de reclutamiento
 * deja de gastar y lo que deja de pagarle a terceros (psicometría, idiomas,
 * antecedentes, que ya vienen en los créditos). Mismos supuestos del cotizador
 * original de Ventas.
 */

/** Horas de trabajo al mes por persona. */
const HOURS_PER_MONTH = 192;
/** Parte del tiempo del reclutador dedicada a tareas que Selección automatiza. */
const AUTOMATABLE_SHARE = 0.65;
/** Parte de ese tiempo que de verdad se libera. */
const EFFICIENCY = 0.75;
/** Selección reduce a la mitad los días para cubrir una vacante. */
const TIME_TO_FILL_FACTOR = 0.5;

/** Salario mensual de referencia de un reclutador (USD). */
export const RECRUITER_SALARY_PRESETS = [
  { label: 'Colombia', value: 450 },
  { label: 'México', value: 640 },
  { label: 'Latinoamérica', value: 700 },
] as const;

export interface SelectionRoiInput {
  /** Lo que el cliente invierte en Selección al año (USD). */
  annualInvestment: number;
  /** Personas en el equipo de reclutamiento. */
  recruiters: number;
  /** Salario mensual de cada reclutador (USD). */
  recruiterMonthlySalary: number;
  /** Lo que hoy paga a terceros al año (USD). */
  thirdPartyAnnualCost: number;
  /** Días que hoy tarda en cubrir una vacante. */
  daysToFill: number;
}

export const DEFAULT_SELECTION_ROI_INPUT: Omit<SelectionRoiInput, 'annualInvestment'> = {
  recruiters: 3,
  recruiterMonthlySalary: 650,
  thirdPartyAnnualCost: 6_000,
  daysToFill: 28,
};

/** Inversión con que arranca el cálculo si la cotización no tiene Selección. */
export const DEFAULT_SELECTION_INVESTMENT = 12_000;

export interface SelectionRoiResult {
  hoursFreedPerYear: number;
  hoursSavingsPerYear: number;
  grossSavingsPerYear: number;
  netSavingsPerYear: number;
  /** USD que recupera el cliente por cada USD invertido. */
  returnPerDollar: number;
  /** Meses en que recupera la inversión. */
  paybackMonths: number;
  daysToFillWithSelection: number;
}

export function selectionRoi(input: SelectionRoiInput): SelectionRoiResult {
  const hoursFreedPerYear = Math.round(input.recruiters * HOURS_PER_MONTH * 12 * AUTOMATABLE_SHARE * EFFICIENCY);
  const hoursSavingsPerYear = hoursFreedPerYear * (input.recruiterMonthlySalary / HOURS_PER_MONTH);
  const grossSavingsPerYear = hoursSavingsPerYear + input.thirdPartyAnnualCost;
  return {
    hoursFreedPerYear,
    hoursSavingsPerYear,
    grossSavingsPerYear,
    netSavingsPerYear: grossSavingsPerYear - input.annualInvestment,
    returnPerDollar: input.annualInvestment > 0 ? grossSavingsPerYear / input.annualInvestment : 0,
    paybackMonths: grossSavingsPerYear > 0 ? input.annualInvestment / (grossSavingsPerYear / 12) : 0,
    daysToFillWithSelection: Math.round(input.daysToFill * TIME_TO_FILL_FACTOR),
  };
}
