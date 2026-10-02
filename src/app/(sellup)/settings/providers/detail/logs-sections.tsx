'use client';

/**
 * logs-sections.tsx — las secciones de la pestaña «Logs»: el estado de la
 * sincronización, la tabla de registros de uso, el historial de
 * sincronizaciones y las evaluaciones de presupuesto. Solo presentación.
 */

import { useState } from 'react';
import { RefreshCw, ScrollText } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell, Timeline, TimelineItem, type TimelineTone } from '@/components/data-display';
import { DetailItem, DetailList } from '@/components/shared/detail-list';
import { DrawerSection } from '@/components/shared/drawer-section';
import type { AdminProviderBudgetRow, BudgetCheckLogEntry } from '@/modules/budgets';
import {
  parseBudgetCheck,
  SCOPE_LABEL,
  type ParsedBudgetCheck,
} from '@/modules/budgets/budget-check-parser';
import type { ProviderSyncLogRow, ProviderUsageLogRow } from '@/modules/budgets/provider-detail-queries';
import { formatUsageLogErrorDetailText } from '@/modules/budgets/provider-usage-log-display';
import { formatDate, formatDateShort, formatLogSpend } from './detail-format';
import { EmptyBlock, LoadingBlock, type StatusBadgeVariant } from './detail-shared';

const INITIAL_BUDGET = 5;
const INITIAL_USAGE = 10;

const USAGE_COLUMNS = ['Fecha', 'Operación', 'Usuario / Agente', 'Créditos', 'Costo USD', 'Estado', 'Detalle de error'];
const USAGE_RIGHT_COLUMNS = new Set(['Créditos', 'Costo USD']);
const SYNC_COLUMNS = ['Fecha', 'Estado', 'Fuente', 'HTTP', 'Créditos ext.', 'Costo MTD', 'Error'];
const SYNC_RIGHT_COLUMNS = new Set(['HTTP', 'Créditos ext.', 'Costo MTD']);

const OUTCOME_BADGE: Record<string, { label: string; variant: StatusBadgeVariant; tone: TimelineTone }> = {
  allowed:         { label: 'Permitido',        variant: 'positive', tone: 'positive' },
  alerted:         { label: 'Alerta',           variant: 'warning',  tone: 'warning' },
  would_block:     { label: 'Habría bloqueado', variant: 'negative', tone: 'negative' },
  technical_error: { label: 'Error técnico',    variant: 'neutral',  tone: 'default' },
  missing_user:    { label: 'Sin usuario',      variant: 'neutral',  tone: 'default' },
  unknown:         { label: 'Desconocido',      variant: 'neutral',  tone: 'default' },
};

/** El botón que despliega o recoge el resto de una lista larga. */
function ShowMoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onClick}>
      {label}
    </Button>
  );
}

// ── Estado de la sincronización ───────────────────────────────────────────────

export function SyncStatusSection({ row }: { row: AdminProviderBudgetRow }) {
  const syncedAt = row.quotaSyncedAt ? formatDateShort(row.quotaSyncedAt) : null;
  const syncError = row.quotaSyncError;
  const status: { label: string; variant: StatusBadgeVariant } = syncError
    ? { label: 'Error de sync', variant: 'negative' }
    : syncedAt
      ? { label: 'OK', variant: 'positive' }
      : { label: 'Sin sync', variant: 'neutral' };

  return (
    <DrawerSection title="Sincronización" icon={RefreshCw} tone={status.variant}>
      <DetailList columns={3}>
        <DetailItem label="Estado de sync">
          <Badge variant={status.variant}>{status.label}</Badge>
        </DetailItem>
        <DetailItem label="Última sync" emptyLabel="Sin registro">
          {syncedAt && <span className="tabular-nums">{syncedAt}</span>}
        </DetailItem>
        <DetailItem label="Evaluaciones">
          <span className="tabular-nums">{(row.recentBudgetCheckLogs ?? []).length}</span>
        </DetailItem>
      </DetailList>
    </DrawerSection>
  );
}

// ── Registros de uso ──────────────────────────────────────────────────────────

