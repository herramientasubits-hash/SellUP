"use client";

/**
 * Cotizador · versión 2026 (vigente hasta el 31 de diciembre de 2026).
 *
 * Mismo orden que la 2027 —condiciones, productos, cotización final y
 * resumen—. Aquí ningún precio baja del mínimo: si el descuento lo pasa, el
 * precio se queda en el mínimo, así que no hay nada que aprobar.
 */

import { useMemo, useState } from "react";
import { Field } from "@/components/forms/field";
import { FormSection } from "@/components/forms/form-section";
import { NumberField } from "@/components/forms/number-field";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CREDIT_PACK_2026 } from "@/modules/sales-quote/credits";
import {
  MAX_LICENSES_2026,
  MODULES_2026,
  PACKAGE_DISCOUNT_2026,
  TERM_OPTIONS_2026,
  defaultQuote2026Input,
  productLabel2026,
  quote2026,
  type LearningPlan,
  type Module2026,
  type Quote2026Input,
  type Quote2026Line,
} from "@/modules/sales-quote/engine-2026";
import { moneyContextFor } from "@/modules/sales-quote/exchange-rates";
import { currencyCode, formatQuoteInteger, formatQuoteMoney, formatQuotePercent } from "@/modules/sales-quote/format";
import { findQuoteCountry, type QuoteCountry } from "@/modules/sales-quote/markets";
import { yearsLabel } from "@/modules/sales-quote/shared";
import { CopyButton, CreditPlanPicker, LinePrice, OtherTermsTable, ProductRow, QuoteConditions, QuoteSummary } from "./quote-parts";
import { LmsAiEstimator } from "./quote-estimators";
import { QuoteSavePanel } from "./quote-save-panel";

const MODULE_DESCRIPTIONS: Record<Module2026, string> = {
  assessments: "Evaluaciones de competencias.",
  desempeno: "Evaluación de desempeño.",
  planes: "Planes de trabajo y seguimiento de tareas.",
  encuestas: "Encuestas de clima y pulso.",
};

interface Quote2026ViewProps {
  countries: readonly QuoteCountry[];
  /** «Duplicar»: arranca con una cotización guardada. */
  initialInput?: Quote2026Input;
  initialClientName?: string;
  onSaved: () => void;
}

