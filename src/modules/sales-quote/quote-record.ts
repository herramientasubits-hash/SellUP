/**
 * Lo que se guarda de una cotización (puro).
 *
 * El navegador manda lo que eligió el vendedor; aquí se valida y se VUELVE A
 * CALCULAR con el mismo motor. Lo que se guarda y lo que ve el aprobador es
 * siempre este cálculo, nunca cifras que vengan del navegador.
 */
import { z } from 'zod';
import { buildApprovalDraft, ACCOUNT_TYPES, type QuoteAccountType } from './approval-draft';
import { CREDIT_TIERS } from './credits';
import { MODULES_2026, quote2026, type Quote2026Input } from './engine-2026';
import { normalizeQuote2027Input, quote2027, type Quote2027Input } from './engine-2027';
import { PAYMENT_OPTIONS } from './shared';
import { PRICING_VERSIONS, type PricingVersion } from './version';

// ── Lo que llega del navegador ───────────────────────────────────────────────

const count = (max: number) => z.number().finite().min(0).max(max);
const credits = z.object({ tier: z.enum(CREDIT_TIERS).nullable(), packs: count(1000) });
const payments = z.number().refine((value) => (PAYMENT_OPTIONS as readonly number[]).includes(value), 'Pagos no válidos');
const country = z.string().trim().min(2).max(8);

const input2027Schema = z.object({
  country,
  employees: count(10_000_000),
  licenses: count(10_000_000),
  payments,
  years: z.number().int().min(1).max(4),
  includeLearning: z.boolean(),
  content: z.boolean(),
  performanceCulture: z.boolean(),
  lmsAi: credits,
  selection: credits,
  manualDiscounts: z.record(z.string(), z.number().finite().min(-2).max(2)),
});

const input2026Schema = z.object({
  country,
  employees: count(10_000_000),
  licenses: count(10_000_000),
  learningPlan: z.enum(['executive', 'standard']),
  modules: z.object(Object.fromEntries(MODULES_2026.map((module) => [module, z.boolean()])) as Record<(typeof MODULES_2026)[number], z.ZodBoolean>),
  priceOverride: z.number().finite().min(0).max(100_000).nullable(),
  payments,
  years: z.number().int().min(1).max(5),
  selection: credits,
  lmsAi: credits,
});

const LINE_IDS_2027 = new Set(['creator', 'contenido', 'lmsai', 'lmsai_topup', 'hiring', 'hiring_topup', 'dc']);

export const quotePayloadSchema = z.discriminatedUnion('version', [
  z.object({
    version: z.literal('2027'),
    input: input2027Schema,
    clientName: z.string().max(200),
    accountId: z.string().uuid().nullable(),
    accountType: z.enum(ACCOUNT_TYPES),
  }),
  z.object({
    version: z.literal('2026'),
    input: input2026Schema,
    clientName: z.string().max(200),
    accountId: z.string().uuid().nullable(),
    accountType: z.enum(ACCOUNT_TYPES),
  }),
]);

export type QuotePayload = z.infer<typeof quotePayloadSchema>;

// ── Lo que se guarda ─────────────────────────────────────────────────────────

export interface StoredQuoteLine {
  id: string;
  name: string;
  detail: string;
  qty: number;
  listUnit: number;
  minUnit: number;
  priceUnit: number;
  discount: number;
  /** Sólo 2027: máximo sin aprobación. */
  maxDiscount: number | null;
  belowMinimum: boolean;
  perYear: number;
}

export interface StoredQuoteResult {
  lines: StoredQuoteLine[];
  beforePerYear: number;
  afterPerYear: number;
  contract: number;
  warnings: string[];
  /** Sólo si necesita aprobación: el texto que lee el aprobador. */
  approval: { subject: string; body: string } | null;
}

export interface QuoteRecord {
  version: PricingVersion;
  countryCode: string;
  accountType: QuoteAccountType;
  clientName: string | null;
  accountId: string | null;
  years: number;
  perYearTotal: number;
  contractTotal: number;
  needsApproval: boolean;
  input: Quote2026Input | Quote2027Input;
  result: StoredQuoteResult;
}

export type QuoteRecordOutcome = { ok: true; record: QuoteRecord } | { ok: false; error: string };

