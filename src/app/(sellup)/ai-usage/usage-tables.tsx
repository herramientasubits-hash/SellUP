// Las tablas de /ai-usage. Solo presentación: reciben las filas ya calculadas
// por la página (los cálculos de costo y créditos siguen en usage-tracking).

import type { ReactNode } from 'react';
import { formatInAppZone } from '@/lib/format-date';
import { Activity, Bot, Plug, Users } from '@/icons';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge, TableShell } from '@/components/data-display';
import { InfoHint } from '@/components/shared/info-hint';
import { CostValue, CreditsValue } from '@/components/shared/cost-value';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { UserConsumptionRow } from '@/modules/ai-usage/queries';
import type { AgentStat, ProviderStat, ProviderUsageLog } from '@/modules/usage-tracking/types';
import { resolveCostDisplay, toCostTruth } from '@/modules/usage-tracking/cost-display';
import {
  resolveUsageCredits,
  readUsageBillingState,
  resolveCreditsDisplay,
  resolveCreditsTotalsDisplay,
  type CreditsDisplayValue,
} from '@/modules/usage-tracking/credits-display';
import { EffectivenessMeter } from './effectiveness-meter';
import {
  agentLabel,
  formatCount,
  formatUsd,
  humanizeKey,
  providerLabel,
  statusPresentation,
} from './usage-labels';

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_WEEK = 604800;

const NUMERIC_CELL = 'text-right tabular-nums text-muted-foreground';
const DASH = <span className="text-text-muted">—</span>;

function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) return '—';
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diff < SECONDS_PER_MINUTE) return 'Hace un momento';
  if (diff < SECONDS_PER_HOUR) return `Hace ${Math.floor(diff / SECONDS_PER_MINUTE)} min`;
  if (diff < SECONDS_PER_DAY) return `Hace ${Math.floor(diff / SECONDS_PER_HOUR)} h`;
  if (diff < SECONDS_PER_WEEK) return `Hace ${Math.floor(diff / SECONDS_PER_DAY)} días`;
  return formatInAppZone(isoDate, { day: 'numeric', month: 'short' }, 'es-ES');
}

function formatDateTime(isoDate: string): string {
  return formatInAppZone(
    isoDate,
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
    'es-ES',
  );
}

interface Column {
  label: string;
  align?: 'left' | 'right';
}

