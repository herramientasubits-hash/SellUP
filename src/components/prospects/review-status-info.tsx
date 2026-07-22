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
import { AlertTriangle, Info, ShieldCheck, ArrowRightCircle } from 'lucide-react';
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
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${className}`}
    >
      {label}
    </span>
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
            <p className="text-[11px] text-muted-foreground/70">
              Aprobado el {new Date(candidate.reviewedAt).toLocaleString('es-CO')}
            </p>
          )}
          {/* Q3F-5AZ.2E-1 — converted prospects link straight to their empresa. */}
          {candidate.status === 'converted_to_account' &&
            (candidate.convertedAccountId ? (
              <Link
                href={`/accounts/${candidate.convertedAccountId}`}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-su-brand hover:underline"
              >
                <ArrowRightCircle className="h-3.5 w-3.5" />
                Ver empresa
              </Link>
            ) : (
              <p className="text-[11px] text-muted-foreground/70">
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
        <div className="mt-1 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-0.5 text-xs leading-relaxed">
            <p className="font-medium">Este prospecto tiene posible coincidencia. Revisa antes de aprobar.</p>
            {view.hasHubspotMatch && (
              <p className="flex items-center gap-1 text-[11px]">
                <ShieldCheck className="h-3 w-3" />
                Coincidencia con una empresa en HubSpot.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-start gap-2">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-su-brand" />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {view.blockReason ?? 'Usa la acción "Aprobar" en la barra de acciones del panel para avanzar este prospecto.'}
        </p>
      </div>
    </SurfaceCard>
  );
}
