'use client';

import { useState } from 'react';
import { Activity, Settings, BarChart2, DollarSign, TrendingUp, ScrollText, ChevronDown, Cpu, Zap, Database, Bot } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import type { BudgetRuleRow } from '@/modules/budgets/rule-queries';
import type { BudgetScopeType, BudgetPeriodType, BudgetOnExceed } from '@/modules/usage-tracking/types';
import {
  MEASUREMENT_STATUS_LABEL,
  MEASUREMENT_STATUS_BADGE,
  MEASUREMENT_STATUS_DESCRIPTION,
  type MeasurementStatus,
} from '@/modules/budgets/provider-measurement';
import {
  getProviderOperationalType,
  getProviderOperationalContext,
  OPERATIONAL_TYPE_LABEL,
  OPERATIONAL_TYPE_BADGE,
} from '@/modules/budgets/provider-operational-type';
import { parseBudgetCheck, SCOPE_LABEL } from '@/modules/budgets';

// ── Rule display constants ────────────────────────────────────────────────────

const PERIOD_LABELS: Record<BudgetPeriodType, string> = {
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  annual: 'Anual',
  custom: 'Personalizado',
};

const ON_EXCEED_LABELS: Record<BudgetOnExceed, string> = {
  alert: 'Alertar',
  block: 'Bloquear',
  require_approval: 'Req. aprobación',
};

const SCOPE_SECTION_LABEL: Record<BudgetScopeType, string> = {
  global: 'Globales',
  role: 'Por rol',
  group: 'Por grupo',
  user: 'Por usuario',
};

function formatLimit(credits: number | null, usd: number | null): string {
  const parts: string[] = [];
  if (credits != null && credits > 0) parts.push(`${credits.toLocaleString()} cr`);
  if (usd != null && usd > 0) parts.push(`$${usd.toFixed(2)}`);
  return parts.join(' · ') || '—';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAmount(credits: number | null, usd: number | null): string {
  const parts: string[] = [];
  if (credits != null && credits > 0) parts.push(`${credits.toLocaleString()} cr`);
  if (usd != null && usd > 0) parts.push(`$${usd.toFixed(2)}`);
  return parts.join(' · ') || '—';
}

function formatAllowance(credits: number | null, usd: number | null): string {
  if (credits === null && usd === null) return 'No configurado';
  const parts: string[] = [];
  if (credits !== null) parts.push(`${credits.toLocaleString()} cr`);
  if (usd !== null) parts.push(`$${usd.toFixed(2)}`);
  return parts.join(' · ') || '—';
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Info row ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/30 last:border-0">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground/60 font-medium shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-xs text-foreground text-right">{value}</span>
    </div>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3 space-y-0">
      {children}
    </div>
  );
}

function ProgressiveNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-su-brand/20 bg-su-brand-soft px-4 py-3">
      <p className="text-[11px] text-muted-foreground/80 leading-relaxed">{children}</p>
    </div>
  );
}

