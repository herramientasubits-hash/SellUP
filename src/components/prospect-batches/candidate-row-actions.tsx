'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  GitMerge,
  ArrowRightCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  approveCandidate,
  discardCandidate,
  markCandidateDuplicate,
  convertCandidateToAccount,
} from '@/modules/prospect-batches/actions';
import type { ProspectCandidate } from '@/modules/prospect-batches/types';

interface CandidateRowActionsProps {
  candidate: ProspectCandidate;
}

export function CandidateRowActions({ candidate }: CandidateRowActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [discardReason, setDiscardReason] = React.useState('');

  const canApprove = ['generated', 'normalized', 'needs_review'].includes(candidate.status);
  const canDiscard = !['discarded', 'converted_to_account'].includes(candidate.status);
  const canMarkDuplicate = !['converted_to_account', 'duplicate'].includes(candidate.status);
  const canConvert = candidate.status === 'approved';

  async function handleApprove() {
    setLoading(true);
    try {
      await approveCandidate(candidate.id);
      toast.success(`"${candidate.name}" aprobado`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al aprobar');
    } finally {
      setLoading(false);
    }
  }

  async function handleDiscard() {
    setLoading(true);
    try {
      await discardCandidate(candidate.id, discardReason.trim() || undefined);
      toast.success(`"${candidate.name}" descartado`);
      setDiscardOpen(false);
      setDiscardReason('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al descartar');
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkDuplicate() {
    setLoading(true);
    try {
      await markCandidateDuplicate(candidate.id, { duplicate_status: 'possible_duplicate' });
      toast.success(`"${candidate.name}" marcado como posible duplicado`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al marcar duplicado');
    } finally {
      setLoading(false);
    }
  }

  async function handleConvert() {
    setLoading(true);
    try {
      await convertCandidateToAccount(candidate.id);
      toast.success(
        <span>
          Cuenta creada.{' '}
          <button
            className="underline font-medium"
            onClick={() => router.push(`/accounts`)}
          >
            Ver cuentas
          </button>
        </span>
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al convertir');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
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
          {canApprove && (
            <DropdownMenuItem onClick={handleApprove}>
              <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-emerald-500" />
              Aprobar
            </DropdownMenuItem>
          )}
          {canConvert && (
            <DropdownMenuItem onClick={handleConvert}>
              <ArrowRightCircle className="mr-2 h-3.5 w-3.5 text-su-brand" />
              Convertir en cuenta
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {canMarkDuplicate && (
            <DropdownMenuItem onClick={handleMarkDuplicate}>
              <GitMerge className="mr-2 h-3.5 w-3.5 text-amber-500" />
              Marcar posible duplicado
            </DropdownMenuItem>
          )}
          {canDiscard && (
            <DropdownMenuItem
              onClick={() => setDiscardOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              <XCircle className="mr-2 h-3.5 w-3.5" />
              Descartar
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Discard dialog */}
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar candidato</DialogTitle>
            <DialogDescription>
              ¿Por qué descartás a <strong>{candidate.name}</strong>? El motivo es opcional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Motivo (opcional)</p>
            <Textarea
              value={discardReason}
              onChange={(e) => setDiscardReason(e.target.value)}
              placeholder="Ej. Empresa fuera del segmento objetivo..."
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDiscardOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDiscard}
              disabled={loading}
              className="gap-1.5"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
