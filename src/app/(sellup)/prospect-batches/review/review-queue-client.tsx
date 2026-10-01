'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  ExternalLink,
  Globe,
  Layers,
  ShieldCheck,
  Info,
  CheckCircle2,
  XCircle,
  Copy,
  Sparkles,
  Clock,
  Loader2,
  AlertTriangle,
} from "@/icons";
import { toast } from 'sonner';
import { SurfaceCard } from '@/components/shared/surface-card';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { DrawerSection } from '@/components/shared/drawer-section';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
// Import pure helpers directly from the aggregators/types modules (not the
// package barrel) so the client bundle never pulls in server-only actions or
// the Supabase query layer that the barrel also re-exports.
import {
  confidenceBand,
  ageInDays,
  isPossibleDuplicate,
  hasHubspotMatch,
  groupByBatch,
  batchLabel,
} from '@/modules/prospect-review/aggregators';
import { formatSourceLabel, formatClassificationLabel } from '@/modules/prospect-review/label-format';
// Server action lives in its own 'use server' module; importing it directly
// keeps the heavy server dependency graph out of this client bundle.
import { approvePendingReviewCandidateAction } from '@/modules/prospect-review/approve-actions';
import type {
  ConfidenceBand,
  PendingReviewCandidate,
  PendingReviewBatch,
} from '@/modules/prospect-review/types';

// Friendly messages for each typed rejection reason from the approve action.
const APPROVE_ERROR_MESSAGES: Record<string, string> = {
  not_allowed: 'No tienes permisos para aprobar candidatos.',
  not_found: 'El candidato ya no está disponible. Actualiza la cola.',
  not_clean_production: 'Este candidato no pertenece a la cola de producción limpia.',
  status_conflict: 'El estado del candidato cambió. Actualiza la cola e inténtalo de nuevo.',
  duplicate_blocked: 'No se puede aprobar: la duplicidad bloquea la aprobación.',
  needs_duplicate_confirmation: 'Este candidato requiere confirmar el posible duplicado.',
  unexpected_error: 'Ocurrió un error inesperado. Inténtalo de nuevo.',
};

// ── Presentation helpers (no data invented) ──────────────────────────────────

const COUNTRY_LABELS: Record<string, string> = {
  CO: 'Colombia',
  MX: 'México',
  PE: 'Perú',
  CL: 'Chile',
  CR: 'Costa Rica',
  GT: 'Guatemala',
  PA: 'Panamá',
  DO: 'República Dominicana',
  HN: 'Honduras',
  EC: 'Ecuador',
};

const CONFIDENCE_BADGE: Record<
  ConfidenceBand,
  { label: string; variant: 'positive' | 'brand' | 'warning' }
> = {
  high: { label: 'Alta', variant: 'positive' },
  medium: { label: 'Media', variant: 'brand' },
  low: { label: 'Baja', variant: 'warning' },
};

function countryLabel(code: string | null): string {
  if (!code) return '—';
  return COUNTRY_LABELS[code] ?? code;
}

function formatScore(score: number | null): string {
  if (score == null) return '—';
  return Math.round(score).toString();
}

function formatAge(days: number | null): string {
  if (days == null) return '—';
  if (days === 0) return 'Hoy';
  if (days === 1) return '1 día';
  return `${days} días`;
}

function hostname(website: string | null, domain: string | null): string | null {
  if (domain) return domain;
  if (!website) return null;
  try {
    return new URL(website.startsWith('http') ? website : `https://${website}`).hostname;
  } catch {
    return website;
  }
}

function externalHref(website: string | null, domain: string | null): string | null {
  const raw = website ?? (domain ? `https://${domain}` : null);
  if (!raw) return null;
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

// ── Small badge primitives ────────────────────────────────────────────────────

function ScoreCell({ score }: { score: number | null }) {
  return <span className="font-mono text-muted-foreground tabular-nums">{formatScore(score)}</span>;
}

function ConfidenceBadge({ score }: { score: number | null }) {
  const band = confidenceBand(score);
  if (!band) return <span className="text-text-muted">—</span>;
  const cfg = CONFIDENCE_BADGE[band];
  return (
    <Badge variant={cfg.variant}>
      {cfg.label} · {formatScore(score)}
    </Badge>
  );
}

function DuplicateBadge({ candidate }: { candidate: PendingReviewCandidate }) {
  if (isPossibleDuplicate(candidate)) {
    return (
      <Badge variant="warning">
        <Copy aria-hidden="true" />
        Posible duplicado
      </Badge>
    );
  }
  return (
    <Badge variant="neutral">Sin coincidencia</Badge>
  );
}

function HubspotBadge({ candidate }: { candidate: PendingReviewCandidate }) {
  if (!hasHubspotMatch(candidate)) return <span className="text-text-muted">—</span>;
  return (
    <Badge variant="warning">
      <ShieldCheck aria-hidden="true" />
      HubSpot
    </Badge>
  );
}

// ── Detail drawer (read-only) ─────────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <span className="text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  );
}