function UsageLogsTable({ logs }: { logs: ProviderUsageLogRow[] }) {
  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow>
          {USAGE_COLUMNS.map((col) => (
            <TableHead key={col} scope="col" className={USAGE_RIGHT_COLUMNS.has(col) ? 'text-right' : undefined}>
              {col}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => {
          const errorDetail = formatUsageLogErrorDetailText(log.errorDetail ?? null);
          return (
            <TableRow key={log.id}>
              <TableCell className="text-muted-foreground tabular-nums">{formatDateShort(log.createdAt)}</TableCell>
              <TableCell className="max-w-[140px] truncate text-foreground" title={log.operationKey ?? undefined}>
                {log.operationKey ?? '—'}
              </TableCell>
              <TableCell className="max-w-[170px] text-foreground">
                <div className="truncate">{log.userDisplay?.primary ?? '—'}</div>
                <div className="truncate text-xs text-muted-foreground">{log.agentDisplay ?? '—'}</div>
              </TableCell>
              <TableCell className="text-right text-foreground tabular-nums">
                {log.creditsUsed != null ? `${log.creditsUsed.toLocaleString()} cr` : '—'}
              </TableCell>
              <TableCell className="text-right text-foreground tabular-nums">
                {log.estimatedCostUsd != null ? `$${log.estimatedCostUsd.toFixed(4)}` : '—'}
              </TableCell>
              <TableCell className="capitalize text-muted-foreground">{log.status ?? '—'}</TableCell>
              <TableCell className="max-w-[180px] truncate text-destructive" title={errorDetail}>
                {errorDetail}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export interface UsageLogsSectionProps {
  logs: ProviderUsageLogRow[];
  loading: boolean;
  isNotMeasured: boolean;
  hasActiveFilters: boolean;
}

function usageLogsEmptyState(isNotMeasured: boolean, hasActiveFilters: boolean) {
  if (isNotMeasured) {
    return <EmptyState variant="plain" title="Este proveedor no genera actividad medida en SellUp." />;
  }
  if (hasActiveFilters) {
    return (
      <EmptyState
        variant="plain"
        title="No hay logs para los filtros seleccionados."
        description="Ajusta el período, rol, grupo, usuario, agente o estado para ampliar la búsqueda."
      />
    );
  }
  return (
    <EmptyState
      variant="plain"
      title="Sin logs recientes."
      description="Los registros aparecen después de la primera ejecución desde SellUp."
    />
  );
}

/** La tabla de registros de uso, con su vacío y su «mostrar más». */
export function UsageLogsSection({ logs, loading, isNotMeasured, hasActiveFilters }: UsageLogsSectionProps) {
  const [showAll, setShowAll] = useState(false);
  const visibleLogs = showAll ? logs : logs.slice(0, INITIAL_USAGE);
  const isEmpty = !loading && (isNotMeasured || logs.length === 0);
  const hiddenCount = logs.length - INITIAL_USAGE;

  return (
    <TableShell
      title="Actividad reciente"
      description="Lo que se le pidió al proveedor desde SellUp, registro por registro."
      empty={isEmpty}
      emptyState={usageLogsEmptyState(isNotMeasured, hasActiveFilters)}
      footer={
        !loading && !isEmpty && hiddenCount > 0 ? (
          <ShowMoreButton
            label={showAll ? 'Contraer' : `Mostrar ${hiddenCount} más`}
            onClick={() => setShowAll((v) => !v)}
          />
        ) : undefined
      }
    >
      {loading ? <LoadingBlock label="Cargando actividad..." /> : <UsageLogsTable logs={visibleLogs} />}
    </TableShell>
  );
}

// ── Historial de sincronización ───────────────────────────────────────────────

function SyncLogsTable({ syncLogs }: { syncLogs: ProviderSyncLogRow[] }) {
  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow>
          {SYNC_COLUMNS.map((col) => (
            <TableHead key={col} scope="col" className={SYNC_RIGHT_COLUMNS.has(col) ? 'text-right' : undefined}>
              {col}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {syncLogs.map((log) => (
          <TableRow key={log.id}>
            <TableCell className="text-muted-foreground tabular-nums">{formatDate(log.syncedAt)}</TableCell>
            <TableCell>
              <Badge variant={log.syncStatus === 'success' ? 'positive' : 'negative'}>{log.syncStatus ?? '—'}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{log.source ?? '—'}</TableCell>
            <TableCell className="text-right text-muted-foreground tabular-nums">{log.httpStatus ?? '—'}</TableCell>
            <TableCell className="text-right text-foreground tabular-nums">
              {log.creditsRemainingExternal != null ? `${log.creditsRemainingExternal.toLocaleString()} cr` : '—'}
            </TableCell>
            <TableCell className="text-right text-foreground tabular-nums">
              {log.usdCostMtd != null ? `$${log.usdCostMtd.toFixed(2)}` : '—'}
            </TableCell>
            <TableCell className="max-w-[150px] truncate text-xs text-destructive" title={log.errorMessage ?? undefined}>
              {log.errorMessage ?? '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function SyncHistorySection({ syncLogs, loading }: { syncLogs: ProviderSyncLogRow[]; loading: boolean }) {
  return (
    <TableShell
      title="Historial de sincronización"
      description="Cada consulta de cuota a la API del proveedor."
      empty={!loading && syncLogs.length === 0}
      emptyState={
        <EmptyState
          variant="plain"
          title="Sin sincronizaciones registradas."
          description="Ejecuta un sync desde la tabla de proveedores para registrar actividad."
        />
      }
    >
      {loading ? <LoadingBlock label="Cargando historial de sync..." /> : <SyncLogsTable syncLogs={syncLogs} />}
    </TableShell>
  );
}

// ── Evaluaciones de presupuesto ───────────────────────────────────────────────

function budgetLogDescription(log: BudgetCheckLogEntry, parsed: ParsedBudgetCheck | null): string | undefined {
  const parts = [formatLogSpend(log.creditsUsed, log.estimatedCostUsd)];
  const scopeApplied = parsed?.scopeApplied;
  if (scopeApplied && scopeApplied !== 'none') parts.push(SCOPE_LABEL[scopeApplied] ?? scopeApplied);
  return parts.filter(Boolean).join(' · ') || undefined;
}

export function BudgetEvaluationsSection({ budgetLogs, isNotMeasured }: {
  budgetLogs: BudgetCheckLogEntry[];
  isNotMeasured: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleLogs = showAll ? budgetLogs : budgetLogs.slice(0, INITIAL_BUDGET);
  const hiddenCount = budgetLogs.length - INITIAL_BUDGET;

  return (
    <DrawerSection
      title="Evaluaciones de presupuesto"
      hint="Cada vez que una operación se contrastó con las reglas de presupuesto."
      icon={ScrollText}
      tone="neutral"
      badge={!isNotMeasured && budgetLogs.length > 0 ? budgetLogs.length : undefined}
    >
      {isNotMeasured ? (
        <EmptyBlock message="Este proveedor no genera evaluaciones de presupuesto." />
      ) : budgetLogs.length === 0 ? (
        <EmptyBlock message="Sin evaluaciones recientes." sub="Los eventos aparecen después de sincronizaciones o ejecuciones." />
      ) : (
        <div className="space-y-2">
          <Timeline>
            {visibleLogs.map((log) => {
              const parsed = parseBudgetCheck(log.budgetCheck);
              const outcome = parsed ? (OUTCOME_BADGE[parsed.outcome] ?? OUTCOME_BADGE.unknown) : null;
              return (
                <TimelineItem
                  key={log.id}
                  density="compact"
                  tone={outcome?.tone ?? 'default'}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {log.operationKey ?? 'operación general'}
                      {outcome && <Badge variant={outcome.variant}>{outcome.label}</Badge>}
                    </span>
                  }
                  time={formatDateShort(log.createdAt)}
                  description={budgetLogDescription(log, parsed)}
                />
              );
            })}
          </Timeline>
          {hiddenCount > 0 && (
            <ShowMoreButton
              label={showAll
                ? 'Contraer evaluaciones'
                : `Mostrar ${hiddenCount} ${hiddenCount !== 1 ? 'evaluaciones' : 'evaluación'} más`}
              onClick={() => setShowAll((v) => !v)}
            />
          )}
        </div>
      )}
    </DrawerSection>
  );
}
