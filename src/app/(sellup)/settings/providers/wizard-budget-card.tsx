'use client';

/**
 * wizard-budget-card.tsx — superficie administrativa del presupuesto del Wizard.
 * AGENT1-WIZARD-BUDGET-ADMIN-F1B.
 *
 * Vive como sección HERMANA de la tabla de proveedores, no dentro del drawer de
 * Apollo, porque el presupuesto que administra no es de Apollo: es el pozo
 * interno compartido por Apollo, Tavily y Lusha. Meterlo en el drawer de un
 * proveedor sugeriría que cambiarlo cambia la cuota de ese proveedor.
 *
 * Las dos cifras se muestran juntas a propósito —«cuota Apollo» y «presupuesto
 * Wizard»— porque la confusión entre ambas es justo lo que esta pantalla existe
 * para deshacer. Ninguna alimenta a la otra: `providerQuotaContext` sólo se
 * renderiza como texto y jamás entra en el estado del formulario.
 */

import { useState, useTransition } from 'react';
import { Wallet, Lock, Info } from 'lucide-react';
import { toast } from 'sonner';
import { SurfaceCard } from '@/components/shared/surface-card';
import { SectionHeader } from '@/components/shared/section-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  updateWizardBudgetPeriod,
  updateWizardMaxCreditsPerExecution,
} from '@/modules/budgets';
import type { WizardBudgetAdminSnapshot } from '@/modules/budgets';

/**
 * Cuota CONTRATADA de un proveedor, sólo como contexto de lectura.
 *
 * Se tipa aparte del presupuesto y se consume en un componente aparte para que
 * no exista ninguna ruta por la que estos números lleguen al formulario.
 */
export type ProviderQuotaContext = {
  providerLabel: string;
  monthlyCreditsAllowance: number | null;
  creditsAvailable: number | null;
};

interface Props {
  snapshot: WizardBudgetAdminSnapshot;
  providerQuotaContext: ProviderQuotaContext | null;
}

const PROVIDER_LABEL: Record<'apollo' | 'tavily' | 'lusha', string> = {
  apollo: 'Apollo',
  tavily: 'Tavily',
  lusha: 'Lusha',
};

function formatCredits(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toLocaleString('es-CO') : '—';
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

function actorLabel(actor: { email: string | null; fullName: string | null } | null): string {
  if (!actor) return '—';
  return actor.fullName ?? actor.email ?? '—';
}

// ── Bloque de sólo lectura: la cuota del proveedor ───────────────────────────
//
// Componente separado y con su propio prop: nada de aquí puede filtrarse a los
// campos editables de abajo.

function ProviderQuotaAside({ quota }: { quota: ProviderQuotaContext }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3 space-y-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-medium">
        Cuota {quota.providerLabel} (contratada)
      </p>
      <p className="text-sm font-medium text-foreground">
        {formatCredits(quota.monthlyCreditsAllowance)} créditos contratados
      </p>
      <p className="text-xs text-muted-foreground/80">
        {formatCredits(quota.creditsAvailable)} disponibles según el proveedor
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground/70 pt-1">
        Es lo que {quota.providerLabel} vendió. No es el presupuesto del Wizard y no lo
        alimenta: son presupuestos independientes y se miden por separado.
      </p>
    </div>
  );
}

// ── Métrica compacta ─────────────────────────────────────────────────────────

