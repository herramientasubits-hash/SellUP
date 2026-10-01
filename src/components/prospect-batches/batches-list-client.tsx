'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Layers, MoreHorizontal, ArrowRight, CheckCircle2, XCircle, GitMerge, Loader2, FlaskConical } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { EmptyState as SharedEmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { changeBatchStatus } from '@/modules/prospect-batches/actions';
import {
  BATCH_STATUS_LABELS,
  BATCH_SOURCE_LABELS,
  type ProspectBatchWithMeta,
  type BatchStatus,
} from '@/modules/prospect-batches/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUS_VARIANTS: Record<
  BatchStatus,
  'neutral' | 'warning' | 'brand' | 'info' | 'positive' | 'negative'
> = {
  draft: 'neutral',
  generating: 'warning',
  ready_for_review: 'brand',
  in_review: 'info',
  completed: 'positive',
  cancelled: 'neutral',
  failed: 'negative',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getFlagEmoji(code: string) {
  const offset = 0x1f1e6 - 'A'.charCodeAt(0);
  return [...code.toUpperCase()].map((c) => String.fromCodePoint(c.charCodeAt(0) + offset)).join('');
}

function EmptyState() {
  return (
    <SharedEmptyState
      icon={Layers}
      title="Sin lotes todavía"
      description="Todavía no hay lotes de prospectos. Crea un lote manualmente o, más adelante, genera prospectos con IA."
      variant="plain"
      className="py-16"
    />
  );
}

interface BatchRowActionsProps {
  batch: ProspectBatchWithMeta;
  onStatusChange: (id: string, status: BatchStatus) => void;
  loading: boolean;
}

function BatchRowActions({ batch, onStatusChange, loading }: BatchRowActionsProps) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={loading}
            aria-label={`Acciones para ${batch.name}`}
          />
        }
      >
        {loading ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.push(`/prospect-batches/${batch.id}`)}>
          <ArrowRight className="mr-2 h-3.5 w-3.5" />
          Ver detalle
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {batch.status === 'draft' && (
          <DropdownMenuItem onClick={() => onStatusChange(batch.id, 'ready_for_review')}>
            <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-primary" />
            Marcar listo para revisión
          </DropdownMenuItem>
        )}
        {batch.status === 'ready_for_review' && (
          <DropdownMenuItem onClick={() => onStatusChange(batch.id, 'in_review')}>
            <GitMerge className="mr-2 h-3.5 w-3.5 text-info" />
            Iniciar revisión
          </DropdownMenuItem>
        )}
        {['draft', 'ready_for_review', 'in_review'].includes(batch.status) && (
          <DropdownMenuItem
            onClick={() => onStatusChange(batch.id, 'cancelled')}
            className="text-destructive focus:text-destructive"
          >
            <XCircle className="mr-2 h-3.5 w-3.5" />
            Cancelar lote
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const TECHNICAL_KEYWORDS = /hito|benchmark|test|prueba|mock/i;

function isTechnicalBatch(name: string) {
  return TECHNICAL_KEYWORDS.test(name);
}

interface BatchesListClientProps {
  batches: ProspectBatchWithMeta[];
}

export function BatchesListClient({ batches }: BatchesListClientProps) {
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [showTechnical, setShowTechnical] = React.useState(false);

  const technicalCount = batches.filter((b) => isTechnicalBatch(b.name)).length;
  const visibleBatches = showTechnical
    ? batches
    : batches.filter((b) => !isTechnicalBatch(b.name));

  async function handleStatusChange(id: string, status: BatchStatus) {
    setLoadingId(id);
    try {
      await changeBatchStatus(id, status);
      toast.success(`Estado actualizado a "${BATCH_STATUS_LABELS[status]}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar estado');
    } finally {
      setLoadingId(null);
    }
  }

  if (batches.length === 0) return <EmptyState />;

  return (
    <div className="overflow-x-auto">
      {technicalCount > 0 && (
        <div className="flex items-center justify-end border-b border-border/50 px-4 py-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-pressed={showTechnical}
            onClick={() => setShowTechnical((v) => !v)}
          >
            <FlaskConical aria-hidden="true" />
            {showTechnical
              ? 'Ocultar lotes técnicos'
              : `Mostrar lotes técnicos (${technicalCount})`}
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {['Nombre', 'País', 'Industria', 'Estado', 'Fuente', 'Candidatos', 'Aprobados', 'Convertidos', 'Costo est.', 'Creación', ''].map(
              (col) => (
                <TableHead
                  key={col}
                  className={['Candidatos', 'Aprobados', 'Convertidos', 'Costo est.'].includes(col) ? 'text-right' : undefined}
                >
                  {col}
                </TableHead>
              )
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleBatches.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={11}>
                <SharedEmptyState
                  variant="plain"
                  icon={Layers}
                  title="No hay lotes productivos todavía."
                  action={
                    technicalCount > 0 ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowTechnical(true)}>
                        Ver lotes técnicos ({technicalCount})
                      </Button>
                    ) : undefined
                  }
                />
              </TableCell>
            </TableRow>
          ) : null}
          {visibleBatches.map((batch) => (
            <TableRow
              key={batch.id}
              className="group"
            >
              {/* Nombre */}
              <TableCell>
                <Link
                  href={`/prospect-batches/${batch.id}`}
                  className="rounded-sm font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  {batch.name}
                </Link>
                {batch.description && (
                  <p className="mt-0.5 max-w-52 truncate text-xs text-muted-foreground" title={batch.description}>
                    {batch.description}
                  </p>
                )}
                {batch.metadata?.generation_mode === 'controlled_real_test' && (
                  <Badge variant="info" className="mt-1">
                    Búsqueda real
                  </Badge>
                )}
              </TableCell>
              {/* País */}
              <TableCell className="text-muted-foreground">
                {batch.country_code ? (
                  <span className="flex items-center gap-1.5">
                    <span>{getFlagEmoji(batch.country_code)}</span>
                    <span className="text-xs">{batch.country ?? batch.country_code}</span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              {/* Industria */}
              <TableCell>
                <span className="text-xs text-muted-foreground">
                  {batch.industry ?? <span className="text-muted-foreground">—</span>}
                </span>
              </TableCell>
              {/* Estado */}
              <TableCell>
                {batch.metadata?.review_ready === false && batch.status === 'ready_for_review' ? (
                  <Badge variant="neutral">
                    Sin candidatas útiles
                  </Badge>
                ) : (
                  <Badge variant={STATUS_VARIANTS[batch.status]}>
                    {BATCH_STATUS_LABELS[batch.status]}
                  </Badge>
                )}
              </TableCell>
              {/* Fuente */}
              <TableCell>
                <span className="text-xs text-muted-foreground">
                  {BATCH_SOURCE_LABELS[batch.source]}
                </span>
              </TableCell>
              {/* Candidatos */}
              <TableCell className="text-right tabular-nums text-foreground">
                {batch.total_candidates}
              </TableCell>
              {/* Aprobados */}
              <TableCell className="text-right tabular-nums">
                <span className="text-success">
                  {batch.approved_count}
                </span>
              </TableCell>
              {/* Convertidos */}
              <TableCell className="text-right tabular-nums">
                <span className="text-primary">{batch.converted_count}</span>
              </TableCell>
              {/* Costo */}
              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                {batch.estimated_cost_usd
                  ? `$${Number(batch.estimated_cost_usd).toFixed(4)}`
                  : '—'}
              </TableCell>
              {/* Fecha */}
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(batch.created_at)}
              </TableCell>
              {/* Acciones */}
              <TableCell>
                <BatchRowActions
                  batch={batch}
                  onStatusChange={handleStatusChange}
                  loading={loadingId === batch.id}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
