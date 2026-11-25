"use client";

/**
 * Cotizador · versión 2027.
 *
 * El vendedor arma la cotización en el orden en que se conversa con el
 * cliente: condiciones, productos y la cotización final. A la derecha, el
 * resumen dice cuánto paga, de dónde sale el descuento y si hace falta pedir
 * aprobación (alguna línea bajo el mínimo).
 */

import { useMemo, useState } from "react";
import { FormSection } from "@/components/forms/form-section";
import { NumberField } from "@/components/forms/number-field";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CREDIT_PACK_2027 } from "@/modules/sales-quote/credits";
import {
  LICENSE_RANGE,
  TERM_OPTIONS_2027,
  defaultQuote2027Input,
  manualDiscountFor,
  quote2027,
  type Line2027Id,
  type Quote2027Input,
  type Quote2027Line,
} from "@/modules/sales-quote/engine-2027";
import { moneyContextFor } from "@/modules/sales-quote/exchange-rates";
import { currencyCode, formatQuoteInteger, formatQuoteMoney, formatQuotePercent } from "@/modules/sales-quote/format";
import { findQuoteCountry, type QuoteCountry } from "@/modules/sales-quote/markets";
import { applySalesRules2027 } from "@/modules/sales-quote/sales-rules";
import { yearsLabel } from "@/modules/sales-quote/shared";
import { CopyButton, CreditPlanPicker, LinePrice, OtherTermsTable, ProductRow, QuoteConditions, QuoteSummary } from "./quote-parts";
import { LmsAiEstimator, SelectionEstimator, SelectionRoiPanel } from "./quote-estimators";
import { EMPTY_CLIENT, type QuoteClientRef } from "./quote-client-picker";
import { QuoteSavePanel } from "./quote-save-panel";

interface Quote2027ViewProps {
  countries: readonly QuoteCountry[];
  /** «Duplicar»: arranca con una cotización guardada. */
  initialInput?: Quote2027Input;
  initialClient?: QuoteClientRef;
  onSaved: () => void;
}

