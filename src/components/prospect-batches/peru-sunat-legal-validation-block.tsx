'use client';

import * as React from 'react';
import { ShieldCheck, AlertTriangle, Clock, XCircle } from 'lucide-react';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import type { PeruSunatEnrichmentBlock } from '@/server/prospect-batches/peru-sunat-post-approval-enrichment';

// ── Status display mapping ───────────────────────────────────────────────────

export type SunatStatusDisplay = {
  label: string;
  badgeClass: string;
  Icon: React.ComponentType<{ className?: string }>;
};

export function getSunatStatusDisplay(
  status: string | null | undefined,
): SunatStatusDisplay {
  switch (status) {
    case 'verified':
      return {
        label: 'Verificado SUNAT',
        badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        Icon: ShieldCheck,
      };
    case 'flagged':
      return {
        label: 'Revisar SUNAT',
        badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        Icon: AlertTriangle,
      };
    case 'not_found':
      return {
        label: 'No encontrado en SUNAT',
        badgeClass: 'bg-muted text-muted-foreground',
        Icon: XCircle,
      };
    case 'snapshot_unavailable':
      return {
        label: 'Snapshot SUNAT no disponible',
        badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        Icon: AlertTriangle,
      };
    case 'pending_snapshot_validation':
    default:
      return {
        label: 'Validación SUNAT pendiente',
        badgeClass: 'bg-muted text-muted-foreground',
        Icon: Clock,
      };
  }
}

// ── Component ────────────────────────────────────────────────────────────────

interface PeruSunatLegalValidationBlockProps {
  block?: PeruSunatEnrichmentBlock | null;
}

export function PeruSunatLegalValidationBlock({
  block,
}: PeruSunatLegalValidationBlockProps) {
  const { label, badgeClass, Icon } = getSunatStatusDisplay(
    block?.legal_validation_status ?? null,
  );

  return (
    <SurfaceCard>
      <SurfaceCardHeader title="Validación Legal SUNAT" />
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge className={`border-0 text-[10px] font-semibold ${badgeClass}`}>
            <Icon className="h-3 w-3 mr-1" />
            {label}
          </Badge>
        </div>

        {block && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {block.ruc && (
              <div className="space-y-0.5 min-w-0">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">RUC</p>
                <p className="text-xs text-foreground/90 font-mono leading-snug">{block.ruc}</p>
              </div>
            )}
            {block.legal_name && (
              <div className="space-y-0.5 min-w-0">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                  Razón social SUNAT
                </p>
                <p className="text-xs text-foreground/90 leading-snug">{block.legal_name}</p>
              </div>
            )}
            {block.taxpayer_status && (
              <div className="space-y-0.5 min-w-0">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                  Estado contribuyente
                </p>
                <p className="text-xs text-foreground/90 leading-snug">
                  {block.taxpayer_status}
                </p>
              </div>
            )}
            {block.domicile_condition && (
              <div className="space-y-0.5 min-w-0">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                  Condición domicilio
                </p>
                <p className="text-xs text-foreground/90 leading-snug">
                  {block.domicile_condition}
                </p>
              </div>
            )}
            <div className="col-span-2 space-y-0.5 min-w-0">
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Fuente</p>
              <p className="text-xs text-foreground/90 leading-snug">SUNAT Padrón Reducido</p>
            </div>
          </div>
        )}

        {/* Sector inference notice — Perú no tiene CIIU oficial en el MVP */}
        <div className="rounded-md bg-muted/40 border border-border/50 px-3 py-2">
          <p className="text-xs text-muted-foreground leading-snug">
            <span className="font-medium text-foreground/70">Sector inferido por web/IA.</span>{' '}
            Perú no tiene CIIU oficial disponible en el MVP.
          </p>
        </div>
      </div>
    </SurfaceCard>
  );
}
