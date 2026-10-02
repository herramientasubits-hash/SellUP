'use client';

import { Link2, ShieldAlert, ShieldCheck } from '@/icons';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import type { parseDuplicateCheck } from '@/modules/prospect-batches/types';

type DuplicateCheck = ReturnType<typeof parseDuplicateCheck>;

const SOURCE_LABELS: Record<string, string> = {
  sellup: 'SellUp',
  hubspot: 'HubSpot',
};

interface CandidateConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  onConfirm: () => void;
}

interface PossibleDuplicateApproveDialogProps extends CandidateConfirmDialogProps {
  duplicateCheck: DuplicateCheck;
}

/**
 * Confirmación de «Aprobar» cuando el candidato tiene posibles duplicados:
 * muestra las coincidencias y exige una respuesta explícita.
 */
export function PossibleDuplicateApproveDialog({
  open,
  onOpenChange,
  loading,
  onConfirm,
  duplicateCheck: dc,
}: PossibleDuplicateApproveDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      variant="warning"
      icon={ShieldAlert}
      title="Posibles duplicados detectados"
      description="Este candidato tiene posibles duplicados. Revisa las coincidencias antes de aprobar."
      confirmLabel="Aprobar de todas formas"
      loading={loading}
      onConfirm={onConfirm}
      className="sm:max-w-md"
    >
      {dc?.summary && <p className="text-sm text-muted-foreground">{dc.summary}</p>}

      {dc?.matches && dc.matches.length > 0 ? (
        <ul className="max-h-52 divide-y divide-border/60 overflow-y-auto pr-1">
          {dc.matches.map((match, i) => (
            <li key={i} className="space-y-0.5 py-2 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  {SOURCE_LABELS[match.source] ?? match.source}
                </span>
                {match.confidence !== null && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Conf: {match.confidence}%
                  </span>
                )}
              </div>
              {match.matched_name && <p className="text-xs text-foreground">{match.matched_name}</p>}
              {match.matched_domain && (
                <p className="text-xs text-muted-foreground">{match.matched_domain}</p>
              )}
              {match.reason && <p className="text-xs text-muted-foreground italic">{match.reason}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Sin detalle de coincidencias disponible.</p>
      )}
    </ConfirmDialog>
  );
}

interface RelatedCompanyApproveDialogProps extends CandidateConfirmDialogProps {
  candidateName: string;
  summary?: string | null;
}

/** Aviso antes de aprobar una empresa marcada como relacionada (filial). */
export function RelatedCompanyApproveDialog({
  open,
  onOpenChange,
  loading,
  onConfirm,
  candidateName,
  summary,
}: RelatedCompanyApproveDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      variant="warning"
      icon={Link2}
      title="Empresa relacionada detectada"
      description={
        <>
          <strong>{candidateName}</strong> está marcada como empresa relacionada (filial o subsidiaria de otra
          empresa). Podés aprobarla, pero registrá la relación en el campo de notas al crear la cuenta.
        </>
      }
      confirmLabel="Aprobar de todas formas"
      loading={loading}
      onConfirm={onConfirm}
      className="sm:max-w-md"
    >
      {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
    </ConfirmDialog>
  );
}

interface DuplicateReviewConfirmDialogProps extends CandidateConfirmDialogProps {
  candidateName: string;
}

/** Confirmación de que ya se revisaron duplicados en SellUp y HubSpot. */
export function DuplicateReviewConfirmDialog({
  open,
  onOpenChange,
  loading,
  onConfirm,
  candidateName,
}: DuplicateReviewConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={ShieldCheck}
      title="Confirmar revisión de duplicados"
      description={
        <>
          Antes de aprobar <strong>{candidateName}</strong>, confirmá que verificaste posibles duplicados en
          SellUp y HubSpot y que no existe un registro previo de esta empresa.
        </>
      }
      confirmLabel="Sí, sin duplicados"
      loading={loading}
      onConfirm={onConfirm}
      className="sm:max-w-md"
    >
      <div className="space-y-1 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">¿Ya verificaste?</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Buscar la empresa en SellUp (Cuentas / Candidatos)</li>
          <li>Buscar la empresa en HubSpot por nombre y NIT</li>
        </ul>
      </div>
    </ConfirmDialog>
  );
}