// Only these remain disabled in this hito — Approve is now wired up.
const DISABLED_ACTIONS = [
  { label: 'Descartar', icon: XCircle },
  { label: 'Marcar duplicado', icon: Copy },
  { label: 'Enviar a enriquecimiento', icon: Sparkles },
  { label: 'Mantener en revisión', icon: Clock },
] as const;

function CandidateDetail({
  candidate,
  batch,
  nowISO,
  onApprove,
  approving,
}: {
  candidate: PendingReviewCandidate;
  batch: PendingReviewBatch | undefined;
  nowISO: string;
  onApprove: () => void;
  approving: boolean;
}) {
  const href = externalHref(candidate.website, candidate.domain);
  const host = hostname(candidate.website, candidate.domain);
  const age = ageInDays(candidate.createdAt, new Date(nowISO));

  return (
    <div className="space-y-4">
      {/* Datos básicos */}
      <div className="grid grid-cols-2 gap-x-4 divide-y divide-border/30 sm:divide-y-0">
        <DetailRow label="Empresa">{candidate.name ?? '—'}</DetailRow>
        <DetailRow label="Sitio / dominio">
          {host ? (
            href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                {host}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ) : (
              host
            )
          ) : (
            '—'
          )}
        </DetailRow>
        <DetailRow label="País">
          {countryLabel(candidate.countryCode)}
          {candidate.city ? ` · ${candidate.city}` : ''}
        </DetailRow>
        <DetailRow label="Industria">
          {candidate.industry ?? '—'}
          {candidate.subindustry ? ` · ${candidate.subindustry}` : ''}
        </DetailRow>
        <DetailRow label="Tamaño">{candidate.companySize ?? '—'}</DetailRow>
        <DetailRow label="Empleados">
          {candidate.employeeCount != null ? candidate.employeeCount.toString() : '—'}
        </DetailRow>
      </div>

      {/* Scores */}
      <DrawerSection title="Puntajes">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="font-mono text-lg font-semibold text-foreground tabular-nums">
              {formatScore(candidate.fitScore)}
            </p>
            <p className="text-xs text-muted-foreground">Fit</p>
          </div>
          <div>
            <p className="font-mono text-lg font-semibold text-foreground tabular-nums">
              {formatScore(candidate.confidenceScore)}
            </p>
            <p className="text-xs text-muted-foreground">Confianza</p>
          </div>
          <div>
            <p className="font-mono text-lg font-semibold text-foreground tabular-nums">
              {formatScore(candidate.dataCompletenessScore)}
            </p>
            <p className="text-xs text-muted-foreground">Completitud</p>
          </div>
        </div>
      </DrawerSection>

      {/* Señales / clasificación */}
      <div className="grid grid-cols-2 gap-x-4">
        <DetailRow label="Duplicado / HubSpot">
          <span className="flex flex-wrap items-center gap-1.5">
            <DuplicateBadge candidate={candidate} />
            <HubspotBadge candidate={candidate} />
          </span>
        </DetailRow>
        <DetailRow label="Fuente">{formatSourceLabel(candidate.sourcePrimary)}</DetailRow>
        <DetailRow label="Origen del registro">{candidate.recordOrigin ?? '—'}</DetailRow>
        <DetailRow label="Clasificación">
          {formatClassificationLabel(candidate.classificationSource)}
        </DetailRow>
        <DetailRow label="Lote de origen">{batchLabel(candidate.batchId ?? '', batch)}</DetailRow>
        <DetailRow label="Antigüedad">{formatAge(age)}</DetailRow>
        <DetailRow label="Estado de revisión">
          <Badge variant="warning">Por revisar</Badge>
        </DetailRow>
      </div>

      {/* Actions */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={onApprove}
            disabled={approving}
          >
            {approving ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 aria-hidden="true" />
            )}
            Aprobar
          </Button>
          {DISABLED_ACTIONS.map((a) => (
            <Button
              key={a.label}
              variant="outline"
              size="sm"
              disabled
              title="Disponible en siguiente fase"
              className="cursor-not-allowed"
            >
              <a.icon aria-hidden="true" />
              {a.label}
            </Button>
          ))}
        </div>
        <div className="mt-2 flex items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Aprobar cambia el estado a <strong className="font-medium text-foreground">aprobado</strong>{' '}
            sin convertir a cuenta ni enviar a HubSpot. El resto de acciones se habilitarán en el
            siguiente hito.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main client surface ────────────────────────────────────────────────────────

interface ReviewQueueClientProps {
  candidates: PendingReviewCandidate[];
  batchesById: Record<string, PendingReviewBatch>;
  totalPending: number;
  nowISO: string;
}

export function ReviewQueueClient({
  candidates,
  batchesById,
  totalPending,
  nowISO,
}: ReviewQueueClientProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // Single source of truth for the approve confirmation. When it is non-null the
  // dialog is open and holds the exact candidate being approved — fully
  // decoupled from `selectedId` (the drawer) so the dialog never depends on the
  // drawer staying mounted underneath it (Q3F-5AZ.2C-HF2).
  const [approveTarget, setApproveTarget] =
    React.useState<PendingReviewCandidate | null>(null);
  const [approving, setApproving] = React.useState(false);

  const selected = React.useMemo(
    () => candidates.find((c) => c.id === selectedId) ?? null,
    [candidates, selectedId],
  );

  // The approve confirmation is a single controlled dialog, rendered once,
  // never per row / per batch / inside the drawer. `approveTarget` alone drives
  // whether it is open.
  const approveDialogOpen = approveTarget != null;

  // A possible-duplicate / HubSpot-matched candidate needs a strong warning and
  // an explicit server-side confirmation flag before it can be approved.
  const approveNeedsWarning = approveTarget != null && isPossibleDuplicate(approveTarget);

  // Open the confirmation for a candidate. Closing the read-only drawer here
  // guarantees a single overlay is ever visible: the previous split state
  // (`confirmOpen` + `selectedId`) left the drawer open *below* the dialog, so
  // Cancel closed the top layer but the drawer remained — read by users as a
  // stacked / residual modal. One overlay at a time removes that entirely.
  function openApproveDialog(candidate: PendingReviewCandidate) {
    if (approving) return; // guard against double-click / double-open
    setSelectedId(null);
    setApproveTarget(candidate);
  }

  // Close and clear the target. Every dismissal path (Cancel button, Escape,
  // backdrop click via onOpenChange) routes through here, so they all resolve
  // to the exact same clean state: no dialog, no target, no residual layer.
  function closeApproveDialog() {
    if (approving) return;
    setApproveTarget(null);
  }

  async function doApprove() {
    if (!approveTarget) return;
    const target = approveTarget;
    setApproving(true);
    try {
      const result = await approvePendingReviewCandidateAction(target.id, {
        confirmPossibleDuplicate: isPossibleDuplicate(target),
      });
      if (result.ok) {
        toast.success(
          result.status === 'idempotent_success'
            ? `"${target.name ?? 'Candidato'}" ya estaba aprobado`
            : `"${target.name ?? 'Candidato'}" aprobado`,
        );
        setApproveTarget(null);
        router.refresh();
      } else {
        toast.error(APPROVE_ERROR_MESSAGES[result.reason] ?? APPROVE_ERROR_MESSAGES.unexpected_error);
      }
    } catch {
      toast.error(APPROVE_ERROR_MESSAGES.unexpected_error);
    } finally {
      setApproving(false);
    }
  }

  const groups = React.useMemo(() => groupByBatch(candidates), [candidates]);

  if (candidates.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="No hay candidatos que coincidan con los filtros"
        description={
          totalPending > 0
            ? 'Ajusta o limpia los filtros para ver la cola completa.'
            : 'No hay candidatos limpios pendientes de revisión en este momento.'
        }
      />
    );
  }

  return (
    <>
      <div className="space-y-4">
        {groups.map((group) => {
          const batch = group.batchId ? batchesById[group.batchId] : undefined;
          const label = batchLabel(group.batchId ?? '', batch);
          return (
            <SurfaceCard key={group.batchId ?? '__none__'} noPadding>
              {/* Batch header */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                    <Layers className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{label}</p>
                    {batch?.source && (
                      <p className="text-xs text-muted-foreground">Fuente: {batch.source}</p>
                    )}
                  </div>
                </div>
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  {group.candidates.length} candidato{group.candidates.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Candidates table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60">
                      {['Empresa', 'País', 'Industria', 'Fit', 'Conf.', 'Compl.', 'Duplicado', 'HubSpot', 'Antigüedad', 'Estado'].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {group.candidates.map((c) => {
                      const host = hostname(c.website, c.domain);
                      const href = externalHref(c.website, c.domain);
                      const age = ageInDays(c.createdAt, new Date(nowISO));
                      return (
                        <tr
                          key={c.id}
                          onClick={() => setSelectedId(c.id)}
                          className="cursor-pointer transition-colors hover:bg-surface-muted"
                        >
                          <td className="px-4 py-3">
                            <div className="flex flex-col">
                              <span className="font-medium text-foreground">{c.name ?? '—'}</span>
                              {host && (
                                href ? (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 rounded-sm text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                                  >
                                    <Globe className="h-3 w-3" aria-hidden="true" />
                                    {host}
                                  </a>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{host}</span>
                                )
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {countryLabel(c.countryCode)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{c.industry ?? '—'}</td>
                          <td className="px-4 py-3">
                            <ScoreCell score={c.fitScore} />
                          </td>
                          <td className="px-4 py-3">
                            <ConfidenceBadge score={c.confidenceScore} />
                          </td>
                          <td className="px-4 py-3">
                            <ScoreCell score={c.dataCompletenessScore} />
                          </td>
                          <td className="px-4 py-3">
                            <DuplicateBadge candidate={c} />
                          </td>
                          <td className="px-4 py-3">
                            <HubspotBadge candidate={c} />
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                            {formatAge(age)}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="warning">Por revisar</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SurfaceCard>
          );
        })}
      </div>

      {/* Read-only detail drawer */}
      <DrawerShell
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        size="lg"
        title={selected?.name ?? 'Detalle del candidato'}
        description="Vista de solo lectura — revisión de prospecto pendiente"
        icon={
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Building2 className="h-4 w-4 text-primary" />
          </div>
        }
      >
        {selected && (
          <CandidateDetail
            candidate={selected}
            batch={selected.batchId ? batchesById[selected.batchId] : undefined}
            nowISO={nowISO}
            approving={approving}
            onApprove={() => openApproveDialog(selected)}
          />
        )}
      </DrawerShell>

      {/*
        Approve confirmation — a SINGLE controlled dialog, rendered once here
        (outside every map / batch / drawer). `approveTarget` is the only source
        of truth for whether it is open, and Escape / backdrop dismiss route
        through the same `closeApproveDialog` as the Cancel button so no state
        can drift out of sync and leave a residual overlay.
      */}
      <AlertDialog
        open={approveDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeApproveDialog();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprobar candidato</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a aprobar{' '}
              <strong className="font-medium text-foreground">
                {approveTarget?.name ?? 'este candidato'}
              </strong>
              . Cambiará a estado <strong className="font-medium text-foreground">aprobado</strong>.
              No se convierte a cuenta ni se envía a HubSpot.
            </AlertDialogDescription>
            {approveNeedsWarning && (
              <div className="mt-2 flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/15 p-3 text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="text-xs">
                  Este candidato tiene posible coincidencia. Revisa antes de aprobar.
                </span>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/*
              This alert-dialog is built on Base UI: AlertDialogCancel renders a
              plain <button> and does NOT auto-close like the Radix primitive
              would. The dialog is fully controlled via `approveTarget`, so Cancel
              must clear that target itself (via closeApproveDialog) — this both
              closes the dialog and removes the single overlay completely, leaving
              no residual layer. `disabled={approving}` blocks the click
              mid-request.
            */}
            <AlertDialogCancel
              type="button"
              disabled={approving}
              onClick={closeApproveDialog}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void doApprove();
              }}
              disabled={approving}
            >
              {approving && <Loader2 className="animate-spin" aria-hidden="true" />}
              Aprobar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
