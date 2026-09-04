'use client';

// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — read-only detail for one discarded
// prospect (issue #389). Works exclusively off the `DiscardedProspectItem`
// already fetched server-side — no provider call, no re-query, ever.

import * as React from 'react';
import { Building2, SendHorizonal } from 'lucide-react';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { DISCARD_DISPOSITION_LABELS } from '@/modules/prospect-discards/types';
import type { DiscardedProspectItem } from '@/modules/prospect-discards/types';
import { formatProspectDate } from '@/modules/prospect-batches/prospect-date-utils';

interface DiscardedProspectDetailSheetProps {
  item: DiscardedProspectItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSendToReview: (item: DiscardedProspectItem) => void | Promise<void>;
  pending?: boolean;
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/75">{label}</p>
      <p className="text-sm text-foreground">{value ?? '—'}</p>
    </div>
  );
}

export function DiscardedProspectDetailSheet({
  item,
  open,
  onOpenChange,
  onSendToReview,
  pending,
}: DiscardedProspectDetailSheetProps) {
  if (!item) return null;

  const isAlreadySent = item.status === 'sent_to_review';
  const evidenceEntries = Object.entries(item.evidence ?? {});

  return (
    <DrawerShell
      open={open}
      onOpenChange={onOpenChange}
      title={item.name}
      description="Detalle de disposición descartada"
      icon={
        <div className="rounded-lg p-1.5 bg-muted">
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </div>
      }
      titleBadge={
        <Badge
          className={
            isAlreadySent
              ? 'border-0 bg-su-brand-soft text-su-brand text-[10px]'
              : 'border-0 bg-muted text-muted-foreground text-[10px]'
          }
        >
          {isAlreadySent ? 'Enviada a revisión' : 'Descartada'}
        </Badge>
      }
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Dejar descartada
          </Button>
          <Button
            className="gap-1.5"
            disabled={isAlreadySent || pending}
            onClick={() => void onSendToReview(item)}
          >
            <SendHorizonal className="h-3.5 w-3.5" />
            Enviar a revisión
          </Button>
        </div>
      }
    >
      <div className="space-y-6 py-2">
        <div className="grid grid-cols-2 gap-4">
          <DetailField label="Empresa" value={item.name} />
          <DetailField label="Dominio" value={item.domain} />
          <DetailField label="País" value={item.countryCode} />
          <DetailField label="Industria" value={item.industry} />
          <DetailField label="Proveedor / origen" value={item.sourcePrimary} />
          <DetailField label="Ronda / batch" value={item.roundOrigin ?? item.batchName} />
          <DetailField label="Fecha" value={formatProspectDate(item.createdAt)} />
          <DetailField
            label="Motivo"
            value={DISCARD_DISPOSITION_LABELS[item.disposition] ?? 'Otro motivo'}
          />
        </div>

        <Separator />

        <div className="space-y-3">
          <p className="text-xs font-semibold text-foreground">Motivo original</p>
          <p className="text-sm text-muted-foreground">
            {item.reasonDetail ?? DISCARD_DISPOSITION_LABELS[item.disposition]}
          </p>
          {item.reasonCode && (
            <DetailField label="Código de razón" value={<code className="text-xs">{item.reasonCode}</code>} />
          )}
        </div>

        {evidenceEntries.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground">Evidencia disponible</p>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
                {JSON.stringify(item.evidence, null, 2)}
              </pre>
            </div>
          </>
        )}

        {item.resultingCandidateId && (
          <>
            <Separator />
            <DetailField label="Candidato resultante" value={item.resultingCandidateId} />
          </>
        )}
      </div>
    </DrawerShell>
  );
}
