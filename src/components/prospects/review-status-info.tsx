'use client';

// Q3F-5AZ.2D-1-UX1 — "Estado de revisión" informational block.
//
// Compact, read-only context about the candidate's review state, rendered
// inside the Validación tab content. The operative "Aprobar" action (and its
// disabled siblings) no longer lives here — it moved to the drawer's action
// zone (`prospect-review-actions.tsx`, rendered as a sticky footer) so it's
// available regardless of which tab is open. This block is pure information:
// no buttons, no writes.

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Info, ShieldCheck, ArrowRightCircle } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import {
  resolveReviewDecisionView,
  type ReviewDecisionCandidate,
} from './prospect-review-decision-utils';

interface ReviewStatusInfoProps {
  candidate: ReviewDecisionCandidate;
}

const SECTION_TITLE = 'Estado de revisión';
// Q3F-5AZ.2E-1 — approving now validates the prospect, creates the SellUp
// account and best-effort syncs HubSpot (no opportunity/proposal yet).
const SECTION_DESCRIPTION =
  'Este prospecto requiere decisión humana antes de avanzar. Aprobar valida el prospecto, crea la empresa en SellUp e intenta sincronizarla con HubSpot según la configuración disponible.';

function StatePill({ label, className }: { label: string; className: string }) {
  return (
    // El mapa de estado aporta solo color y borde; forma y tipografía son del Badge.
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

export function ReviewStatusInfo({ candidate }: ReviewStatusInfoProps) {
  const view = resolveReviewDecisionView(candidate);

  if (view.terminal) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader title={SECTION_TITLE} description={SECTION_DESCRIPTION} />
        <div className="mt-1 space-y-2">
          <StatePill label={view.terminal.label} className={view.terminal.className} />
          <p className="text-xs text-muted-foreground leading-relaxed">{view.terminal.description}</p>
          {candidate.status === 'approved' && candidate.reviewedAt && (
            <p className="text-xs text-muted-foreground">
              Aprobado el {new Date(candidate.reviewedAt).toLocaleString('es-CO')}
            </p>
          )}
          {/* Q3F-5AZ.2E-1 — converted prospects link straight to their empresa. */}
          {candidate.status === 'converted_to_account' &&
            (candidate.convertedAccountId ? (
              <Link
                href={`/accounts/${candidate.convertedAccountId}`}
                className="inline-flex items-center gap-1.5 rounded-sm text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                <ArrowRightCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Ver empresa
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground">
                La empresa ya fue creada en SellUp.
              </p>
            ))}
        </div>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard>
      <SurfaceCardHeader title={SECTION_TITLE} description={SECTION_DESCRIPTION} />

      {view.needsWarning && (
        <div className="mt-1 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/15 p-3 text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 space-y-0.5 text-xs leading-relaxed">
            <p className="font-medium">Este prospecto tiene posible coincidencia. Revisa antes de aprobar.</p>
            {view.hasHubspotMatch && (
              <p className="flex items-center gap-1 text-xs">
                <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
                Coincidencia con una empresa en HubSpot.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-start gap-2">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
          {view.blockReason ?? 'Usa la acción "Aprobar" en la barra de acciones del panel para avanzar este prospecto.'}
        </p>
      </div>
    </SurfaceCard>
  );
}