function Metric({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'negative' | 'muted';
  hint?: string;
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-500'
      : tone === 'negative'
        ? 'text-destructive'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : 'text-foreground';
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-medium">
        {label}
      </p>
      <p className={`text-xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function WizardBudgetCard({ snapshot, providerQuotaContext }: Props) {
  const period = snapshot.period;

  const [budgetInput, setBudgetInput] = useState(
    period ? String(period.budgetCredits) : '',
  );
  const [closedInput, setClosedInput] = useState(period?.isClosed ?? false);
  const [maxCreditsInput, setMaxCreditsInput] = useState(
    snapshot.maxCreditsPerExecution !== null ? String(snapshot.maxCreditsPerExecution) : '',
  );

  const [isSavingBudget, startBudgetTransition] = useTransition();
  const [isSavingMax, startMaxTransition] = useTransition();

  const parsedBudget = Number(budgetInput.trim());
  const parsedMax = Number(maxCreditsInput.trim());

  function handleSaveBudget() {
    if (!Number.isInteger(parsedBudget) || parsedBudget <= 0) {
      toast.error(
        'El presupuesto debe ser un entero mayor que 0. Para detener el gasto del mes, cierra el período.',
      );
      return;
    }
    startBudgetTransition(async () => {
      const result = await updateWizardBudgetPeriod(parsedBudget, closedInput);
      if (!result.success) {
        toast.error(result.error ?? 'No se pudo guardar el presupuesto.');
        return;
      }
      toast.success(
        result.outcome === 'no_change'
          ? 'Sin cambios: los valores ya eran esos.'
          : 'Presupuesto del Wizard actualizado.',
      );
    });
  }

  function handleSaveMaxCredits() {
    if (!Number.isInteger(parsedMax) || parsedMax <= 0) {
      toast.error('El máximo de créditos por ejecución debe ser un entero mayor que 0.');
      return;
    }
    startMaxTransition(async () => {
      const result = await updateWizardMaxCreditsPerExecution(parsedMax);
      if (!result.success) {
        toast.error(result.error ?? 'No se pudo guardar el límite.');
        return;
      }
      toast.success(
        result.outcome === 'no_change'
          ? 'Sin cambios: el límite ya era ese.'
          : 'Máximo de créditos por ejecución actualizado.',
      );
    });
  }

  const worstCase = snapshot.worstCaseCreditsByProvider;

  return (
    <section className="space-y-4" aria-labelledby="wizard-budget-heading">
      <SectionHeader
        eyebrow="Agente 1"
        title="Presupuesto de ejecución — Wizard (Agente 1)"
        description="Pozo compartido por Apollo, Tavily y Lusha. Independiente de la cuota contratada de cada proveedor."
      />

      <SurfaceCard>
        <div className="space-y-6">
          {/* ── Estado del período vigente ───────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-su-brand" aria-hidden />
              <h4 id="wizard-budget-heading" className="text-sm font-medium text-foreground">
                Período vigente {snapshot.periodStart}
              </h4>
              <span className="text-[11px] text-muted-foreground/70">
                (zona horaria {snapshot.timezone}, derivada por el servidor)
              </span>
              {period?.isClosed && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-500">
                  <Lock className="h-3 w-3" aria-hidden /> Cerrado
                </span>
              )}
            </div>

            {snapshot.unavailable && (
              <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
                <p className="text-xs text-destructive">
                  No se pudo leer el presupuesto del Wizard (faltan credenciales service_role o la
                  lectura falló).
                </p>
              </div>
            )}

            {!snapshot.unavailable && !period && (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  El mes vigente todavía no tiene presupuesto configurado. Mientras no exista, el
                  Wizard responde <code className="font-mono">period_not_configured</code>. Guarda un
                  presupuesto abajo para crearlo.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <Metric label="Configurado" value={formatCredits(period?.budgetCredits)} />
              <Metric label="Consumido" value={formatCredits(period?.creditsConsumed)} tone="muted" />
              <Metric label="Reservado" value={formatCredits(period?.creditsReserved)} tone="muted" />
              <Metric
                label="Disponible"
                value={formatCredits(period?.availableCredits)}
                tone={
                  period == null
                    ? 'default'
                    : period.availableCredits > 0
                      ? 'positive'
                      : 'negative'
                }
                hint="configurado − consumido − reservado"
              />
              <Metric
                label="Máx. por ejecución"
                value={formatCredits(snapshot.maxCreditsPerExecution)}
                hint="global del Wizard"
              />
            </div>

            <p className="text-[11px] text-muted-foreground/70">
              Consumido y reservado son propiedad de la reserva atómica del Wizard: esta pantalla los
              muestra, nunca los escribe.
            </p>
          </div>

          {/* ── Formularios ──────────────────────────────────────── */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-border/40 px-4 py-4">
              <div className="space-y-1">
                <Label htmlFor="wizard-budget-credits" className="text-xs">
                  Presupuesto del período (créditos)
                </Label>
                <Input
                  id="wizard-budget-credits"
                  inputMode="numeric"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  placeholder="p. ej. 60"
                  className="h-9"
                />
                <p className="text-[11px] text-muted-foreground/70">
                  Autorización interna de SellUp para el pozo compartido. No es la cuota de ningún
                  proveedor.
                </p>
              </div>

              <div className="flex items-start justify-between gap-4 rounded-md bg-muted/10 px-3 py-2.5">
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-foreground">Cerrar el período</p>
                  <p className="text-[11px] text-muted-foreground/70">
                    Detiene el gasto del mes. Un presupuesto de 0 no es la manera de cerrarlo.
                  </p>
                </div>
                <Switch
                  checked={closedInput}
                  onCheckedChange={setClosedInput}
                  aria-label="Cerrar el período de presupuesto"
                />
              </div>

              <Button
                type="button"
                size="sm"
                className="h-8 text-xs"
                onClick={handleSaveBudget}
                disabled={isSavingBudget}
              >
                {isSavingBudget ? 'Guardando…' : 'Guardar presupuesto'}
              </Button>
            </div>

            <div className="space-y-3 rounded-lg border border-border/40 px-4 py-4">
              <div className="space-y-1">
                <Label htmlFor="wizard-max-credits" className="text-xs">
                  Máximo de créditos por ejecución
                </Label>
                <Input
                  id="wizard-max-credits"
                  inputMode="numeric"
                  value={maxCreditsInput}
                  onChange={(e) => setMaxCreditsInput(e.target.value)}
                  placeholder="p. ej. 20"
                  className="h-9"
                />
                <p className="text-[11px] text-muted-foreground/70">
                  Límite <strong>global del Wizard</strong>, no específico de Apollo: una corrida con
                  cualquier proveedor que estime más créditos que este techo queda bloqueada con
                  <code className="font-mono"> execution_limit_exceeded</code>.
                </p>
              </div>

              <div className="rounded-md bg-muted/10 px-3 py-2.5 space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-medium">
                  Costo peor caso por proveedor
                </p>
                <ul className="space-y-0.5">
                  {(['apollo', 'tavily', 'lusha'] as const).map((key) => (
                    <li key={key} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{PROVIDER_LABEL[key]}</span>
                      <span className="tabular-nums text-foreground">
                        {formatCredits(worstCase[key])} cr
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground/70 pt-0.5">
                  Resuelto con las mismas funciones de estimación que usa la reserva.
                </p>
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={handleSaveMaxCredits}
                disabled={isSavingMax}
              >
                {isSavingMax ? 'Guardando…' : 'Guardar límite'}
              </Button>
            </div>
          </div>

          {/* ── Contexto y auditoría ─────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-2">
            {providerQuotaContext && <ProviderQuotaAside quota={providerQuotaContext} />}

            <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-medium">
                Última modificación
              </p>
              <p className="text-sm text-foreground">
                {formatDateTime(snapshot.lastChange?.changedAt ?? period?.updatedAt ?? null)}
              </p>
              <p className="text-xs text-muted-foreground/80">
                Por {actorLabel(snapshot.lastChange?.changedBy ?? period?.updatedBy ?? null)}
              </p>
              {snapshot.lastChange && (
                <ul className="pt-1 space-y-0.5 text-[11px] text-muted-foreground/70">
                  {snapshot.lastChange.newBudgetCredits !== null && (
                    <li>
                      Presupuesto: {formatCredits(snapshot.lastChange.previousBudgetCredits)} →{' '}
                      {formatCredits(snapshot.lastChange.newBudgetCredits)}
                    </li>
                  )}
                  {snapshot.lastChange.newIsClosed !== null && (
                    <li>
                      Estado: {snapshot.lastChange.previousIsClosed === null
                        ? '—'
                        : snapshot.lastChange.previousIsClosed
                          ? 'cerrado'
                          : 'abierto'}{' '}
                      → {snapshot.lastChange.newIsClosed ? 'cerrado' : 'abierto'}
                    </li>
                  )}
                  {snapshot.lastChange.newMaxCreditsPerExecution !== null && (
                    <li>
                      Máx. por ejecución:{' '}
                      {formatCredits(snapshot.lastChange.previousMaxCreditsPerExecution)} →{' '}
                      {formatCredits(snapshot.lastChange.newMaxCreditsPerExecution)}
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>

          <div className="flex gap-2 rounded-md border border-su-brand/20 bg-su-brand-soft px-3 py-2.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-su-brand" aria-hidden />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              La cuota contratada de cada proveedor y el presupuesto del Wizard son presupuestos
              independientes. Subir la cuota de Apollo no sube el pozo del Wizard, y subir el pozo del
              Wizard no compra créditos a ningún proveedor.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </section>
  );
}