export function Quote2027View({ countries, initialInput, initialClient = EMPTY_CLIENT, onSaved }: Quote2027ViewProps) {
  const [input, setInput] = useState<Quote2027Input>(() =>
    initialInput && countries.some((country) => country.code === initialInput.country)
      ? initialInput
      : { ...(initialInput ?? defaultQuote2027Input()), country: countries[0]?.code ?? "CO" },
  );
  const [client, setClient] = useState<QuoteClientRef>(initialClient);
  const [useLocalCurrency, setUseLocalCurrency] = useState(false);
  const result = useMemo(() => quote2027(input), [input]);
  const money = moneyContextFor(input.country, useLocalCurrency);
  const patch = (next: Partial<Quote2027Input>) => setInput((current) => applySalesRules2027({ ...current, ...next }));
  const lineById = (id: Line2027Id) => result.lines.find((line) => line.id === id);

  const setLineDiscount = (line: Quote2027Line, percent: number | null) =>
    setInput((current) => ({
      ...current,
      manualDiscounts: { ...current.manualDiscounts, [line.id]: manualDiscountFor((percent ?? 0) / 100, line.autoDiscount) },
    }));

  const discountControl = (line: Quote2027Line | undefined) =>
    line && (
      <div className="flex items-center gap-2">
        <NumberField
          size="sm"
          className="w-24"
          value={Math.round(line.discount * 1000) / 10}
          onValueChange={(next) => setLineDiscount(line, next)}
          min={0}
          max={100}
          step={1}
          suffix="%"
          stepper="none"
          aria-label={`Descuento de ${line.name}`}
        />
        <span className="text-xs text-muted-foreground">máx. {formatQuotePercent(line.maxDiscount)}</span>
      </div>
    );

  const linePrice = (line: Quote2027Line | undefined) =>
    line && (
      <div className="flex flex-col items-end gap-2">
        <LinePrice
          listUnit={line.listUnit}
          minUnit={line.minUnit}
          priceUnit={line.priceUnit}
          money={money}
          badge={line.belowMinimum ? <Badge variant="warning">Bajo el mínimo</Badge> : undefined}
        />
        {discountControl(line)}
      </div>
    );

  const coverageText =
    result.coverage !== null
      ? `Cobertura ${formatQuotePercent(result.coverage)}${result.coverageApplies ? ": suma 10 % de descuento" : " (desde 90 % suma 10 % de descuento)"}.`
      : "Con los empleados se calcula la cobertura.";

  const needsApproval = result.belowMinimum.length > 0;
  const status = needsApproval ? (
    <Badge variant="warning">Necesita aprobación</Badge>
  ) : result.lines.length > 0 ? (
    <Badge variant="success">Lista para enviar</Badge>
  ) : (
    <Badge variant="neutral">Borrador</Badge>
  );

  const discountParts = result.lines[0]
    ? [
        { label: "Plazo", value: result.lines[0].breakdown.multiYear },
        { label: "Cobertura", value: result.lines[0].breakdown.coverage },
        { label: "Paquete", value: result.lines[0].breakdown.package },
        { label: "Pagos", value: result.lines[0].breakdown.payments },
      ]
    : [];

  const country = findQuoteCountry(input.country)?.name ?? input.country;
  const summaryText = [
    `Cotización UBITS · ${client.name.trim() || "cliente sin nombre"} · ${country}`,
    `Plazo: ${yearsLabel(input.years)}. Pagos al año: ${input.payments}.`,
    "",
    ...result.lines.map(
      (line) =>
        `- ${line.name} (${line.detail}): ${formatQuoteMoney(line.priceUnit, money, { unit: true, withCode: true })} por unidad al año, descuento ${formatQuotePercent(line.discount)}.`,
    ),
    "",
    `Total por año: ${formatQuoteMoney(result.totals.afterPerYear, money, { withCode: true })}.`,
    `Total del contrato: ${formatQuoteMoney(result.totals.contract, money, { withCode: true })}.`,
  ].join("\n");

  const selectionInvestment = result.lines
    .filter((line) => line.id === "hiring" || line.id === "hiring_topup")
    .reduce((sum, line) => sum + line.totalAfter, 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <FormSection title="Cliente y condiciones" description="Dónde, por cuánto tiempo y cómo paga.">
          <QuoteConditions
            client={client}
            onClient={setClient}
            countries={countries}
            country={input.country}
            onCountry={(code) => patch({ country: code })}
            payments={input.payments}
            onPayments={(payments) => patch({ payments })}
            years={input.years}
            termOptions={TERM_OPTIONS_2027}
            onYears={(years) => patch({ years })}
            useLocalCurrency={useLocalCurrency}
            onUseLocalCurrency={setUseLocalCurrency}
            employees={input.employees}
            onEmployees={(employees) => patch({ employees })}
            licenses={input.licenses}
            onLicenses={(licenses) => patch({ licenses })}
            licensesHint={input.includeLearning ? coverageText : "Solo cuentan si incluyes Aprendizaje."}
          />
        </FormSection>

        <FormSection
          title="Productos"
          description={`Precios por unidad al año en ${currencyCode(money)}. Escribe el descuento total de cada línea; pasar el máximo pide aprobación.`}
          actions={result.packageApplies ? <Badge variant="brand">Paquete completo · 5 %</Badge> : undefined}
        >
          <div>
            <ProductRow
              title="Aprendizaje"
              description={
                input.includeLearning
                  ? `Por licencia. ${formatQuoteInteger(input.licenses)} licencias${input.licenses > 0 && input.licenses < LICENSE_RANGE.min ? ` (se cobran como ${LICENSE_RANGE.min})` : ""}.`
                  : "No se incluye: la cotización es solo de Selección (sin LMS AI ni Desempeño y Cultura)."
              }
              control={
                <Switch
                  checked={input.includeLearning}
                  onCheckedChange={(value) => patch({ includeLearning: Boolean(value) })}
                  aria-label="Incluir Aprendizaje"
                />
              }
            />
            {input.includeLearning && (
              <>
                <ProductRow title="LMS Creator" description="Siempre va con Aprendizaje.">
                  {linePrice(lineById("creator"))}
                </ProductRow>
                <ProductRow
                  title="Contenido"
                  description="Biblioteca de cursos UBITS."
                  control={
                    <Checkbox
                      checked={input.content}
                      onCheckedChange={(value) => patch({ content: value === true })}
                      aria-label="Incluir Contenido"
                    />
                  }
                >
                  {linePrice(lineById("contenido"))}
                </ProductRow>
                <div className="space-y-4 border-b border-border/60 py-4">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-foreground">LMS AI</p>
                    <p className="text-sm text-muted-foreground">
                      Parte de Aprendizaje: créditos para crear cursos con IA. No se vende solo y no cuenta para el paquete.
                    </p>
                  </div>
                  <CreditPlanPicker label="LMS AI" value={input.lmsAi} pack={CREDIT_PACK_2027} money={money} onChange={(lmsAi) => patch({ lmsAi })} />
                  {lineById("lmsai") && (
                    <div>
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
                  <LmsAiEstimator value={input.lmsAi} pack={CREDIT_PACK_2027} money={money} onApply={(lmsAi) => patch({ lmsAi })} />
                </div>
              </>
            )}
            <ProductRow
              title="Desempeño y Cultura"
              description={input.includeLearning ? "Desempeño y encuestas en un solo producto. Precio fijo anual." : "Requiere Aprendizaje."}
              control={
                <Checkbox
                  checked={input.performanceCulture}
                  disabled={!input.includeLearning}
                  onCheckedChange={(value) => patch({ performanceCulture: value === true })}
                  aria-label="Incluir Desempeño y Cultura"
                />
              }
            >
              {linePrice(lineById("dc"))}
            </ProductRow>
          </div>
        </FormSection>


        <FormSection title="Selección" description="Se vende solo o con Aprendizaje. Precio fijo por plan de créditos, sin factor de país.">
          <CreditPlanPicker label="Selección" value={input.selection} pack={CREDIT_PACK_2027} money={money} onChange={(selection) => patch({ selection })} />
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
          <SelectionEstimator value={input.selection} pack={CREDIT_PACK_2027} money={money} onApply={(selection) => patch({ selection })} />
          {input.selection.tier && <SelectionRoiPanel key={selectionInvestment} quotedInvestment={selectionInvestment} />}
        </FormSection>

        <FormSection title="Cotización final" description={`Lo que paga el cliente en ${currencyCode(money)} con ${yearsLabel(input.years)}.`}>
          {result.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Escribe las licencias o elige un plan para ver la cotización.</p>
          ) : (
            <Table containerClassName="overflow-x-auto">
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Lista</TableHead>
                  <TableHead className="text-right">Descuento</TableHead>
                  <TableHead className="text-right">Precio unitario</TableHead>
                  <TableHead className="text-right">Por año sin descuento</TableHead>
                  <TableHead className="text-right">Por año con descuento</TableHead>
                  <TableHead className="text-right">Contrato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <span className="text-foreground">{line.name}</span>
                      <span className="block text-xs text-muted-foreground">{line.detail}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatQuoteInteger(line.qty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQuoteMoney(line.listUnit, money, { unit: true })}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuotePercent(line.discount)}
                      {line.belowMinimum && <Badge variant="warning" className="ml-2">Bajo el mínimo</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatQuoteMoney(line.priceUnit, money, { unit: true })}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatQuoteMoney(line.totalBefore, money)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQuoteMoney(line.totalAfter, money)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQuoteMoney(line.totalAfter * input.years, money)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5}>Totales</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQuoteMoney(result.totals.beforePerYear, money)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQuoteMoney(result.totals.afterPerYear, money)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQuoteMoney(result.totals.contract, money)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </FormSection>

        {result.lines.length > 0 && (
          <FormSection
            title="Otros plazos"
            description="Referencia: el mismo cliente con otro plazo. Cambia solo el descuento por plazo; los descuentos manuales se mantienen."
          >
            <OtherTermsTable
              rows={result.otherTerms.map((term) => ({ years: term.years, multiYear: term.multiYear, perYear: term.afterPerYear, contract: term.contract }))}
              money={money}
            />
          </FormSection>
        )}
      </div>

      <QuoteSummary
        status={status}
        discountParts={discountParts}
        rows={[
          { label: "Total por año sin descuento", value: result.totals.beforePerYear },
          { label: "Total por año con descuento", value: result.totals.afterPerYear },
          { label: "Ahorro en el contrato", value: result.totals.savings },
        ]}
        contract={result.totals.contract}
        years={input.years}
        money={money}
        warnings={result.warnings}
        actions={
          result.lines.length > 0 && (
            <>
              <CopyButton text={summaryText} label="Copiar resumen" />
              <QuoteSavePanel
                version="2027"
                input={input}
                client={client}
                needsApproval={needsApproval}
                disabled={result.blockedByOperations}
                onSaved={onSaved}
              />
            </>
          )
        }
        footnote={
          needsApproval
            ? `${result.belowMinimum.length === 1 ? "Una línea queda" : `${result.belowMinimum.length} líneas quedan`} bajo el mínimo: al pedir aprobación le llega a quien aprueba descuentos, en SellUp y por Slack.`
            : undefined
        }
      />
    </div>
  );
}
