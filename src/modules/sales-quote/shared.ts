/** Lo que comparten las dos versiones del cotizador. */

export const PAYMENT_OPTIONS = [1, 2, 3, 4, 12] as const;
export type PaymentCount = (typeof PAYMENT_OPTIONS)[number];

/** Descuento (o recargo, si es negativo) por número de pagos al año. */
export const PAYMENT_DISCOUNTS: Record<PaymentCount, number> = { 1: 0.05, 2: 0, 3: 0, 4: -0.05, 12: -0.1 };

export function isPaymentCount(value: unknown): value is PaymentCount {
  return typeof value === 'number' && (PAYMENT_OPTIONS as readonly number[]).includes(value);
}

export interface QuoteWarning<Code extends string = string> {
  code: Code;
  message: string;
}

export const yearsLabel = (years: number) => `${years} ${years === 1 ? 'año' : 'años'}`;
