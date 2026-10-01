'use client';

import * as React from 'react';
import { ShieldCheck, AlertTriangle, Clock, XCircle, WifiOff } from 'lucide-react';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import type { PeMigoApiEnrichmentBlock, PeMigoLegalValidationStatus } from '@/server/prospect-batches/peru-migo-legal-enrichment';

// ── Status display mapping ───────────────────────────────────────────────────

export type MigoStatusDisplay = {
  label: string;
  badgeClass: string;
  Icon: React.ComponentType<{ className?: string }>;
};

export function getMigoStatusDisplay(
  status: PeMigoLegalValidationStatus | string | null | undefined,
): MigoStatusDisplay {
  switch (status) {
    case 'verified':
      return {
        label: 'Verificado por Migo',
        badgeClass: 'bg-success/10 text-success',
        Icon: ShieldCheck,
      };
    case 'not_found':
      return {
        label: 'No encontrado en Migo',
        badgeClass: 'bg-muted text-muted-foreground',
        Icon: XCircle,
      };
    case 'flagged':
      return {
        label: 'Revisar Migo',
        badgeClass: 'bg-warning/10 text-warning',
        Icon: AlertTriangle,
      };
    case 'api_unavailable':
      return {
        label: 'Migo no disponible',
        badgeClass: 'bg-warning/10 text-warning',
        Icon: WifiOff,
      };
    case 'invalid_ruc_format':
      return {
        label: 'RUC inválido',
        badgeClass: 'bg-muted text-muted-foreground',
        Icon: XCircle,
      };
    case 'pending_validation':
    default:
      return {
        label: 'Validación Migo pendiente',
        badgeClass: 'bg-muted text-muted-foreground',
        Icon: Clock,
      };
  }
}

// ── Component ────────────────────────────────────────────────────────────────

interface PeruMigoLegalValidationBlockProps {
  block?: PeMigoApiEnrichmentBlock | null;
}

export function PeruMigoLegalValidationBlock({
  block,
}: PeruMigoLegalValidationBlockProps) {
  const { label, badgeClass, Icon } = getMigoStatusDisplay(
    block?.legal_validation_status ?? null,
  );

  return (
    <SurfaceCard>
      <SurfaceCardHeader title="Validación complementaria Migo" />
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge className={`border-0 text-xs font-semibold ${badgeClass}`}>
            <Icon className="h-3 w-3 mr-1" />
            {label}
          </Badge>
        </div>

        {block && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {block.ruc && (
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs text-muted-foreground">RUC</p>
                <p className="text-xs text-foreground/90 font-mono leading-snug">{block.ruc}</p>
              </div>
            )}
            {block.legal_name && (
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs text-muted-foreground">
                  Razón social Migo
                </p>
                <p className="text-xs text-foreground/90 leading-snug">{block.legal_name}</p>
              </div>
            )}
            {block.taxpayer_status && (
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs text-muted-foreground">
                  Estado contribuyente
                </p>
                <p className="text-xs text-foreground/90 leading-snug">
                  {block.taxpayer_status}
                </p>
              </div>
            )}
            {block.domicile_condition && (
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs text-muted-foreground">
                  Condición domicilio
                </p>
                <p className="text-xs text-foreground/90 leading-snug">
                  {block.domicile_condition}
                </p>
              </div>
            )}
            {block.ubigeo && (
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs text-muted-foreground">Ubigeo</p>
                <p className="text-xs text-foreground/90 font-mono leading-snug">{block.ubigeo}</p>
              </div>
            )}
            {block.address && (
              <div className="col-span-2 space-y-0.5 min-w-0">
                <p className="text-xs text-muted-foreground">Dirección</p>
                <p className="text-xs text-foreground/90 leading-snug">{block.address}</p>
              </div>
            )}
            {block.updated_at_source && (
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs text-muted-foreground">
                  Actualizado en fuente
                </p>
                <p className="text-xs text-foreground/90 leading-snug">{block.updated_at_source}</p>
              </div>
            )}
            <div className="col-span-2 space-y-0.5 min-w-0">
              <p className="text-xs text-muted-foreground">Fuente</p>
              <p className="text-xs text-foreground/90 leading-snug">Migo API Perú</p>
            </div>
          </div>
        )}

        {/* Migo complementary notice — no CIIU, no sector oficial */}
        <div className="rounded-md bg-surface-subtle border border-border/50 px-3 py-2">
          <p className="text-xs text-muted-foreground leading-snug">
            Migo se usa como validación legal complementaria. No entrega CIIU ni sector oficial
            para el MVP.
          </p>
        </div>
      </div>
    </SurfaceCard>
  );
}
