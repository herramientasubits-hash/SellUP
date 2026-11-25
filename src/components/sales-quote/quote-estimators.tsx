"use client";

/**
 * Ayudas para elegir el plan de créditos (LMS AI y Selección) y el retorno del
 * cliente con Selección. Van plegadas: son para cuando el vendedor necesita
 * justificar el plan, no para cada cotización.
 */

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "@/icons";
import { Field } from "@/components/forms/field";
import { MetricStrip } from "@/components/shared/metric-strip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { NumberField } from "@/components/forms/number-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CREDIT_FIT_LABELS,
  CREDIT_TIER_PLANS,
  DEFAULT_LMS_AI_USAGE_SET,
  DEFAULT_SELECTION_VACANCIES,
  LMS_AI_USAGE_SETS,
  SELECTION_INDUSTRY_MIXES,
  SELECTION_SERVICES,
  SELECTION_SERVICE_CREDITS,
  SELECTION_SERVICE_LABELS,
  baseUsageQuantities,
  creditFit,
  creditTierOptions,
  lmsAiUsage,
  recommendCreditTier,
  selectionCreditsUsed,
  selectionMix,
  withCourses,
  type CreditFit,
  type CreditPack,
  type CreditSelection,
  type LmsAiUsageSetId,
  type SelectionMix,
  type UsageQuantities,
} from "@/modules/sales-quote/credits";
import type { MoneyContext } from "@/modules/sales-quote/exchange-rates";
import { formatQuoteInteger, formatQuoteMoney, formatQuotePercent } from "@/modules/sales-quote/format";
import {
  DEFAULT_SELECTION_INVESTMENT,
  DEFAULT_SELECTION_ROI_INPUT,
  RECRUITER_SALARY_PRESETS,
  selectionRoi,
} from "@/modules/sales-quote/selection-roi";

const FIT_VARIANT: Record<CreditFit, "success" | "warning" | "negative"> = {
  fits: "success",
  tight: "warning",
  short: "negative",
};