function HeaderRow({ columns }: { columns: readonly Column[] }) {
  return (
    <TableHeader>
      <TableRow>
        {columns.map((column) => (
          <TableHead
            key={column.label}
            scope="col"
            className={column.align === 'left' ? 'text-left' : 'text-right'}
          >
            {column.label}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

// ============================================================
// Resumen — qué hizo cada agente
// ============================================================

const AGENT_COLUMNS: readonly Column[] = [
  { label: 'Agente', align: 'left' },
  { label: 'Ejecuciones' },
  { label: 'Generados' },
  { label: 'Aprobados' },
  { label: 'Efectividad' },
  { label: 'Costo estimado' },
  { label: 'Costo por aprobado' },
];

export function AgentUsageSection({ agents }: { agents: AgentStat[] }) {
  return (
    <TableShell
      title="Qué hizo cada agente"
      description="Veces que trabajó, prospectos que generó, cuántos se aprobaron y lo que costó."
      actions={
        <InfoHint showLabel>
          La efectividad son los prospectos aprobados sobre los generados. No cuenta cuántos
          resultados devolvió el proveedor, solo los que terminaron aprobados.
        </InfoHint>
      }
      empty={agents.length === 0}
      emptyState={
        <EmptyState
          variant="plain"
          icon={Bot}
          title="Ningún agente ha trabajado todavía"
          description="Cuando alguien busque prospectos con IA, aquí verás cuántos se generaron y cuántos se aprobaron. Si tienes filtros puestos, prueba a quitarlos."
        />
      }
    >
      <Table>
        <HeaderRow columns={AGENT_COLUMNS} />
        <TableBody>
          {agents.map((agent) => {
            const effectiveness =
              agent.total_results_generated > 0
                ? (agent.total_results_approved / agent.total_results_generated) * 100
                : null;
            const costPerApproved =
              agent.total_results_approved > 0
                ? agent.total_estimated_cost_usd / agent.total_results_approved
                : null;

            return (
              <TableRow key={agent.agent_key}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Bot aria-hidden className="size-4 shrink-0 text-primary" />
                    <span className="font-medium text-foreground">
                      {agentLabel(agent.agent_key, agent.agent_name)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className={NUMERIC_CELL}>{formatCount(agent.total_executions)}</TableCell>
                <TableCell className={NUMERIC_CELL}>{formatCount(agent.total_results_generated)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums text-foreground">
                  {formatCount(agent.total_results_approved)}
                </TableCell>
                <TableCell>
                  {effectiveness !== null ? (
                    <EffectivenessMeter
                      pct={effectiveness}
                      label={`Efectividad de ${agentLabel(agent.agent_key, agent.agent_name)}`}
                    />
                  ) : (
                    <span className="block text-right text-xs text-muted-foreground">Sin prospectos aún</span>
                  )}
                </TableCell>
                <TableCell className={NUMERIC_CELL}>{formatUsd(agent.total_estimated_cost_usd)}</TableCell>
                <TableCell className={NUMERIC_CELL}>
                  {costPerApproved !== null ? formatUsd(costPerApproved, 4) : DASH}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableShell>
  );
}

// ============================================================
// Proveedores
// ============================================================

// A1-APOLLO-TWO-ROUND-QA-READINESS-1 § 4/§ 5 — la medición de un proveedor es
// "por créditos" también cuando lo único que hay son operaciones con consumo
// indeterminado: un proveedor con 25 operaciones sin crédito determinado no es
// un proveedor "por llamadas", es uno con la contabilidad pendiente. Un
// proveedor facturado por tokens conserva su medición en tokens.
function isCreditMeasured(stat: ProviderStat): boolean {
  const hasTokenBased = stat.total_input_tokens + stat.total_output_tokens > 0;
  if (hasTokenBased) return false;
  return (stat.total_credits_used ?? 0) > 0 || stat.has_unknown_credits;
}

function providerMeasurementLabel(stat: ProviderStat): string {
  if (isCreditMeasured(stat)) return 'Créditos';
  if (stat.total_input_tokens + stat.total_output_tokens > 0) return 'Tokens';
  return 'Consultas';
}

/**
 * `null` significa "no hay medición que mostrar" (un guion), no "cero".
 * Cuando hay créditos, se devuelve el display resuelto: un total con
 * operaciones pendientes se marca como parcial en vez de presentarse cerrado.
 */
function providerMeasurementCredits(stat: ProviderStat): CreditsDisplayValue | null {
  if (!isCreditMeasured(stat)) return null;
  return resolveCreditsTotalsDisplay({
    totals: {
      knownCreditsTotal: stat.total_credits_used ?? 0,
      unknownCreditOperations: stat.unknown_credit_operations,
      hasUnknownCredits: stat.has_unknown_credits,
    },
  });
}

function providerMeasurementTokens(stat: ProviderStat): string | null {
  const tokens = stat.total_input_tokens + stat.total_output_tokens;
  return tokens > 0 ? formatCount(tokens) : null;
}

function ProviderConsumption({ stat }: { stat: ProviderStat }) {
  const credits = providerMeasurementCredits(stat);
  if (credits) {
    return (
      <div className="flex justify-end">
        <CreditsValue display={credits} />
      </div>
    );
  }
  return providerMeasurementTokens(stat) ?? DASH;
}

const PROVIDER_COLUMNS: readonly Column[] = [
  { label: 'Proveedor', align: 'left' },
  { label: 'Se mide en', align: 'left' },
  { label: 'Consultas' },
  { label: 'Consumo' },
  { label: 'Resultados' },
  { label: 'Costo estimado' },
  { label: 'Último uso' },
];

export function ProviderUsageSection({ providers }: { providers: ProviderStat[] }) {
  return (
    <TableShell
      title="Consumo por proveedor"
      description="Consultas hechas, créditos o tokens gastados y costo estimado de cada proveedor."
      actions={
        <InfoHint showLabel>
          Los buscadores y las bases de contactos cobran por crédito o consulta; los modelos de
          IA, por tokens. El costo es estimado con la tarifa configurada: el valor real sale de
          la factura.
        </InfoHint>
      }
      empty={providers.length === 0}
      emptyState={
        <EmptyState
          variant="plain"
          icon={Plug}
          title="Aún no se ha consultado a ningún proveedor"
          description="Aparecerán aquí en cuanto un agente busque empresas o contactos. Si tienes filtros puestos, prueba a quitarlos."
        />
      }
    >
      <Table>
        <HeaderRow columns={PROVIDER_COLUMNS} />
        <TableBody>
          {providers.map((provider) => (
            <TableRow key={provider.provider_key}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Plug aria-hidden className="size-4 shrink-0 text-text-muted" />
                  <span className="font-medium text-foreground">
                    {providerLabel(provider.provider_key)}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">{providerMeasurementLabel(provider)}</TableCell>
              <TableCell className={NUMERIC_CELL}>{formatCount(provider.total_calls)}</TableCell>
              <TableCell className={NUMERIC_CELL}>
                <ProviderConsumption stat={provider} />
              </TableCell>
              <TableCell className={NUMERIC_CELL}>{formatCount(provider.total_results_returned)}</TableCell>
              <TableCell className={NUMERIC_CELL}>
                {provider.total_estimated_cost_usd === 0 && !provider.has_unknown_cost ? (
                  DASH
                ) : (
                  <CostValue
                    display={resolveCostDisplay({
                      valueUsd: provider.total_estimated_cost_usd,
                      costTruth: toCostTruth(provider.has_unknown_cost),
                      formatUsd: (value) => formatUsd(value),
                    })}
                  />
                )}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatRelativeTime(provider.last_used_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableShell>
  );
}

// ============================================================
// Equipo — consumo por persona
// ============================================================

const USER_COLUMNS: readonly Column[] = [
  { label: 'Persona', align: 'left' },
  { label: 'Ejecuciones' },
  { label: 'Consultas' },
  { label: 'Proveedores' },
  { label: 'Costo estimado' },
  { label: 'Último uso' },
];

/** `null` = sin permiso para ver el consumo por persona (no es «cero personas»). */
export function TeamUsageSection({ users }: { users: UserConsumptionRow[] | null }) {
  const rows = users ?? [];

  return (
    <TableShell
      title="Consumo por persona"
      description="Quién usa los agentes y cuánto cuesta. Quien aún no los ha usado aparece en cero. Usa los filtros de rol y grupo para ver un equipo."
      empty={rows.length === 0}
      emptyState={
        users === null ? (
          <EmptyState
            variant="plain"
            icon={Users}
            title="No tienes permiso para ver el consumo por persona"
            description="Pide acceso a una persona administradora."
          />
        ) : (
          <EmptyState
            variant="plain"
            icon={Users}
            title="Nadie coincide con estos filtros"
            description="Cambia el rol, el grupo o la persona elegida para ver a más gente."
          />
        )
      }
    >
      <Table>
        <HeaderRow columns={USER_COLUMNS} />
        <TableBody>
          {rows.map((user) => {
            const hasActivity = user.executions + user.provider_calls > 0;
            return (
              <TableRow key={user.triggered_by} className={hasActivity ? undefined : 'opacity-60'}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {user.full_name ?? user.email ?? user.triggered_by.slice(0, 8)}
                    </span>
                    {user.full_name && user.email && (
                      <span className="text-xs text-muted-foreground">{user.email}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className={NUMERIC_CELL}>{formatCount(user.executions)}</TableCell>
                <TableCell className={NUMERIC_CELL}>{formatCount(user.provider_calls)}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {user.providers.length > 0 ? user.providers.map(providerLabel).join(', ') : DASH}
                </TableCell>
                <TableCell className={NUMERIC_CELL}>
                  {user.estimated_cost_usd === 0 && !user.has_unknown_cost ? (
                    <span className="text-text-muted">$0.00</span>
                  ) : (
                    <CostValue
                      display={resolveCostDisplay({
                        valueUsd: user.estimated_cost_usd,
                        costTruth: toCostTruth(user.has_unknown_cost),
                        formatUsd: (value) => formatUsd(value),
                      })}
                    />
                  )}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {hasActivity ? formatRelativeTime(user.last_activity_at) : 'Sin uso'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableShell>
  );
}

// ============================================================
// Detalle — últimas consultas
// ============================================================

function logConsumption(log: ProviderUsageLog): ReactNode {
  // § 3 — el estado del crédito se resuelve explícitamente: un NULL (o un
  // billing_state indeterminado) NO se muestra como "0 créditos" ni como "sin
  // consumo". Los tokens siguen ganando cuando el proveedor factura por tokens.
  const credits = resolveUsageCredits(log.credits_used, readUsageBillingState(log));
  const tokens = log.input_tokens + log.output_tokens;

  if (credits.state === 'known' && credits.credits > 0) {
    return `${credits.credits.toFixed(0)} créditos`;
  }
  if (tokens > 0) return `${formatCount(tokens)} tokens`;
  if (credits.state === 'unknown') {
    return (
      <div className="flex justify-end">
        <CreditsValue display={resolveCreditsDisplay(credits)} />
      </div>
    );
  }
  return '0 créditos';
}

const LOG_COLUMNS: readonly Column[] = [
  { label: 'Fecha', align: 'left' },
  { label: 'Proveedor', align: 'left' },
  { label: 'Qué se pidió', align: 'left' },
  { label: 'Estado' },
  { label: 'Consumo' },
  { label: 'Costo estimado' },
];

export function RecentActivitySection({ logs, limit }: { logs: ProviderUsageLog[]; limit: number }) {
  return (
    <TableShell
      title="Últimas consultas"
      description={`Las ${limit} consultas más recientes a proveedores, de la más nueva a la más antigua.`}
      empty={logs.length === 0}
      emptyState={
        <EmptyState
          variant="plain"
          icon={Activity}
          title="Todavía no hay consultas"
          description="Cada búsqueda que haga un agente quedará registrada aquí. Si tienes filtros puestos, prueba a quitarlos."
        />
      }
    >
      <Table>
        <HeaderRow columns={LOG_COLUMNS} />
        <TableBody>
          {logs.map((log) => {
            const status = statusPresentation(log.status);
            const cost = Number(log.estimated_cost_usd);
            return (
              <TableRow key={log.id}>
                <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {formatDateTime(log.created_at)}
                </TableCell>
                <TableCell className="font-medium text-foreground">
                  {providerLabel(log.provider_key)}
                </TableCell>
                <TableCell className="max-w-44 truncate text-muted-foreground" title={humanizeKey(log.operation_key)}>
                  {humanizeKey(log.operation_key)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <StatusBadge status={status.type} label={status.label} />
                  </div>
                </TableCell>
                <TableCell className={NUMERIC_CELL}>{logConsumption(log)}</TableCell>
                <TableCell className={NUMERIC_CELL}>{cost > 0 ? formatUsd(cost, 4) : DASH}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableShell>
  );
}