export function Quote2026View({ countries, initialInput, initialClientName = "", onSaved }: Quote2026ViewProps) {
  const [input, setInput] = useState<Quote2026Input>(() =>
    initialInput && countries.some((country) => country.code === initialInput.country)
      ? initialInput
      : { ...(initialInput ?? defaultQuote2026Input()), country: countries[0]?.code ?? "CO" },
  );
  const [clientName, setClientName] = useState(initialClientName);
  const [useLocalCurrency, setUseLocalCurrency] = useState(false);
  const result = useMemo(() => quote2026(input), [input]);
  const money = moneyContextFor(input.country, useLocalCurrency);
  const { main } = result;

  /** Cambiar país o licencias cambia el rango de precio: el precio pedido se descarta. */
  const patch = (next: Partial<Quote2026Input>) =>
    setInput((current) => ({
      ...current,
      ...next,
      priceOverride: next.licenses !== undefined || next.country !== undefined ? (next.priceOverride ?? null) : (next.priceOverride ?? current.priceOverride),
    }));
  const lineById = (id: string) => main.lines.find((line) => line.id === id);

  const linePrice = (line: Quote2026Line | undefined) =>
    line && (
      <LinePrice
        listUnit={line.listUnit}
        minUnit={line.minUnit}
        priceUnit={line.priceUnit}
        money={money}
        badge={line.floored ? <Badge variant="neutral">En el mínimo</Badge> : undefined}
      />
    );

  const listOverOne = main.listPerYear > 0 ? 1 - main.totalPerYear / main.listPerYear : 0;
  const discountParts = [
    { label: "Plazo", value: main.multiYear },
    { label: "Paquete", value: result.packageApplies ? PACKAGE_DISCOUNT_2026.discount : 0 },
    { label: "Pagos", value: result.paymentsDiscount },
  ];

  const country = findQuoteCountry(input.country)?.name ?? input.country;
  const summaryText = [
    `Cotización UBITS · ${clientName.trim() || "cliente sin nombre"} · ${country}`,
    `Plazo: ${yearsLabel(input.years)}. Pagos al año: ${input.payments}.`,
    "",
    ...main.lines.map(
      (line) =>
        `- ${line.name} (${line.detail}): ${formatQuoteMoney(line.priceUnit, money, { unit: true, withCode: true })} por unidad al año.`,
    ),
    "",
    `Total por año: ${formatQuoteMoney(main.totalPerYear, money, { withCode: true })}.`,
    `Total del contrato: ${formatQuoteMoney(main.contract, money, { withCode: true })}.`,
  ].join("\n");

  const priceRangeText = result.priceRange
    ? `Entre ${formatQuoteMoney(result.priceRange.min, money, { unit: true, withCode: true })} (mínimo) y ${formatQuoteMoney(result.priceRange.list, money, { unit: true, withCode: true })} (lista) por licencia al año.`
    : "Escribe las licencias para ver el rango de precio.";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <FormSection title="Cliente y condiciones" description="Dónde, por cuánto tiempo y cómo paga.">
          <QuoteConditions
            clientName={clientName}
            onClientName={setClientName}
            countries={countries}
            country={input.country}
            onCountry={(code) => patch({ country: code })}
            payments={input.payments}
            onPayments={(payments) => patch({ payments })}
            years={input.years}
            termOptions={TERM_OPTIONS_2026}
            onYears={(years) => patch({ years })}
            useLocalCurrency={useLocalCurrency}
            onUseLocalCurrency={setUseLocalCurrency}
            employees={input.employees}
            onEmployees={(employees) => patch({ employees })}
            licenses={input.licenses}
            onLicenses={(licenses) => patch({ licenses })}
            licensesHint={`Hasta ${formatQuoteInteger(MAX_LICENSES_2026)} en esta versión.`}
          >
            <Field label="Precio por licencia (USD, opcional)" description={priceRangeText}>
              <NumberField
                value={input.priceOverride}
                onValueChange={(value) => setInput((current) => ({ ...current, priceOverride: value }))}
                min={0}
                stepper="none"
                disabled={!result.priceRange}
                placeholder="Precio de lista"
                aria-label="Precio por licencia"
              />
            </Field>
          </QuoteConditions>
        </FormSection>

        <FormSection
          title="Productos"
          description={`Precios por unidad al año en ${currencyCode(money)}. Los módulos valen una parte del precio de Aprendizaje.`}
          actions={
            <Badge variant={result.packageApplies ? "brand" : "neutral"}>
              {result.productCount} {result.productCount === 1 ? "producto" : "productos"} · {formatQuotePercent(PACKAGE_DISCOUNT_2026.discount)} desde {PACKAGE_DISCOUNT_2026.minProducts}
            </Badge>
          }
        >
          <div>
            <ProductRow
              title="Aprendizaje"
              description="Siempre se incluye."
              control={
                <Tabs value={input.learningPlan} onValueChange={(value) => patch({ learningPlan: value as LearningPlan })}>
                  <TabsList variant="segmented" aria-label="Plan de Aprendizaje">
                    <TabsTrigger value="executive">Executive</TabsTrigger>
                    <TabsTrigger value="standard">Standard</TabsTrigger>
                  </TabsList>
                </Tabs>
              }
            >
              {linePrice(lineById(input.learningPlan))}
            </ProductRow>
            {MODULES_2026.map((module) => (
              <ProductRow
                key={module}
                title={productLabel2026(module)}
                description={MODULE_DESCRIPTIONS[module]}
                control={
                  <Checkbox
                    checked={input.modules[module]}
                    onCheckedChange={(value) => patch({ modules: { ...input.modules, [module]: value === true } })}
                    aria-label={`Incluir ${productLabel2026(module)}`}
                  />
                }
              >
                {linePrice(lineById(module))}
              </ProductRow>
            ))}
          </div>
        </FormSection>

        <FormSection title="Selección" description="Precio fijo por plan de créditos, sin factor de país. Cuenta para el paquete.">
          <CreditPlanPicker label="Selección" value={input.selection} pack={CREDIT_PACK_2026} money={money} onChange={(selection) => patch({ selection })} />
          {lineById("hiring") && (
            <div className="space-y-3">
              <ProductRow title="Plan de Selección" description={lineById("hiring")?.detail}>
                {linePrice(lineById("hiring"))}
              </ProductRow>
              {lineById("hiring_topup") && (
                <ProductRow title="Paquetes adicionales" description={lineById("hiring_topup")?.detail}>
                  {linePrice(lineById("hiring_topup"))}
                </ProductRow>
              )}
            </div>
          )}
        </FormSection>

        <FormSection title="LMS AI" description="Complemento de Aprendizaje: créditos para crear cursos con IA. Se cobra como servicio y no recibe el descuento de paquete.">
          <CreditPlanPicker label="LMS AI" value={input.lmsAi} pack={CREDIT_PACK_2026} money={money} onChange={(lmsAi) => patch({ lmsAi })} />
          {lineById("lmsai") && (
            <div className="space-y-3">
              <ProductRow title="Plan de LMS AI" description={lineById("lmsai")?.detail}>
                {linePrice(lineById("lmsai"))}
              </ProductRow>
              {lineById("lmsai_topup") && (
                <ProductRow title="Paquetes adicionales" description={lineById("lmsai_topup")?.detail}>
                  {linePrice(lineById("lmsai_topup"))}
                </ProductRow>
              )}
            </div>
          )}
          <LmsAiEstimator value={input.lmsAi} pack={CREDIT_PACK_2026} money={money} onApply={(lmsAi) => patch({ lmsAi })} />
        </FormSection>

        <FormSection title="Cotización final" description={`Lo que paga el cliente en ${currencyCode(money)} con ${yearsLabel(input.years)}.`}>
          {main.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Escribe las licencias para ver la cotización.</p>
          ) : (
            <Table containerClassName="overflow-x-auto">
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Lista</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead className="text-right">Precio unitario</TableHead>
                  <TableHead className="text-right">Por año</TableHead>
                  <TableHead className="text-right">Contrato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {main.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <span className="text-foreground">{line.name}</span>
                      <span className="block text-xs text-muted-foreground">{line.detail}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatQuoteInteger(line.qty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQuoteMoney(line.listUnit, money, { unit: true })}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatQuoteMoney(line.minUnit, money, { unit: true })}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatQuoteMoney(line.priceUnit, money, { unit: true })}
                      {line.floored && <Badge variant="neutral" className="ml-2">En el mínimo</Badge>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatQuoteMoney(line.total, money)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQuoteMoney(line.total * input.years, money)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5}>Totales</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQuoteMoney(main.totalPerYear, money)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQuoteMoney(main.contract, money)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </FormSection>

        {main.lines.length > 0 && (
          <FormSection title="Otros plazos" description="Referencia: el mismo cliente con otro plazo. Cambia solo el descuento por plazo; el ahorro es frente a contratar año a año.">
            <OtherTermsTable
              rows={result.terms.map((term) => ({
                years: term.years,
                multiYear: term.multiYear,
                perYear: term.totalPerYear,
                contract: term.contract,
                savings: result.oneYear.totalPerYear * term.years - term.contract,
              }))}
              money={money}
            />
          </FormSection>
        )}
      </div>

      <QuoteSummary
        status={main.lines.length > 0 ? <Badge variant="success">Lista para enviar</Badge> : <Badge variant="neutral">Borrador</Badge>}
        discountParts={discountParts}
        rows={[
          { label: "Licencias y Selección por año", value: main.subscriptionPerYear },
          { label: "LMS AI por año", value: main.servicesPerYear },
          { label: "Total por año", value: main.totalPerYear },
          ...(input.years > 1
            ? [{ label: "Ahorro frente a contratar año a año", value: (result.oneYear.totalPerYear - main.totalPerYear) * input.years }]
            : []),
        ]}
        contract={main.contract}
        years={input.years}
        money={money}
        warnings={result.warnings}
        actions={
          main.lines.length > 0 && (
            <>
              <CopyButton text={summaryText} label="Copiar resumen" />
              <QuoteSavePanel version="2026" input={input} clientName={clientName} needsApproval={false} disabled={result.blocked} onSaved={onSaved} />
            </>
          )
        }
        footnote={
          main.lines.length > 0
            ? `${formatQuotePercent(listOverOne)} por debajo del precio de lista. En esta versión ningún precio baja del mínimo.`
            : undefined
        }
      />
    </div>
  );
}
