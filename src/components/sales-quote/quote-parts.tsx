"use client";

/**
 * Piezas que comparten las dos versiones del cotizador: condiciones, plan de
 * créditos, precio de una línea, resumen y la tabla de otros plazos.
 */

import { useState, type ReactNode } from "react";
import { Check, Copy } from "@/icons";
import { Field } from "@/components/forms/field";
import { NumberField } from "@/components/forms/number-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { QuoteClientPicker, type QuoteClientRef } from "./quote-client-picker";
import {
  CREDIT_TIERS,
  CREDIT_TIER_PLANS,
  type CreditPack,
  type CreditSelection,
  type CreditTier,
} from "@/modules/sales-quote/credits";
import { EXCHANGE_RATES, hasLocalCurrency, type MoneyContext } from "@/modules/sales-quote/exchange-rates";
import { currencyCode, formatQuoteMoney, formatQuotePercent } from "@/modules/sales-quote/format";
import { findQuoteCountry, type QuoteCountry } from "@/modules/sales-quote/markets";
import { PAYMENT_DISCOUNTS, PAYMENT_OPTIONS, yearsLabel, type PaymentCount, type QuoteWarning } from "@/modules/sales-quote/shared";

// ── Condiciones ──────────────────────────────────────────────────────────────

const PAYMENT_LABELS: Record<string, string> = Object.fromEntries(
  PAYMENT_OPTIONS.map((count) => [String(count), count === 1 ? "1 pago" : count === 12 ? "12 pagos (mensual)" : `${count} pagos`]),
);

/** Qué hace cada número de pagos con el precio, en una frase. */
export function paymentsHint(payments: PaymentCount): string {
  const discount = PAYMENT_DISCOUNTS[payments];
  if (discount > 0) return `Un solo pago: ${formatQuotePercent(discount)} de descuento.`;
  if (discount < 0) return `${payments} pagos: recargo de ${formatQuotePercent(-discount)}.`;
  return `${payments} pagos: sin descuento ni recargo.`;
}

interface ConditionsProps {
  client: QuoteClientRef;
  onClient: (value: QuoteClientRef) => void;
  countries: readonly QuoteCountry[];
  country: string;
  onCountry: (code: string) => void;
  payments: PaymentCount;
  onPayments: (value: PaymentCount) => void;
  years: number;
  termOptions: readonly number[];
  onYears: (value: number) => void;
  useLocalCurrency: boolean;
  onUseLocalCurrency: (value: boolean) => void;
  employees: number;
  onEmployees: (value: number) => void;
  licenses: number;
  onLicenses: (value: number) => void;
  /** Lo que se dice bajo «Licencias» (cobertura, tope…). */
  licensesHint?: ReactNode;
  children?: ReactNode;
}

