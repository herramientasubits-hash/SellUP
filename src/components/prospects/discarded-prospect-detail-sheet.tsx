'use client';

// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — read-only detail for one discarded
// prospect (issue #389). Works exclusively off the `DiscardedProspectItem`
// already fetched server-side — no provider call, no re-query, ever.

import * as React from 'react';
import { Building2, FileSearch, MessageSquareText, SendHorizonal } from "@/icons";
import { DrawerSection } from '@/components/shared/drawer-section';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium text-foreground">{value ?? '—'}</dd>
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
        <div className="rounded-xl bg-surface-muted p-1.5">
          <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
      }
      titleBadge={
        <Badge variant={isAlreadySent ? 'brand' : 'neutral'}>
          {isAlreadySent ? 'Enviada a revisión' : item.sendToReviewBlockedReason ? 'Duplicada' : 'Descartada'}
        </Badge>
      }
      size="md"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Dejar descartada
          </Button>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {/* AGENT1-IMPORT-DUPLICATES-VISIBLE-1 — duplicado importado: sólo lectura. */}
            {item.sendToReviewBlockedReason && (
              <span className="min-w-0 text-xs text-muted-foreground">{item.sendToReviewBlockedReason}</span>
            )}
            <Button
              type="button"
              disabled={isAlreadySent || pending || !!item.sendToReviewBlockedReason}
              aria-busy={pending || undefined}
              onClick={() => void onSendToReview(item)}
            >
              <SendHorizonal aria-hidden="true" />
              Enviar a revisión
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 py-2">
        <DrawerSection title="Datos del prospecto" icon={Building2} tone="neutral">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
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
            {item.resultingCandidateId && (
              <DetailField label="Candidato resultante" value={item.resultingCandidateId} />
            )}
          </dl>
        </DrawerSection>

        <DrawerSection title="Motivo original" icon={MessageSquareText} tone="warning">
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {item.reasonDetail ?? DISCARD_DISPOSITION_LABELS[item.disposition]}
            </p>
            {item.reasonCode && (
              <dl>
                <DetailField
                  label="Código de razón"
                  value={<code className="font-mono text-xs">{item.reasonCode}</code>}
                />
              </dl>
            )}
          </div>
        </DrawerSection>

        {evidenceEntries.length > 0 && (
          <DrawerSection title="Evidencia disponible" icon={FileSearch} tone="brand">
            <pre className="max-h-64 overflow-auto rounded-lg bg-surface-subtle p-3 text-xs leading-relaxed text-muted-foreground">
              {JSON.stringify(item.evidence, null, 2)}
            </pre>
          </DrawerSection>
        )}
      </div>
    </DrawerShell>
  );
}