function FoldingPanel({ title, summary, children }: { title: string; summary?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/40">
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-foreground">{title}</span>
          {summary}
        </span>
        <ChevronDownIcon className={open ? "size-4 rotate-180 text-muted-foreground transition-transform" : "size-4 text-muted-foreground transition-transform"} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-5 border-t border-border/60 p-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Los tres planes con el mismo consumo: cuánto cubre cada uno, cuántos paquetes
 * adicionales le harían falta y el costo anual de lista. El recomendado es el
 * más barato que alcanza.
 */
function PlanComparison({
  used,
  pack,
  current,
  money,
  onApply,
}: {
  used: number;
  pack: CreditPack;
  current: CreditSelection;
  money: MoneyContext;
  onApply: (value: CreditSelection) => void;
}) {
  const recommended = recommendCreditTier(used, pack);
  if (!recommended) return <p className="text-sm text-muted-foreground">Escribe un consumo para ver qué plan le sirve.</p>;
  const options = creditTierOptions(used, pack);
  const currentCapacity = current.tier ? CREDIT_TIER_PLANS[current.tier].credits + current.packs * pack.credits : 0;
  const chosenFalls = current.tier !== null && used > currentCapacity;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Mismo consumo en cada plan; se recomienda el de menor costo anual de lista.</p>
      <Table containerClassName="overflow-x-auto">
        <TableHeader>
          <TableRow>
            <TableHead>Plan</TableHead>
            <TableHead className="text-right">Precio</TableHead>
            <TableHead className="text-right">Créditos</TableHead>
            <TableHead className="text-right">Uso del plan</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Paquetes adicionales</TableHead>
            <TableHead className="text-right">Costo anual</TableHead>
            <TableHead className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {options.map((option) => {
            const plan = CREDIT_TIER_PLANS[option.tier];
            const isRecommended = option.tier === recommended.tier;
            const isCurrent = current.tier === option.tier && current.packs === option.packs;
            return (
              <TableRow key={option.tier} data-state={isRecommended ? "selected" : undefined}>
                <TableCell>
                  <span className="font-medium text-foreground">{plan.label}</span>
                  {isRecommended && <Badge variant="brand" className="ml-2">Recomendado</Badge>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatQuoteMoney(option.price, money)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQuoteInteger(option.credits)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQuotePercent(option.ratio)}</TableCell>
                <TableCell>
                  <Badge variant={FIT_VARIANT[option.fit]}>{CREDIT_FIT_LABELS[option.fit]}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatQuoteInteger(option.packs)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatQuoteMoney(option.totalCost, money)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant={isCurrent ? "outline" : isRecommended ? "default" : "ghost"} disabled={isCurrent} onClick={() => onApply({ tier: option.tier, packs: option.packs })}>
                    {isCurrent ? "Elegido" : "Usar"}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {chosenFalls && (
        <Alert variant="warning">
          <AlertDescription>El plan elegido no alcanza para este consumo: sube de plan o agrega paquetes adicionales.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ── LMS AI ───────────────────────────────────────────────────────────────────

export function LmsAiEstimator({
  value,
  pack,
  money,
  onApply,
}: {
  value: CreditSelection;
  pack: CreditPack;
  money: MoneyContext;
  onApply: (value: CreditSelection) => void;
}) {
  const [setId, setSetId] = useState<LmsAiUsageSetId>(DEFAULT_LMS_AI_USAGE_SET);
  const [quantities, setQuantities] = useState<Record<LmsAiUsageSetId, UsageQuantities>>({
    artefacto: baseUsageQuantities("artefacto"),
    unificado: baseUsageQuantities("unificado"),
  });
  const set = LMS_AI_USAGE_SETS[setId];
  const current = quantities[setId];
  const usage = lmsAiUsage(setId, current, value.tier, value.packs, pack);
  const update = (next: UsageQuantities) => setQuantities((all) => ({ ...all, [setId]: next }));

  return (
    <FoldingPanel
      title="Estimar consumo de LMS AI"
      summary={
        usage.used > 0 && (
          <>
            <span className="tabular-nums text-muted-foreground">
              {formatQuoteInteger(usage.used)} créditos al año
              {value.tier && ` · ${formatQuotePercent(usage.ratio)} del plan`}
            </span>
            {value.tier && <Badge variant={FIT_VARIANT[usage.fit]}>{CREDIT_FIT_LABELS[usage.fit]}</Badge>}
          </>
        )
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Costos de créditos" description="Tabla con que se calcula cada uso. Artefacto es la vigente.">
          <Select
            value={setId}
            onValueChange={(next) => next && setSetId(next as LmsAiUsageSetId)}
            items={Object.fromEntries(Object.values(LMS_AI_USAGE_SETS).map((item) => [item.id, item.label]))}
          >
            <SelectTrigger className="w-full" aria-label="Costos de créditos">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(LMS_AI_USAGE_SETS).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Cursos completos al año" description={`Un curso completo usa ${formatQuoteInteger(set.course.credits)} créditos.`}>
          <NumberField
            value={current[set.course.rows[0]] ?? 0}
            onValueChange={(next) => update(withCourses(setId, current, Math.max(0, Math.floor(next ?? 0))))}
            min={0}
            aria-label="Cursos completos al año"
          />
        </Field>
      </div>
      <Table containerClassName="overflow-x-auto">
        <TableHeader>
          <TableRow>
            <TableHead>Uso</TableHead>
            <TableHead className="text-right">Créditos por uso</TableHead>
            <TableHead className="w-32 text-right">Usos al año</TableHead>
            <TableHead className="text-right">Créditos al año</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {set.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <span className="text-foreground">{row.name}</span>
                <span className="block text-xs text-muted-foreground">{row.group}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatQuoteInteger(row.credits)}</TableCell>
              <TableCell className="text-right">
                <NumberField
                  size="sm"
                  value={current[row.id] ?? 0}
                  onValueChange={(next) => update({ ...current, [row.id]: Math.max(0, Math.floor(next ?? 0)) })}
                  min={0}
                  stepper="none"
                  aria-label={`Usos al año: ${row.name}`}
                />
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatQuoteInteger(row.credits * Math.max(0, current[row.id] ?? 0))}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {usage.used > 0 && (
        <MetricStrip
          aria-label="Consumo de LMS AI"
          items={[
            { label: "Créditos al año", value: formatQuoteInteger(usage.used) },
            {
              label: "Capacidad",
              value: formatQuoteInteger(usage.capacity),
              description: value.tier ? "Plan elegido y paquetes" : "Plan recomendado",
            },
            {
              label: usage.balance >= 0 ? "Sobran" : "Faltan",
              value: `${formatQuoteInteger(Math.abs(usage.balance))} créditos`,
              aside: <Badge variant={FIT_VARIANT[usage.fit]}>{CREDIT_FIT_LABELS[usage.fit]}</Badge>,
            },
            {
              label: "Cursos que aún caben",
              value: (Math.round(Math.max(0, usage.coursesLeft) * 10) / 10).toLocaleString("es-CO"),
              description: `De ${formatQuoteInteger(set.course.credits)} créditos cada uno`,
            },
            { label: "Valor del uso", value: formatQuoteMoney(usage.usdValue, money, { withCode: true }) },
            { label: "Uso mensual promedio", value: `${formatQuoteInteger(Math.round(usage.monthly))} créditos` },
          ]}
        />
      )}
      <PlanComparison used={usage.used} pack={pack} current={value} money={money} onApply={onApply} />
    </FoldingPanel>
  );
}

// ── Selección ────────────────────────────────────────────────────────────────

export function SelectionEstimator({
  value,
  pack,
  money,
  onApply,
}: {
  value: CreditSelection;
  pack: CreditPack;
  money: MoneyContext;
  onApply: (value: CreditSelection) => void;
}) {
  const [industry, setIndustry] = useState(0);
  const [vacancies, setVacancies] = useState(DEFAULT_SELECTION_VACANCIES);
  const [mix, setMix] = useState<SelectionMix>(() => selectionMix(0));
  const used = selectionCreditsUsed(vacancies, mix);
  const capacity = value.tier ? CREDIT_TIER_PLANS[value.tier].credits + value.packs * pack.credits : 0;
  const fit = creditFit(capacity > 0 ? used / capacity : 0);

  return (
    <FoldingPanel
      title="Estimar consumo de Selección"
      summary={
        used > 0 && (
          <>
            <span className="tabular-nums text-muted-foreground">{formatQuoteInteger(used)} créditos al año</span>
            {value.tier && <Badge variant={FIT_VARIANT[fit]}>{CREDIT_FIT_LABELS[fit]}</Badge>}
          </>
        )
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Industria del cliente" description="Define cuántas veces se usa cada servicio por vacante.">
          <Select
            value={String(industry)}
            onValueChange={(next) => {
              const index = Number(next ?? 0);
              setIndustry(index);
              setMix(selectionMix(index));
            }}
            items={Object.fromEntries(SELECTION_INDUSTRY_MIXES.map((item, index) => [String(index), item.label]))}
          >
            <SelectTrigger className="w-full" aria-label="Industria del cliente">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SELECTION_INDUSTRY_MIXES.map((item, index) => (
                <SelectItem key={item.label} value={String(index)}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Vacantes al año">
          <NumberField
            value={vacancies}
            onValueChange={(next) => setVacancies(Math.max(0, Math.floor(next ?? 0)))}
            min={0}
            aria-label="Vacantes al año"
          />
        </Field>
      </div>
      <Table containerClassName="overflow-x-auto">
        <TableHeader>
          <TableRow>
            <TableHead>Servicio</TableHead>
            <TableHead className="text-right">Créditos por uso</TableHead>
            <TableHead className="w-32 text-right">Usos por vacante</TableHead>
            <TableHead className="text-right">Usos al año</TableHead>
            <TableHead className="text-right">Créditos al año</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SELECTION_SERVICES.map((service) => (
            <TableRow key={service}>
              <TableCell className="text-foreground">{SELECTION_SERVICE_LABELS[service]}</TableCell>
              <TableCell className="text-right tabular-nums">
                {SELECTION_SERVICE_CREDITS[service] === 0 ? <Badge variant="neutral">Incluido</Badge> : formatQuoteInteger(SELECTION_SERVICE_CREDITS[service])}
              </TableCell>
              <TableCell className="text-right">
                <NumberField
                  size="sm"
                  value={mix[service]}
                  onValueChange={(next) => setMix((all) => ({ ...all, [service]: Math.max(0, Math.floor(next ?? 0)) }))}
                  min={0}
                  stepper="none"
                  aria-label={`Usos por vacante: ${SELECTION_SERVICE_LABELS[service]}`}
                />
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatQuoteInteger(Math.max(0, mix[service]) * vacancies)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatQuoteInteger(Math.max(0, mix[service]) * vacancies * SELECTION_SERVICE_CREDITS[service])}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {used > 0 && value.tier && (
        <MetricStrip
          aria-label="Consumo de Selección"
          items={[
            { label: "Créditos al año", value: formatQuoteInteger(used) },
            { label: "Capacidad", value: formatQuoteInteger(capacity), description: "Plan elegido y paquetes" },
            {
              label: capacity - used >= 0 ? "Sobran" : "Faltan",
              value: `${formatQuoteInteger(Math.abs(capacity - used))} créditos`,
              aside: <Badge variant={FIT_VARIANT[fit]}>{CREDIT_FIT_LABELS[fit]}</Badge>,
            },
          ]}
        />
      )}
      <PlanComparison used={used} pack={pack} current={value} money={money} onApply={onApply} />
    </FoldingPanel>
  );
}

// ── Retorno del cliente con Selección ────────────────────────────────────────

export function SelectionRoiPanel({ quotedInvestment }: { quotedInvestment: number }) {
  const [investment, setInvestment] = useState<number>(quotedInvestment || DEFAULT_SELECTION_INVESTMENT);
  const [inputs, setInputs] = useState(DEFAULT_SELECTION_ROI_INPUT);
  const roi = useMemo(() => selectionRoi({ ...inputs, annualInvestment: investment }), [inputs, investment]);
  const usd = (value: number) => `US$${Math.round(value).toLocaleString("es-CO")}`;
  const oneDecimal = (value: number) => value.toLocaleString("es-CO", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

  return (
    <FoldingPanel
      title="Retorno del cliente con Selección"
      summary={
        investment > 0 && (
          <span className="tabular-nums text-muted-foreground">
            Se paga en {oneDecimal(roi.paybackMonths)} meses · {oneDecimal(roi.returnPerDollar)} USD por cada USD
          </span>
        )
      }
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Inversión anual en Selección (USD)"
          description={
            quotedInvestment > 0 && quotedInvestment !== investment ? (
              <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => setInvestment(quotedInvestment)}>
                Usar lo cotizado ({usd(quotedInvestment)})
              </button>
            ) : undefined
          }
        >
          <NumberField value={investment} onValueChange={(next) => setInvestment(Math.max(0, next ?? 0))} min={0} stepper="none" aria-label="Inversión anual en Selección" />
        </Field>
        <Field label="Personas en reclutamiento">
          <NumberField value={inputs.recruiters} onValueChange={(next) => setInputs((all) => ({ ...all, recruiters: Math.max(0, Math.floor(next ?? 0)) }))} min={0} aria-label="Personas en reclutamiento" />
        </Field>
        <Field
          label="Salario mensual por reclutador (USD)"
          description={
            <span className="flex flex-wrap gap-2">
              {RECRUITER_SALARY_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="text-primary underline-offset-4 hover:underline"
                  onClick={() => setInputs((all) => ({ ...all, recruiterMonthlySalary: preset.value }))}
                >
                  {preset.label}: {preset.value}
                </button>
              ))}
            </span>
          }
        >
          <NumberField value={inputs.recruiterMonthlySalary} onValueChange={(next) => setInputs((all) => ({ ...all, recruiterMonthlySalary: Math.max(0, next ?? 0) }))} min={0} stepper="none" aria-label="Salario mensual por reclutador" />
        </Field>
        <Field label="Pago anual a terceros (USD)" description="Psicometría, idiomas y antecedentes: ya vienen en los créditos.">
          <NumberField value={inputs.thirdPartyAnnualCost} onValueChange={(next) => setInputs((all) => ({ ...all, thirdPartyAnnualCost: Math.max(0, next ?? 0) }))} min={0} stepper="none" aria-label="Pago anual a terceros" />
        </Field>
        <Field label="Días para cubrir una vacante hoy">
          <NumberField value={inputs.daysToFill} onValueChange={(next) => setInputs((all) => ({ ...all, daysToFill: Math.max(0, Math.floor(next ?? 0)) }))} min={0} aria-label="Días para cubrir una vacante hoy" />
        </Field>
      </div>
      <div className="space-y-1 rounded-lg bg-muted p-4">
        <p className="text-xs text-muted-foreground">Retorno de la inversión</p>
        <p className="text-lg font-semibold tracking-tight text-foreground">
          {investment > 0 && roi.grossSavingsPerYear > 0
            ? `La inversión se recupera en ${oneDecimal(roi.paybackMonths)} meses`
            : "Escribe la inversión y el equipo para ver el retorno"}
        </p>
        {investment > 0 && roi.grossSavingsPerYear > 0 && (
          <p className="text-sm text-muted-foreground">
            Por cada US$1 invertido, el cliente recupera US${oneDecimal(roi.returnPerDollar)} al año.
          </p>
        )}
      </div>
      <MetricStrip
        aria-label="Retorno del cliente"
        items={[
          { label: "Inversión anual", value: usd(investment) },
          { label: "Ahorro bruto al año", value: usd(roi.grossSavingsPerYear), description: "Horas liberadas + terceros" },
          {
            label: roi.netSavingsPerYear >= 0 ? "Ahorro neto al año" : "Déficit neto al año",
            value: usd(Math.abs(roi.netSavingsPerYear)),
            description: "Bruto menos la inversión",
          },
        ]}
      />
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">De dónde sale el retorno</p>
        <MetricStrip
          aria-label="De dónde sale el retorno"
          items={[
            {
              label: "Horas del equipo liberadas",
              value: usd(roi.hoursSavingsPerYear),
              description: `${formatQuoteInteger(roi.hoursFreedPerYear)} horas al año, valorizadas al costo por hora del reclutador`,
            },
            {
              label: "Terceros que deja de pagar",
              value: usd(inputs.thirdPartyAnnualCost),
              description: "Psicometría, idiomas y antecedentes ya vienen en los créditos",
            },
          ]}
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Beneficios que no entran en el cálculo</p>
        <MetricStrip
          aria-label="Beneficios adicionales"
          items={[
            {
              label: "Días para cubrir una vacante",
              value: `${formatQuoteInteger(inputs.daysToFill)} → ${formatQuoteInteger(roi.daysToFillWithSelection)}`,
              description: "La mitad del tiempo de contratación",
            },
            { label: "Procesos con el mismo equipo", value: "3–4×", description: "Sin contratar más reclutadores" },
            { label: "Candidatos evaluados", value: "100 %", description: "Ninguno se queda sin revisar" },
          ]}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Supuestos: 192 horas de trabajo al mes, 65 % del tiempo del reclutador en tareas que Selección automatiza y 75 % de ese tiempo realmente liberado.
      </p>
    </FoldingPanel>
  );
}