function PendingEditDisclosure({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/40 bg-muted/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-foreground hover:bg-muted/20 transition-colors rounded-lg"
      >
        <span className="font-medium">{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-3 pt-2.5 border-t border-border/30">
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            La edición de cuota y reglas se conectará directamente en este panel de forma progresiva.
            Por ahora puedes revisar el estado configurado del proveedor.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Tab: Resumen ──────────────────────────────────────────────────────────────

function TabResumen({ row, ms }: { row: AdminProviderBudgetRow; ms: MeasurementStatus }) {
  const opType = getProviderOperationalType(row.providerKey);
  const msBadge = MEASUREMENT_STATUS_BADGE[ms];
  const opBadge = OPERATIONAL_TYPE_BADGE[opType];

  const consumed =
    ms === 'active'
      ? formatAmount(row.consumedCredits, row.consumedUsd) || '0 cr'
      : '—';

  const allowance = formatAllowance(
    row.providerMonthlyCreditsAllowance,
    row.providerMonthlyUsdAllowance,
  );

  const syncedAt = row.quotaSyncedAt
    ? formatDateShort(row.quotaSyncedAt)
    : row.latestBudgetCheckLog?.createdAt
      ? formatDateShort(row.latestBudgetCheckLog.createdAt)
      : null;

  const hasAttention =
    (row.quotaSource === 'sync_error' && !row.providerMonthlyCreditsAllowance && !row.providerMonthlyUsdAllowance) ||
    (row.consumedCredits != null && row.remainingCredits != null && row.remainingCredits <= 0) ||
    (row.consumedUsd != null && row.remainingUsd != null && row.remainingUsd <= 0);

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <SectionCard>
          <InfoRow
            label="Tipo"
            value={
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${opBadge}`}>
                {OPERATIONAL_TYPE_LABEL[opType]}
              </span>
            }
          />
          <InfoRow
            label="Estado"
            value={
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${msBadge.className}`}>
                {MEASUREMENT_STATUS_LABEL[ms]}
              </span>
            }
          />
          <InfoRow
            label="Contexto"
            value={<span className="text-muted-foreground">{getProviderOperationalContext(row.providerKey)}</span>}
          />
          {syncedAt && (
            <InfoRow label="Última sync" value={<span className="text-muted-foreground">{syncedAt}</span>} />
          )}
        </SectionCard>

        <SectionCard>
          <InfoRow label="Consumo del mes" value={consumed} />
          <InfoRow label="Cuota configurada" value={allowance} />
          {row.activeRules > 0 && (
            <InfoRow label="Reglas activas" value={`${row.activeRules} regla${row.activeRules !== 1 ? 's' : ''}`} />
          )}
          {row.providerCreditsAvailable != null && (
            <InfoRow
              label="Disponible (API)"
              value={formatAmount(row.providerCreditsAvailable, row.providerUsdAvailable)}
            />
          )}
        </SectionCard>
      </div>

      {hasAttention && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Atención requerida</p>
          <p className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">
            {row.quotaSource === 'sync_error' && !row.providerMonthlyCreditsAllowance && !row.providerMonthlyUsdAllowance
              ? 'La sincronización con la API del proveedor falló. Configura una cuota manual.'
              : 'El presupuesto del proveedor está agotado o cerca del límite.'}
          </p>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/50 px-1">
        {MEASUREMENT_STATUS_DESCRIPTION[ms]}
      </p>
    </div>
  );
}

// ── Tab: Configuración — helpers ──────────────────────────────────────────────

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-muted-foreground/50">{icon}</span>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-medium">{label}</p>
    </div>
  );
}