export function QuoteConditions(props: ConditionsProps) {
  const currency = findQuoteCountry(props.country)?.currency ?? null;
  const canUseLocal = hasLocalCurrency(props.country);
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 md:grid-cols-3">
        <Field label="Cliente" description="La empresa de HubSpot a la que se cotiza. Si no está, escribe su nombre.">
          <QuoteClientPicker value={props.client} onChange={props.onClient} />
        </Field>
        <Field label="País" required>
          <Select
            value={props.country}
            onValueChange={(value) => value && props.onCountry(value)}
            items={Object.fromEntries(props.countries.map((country) => [country.code, country.name]))}
          >
            <SelectTrigger className="w-full" aria-label="País">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.countries.map((country) => (
                <SelectItem key={country.code} value={country.code}>
                  {country.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Moneda"
          description={
            canUseLocal && currency
              ? `Referencia del ${EXCHANGE_RATES.asOf.split("-").reverse().join("/")}: 1 USD = ${EXCHANGE_RATES.rates[currency].toLocaleString("es-CO")} ${currency}.`
              : "Este país se cotiza solo en USD."
          }
        >
          <label className="flex h-10 items-center gap-3 text-sm text-foreground">
            <Switch
              checked={canUseLocal && props.useLocalCurrency}
              onCheckedChange={(value) => props.onUseLocalCurrency(Boolean(value))}
              disabled={!canUseLocal}
              aria-label="Ver en moneda local"
            />
            {canUseLocal && currency ? `Ver en ${currency}` : "USD"}
          </label>
        </Field>
      </div>
      <div className="grid gap-5 md:grid-cols-4">
        <Field label="Plazo">
          <Select
            value={String(props.years)}
            onValueChange={(value) => value && props.onYears(Number(value))}
            items={Object.fromEntries(props.termOptions.map((years) => [String(years), yearsLabel(years)]))}
          >
            <SelectTrigger className="w-full" aria-label="Plazo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.termOptions.map((years) => (
                <SelectItem key={years} value={String(years)}>
                  {yearsLabel(years)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Pagos al año" description={paymentsHint(props.payments)}>
          <Select
            value={String(props.payments)}
            onValueChange={(value) => value && props.onPayments(Number(value) as PaymentCount)}
            items={PAYMENT_LABELS}
          >
            <SelectTrigger className="w-full" aria-label="Pagos al año">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_OPTIONS.map((count) => (
                <SelectItem key={count} value={String(count)}>
                  {PAYMENT_LABELS[String(count)]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Empleados del cliente">
          <NumberField
            value={props.employees || null}
            onValueChange={(value) => props.onEmployees(Math.max(0, Math.floor(value ?? 0)))}
            min={0}
            stepper="none"
            aria-label="Empleados del cliente"
          />
        </Field>
        <Field label="Licencias" description={props.licensesHint}>
          <NumberField
            value={props.licenses || null}
            onValueChange={(value) => props.onLicenses(Math.max(0, Math.floor(value ?? 0)))}
            min={0}
            stepper="none"
            aria-label="Licencias"
          />
        </Field>
      </div>
      {props.children}
    </div>
  );
}

// ── Plan de créditos ─────────────────────────────────────────────────────────

const NO_TIER = "none";

interface CreditPlanPickerProps {
  label: string;
  value: CreditSelection;
  pack: CreditPack;
  onChange: (value: CreditSelection) => void;
  money: MoneyContext;
}

/** Plan (Basic, Pro, Max o ninguno) y paquetes adicionales de un producto de créditos. */
export function CreditPlanPicker({ label, value, pack, onChange, money }: CreditPlanPickerProps) {
  const items: Record<string, string> = {
    [NO_TIER]: `Sin ${label}`,
    ...Object.fromEntries(
      CREDIT_TIERS.map((tier) => {
        const plan = CREDIT_TIER_PLANS[tier];
        return [tier, `${plan.label} · ${plan.credits / 1000}K créditos · ${formatQuoteMoney(plan.list, money, { withCode: true })}`];
      }),
    ),
  };
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Field label={`Plan de ${label}`}>
        <Select
          value={value.tier ?? NO_TIER}
          onValueChange={(next) =>
            onChange({ tier: !next || next === NO_TIER ? null : (next as CreditTier), packs: !next || next === NO_TIER ? 0 : value.packs })
          }
          items={items}
        >
          <SelectTrigger className="w-full" aria-label={`Plan de ${label}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(items).map(([tier, text]) => (
              <SelectItem key={tier} value={tier}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        label="Paquetes adicionales"
        description={`De ${pack.credits / 1000}K créditos, ${formatQuoteMoney(pack.list, money, { withCode: true })} cada uno. Máximo ${pack.maxPacks}.`}
        disabled={!value.tier}
      >
        <NumberField
          value={value.packs}
          onValueChange={(next) => onChange({ ...value, packs: Math.min(pack.maxPacks, Math.max(0, Math.floor(next ?? 0))) })}
          min={0}
          max={pack.maxPacks}
          disabled={!value.tier}
          aria-label={`Paquetes adicionales de ${label}`}
        />
      </Field>
    </div>
  );
}

// ── Precio de una línea ──────────────────────────────────────────────────────

interface LinePriceProps {
  listUnit: number;
  minUnit: number;
  priceUnit: number;
  money: MoneyContext;
  /** Insignia junto al precio: «Bajo el mínimo», «En el mínimo». */
  badge?: ReactNode;
}

/** Mínimo, lista y precio por unidad al año. */
export function LinePrice({ listUnit, minUnit, priceUnit, money, badge }: LinePriceProps) {
  const cell = (label: string, value: number, strong = false) => (
    <div className="flex flex-col items-end gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm tabular-nums", strong ? "font-semibold text-foreground" : "text-muted-foreground")}>
        {formatQuoteMoney(value, money, { unit: true })}
      </dd>
    </div>
  );
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {badge}
      <dl className="grid grid-cols-3 gap-4">
        {cell("Mínimo", minUnit)}
        {cell("Lista", listUnit)}
        {cell("Precio", priceUnit, true)}
      </dl>
    </div>
  );
}

interface ProductRowProps {
  title: string;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  muted?: boolean;
}

/** Una fila de producto: nombre y control a la izquierda, precios a la derecha. */
export function ProductRow({ title, description, control, children, muted = false }: ProductRowProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-border/60 py-4 first:pt-0 last:border-b-0 last:pb-0 md:flex-row md:items-center md:justify-between",
        muted && "text-muted-foreground",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {control}
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Resumen ──────────────────────────────────────────────────────────────────

export interface SummaryRow {
  label: string;
  value: number;
}

interface QuoteSummaryProps {
  status: ReactNode;
  discountParts: { label: string; value: number }[];
  rows: SummaryRow[];
  contract: number;
  years: number;
  money: MoneyContext;
  warnings: readonly QuoteWarning[];
  actions?: ReactNode;
  footnote?: ReactNode;
}

/** El resumen fijo a la derecha: de dónde sale el descuento, totales y acciones. */
export function QuoteSummary({ status, discountParts, rows, contract, years, money, warnings, actions, footnote }: QuoteSummaryProps) {
  const parts = discountParts.filter((part) => part.value !== 0);
  return (
    <div className="flex min-w-0 flex-col gap-0.75 rounded-2xl border border-border bg-frame p-0.75 lg:sticky lg:top-4">
      <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-1.5">
        <h3 className="text-sm font-medium text-foreground">Resumen</h3>
        {status}
      </div>
      <div className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5 shadow-card">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">De dónde sale el descuento</p>
          {parts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {parts.map((part) => (
                <Badge key={part.label} variant={part.value < 0 ? "warning" : "brand"}>
                  {part.label} {part.value < 0 ? "+" : "−"}
                  {formatQuotePercent(Math.abs(part.value))}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sin descuento: precio de lista.</p>
          )}
        </div>
        <dl className="space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="tabular-nums text-foreground">{formatQuoteMoney(row.value, money)}</dd>
            </div>
          ))}
        </dl>
        <div className="rounded-lg bg-muted p-4">
          <p className="text-xs text-muted-foreground">Total del contrato · {yearsLabel(years)}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
            {formatQuoteMoney(contract, money)} <span className="text-sm font-normal text-muted-foreground">{currencyCode(money)}</span>
          </p>
        </div>
        {warnings.length > 0 && (
          <div className="space-y-2">
            {warnings.map((warning) => (
              <Alert key={warning.code} variant="warning">
                <AlertDescription>{warning.message}</AlertDescription>
              </Alert>
            ))}
          </div>
        )}
        {actions && <div className="flex flex-col gap-2">{actions}</div>}
        {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
      </div>
    </div>
  );
}

/** Copia un texto y confirma con un «Copiado» de dos segundos. */
export function CopyButton({ text, label, variant = "outline" }: { text: string; label: string; variant?: "default" | "outline" }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={variant}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copiado" : label}
    </Button>
  );
}

// ── Otros plazos ─────────────────────────────────────────────────────────────

export interface OtherTermRow {
  years: number;
  multiYear: number;
  perYear: number;
  contract: number;
  /** Ahorro frente a contratar año a año (solo la 2026 lo muestra). */
  savings?: number;
}

/** El mismo cliente a otros plazos: cambia solo el descuento por plazo. */
export function OtherTermsTable({ rows, money }: { rows: OtherTermRow[]; money: MoneyContext }) {
  const withSavings = rows.some((row) => row.savings !== undefined);
  return (
    <Table containerClassName="overflow-x-auto">
      <TableHeader>
        <TableRow>
          <TableHead>Plazo</TableHead>
          <TableHead className="text-right">Descuento por plazo</TableHead>
          <TableHead className="text-right">Total por año ({currencyCode(money)})</TableHead>
          <TableHead className="text-right">Total del contrato ({currencyCode(money)})</TableHead>
          {withSavings && <TableHead className="text-right">Ahorro frente a 1 año ({currencyCode(money)})</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.years}>
            <TableCell>{yearsLabel(row.years)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatQuotePercent(row.multiYear)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatQuoteMoney(row.perYear, money)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatQuoteMoney(row.contract, money)}</TableCell>
            {withSavings && (
              <TableCell className="text-right tabular-nums">{row.savings ? formatQuoteMoney(row.savings, money) : "—"}</TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