/** Valida, recalcula y arma lo que se guarda. */
export function buildQuoteRecord(raw: unknown): QuoteRecordOutcome {
  const parsed = quotePayloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'La cotización trae datos que no son válidos. Recarga la página y vuelve a armarla.' };
  const payload = parsed.data;
  const clientName = payload.clientName.trim() || null;

  if (payload.version === '2027') {
    const manualDiscounts = Object.fromEntries(
      Object.entries(payload.input.manualDiscounts).filter(([id]) => LINE_IDS_2027.has(id)),
    );
    const input = normalizeQuote2027Input({ ...payload.input, manualDiscounts } as Quote2027Input);
    const result = quote2027(input);
    if (result.blockedByOperations) return { ok: false, error: 'Más de 10.000 licencias: Aprendizaje se cotiza con Operaciones, no aquí.' };
    if (result.lines.length === 0) return { ok: false, error: 'La cotización no tiene productos: escribe las licencias o elige un plan.' };
    const needsApproval = result.belowMinimum.length > 0;
    const approval = needsApproval ? buildApprovalDraft(input, result, clientName ?? '') : null;
    return {
      ok: true,
      record: {
        version: '2027',
        countryCode: input.country,
        accountType: payload.accountType,
        clientName,
        accountId: payload.accountId,
        years: input.years,
        perYearTotal: result.totals.afterPerYear,
        contractTotal: result.totals.contract,
        needsApproval,
        input,
        result: {
          lines: result.lines.map((line) => ({
            id: line.id,
            name: line.name,
            detail: line.detail,
            qty: line.qty,
            listUnit: line.listUnit,
            minUnit: line.minUnit,
            priceUnit: line.priceUnit,
            discount: line.discount,
            maxDiscount: line.maxDiscount,
            belowMinimum: line.belowMinimum,
            perYear: line.totalAfter,
          })),
          beforePerYear: result.totals.beforePerYear,
          afterPerYear: result.totals.afterPerYear,
          contract: result.totals.contract,
          warnings: result.warnings.map((warning) => warning.message),
          approval,
        },
      },
    };
  }

  const input = payload.input as Quote2026Input;
  const result = quote2026(input);
  if (result.main.lines.length === 0) return { ok: false, error: 'La cotización no tiene productos: escribe las licencias.' };
  if (result.blocked) return { ok: false, error: 'Más de 25.000 licencias no se cotizan en la versión 2026.' };
  return {
    ok: true,
    record: {
      version: '2026',
      countryCode: input.country,
      accountType: payload.accountType,
      clientName,
      accountId: payload.accountId,
      years: input.years,
      perYearTotal: result.main.totalPerYear,
      contractTotal: result.main.contract,
      needsApproval: false,
      input,
      result: {
        lines: result.main.lines.map((line) => ({
          id: line.id,
          name: line.name,
          detail: line.detail,
          qty: line.qty,
          listUnit: line.listUnit,
          minUnit: line.minUnit,
          priceUnit: line.priceUnit,
          discount: line.discount,
          maxDiscount: null,
          belowMinimum: false,
          perYear: line.total,
        })),
        beforePerYear: result.main.listPerYear,
        afterPerYear: result.main.totalPerYear,
        contract: result.main.contract,
        warnings: result.warnings.map((warning) => warning.message),
        approval: null,
      },
    },
  };
}

// ── Estados ──────────────────────────────────────────────────────────────────

export const QUOTE_STATUSES = ['ready', 'pending_approval', 'approved', 'rejected', 'cancelled'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  ready: 'Lista para enviar',
  pending_approval: 'Pendiente de aprobación',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
};

/** Con qué estado se guarda: si algo baja del mínimo, pide aprobación. */
export function initialQuoteStatus(record: Pick<QuoteRecord, 'needsApproval'>): QuoteStatus {
  return record.needsApproval ? 'pending_approval' : 'ready';
}

/** ¿Se puede usar con el cliente? */
export function isQuoteSendable(status: QuoteStatus): boolean {
  return status === 'ready' || status === 'approved';
}

export function isPricingVersionValue(value: unknown): value is PricingVersion {
  return typeof value === 'string' && (PRICING_VERSIONS as readonly string[]).includes(value);
}
