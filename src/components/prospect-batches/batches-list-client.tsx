'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Layers, MoreHorizontal, ArrowRight, CheckCircle2, XCircle, GitMerge, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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

const STATUS_STYLES: Record<BatchStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  generating: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  ready_for_review: 'bg-su-brand-soft text-su-brand',
  in_review: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  cancelled: 'bg-muted/60 text-muted-foreground/60',
  failed: 'bg-destructive/10 text-destructive',
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
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 rounded-full bg-su-brand-soft p-4">
        <Layers className="h-8 w-8 text-su-brand" />
      </div>
      <p className="text-sm font-semibold text-foreground">Sin lotes todavía</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        Todavía no hay lotes de prospectos. Crea un lote manualmente o, más adelante, genera prospectos con IA.
      </p>
    </div>
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
      <DropdownMenuTrigger>
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={loading}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MoreHorizontal className="h-3.5 w-3.5" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.push(`/prospect-batches/${batch.id}`)}>
          <ArrowRight className="mr-2 h-3.5 w-3.5" />
          Ver detalle
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {batch.status === 'draft' && (
          <DropdownMenuItem onClick={() => onStatusChange(batch.id, 'ready_for_review')}>
            <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-su-brand" />
            Marcar listo para revisión
          </DropdownMenuItem>
        )}
        {batch.status === 'ready_for_review' && (
          <DropdownMenuItem onClick={() => onStatusChange(batch.id, 'in_review')}>
            <GitMerge className="mr-2 h-3.5 w-3.5 text-blue-500" />
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

interface BatchesListClientProps {
  batches: ProspectBatchWithMeta[];
}

export function BatchesListClient({ batches }: BatchesListClientProps) {
  const [loadingId, setLoadingId] = React.useState<string | null>(null);

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
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/40">
            {['Nombre', 'País', 'Industria', 'Estado', 'Fuente', 'Candidatos', 'Aprobados', 'Convertidos', 'Costo est.', 'Creación', ''].map(
              (col) => (
                <th
                  key={col}
                  className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60"
                >
                  {col}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr
              key={batch.id}
              className="group border-b border-border/30 transition-colors last:border-0 hover:bg-muted/30"
            >
              {/* Nombre */}
              <td className="px-4 py-3">
                <Link
                  href={`/prospect-batches/${batch.id}`}
                  className="font-medium text-foreground hover:text-su-brand hover:underline"
                >
                  {batch.name}
                </Link>
                {batch.description && (
                  <p className="mt-0.5 max-w-[200px] truncate text-xs text-muted-foreground">
                    {batch.description}
                  </p>
                )}
                {batch.metadata?.generation_mode === 'controlled_real_test' && (
                  <Badge className="mt-1 border-0 bg-blue-500/10 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                    Búsqueda real
                  </Badge>
                )}
              </td>
              {/* País */}
              <td className="px-4 py-3 text-muted-foreground">
                {batch.country_code ? (
                  <span className="flex items-center gap-1.5">
                    <span>{getFlagEmoji(batch.country_code)}</span>
                    <span className="text-xs">{batch.country ?? batch.country_code}</span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground/50">—</span>
                )}
              </td>
              {/* Industria */}
              <td className="px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  {batch.industry ?? <span className="text-muted-foreground/50">—</span>}
                </span>
              </td>
              {/* Estado */}
              <td className="px-4 py-3">
                <Badge className={`${STATUS_STYLES[batch.status]} border-0 text-[10px] font-semibold`}>
                  {BATCH_STATUS_LABELS[batch.status]}
                </Badge>
              </td>
              {/* Fuente */}
              <td className="px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  {BATCH_SOURCE_LABELS[batch.source]}
                </span>
              </td>
              {/* Candidatos */}
              <td className="px-4 py-3 tabular-nums text-foreground">
                {batch.total_candidates}
              </td>
              {/* Aprobados */}
              <td className="px-4 py-3 tabular-nums">
                <span className="text-emerald-600 dark:text-emerald-400">
                  {batch.approved_count}
                </span>
              </td>
              {/* Convertidos */}
              <td className="px-4 py-3 tabular-nums">
                <span className="text-su-brand">{batch.converted_count}</span>
              </td>
              {/* Costo */}
              <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground">
                {batch.estimated_cost_usd
                  ? `$${Number(batch.estimated_cost_usd).toFixed(4)}`
                  : '—'}
              </td>
              {/* Fecha */}
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {formatDate(batch.created_at)}
              </td>
              {/* Acciones */}
              <td className="px-3 py-3">
                <BatchRowActions
                  batch={batch}
                  onStatusChange={handleStatusChange}
                  loading={loadingId === batch.id}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
