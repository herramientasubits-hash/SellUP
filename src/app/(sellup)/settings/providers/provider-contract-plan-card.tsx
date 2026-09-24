'use client';

/**
 * provider-contract-plan-card.tsx — «Plan contratado» en el panel del proveedor.
 *
 * SETTINGS-PROVIDER-CONTRACT-PLAN-1. Muestra el CONTRATO (lo que se paga y por
 * cuántos créditos), el precio por crédito que usa el registro de costos, lo que
 * queda según la última sincronización y cuándo renueva. Si el precio activo no
 * coincide con el contrato, lo dice: los costos estimados estarían mal.
 *
 * Sólo lectura. La vista llega armada desde el servidor (admin).
 */

import { AlertTriangle } from 'lucide-react';
import type { ProviderContractPlanView } from '@/modules/budgets/provider-contract-plan';

function Row({ label, value, testId }: { label: string; value: React.ReactNode; testId?: string }) {
  return (
    <div
      className="flex items-start justify-between gap-4 py-2 border-b border-border/30 last:border-0"
      data-testid={testId}
    >
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground/60 font-medium shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-xs text-foreground text-right">{value}</span>
    </div>
  );
}

const usd = (value: number, decimals = 2) =>
  `$${value.toLocaleString('es-CO', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
const credits = (value: number) => `${value.toLocaleString('es-CO')} cr`;

function formatDay(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatSynced(value: string): string {
  return new Date(value).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

/**
 * Lusha sincronizada por API escribe en el campo «mensual» el total del PLAN
 * anual que devuelve su cuenta: rotularlo mensual multiplicaba por doce lo que se
 * podía gastar.
 */
export function monthlyCreditsLabel(row: {
  providerKey: string;
  quotaSource: string | null;
}): string {
  return row.providerKey === 'lusha' && row.quotaSource === 'api_synced'
    ? 'Créditos del plan (API)'
    : 'Créditos mensuales';
}

export function renewalLabel(plan: ProviderContractPlanView): string {
  if (plan.renewalDate === null || plan.daysToRenewal === null) return 'Sin configurar';
  const day = formatDay(plan.renewalDate);
  if (plan.daysToRenewal < 0) return `${day} · vencida`;
  if (plan.daysToRenewal === 0) return `${day} · hoy`;
  return `${day} · en ${plan.daysToRenewal} ${plan.daysToRenewal === 1 ? 'día' : 'días'}`;
}

export function ProviderContractPlanCard({ plan }: { plan: ProviderContractPlanView }) {
  return (
    <div className="space-y-2" data-testid="provider-contract-plan">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">
        Plan contratado
      </p>
      <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3 space-y-0">
        <Row label="Facturación" value="Anual" />
        <Row label="Créditos del plan" value={`${credits(plan.annualCredits)} / año`} />
        <Row label="Costo del plan" value={`${usd(plan.annualUsd)} USD / año`} />
        <Row
          label="Precio por crédito"
          testId="provider-contract-plan-price"
          value={
            <span>
              {usd(plan.contractUsdPerCredit, 5)} USD
              {plan.activeUsdPerCredit !== null && plan.activeUsdPerCreditEffectiveFrom && (
                <span className="block text-[11px] text-muted-foreground">
                  Vigente en costos desde {formatDay(plan.activeUsdPerCreditEffectiveFrom)}
                </span>
              )}
            </span>
          }
        />
        <Row
          label="Créditos restantes"
          testId="provider-contract-plan-remaining"
          value={
            plan.creditsRemaining === null ? (
              <span className="text-muted-foreground">Sin sincronizar</span>
            ) : (
              <span>
                {credits(plan.creditsRemaining)}
                {plan.remainingPercentOfPlan !== null && (
                  <span className="text-muted-foreground">
                    {' '}
                    · {plan.remainingPercentOfPlan}% del plan
                  </span>
                )}
                {plan.creditsRemainingSyncedAt && (
                  <span className="block text-[11px] text-muted-foreground">
                    Sincronizado el {formatSynced(plan.creditsRemainingSyncedAt)}
                  </span>
                )}
              </span>
            )
          }
        />
        <Row
          label="Renovación"
          value={renewalLabel(plan)}
          testId="provider-contract-plan-renewal"
        />
      </div>
      {!plan.pricingMatchesContract && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2"
          role="alert"
          data-testid="provider-contract-plan-price-mismatch"
        >
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            {plan.activeUsdPerCredit === null
              ? 'No hay precio activo en la tabla de costos: los costos estimados de este proveedor quedan sin calcular.'
              : `La tabla de costos usa ${usd(plan.activeUsdPerCredit, 5)} USD por crédito, distinto del contrato: los costos estimados no coinciden con lo que se paga.`}
          </p>
        </div>
      )}
    </div>
  );
}
