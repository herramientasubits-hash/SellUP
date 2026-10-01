'use client';

// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — read-only detail for one discarded
// prospect (issue #389). Works exclusively off the `DiscardedProspectItem`
// already fetched server-side — no provider call, no re-query, ever.

import * as React from 'react';
import { Building2, FileSearch, MessageSquareText, SendHorizonal } from "@/icons";
import { CollapsibleDrawerSection } from '@/components/shared/collapsible-drawer-section';
import { DrawerSection } from '@/components/shared/drawer-section';
import { countryFlag, countryName } from '@/components/shared/table-cells';
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
      <dd className="break-words text-sm font-medium text-foreground">
        {value ?? <span className="font-normal text-text-muted">Sin dato</span>}
      </dd>
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
  const reasonLabel = DISCARD_DISPOSITION_LABELS[item.disposition] ?? 'Otro motivo';
  const country = countryName(item.countryCode);

  return (
    <DrawerShell
      open={open}
      onOpenChange={onOpenChange}
      title={item.name}
      // Bajo el nombre, por qué y cuándo se descartó: es lo que se mira para
      // decidir si se rescata.
      description={`${reasonLabel} · ${formatProspectDate(item.createdAt)}`}
      icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
      titleBadge={
        <Badge variant={isAlreadySent ? 'brand' : 'neutral'}>
          {isAlreadySent ? 'Enviada a revisión' : item.sendToReviewBlockedReason ? 'Duplicada' : 'Descartada'}
        </Badge>
      }
      size="md"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Dejar descartada
          </Button>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {/* AGENT1-IMPORT-DUPLICATES-VISIBLE-1 — duplicado importado: sólo lectura. */}
            {item.sendToReviewBlockedReason && (
              <span className="min-w-0 text-xs text-muted-foreground">{item.sendToReviewBlockedReason}</span>
            )}
            <Button
              type="button"
              size="sm"
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
        {/* Primero el porqué: es lo que decide si la empresa vuelve a revisión. */}
        <DrawerSection title="Por qué se descartó" icon={MessageSquareText} tone="warning">
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {item.reasonDetail ?? reasonLabel}
            </p>
            {item.reasonCode && (
              <dl>
                <DetailField
                  label="Código del motivo"
                  value={<code className="font-mono text-xs">{item.reasonCode}</code>}
                />
              </dl>
            )}
          </div>
        </DrawerSection>

        <DrawerSection title="Datos de la empresa" icon={Building2} tone="neutral">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <DetailField label="Dominio" value={item.domain} />
            <DetailField
              label="País"
              value={country ? `${countryFlag(item.countryCode)} ${country}`.trim() : null}
            />
            <DetailField label="Industria" value={item.industry} />
            <DetailField label="Proveedor" value={item.sourcePrimary} />
            <DetailField label="Ronda u origen" value={item.roundOrigin ?? item.batchName} />
            <DetailField label="Motivo" value={reasonLabel} />
            {item.resultingCandidateId && (
              <DetailField label="Prospecto resultante" value={item.resultingCandidateId} />
            )}
          </dl>
        </DrawerSection>

        {evidenceEntries.length > 0 && (
          <CollapsibleDrawerSection
            title="Evidencia guardada"
            icon={FileSearch}
            tone="neutral"
            badge={evidenceEntries.length}
            summary="Los datos técnicos con los que se tomó la decisión."
          >
            <pre className="max-h-64 overflow-auto rounded-lg bg-surface-subtle p-3 text-xs leading-relaxed text-muted-foreground">
              {JSON.stringify(item.evidence, null, 2)}
            </pre>
          </CollapsibleDrawerSection>
        )}
      </div>
    </DrawerShell>
  );
}