function ReadOnlyToggle({ label, checked, note }: { label: string; checked: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-border/30 last:border-0">
      <div className="min-w-0">
        <span className="text-xs text-foreground">{label}</span>
        {note && <p className="text-[10px] text-muted-foreground/50 mt-0.5">{note}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground/40">Solo lectura</span>
        <Switch checked={checked} disabled className="opacity-50 cursor-not-allowed" />
      </div>
    </div>
  );
}

function ConfigAccordion({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/40 bg-muted/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-foreground hover:bg-muted/20 transition-colors rounded-lg"
      >
        <span className="font-medium">{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 border-t border-border/30">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Tab: Configuración IA ─────────────────────────────────────────────────────

function TabConfiguracionIA({ row, ms }: { row: AdminProviderBudgetRow; ms: MeasurementStatus }) {
  const msBadge = MEASUREMENT_STATUS_BADGE[ms];
  const opType = getProviderOperationalType(row.providerKey);
  const opBadge = OPERATIONAL_TYPE_BADGE[opType];

  const syncedAt = row.quotaSyncedAt
    ? formatDateShort(row.quotaSyncedAt)
    : row.latestBudgetCheckLog?.createdAt
      ? formatDateShort(row.latestBudgetCheckLog.createdAt)
      : null;

  const allowance = formatAllowance(row.providerMonthlyCreditsAllowance, row.providerMonthlyUsdAllowance);

  const quotaSourceLabel =
    row.quotaSource === 'api_synced' ? 'API del proveedor'
    : row.quotaSource === 'manual' ? 'Configuración manual'
    : row.quotaSource === 'sync_error' ? 'Error de sincronización'
    : 'No configurada';

  const measurementUnit = row.providerMonthlyCreditsAllowance != null ? 'Créditos' : row.providerMonthlyUsdAllowance != null ? 'USD' : 'No definida';

  return (
    <div className="space-y-5">
      {/* 1. Estado del proveedor */}
      <div>
        <SectionHeader icon={<Activity className="h-3.5 w-3.5" />} label="Estado del proveedor" />
        <SectionCard>
          <InfoRow
            label="Tipo operativo"
            value={
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${opBadge}`}>
                {OPERATIONAL_TYPE_LABEL[opType]} · LLM
              </span>
            }
          />
          <InfoRow
            label="Estado de medición"
            value={
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${msBadge.className}`}>
                {MEASUREMENT_STATUS_LABEL[ms]}
              </span>
            }
          />
          <InfoRow label="Descripción" value={<span className="text-muted-foreground">{MEASUREMENT_STATUS_DESCRIPTION[ms]}</span>} />
          {syncedAt && <InfoRow label="Última sync" value={<span className="text-muted-foreground">{syncedAt}</span>} />}
          {row.quotaSyncError && (
            <InfoRow label="Error de sync" value={<span className="text-destructive text-[10px]">{row.quotaSyncError}</span>} />
          )}
        </SectionCard>
      </div>

      {/* 2. Modelos y tarifas */}
      <div>
        <SectionHeader icon={<Cpu className="h-3.5 w-3.5" />} label="Modelos y tarifas" />
        <div className="space-y-2">
          <SectionCard>
            <InfoRow label="Cuota configurada" value={allowance} />
            <InfoRow label="Fuente de cuota" value={<span className="text-muted-foreground">{quotaSourceLabel}</span>} />
            {row.quotaOverrideManual && (
              <InfoRow label="Override manual" value={<span className="text-amber-600 dark:text-amber-400 text-[10px]">Activo — sync API no sobreescribe</span>} />
            )}
            {row.creditsRemainingExternal != null && (
              <InfoRow label="Disponible (API)" value={`${row.creditsRemainingExternal.toLocaleString()} cr`} />
            )}
            {row.usdCostMtd != null && (
              <InfoRow label="Costo MTD (API)" value={`$${row.usdCostMtd.toFixed(4)}`} />
            )}
          </SectionCard>
          <ConfigAccordion label="Gestión de modelos">
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-1">
              La edición de modelos activos, tarifas por token y configuración de conexión
              se conectará progresivamente dentro de este workspace del proveedor.
            </p>
          </ConfigAccordion>
        </div>
      </div>

      {/* 3. Medición y consumo */}
      <div>
        <SectionHeader icon={<Database className="h-3.5 w-3.5" />} label="Medición y consumo" />
        <SectionCard>
          <InfoRow label="Modo de medición" value={MEASUREMENT_STATUS_LABEL[ms]} />
          <InfoRow label="Unidad de medición" value={<span className="text-muted-foreground">{measurementUnit}</span>} />
          <InfoRow label="Fuente de medición" value={<span className="text-muted-foreground">{quotaSourceLabel}</span>} />
          <ReadOnlyToggle
            label="Participa en reportes de consumo"
            checked={ms === 'active'}
            note="Activo cuando hay registros de uso medidos"
          />
        </SectionCard>
      </div>

      {/* 4. Automatización y uso operativo */}
      <div>
        <SectionHeader icon={<Bot className="h-3.5 w-3.5" />} label="Automatización / uso operativo" />
        <SectionCard>
          <ReadOnlyToggle
            label="Habilitado para agentes"
            checked={ms === 'active' || ms === 'connected'}
            note="Pendiente de configurar por agente"
          />
          <ReadOnlyToggle
            label="Solo lectura operativa"
            checked={ms === 'prepared' || ms === 'not_measured'}
            note="Sin ejecuciones registradas en SellUp"
          />
        </SectionCard>
        <p className="text-[10px] text-muted-foreground/40 mt-2 px-1 leading-relaxed">
          La configuración por agente se conectará progresivamente dentro de este workspace.
        </p>
      </div>
    </div>
  );
}

// ── Tab: Configuración no IA ──────────────────────────────────────────────────

const OPERATIONAL_USE_MAP: Record<string, string> = {
  tavily:  'Búsqueda web y señales externas en prospección y enriquecimiento',
  lusha:   'Enriquecimiento de contactos (teléfono, email verificado)',
  apollo:  'Prospección de cuentas y enriquecimiento de contactos',
  samu_ia: 'Post-reunión — no medido directamente desde SellUp',
};

function TabConfiguracionNoIA({ row, ms }: { row: AdminProviderBudgetRow; ms: MeasurementStatus }) {
  const msBadge = MEASUREMENT_STATUS_BADGE[ms];
  const opType = getProviderOperationalType(row.providerKey);
  const opBadge = OPERATIONAL_TYPE_BADGE[opType];

  const syncedAt = row.quotaSyncedAt
    ? formatDateShort(row.quotaSyncedAt)
    : row.latestBudgetCheckLog?.createdAt
      ? formatDateShort(row.latestBudgetCheckLog.createdAt)
      : null;

  const allowance = formatAllowance(row.providerMonthlyCreditsAllowance, row.providerMonthlyUsdAllowance);
  const consumed = ms === 'active'
    ? formatAmount(row.consumedCredits, row.consumedUsd) || '0 cr'
    : '—';

  const quotaSourceLabel =
    row.quotaSource === 'api_synced' ? 'API del proveedor'
    : row.quotaSource === 'manual' ? 'Configuración manual'
    : row.quotaSource === 'sync_error' ? 'Error de sincronización'
    : 'No configurada';

  const measurementUnit = row.providerMonthlyCreditsAllowance != null ? 'Créditos'
    : row.providerMonthlyUsdAllowance != null ? 'USD'
    : 'No definida';

  const operationalUse = OPERATIONAL_USE_MAP[row.providerKey.toLowerCase()]
    ?? 'Uso operativo pendiente de documentar';

  return (
    <div className="space-y-5">
      {/* 1. Estado del proveedor */}
      <div>
        <SectionHeader icon={<Activity className="h-3.5 w-3.5" />} label="Estado del proveedor" />
        <SectionCard>
          <InfoRow
            label="Tipo operativo"
            value={
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${opBadge}`}>
                {OPERATIONAL_TYPE_LABEL[opType]}
              </span>
            }
          />
          <InfoRow
            label="Estado de medición"
            value={
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${msBadge.className}`}>
                {MEASUREMENT_STATUS_LABEL[ms]}
              </span>
            }
          />
          <InfoRow label="Descripción" value={<span className="text-muted-foreground">{MEASUREMENT_STATUS_DESCRIPTION[ms]}</span>} />
          {syncedAt && <InfoRow label="Última sync" value={<span className="text-muted-foreground">{syncedAt}</span>} />}
          {row.quotaSyncError && (
            <InfoRow label="Error de sync" value={<span className="text-destructive text-[10px]">{row.quotaSyncError}</span>} />
          )}
        </SectionCard>
      </div>

      {/* 2. Cuota y medición */}
      <div>
        <SectionHeader icon={<Zap className="h-3.5 w-3.5" />} label="Cuota y medición" />
        <SectionCard>
          <InfoRow label="Cuota configurada" value={allowance} />
          <InfoRow label="Consumo del mes" value={consumed} />
          <InfoRow label="Fuente de cuota" value={<span className="text-muted-foreground">{quotaSourceLabel}</span>} />
          <InfoRow label="Unidad de medición" value={<span className="text-muted-foreground">{measurementUnit}</span>} />
          {row.creditsRemainingExternal != null && (
            <InfoRow label="Disponible (API)" value={`${row.creditsRemainingExternal.toLocaleString()} cr`} />
          )}
          <ReadOnlyToggle
            label="Participa en reportes de consumo"
            checked={ms === 'active'}
            note="Activo cuando hay registros de uso medidos"
          />
        </SectionCard>
      </div>

      {/* 3. Uso operativo */}
      <div>
        <SectionHeader icon={<Bot className="h-3.5 w-3.5" />} label="Uso operativo" />
        <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
          <p className="text-xs text-foreground leading-relaxed">{operationalUse}</p>
          <p className="text-[10px] text-muted-foreground/50 mt-2">
            Módulos: {opType === 'enriquecimiento' ? 'Enriquecimiento, Agente 2A' : opType === 'busqueda' ? 'Prospección, Agente 1' : 'Pendiente de mapear'}
          </p>
        </div>
      </div>

      {/* 4. Edición progresiva */}
      <div>
        <SectionHeader icon={<Settings className="h-3.5 w-3.5" />} label="Edición progresiva" />
        <ConfigAccordion label="Configurar cuota / presupuesto">
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-1">
            La edición de esta configuración se conectará progresivamente dentro del workspace del proveedor.
            Por ahora puedes revisar el estado configurado desde la tab Presupuesto.
          </p>
        </ConfigAccordion>
      </div>
    </div>
  );
}

// ── Tab: Configuración (dispatcher) ──────────────────────────────────────────

function TabConfiguracion({
  row,
  ms,
}: {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
}) {
  const opType = getProviderOperationalType(row.providerKey);
  const isIa = opType === 'ia';

  return isIa
    ? <TabConfiguracionIA row={row} ms={ms} />
    : <TabConfiguracionNoIA row={row} ms={ms} />;
}

// ── Tab: Consumo ──────────────────────────────────────────────────────────────

function TabConsumo({ row, ms }: { row: AdminProviderBudgetRow; ms: MeasurementStatus }) {
  const consumed =
    ms === 'active'
      ? formatAmount(row.consumedCredits, row.consumedUsd) || '0 cr'
      : '—';

  const hasGlobalRule = row.globalLimitCredits != null || row.globalLimitUsd != null;
  const ruleLimit = hasGlobalRule
    ? formatAmount(row.globalLimitCredits, row.globalLimitUsd)
    : 'Sin regla';

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <SectionCard>
          <InfoRow label="Consumo del mes" value={consumed} />
          <InfoRow label="Límite de regla" value={ruleLimit} />
          {hasGlobalRule && (
            <InfoRow
              label="Disponible por regla"
              value={formatAmount(row.remainingCredits, row.remainingUsd)}
            />
          )}
          {row.quotaSyncedAt && (
            <InfoRow
              label="Cuota disponible (API)"
              value={formatAmount(row.providerCreditsAvailable, row.providerUsdAvailable)}
            />
          )}
        </SectionCard>

        {ms !== 'active' ? (
          <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-6 flex items-center justify-center">
            <p className="text-sm text-muted-foreground text-center">
              {ms === 'not_measured'
                ? 'Este proveedor no genera consumo medido en SellUp.'
                : 'Aún no hay consumo registrado. Los datos aparecerán después de la primera ejecución.'}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-3">Estado de medición</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {MEASUREMENT_STATUS_DESCRIPTION[ms]}
            </p>
          </div>
        )}
      </div>

      <ProgressiveNote>
        Los filtros avanzados por rol, grupo, usuario, agente y cuenta se incorporarán progresivamente.
      </ProgressiveNote>
    </div>
  );
}

// ── Rules scope list ──────────────────────────────────────────────────────────

function RulesScopeList({ rules }: { rules: BudgetRuleRow[] }) {
  if (rules.length === 0) {
    return (
      <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-5 text-center mt-2">
        <p className="text-xs text-muted-foreground">
          Este proveedor aún no tiene reglas configuradas para este alcance.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 mt-2">
      {rules.map((rule) => (
        <div key={rule.id} className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs font-medium text-foreground">{rule.scopeLabel}</span>
            <span className="text-[10px] text-muted-foreground/60">{PERIOD_LABELS[rule.period_type]}</span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70">
            <span>{formatLimit(rule.limit_credits, rule.limit_usd)}</span>
            <span className="ml-auto">{ON_EXCEED_LABELS[rule.on_exceed]}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Presupuesto y reglas ─────────────────────────────────────────────────

const RULE_SCOPES: BudgetScopeType[] = ['global', 'role', 'group', 'user'];

function TabPresupuesto({
  row,
  providerRules,
}: {
  row: AdminProviderBudgetRow;
  providerRules: BudgetRuleRow[];
}) {
  const hasGlobalRule = row.globalLimitCredits != null || row.globalLimitUsd != null;
  const allowance = formatAllowance(
    row.providerMonthlyCreditsAllowance,
    row.providerMonthlyUsdAllowance,
  );

  const rulesByScope = Object.fromEntries(
    RULE_SCOPES.map((s) => [s, providerRules.filter((r) => r.scope_type === s && r.is_active)]),
  ) as Record<BudgetScopeType, BudgetRuleRow[]>;

  return (
    <div className="space-y-4">
      {/* Resumen superior en 2 columnas */}
      <div className="grid md:grid-cols-2 gap-4">
        <SectionCard>
          <InfoRow label="Cuota contratada" value={allowance} />
          <InfoRow label="Reglas activas" value={row.activeRules > 0 ? `${row.activeRules}` : 'Sin reglas'} />
          {hasGlobalRule && (
            <>
              <InfoRow label="Límite global" value={formatAmount(row.globalLimitCredits, row.globalLimitUsd)} />
              <InfoRow label="Disponible (regla)" value={formatAmount(row.remainingCredits, row.remainingUsd)} />
              {row.onExceed && (
                <InfoRow
                  label="Acción al exceder"
                  value={
                    <span className="text-muted-foreground capitalize">
                      {row.onExceed === 'alert' ? 'Alertar' : row.onExceed === 'block' ? 'Bloquear' : 'Requiere aprobación'}
                    </span>
                  }
                />
              )}
            </>
          )}
        </SectionCard>

        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">Acciones</p>
          <PendingEditDisclosure label="Configurar cuota / presupuesto" />
        </div>
      </div>

      {/* Reglas segmentadas por alcance — full width */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">Reglas de presupuesto</p>
        <Tabs defaultValue="global">
          <TabsList className="w-full grid grid-cols-4 h-auto">
            {RULE_SCOPES.map((s) => (
              <TabsTrigger key={s} value={s} className="text-[10px] py-1.5">
                {SCOPE_SECTION_LABEL[s]}
              </TabsTrigger>
            ))}
          </TabsList>
          {RULE_SCOPES.map((s) => (
            <TabsContent key={s} value={s}>
              <RulesScopeList rules={rulesByScope[s]} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}

// ── Tab: Efectividad ──────────────────────────────────────────────────────────

function TabEfectividad() {
  const metrics = [
    {
      label: 'Calidad de resultados',
      description: 'Tasa de resultados útiles vs totales por agente.',
    },
    {
      label: 'Costo vs utilidad',
      description: 'Relación entre créditos consumidos y valor operativo generado.',
    },
    {
      label: 'Errores por agente',
      description: 'Frecuencia y tipo de errores segmentados por agente y operación.',
    },
    {
      label: 'Disponibilidad del proveedor',
      description: 'Uptime y latencia promedio en el periodo medido.',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-border/30 bg-muted/10 px-4 py-4">
            <p className="text-xs font-medium text-foreground mb-1">{m.label}</p>
            <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{m.description}</p>
            <p className="text-[10px] text-muted-foreground/40 mt-2 italic">Sin datos suficientes</p>
          </div>
        ))}
      </div>
      <ProgressiveNote>
        Efectividad cruzará costo, calidad, errores y utilidad una vez que haya ejecuciones históricas suficientes registradas para este proveedor.
      </ProgressiveNote>
    </div>
  );
}

// ── Tab: Logs y auditoría ─────────────────────────────────────────────────────

const OUTCOME_BADGE: Record<string, { label: string; className: string }> = {
  allowed:         { label: 'Permitido',        className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' },
  alerted:         { label: 'Alerta',           className: 'border-amber-500/30 bg-amber-500/10 text-amber-500' },
  would_block:     { label: 'Habría bloqueado', className: 'border-destructive/30 bg-destructive/10 text-destructive' },
  technical_error: { label: 'Error técnico',    className: 'border-border/40 bg-muted/30 text-muted-foreground' },
  missing_user:    { label: 'Sin usuario',      className: 'border-border/40 bg-muted/30 text-muted-foreground' },
  unknown:         { label: 'Desconocido',      className: 'border-border/40 bg-muted/30 text-muted-foreground' },
};

function TabLogs({ row, ms }: { row: AdminProviderBudgetRow; ms: MeasurementStatus }) {
  const logs = row.recentBudgetCheckLogs ?? [];
  const [showAll, setShowAll] = useState(false);
  const INITIAL_COUNT = 5;
  const visibleLogs = showAll ? logs : logs.slice(0, INITIAL_COUNT);
  const syncedAt = row.quotaSyncedAt ? formatDateShort(row.quotaSyncedAt) : null;
  const syncError = row.quotaSyncError;

  const syncStatusLabel = syncError ? 'Error de sync' : syncedAt ? 'OK' : 'Sin sync';
  const syncStatusClass = syncError
    ? 'text-destructive'
    : syncedAt
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-muted-foreground/60';

  return (
    <div className="space-y-4">
      {/* 3 status cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1.5">Estado de sync</p>
          <p className={`text-xs font-medium ${syncStatusClass}`}>{syncStatusLabel}</p>
        </div>
        <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1.5">Última sync</p>
          <p className="text-xs font-medium text-foreground">{syncedAt ?? 'Sin registro'}</p>
        </div>
        <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1.5">Evaluaciones recientes</p>
          <p className="text-xs font-medium text-foreground">{logs.length}</p>
        </div>
      </div>

      {/* Informational card */}
      <div className="rounded-lg border border-su-brand/20 bg-su-brand-soft px-4 py-3">
        <p className="text-xs font-medium text-foreground mb-2">Qué verás en logs</p>
        <ul className="space-y-1 text-[11px] text-muted-foreground/70 leading-relaxed">
          <li>· Sincronizaciones con la API del proveedor</li>
          <li>· Errores de evaluación y enforcement</li>
          <li>· Evaluaciones recientes de presupuesto</li>
          <li>· Cambios operativos relevantes</li>
        </ul>
      </div>

      {/* Events section */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-1">Eventos recientes</p>
        {ms === 'not_measured' ? (
          <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-4">
            <p className="text-xs text-muted-foreground">
              Este proveedor no genera evaluaciones de presupuesto en SellUp.
            </p>
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-4">
            <p className="text-xs font-medium text-foreground mb-1">No hay logs recientes para este proveedor.</p>
            <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
              Los eventos aparecerán después de sincronizaciones o ejecuciones asociadas.
            </p>
          </div>
        ) : (
          visibleLogs.map((log) => {
            const parsed = parseBudgetCheck(log.budgetCheck);
            const outcomeBadge = parsed
              ? (OUTCOME_BADGE[parsed.outcome] ?? OUTCOME_BADGE['unknown'])
              : null;
            return (
              <div key={log.id} className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-foreground font-medium truncate">
                    {log.operationKey ?? 'operación general'}
                  </span>
                  {outcomeBadge && (
                    <span className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${outcomeBadge.className}`}>
                      {outcomeBadge.label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70">
                  {log.creditsUsed != null && <span>{log.creditsUsed.toLocaleString()} cr</span>}
                  {log.estimatedCostUsd != null && <span>${log.estimatedCostUsd.toFixed(4)}</span>}
                  {parsed?.scopeApplied && parsed.scopeApplied !== 'none' && (
                    <span>{SCOPE_LABEL[parsed.scopeApplied] ?? parsed.scopeApplied}</span>
                  )}
                  <span className="ml-auto">{formatDateShort(log.createdAt)}</span>
                </div>
              </div>
            );
          })
        )}
        {logs.length > INITIAL_COUNT && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="w-full text-center text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors py-1.5"
          >
            {showAll
              ? 'Contraer eventos'
              : `Mostrar ${logs.length - INITIAL_COUNT} evento${logs.length - INITIAL_COUNT !== 1 ? 's' : ''} más`}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export type SidepanelInitialTab = 'resumen' | 'configuracion' | 'consumo' | 'presupuesto' | 'efectividad' | 'logs';

interface ProviderDetailSidepanelProps {
  provider: AdminProviderBudgetRow | null;
  open: boolean;
  initialTab?: SidepanelInitialTab;
  onClose: () => void;
  onConfigureAllowance: (row: AdminProviderBudgetRow) => void;
  allRules?: BudgetRuleRow[];
}

export function ProviderDetailSidepanel({
  provider,
  open,
  initialTab = 'resumen',
  onClose,
  onConfigureAllowance,
  allRules = [],
}: ProviderDetailSidepanelProps) {
  const ms: MeasurementStatus = provider?.measurementStatus ?? 'prepared';
  const opType = provider ? getProviderOperationalType(provider.providerKey) : null;
  const msBadge = MEASUREMENT_STATUS_BADGE[ms];
  const providerRules = provider
    ? allRules.filter((r) => r.provider_key === provider.providerKey)
    : [];

  const hasAttention = provider && (
    (provider.quotaSource === 'sync_error' && !provider.providerMonthlyCreditsAllowance && !provider.providerMonthlyUsdAllowance) ||
    (provider.remainingCredits != null && provider.remainingCredits <= 0) ||
    (provider.remainingUsd != null && provider.remainingUsd <= 0)
  );

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      size="workspace"
      title={
        <div className="flex items-center gap-2 flex-wrap">
          <span>{provider?.displayName ?? provider?.providerKey ?? 'Proveedor'}</span>
          {opType && (
            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${OPERATIONAL_TYPE_BADGE[opType]}`}>
              {OPERATIONAL_TYPE_LABEL[opType]}
            </span>
          )}
          <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${msBadge.className}`}>
            {MEASUREMENT_STATUS_LABEL[ms]}
          </span>
          {hasAttention && (
            <span className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              Atención
            </span>
          )}
        </div>
      }
      description={provider ? getProviderOperationalContext(provider.providerKey) : ''}
      icon={<Activity className="h-4 w-4 text-su-brand" />}
      footer={
        <div className="shrink-0 flex items-center justify-end border-t border-border/50 bg-muted/20 px-6 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      }
    >
      {provider && (
        <Tabs defaultValue={initialTab} key={`${provider.providerKey}-${initialTab}`}>
          <TabsList className="w-full grid grid-cols-6 mb-5 h-auto">
            <TabsTrigger value="resumen" className="text-[11px] gap-1 py-1.5">
              <Activity className="h-3 w-3" />
              Resumen
            </TabsTrigger>
            <TabsTrigger value="configuracion" className="text-[11px] gap-1 py-1.5">
              <Settings className="h-3 w-3" />
              Config.
            </TabsTrigger>
            <TabsTrigger value="consumo" className="text-[11px] gap-1 py-1.5">
              <BarChart2 className="h-3 w-3" />
              Consumo
            </TabsTrigger>
            <TabsTrigger value="presupuesto" className="text-[11px] gap-1 py-1.5">
              <DollarSign className="h-3 w-3" />
              Presupuesto
            </TabsTrigger>
            <TabsTrigger value="efectividad" className="text-[11px] gap-1 py-1.5">
              <TrendingUp className="h-3 w-3" />
              Efectividad
            </TabsTrigger>
            <TabsTrigger value="logs" className="text-[11px] gap-1 py-1.5">
              <ScrollText className="h-3 w-3" />
              Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="resumen">
            <TabResumen row={provider} ms={ms} />
          </TabsContent>

          <TabsContent value="configuracion">
            <TabConfiguracion row={provider} ms={ms} />
          </TabsContent>

          <TabsContent value="consumo">
            <TabConsumo row={provider} ms={ms} />
          </TabsContent>

          <TabsContent value="presupuesto">
            <TabPresupuesto row={provider} providerRules={providerRules} />
          </TabsContent>

          <TabsContent value="efectividad">
            <TabEfectividad />
          </TabsContent>

          <TabsContent value="logs">
            <TabLogs row={provider} ms={ms} />
          </TabsContent>
        </Tabs>
      )}
    </DrawerShell>
  );
}
