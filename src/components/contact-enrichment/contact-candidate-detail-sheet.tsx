'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  UserSearch,
  User,
  Briefcase,
  Building2,
  Globe,
  Tag,
  Calendar,
  Mail,
  Link2,
  Phone,
  Gauge,
  ShieldCheck,
  Copy,
  Hash,
  Info,
  Check,
  X,
  Loader2,
  Ban,
  AlertTriangle,
} from 'lucide-react';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import {
  getPendingContactCandidateById,
  approveContactCandidate,
  discardContactCandidate,
} from '@/modules/contact-enrichment/actions';
import type {
  PendingContactCandidate,
  ContactRelevanceStatus,
  ContactDuplicateStatus,
  ContactSource,
  ContactCandidateCompanyConsistency,
  LushaPersonIdentityEvidenceV1,
} from '@/modules/contact-enrichment/types';
import {
  IDENTITY_TONE_STYLES,
  resolveIdentityDisplay,
} from './contact-candidate-identity-display';

// Motivos de rechazo sugeridos (Hito 17A.4B). "Otro" habilita un comentario
// opcional; el resto se guarda tal cual en review_notes + metadata.review.
const REJECTION_REASONS = [
  'Cargo no relevante',
  'Datos insuficientes',
  'No pertenece a la empresa',
  'Duplicado',
  'No es decisor / sponsor útil',
  'Otro',
] as const;

// ── Label & style maps (espejo de contact-candidates-data-table-client) ──────

const SOURCE_LABELS: Record<ContactSource, string> = {
  apollo: 'Apollo',
  lusha: 'Lusha',
  hubspot: 'HubSpot',
  manual: 'Manual',
  mock: 'Mock',
};

const RELEVANCE_LABELS: Record<ContactRelevanceStatus, string> = {
  high_relevance: 'Alta',
  medium_relevance: 'Media',
  low_relevance: 'Baja',
  not_relevant: 'No relevante',
  insufficient_data: 'Datos insuficientes',
};

const RELEVANCE_STYLES: Record<ContactRelevanceStatus, string> = {
  high_relevance: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  medium_relevance: 'bg-su-brand-soft text-su-brand',
  low_relevance: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  not_relevant: 'bg-muted text-muted-foreground',
  insufficient_data: 'bg-muted text-muted-foreground',
};

const DUPLICATE_LABELS: Record<ContactDuplicateStatus, string> = {
  unchecked: 'Sin verificar',
  no_match: 'Sin coincidencias',
  possible_duplicate: 'Posible duplicado',
  exact_duplicate: 'Duplicado exacto',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const UNAVAILABLE = 'No disponible';

function formatDate(iso: string | null): string {
  if (!iso) return UNAVAILABLE;
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Convierte un score 0–1 (o 0–100) en porcentaje legible; null si no hay dato. */
function toPercent(score: number | undefined | null): string | null {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  const normalized = score > 1 ? score : score * 100;
  return `${Math.round(normalized)}%`;
}

function normalizeLinkedinUrl(url: string): string {
  return url.startsWith('http') ? url : `https://${url}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface ContactCandidateDetailSheetProps {
  candidateId: string | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Side panel de revisión humana de un candidato del Agente 2A. Reutiliza el
 * shell compartido `DrawerShell` + `SurfaceCard`, el mismo patrón que el detalle
 * de Cuentas/Prospectos (fetch por id con loading, `null` ⇒ "no disponible").
 * Hito 17A.4B: incluye aprobar (crea contacto oficial en `contacts`) y rechazar
 * (marca `discarded` con motivo). NO escribe en HubSpot ni ejecuta Apollo.
 */
export function ContactCandidateDetailSheet({
  candidateId,
  open,
  onClose,
}: ContactCandidateDetailSheetProps) {
  const router = useRouter();
  const [candidate, setCandidate] = React.useState<PendingContactCandidate | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [notFound, setNotFound] = React.useState(false);

  // Estado de revisión humana (Hito 17A.4B)
  const [approving, setApproving] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [showRejectForm, setShowRejectForm] = React.useState(false);
  const [reason, setReason] = React.useState<string>(REJECTION_REASONS[0]);
  const [otherComment, setOtherComment] = React.useState('');

  const busy = approving || rejecting;

  React.useEffect(() => {
    if (open && candidateId) {
      let cancelled = false;
      (async () => {
        setLoading(true);
        setNotFound(false);
        try {
          const result = await getPendingContactCandidateById(candidateId);
          if (cancelled) return;
          if (!result) {
            setNotFound(true);
            setCandidate(null);
          } else {
            setCandidate(result);
          }
        } catch {
          if (!cancelled) {
            setNotFound(true);
            setCandidate(null);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    } else if (!open) {
      queueMicrotask(() => {
        setCandidate(null);
        setNotFound(false);
        setApproving(false);
        setRejecting(false);
        setShowRejectForm(false);
        setReason(REJECTION_REASONS[0]);
        setOtherComment('');
      });
    }
  }, [open, candidateId]);

  async function handleApprove() {
    if (!candidate || busy) return;
    setApproving(true);
    try {
      const result = await approveContactCandidate(candidate.id);
      if (result.ok) {
        toast.success(result.message ?? 'Contacto aprobado y creado en SellUp.');
        router.refresh();
        onClose();
      } else if (result.duplicate) {
        // El candidato pasó a `duplicate` y sale de revisión: refrescamos y cerramos.
        toast.warning(result.error ?? 'Este candidato parece estar duplicado.');
        router.refresh();
        onClose();
      } else {
        toast.error(result.error ?? 'No fue posible aprobar el candidato.');
      }
    } catch {
      toast.error('No fue posible aprobar el candidato.');
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    if (!candidate || busy) return;
    const finalReason =
      reason === 'Otro' && otherComment.trim()
        ? `Otro: ${otherComment.trim()}`
        : reason;
    setRejecting(true);
    try {
      const result = await discardContactCandidate(candidate.id, finalReason);
      if (result.ok) {
        toast.success(result.message ?? 'Candidato rechazado.');
        router.refresh();
        onClose();
      } else {
        toast.error(result.error ?? 'No fue posible rechazar el candidato.');
      }
    } catch {
      toast.error('No fue posible rechazar el candidato.');
    } finally {
      setRejecting(false);
    }
  }

  const relevance = candidate?.enrichment_metadata?.relevance;
  const relevanceScore = toPercent(relevance?.score);
  const qualityScore = toPercent(relevance?.quality_score);
  const confidenceLabel = toPercent(candidate?.confidence);
  const apolloAttempt = candidate?.enrichment_metadata?.apollo_search_attempt ?? null;
  const matchedKeywords = relevance?.matched_keywords?.filter(Boolean) ?? [];
  const companyConsistency =
    (candidate?.enrichment_metadata?.company_consistency as
      | ContactCandidateCompanyConsistency
      | null
      | undefined) ?? null;
  const showConsistencyWarning =
    companyConsistency?.status === 'possible_mismatch' ||
    companyConsistency?.status === 'possible_related_domain';

  // Consistencia de identidad de persona (17B.4W.6). null ⇒ candidato legacy.
  const personIdentity =
    (candidate?.enrichment_metadata?.person_identity as
      | LushaPersonIdentityEvidenceV1
      | null
      | undefined) ?? null;
  const identityDisplay = resolveIdentityDisplay(personIdentity);
  const showIdentityEvidence =
    personIdentity?.identity_consistency === 'mismatch';

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => !v && onClose()}
      side="right"
      className="w-full sm:w-[60vw] sm:min-w-[620px] sm:max-w-[820px]"
      loading={loading}
      icon={<UserSearch className="h-5 w-5 text-su-brand" />}
      title={
        candidate ? (
          <div className="flex items-center justify-between gap-4 mr-6">
            <span className="truncate">{candidate.full_name || 'Sin nombre'}</span>
            <Badge
              variant="outline"
              className="shrink-0 border-transparent bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-semibold"
            >
              Por revisar
            </Badge>
          </div>
        ) : notFound ? (
          'Candidato no disponible'
        ) : (
          'Cargando candidato…'
        )
      }
      description={
        candidate
          ? [candidate.title ?? 'Sin cargo', candidate.company_name ?? 'Sin empresa']
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      actions={
        candidate ? (
          !showRejectForm ? (
            <>
              <p className="flex-1 text-[11px] text-muted-foreground/70">
                {candidate.account_id
                  ? 'Al aprobar se creará un contacto oficial en SellUp.'
                  : candidate.hubspot_company_id
                    ? 'Al aprobar, SellUp creará o vinculará la cuenta automáticamente.'
                    : 'Sin cuenta SellUp asociada: no se puede aprobar.'}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setShowRejectForm(true)}
                >
                  <Ban className="h-4 w-4" />
                  Rechazar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || (!candidate.account_id && !candidate.hubspot_company_id)}
                  onClick={handleApprove}
                >
                  {approving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Aprobando…
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      Aprobar candidato
                    </>
                  )}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="flex-1 text-[11px] text-muted-foreground/70">
                Indica el motivo del rechazo.
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setShowRejectForm(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={handleReject}
                >
                  {rejecting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Rechazando…
                    </>
                  ) : (
                    <>
                      <X className="h-4 w-4" />
                      Confirmar rechazo
                    </>
                  )}
                </Button>
              </div>
            </>
          )
        ) : undefined
      }
    >
      {notFound ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60">
            <Info className="h-5 w-5 text-muted-foreground/40" />
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            No fue posible cargar el detalle del candidato.
          </p>
        </div>
      ) : !candidate ? null : (
        <div className="space-y-4">
          {/* 1. Información principal */}
          <SurfaceCard>
            <SurfaceCardHeader title="Información principal" />
            <dl className="space-y-3">
              <DetailRow icon={User} label="Nombre completo">
                {candidate.full_name || <Fallback />}
              </DetailRow>
              <DetailRow icon={Briefcase} label="Cargo">
                {candidate.title || <Fallback />}
              </DetailRow>
              <DetailRow icon={Building2} label="Empresa">
                {candidate.company_name || <Fallback />}
              </DetailRow>
              <DetailRow icon={Globe} label="Dominio empresa">
                {candidate.company_domain || <Fallback />}
              </DetailRow>
              <DetailRow icon={Tag} label="Fuente">
                <Badge variant="outline" className="text-[10px]">
                  {SOURCE_LABELS[candidate.source] ?? candidate.source}
                </Badge>
              </DetailRow>
              <DetailRow icon={Calendar} label="Fecha de creación">
                {formatDate(candidate.created_at)}
              </DetailRow>
            </dl>
          </SurfaceCard>

          {/* 2. Canales de contacto */}
          <SurfaceCard>
            <SurfaceCardHeader title="Canales de contacto" />
            <dl className="space-y-3">
              <DetailRow icon={Mail} label="Email">
                {candidate.email || <Fallback />}
              </DetailRow>
              <DetailRow icon={Link2} label="LinkedIn">
                {candidate.linkedin_url ? (
                  <a
                    href={normalizeLinkedinUrl(candidate.linkedin_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-su-brand hover:underline break-all"
                  >
                    {candidate.linkedin_url}
                  </a>
                ) : (
                  <Fallback />
                )}
              </DetailRow>
              <DetailRow icon={Phone} label="Teléfono">
                {candidate.phone || <Fallback />}
              </DetailRow>
            </dl>
          </SurfaceCard>

          {/* 3. Evaluación del candidato */}
          <SurfaceCard>
            <SurfaceCardHeader
              title="Evaluación del candidato"
              description="Veredicto del filtro de relevancia del Agente de contactos."
            />
            <dl className="space-y-3">
              <DetailRow icon={Gauge} label="Relevancia">
                {relevance?.status ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Badge
                      className={`${RELEVANCE_STYLES[relevance.status]} border-0 text-[10px] font-semibold`}
                    >
                      {RELEVANCE_LABELS[relevance.status] ?? relevance.status}
                    </Badge>
                    {relevanceScore && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        Score {relevanceScore}
                      </span>
                    )}
                  </span>
                ) : (
                  <Fallback />
                )}
              </DetailRow>
              <DetailRow icon={ShieldCheck} label="Calidad">
                {qualityScore ? (
                  <span className="tabular-nums">{qualityScore}</span>
                ) : (
                  <Fallback />
                )}
              </DetailRow>
              <DetailRow icon={Copy} label="Estado de duplicado">
                {DUPLICATE_LABELS[candidate.duplicate_status] ?? candidate.duplicate_status}
              </DetailRow>
              <DetailRow icon={Gauge} label="Confianza">
                {confidenceLabel ? (
                  <span className="tabular-nums">{confidenceLabel}</span>
                ) : (
                  <Fallback />
                )}
              </DetailRow>
              {matchedKeywords.length > 0 && (
                <DetailRow icon={Tag} label="Señales detectadas">
                  <span className="flex flex-wrap gap-1">
                    {matchedKeywords.map((kw) => (
                      <Badge
                        key={kw}
                        variant="outline"
                        className="text-[10px] font-normal"
                      >
                        {kw}
                      </Badge>
                    ))}
                  </span>
                </DetailRow>
              )}
            </dl>
          </SurfaceCard>

          {/* 3a. Consistencia de identidad (Hito 17B.4W.6) — observacional */}
          <SurfaceCard>
            <SurfaceCardHeader
              title="Consistencia de identidad"
              description="Compara la persona encontrada en Lusha con la identidad devuelta por el enriquecimiento."
            />
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                {identityDisplay.tone === 'consistent' ? (
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : identityDisplay.tone === 'mismatch' ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                ) : (
                  <Info className="h-3.5 w-3.5 text-muted-foreground/50" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Badge
                  className={`${IDENTITY_TONE_STYLES[identityDisplay.tone]} border-0 text-[10px] font-semibold`}
                >
                  {identityDisplay.label}
                </Badge>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {identityDisplay.description}
                </p>
                {showIdentityEvidence && (
                  <div className="space-y-0.5 pt-1 text-[11px] text-muted-foreground/80">
                    <p>
                      Persona encontrada:{' '}
                      <span className="text-foreground">
                        {personIdentity?.prospect_full_name || UNAVAILABLE}
                      </span>
                    </p>
                    <p>
                      Identidad enriquecida:{' '}
                      <span className="text-foreground">
                        {personIdentity?.enrich_full_name || UNAVAILABLE}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </SurfaceCard>

          {/* 3b. Consistencia con la empresa (Hito 17A.9G) */}
          {showConsistencyWarning && companyConsistency && (
            <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    {companyConsistency.status === 'possible_related_domain'
                      ? 'Posible empresa relacionada'
                      : 'Revisar pertenencia a empresa'}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {companyConsistency.explanation}
                  </p>
                  {companyConsistency.email_domain &&
                    companyConsistency.expected_domain &&
                    companyConsistency.email_domain !== companyConsistency.expected_domain && (
                      <p className="text-[11px] text-muted-foreground/70 tabular-nums">
                        Correo: @{companyConsistency.email_domain} · Empresa: {companyConsistency.expected_domain}
                      </p>
                    )}
                </div>
              </div>
            </div>
          )}

          {/* 4. Trazabilidad */}
          <SurfaceCard>
            <SurfaceCardHeader title="Trazabilidad" />
            <dl className="space-y-3">
              <DetailRow icon={Hash} label="Candidate ID">
                <span className="font-mono text-[11px] break-all">{candidate.id}</span>
              </DetailRow>
              <DetailRow icon={Hash} label="Enrichment run ID">
                {candidate.enrichment_run_id ? (
                  <span className="font-mono text-[11px] break-all">
                    {candidate.enrichment_run_id}
                  </span>
                ) : (
                  <Fallback />
                )}
              </DetailRow>
              <DetailRow icon={Tag} label="Fuente">
                {SOURCE_LABELS[candidate.source] ?? candidate.source}
              </DetailRow>
              {apolloAttempt && (
                <DetailRow icon={UserSearch} label="Intento de búsqueda Apollo">
                  <span className="text-xs">{apolloAttempt}</span>
                </DetailRow>
              )}
              {candidate.account_id && (
                <DetailRow icon={Building2} label="SellUp Account ID">
                  <span className="font-mono text-[11px] break-all">{candidate.account_id}</span>
                </DetailRow>
              )}
              {candidate.hubspot_company_id && (
                <DetailRow icon={Globe} label="HubSpot Company ID">
                  <span className="font-mono text-[11px] break-all">
                    {candidate.hubspot_company_id}
                  </span>
                </DetailRow>
              )}
            </dl>
          </SurfaceCard>

          {/* 5. Revisión humana (Hito 17A.4B) */}
          {showRejectForm ? (
            <SurfaceCard>
              <SurfaceCardHeader
                title="Motivo de rechazo"
                description="Quedará registrado en la trazabilidad del candidato."
              />
              <div className="space-y-3">
                <Select value={reason} onValueChange={(v) => setReason(v ?? REJECTION_REASONS[0])}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecciona un motivo" />
                  </SelectTrigger>
                  <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
                    {REJECTION_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {reason === 'Otro' && (
                  <Textarea
                    value={otherComment}
                    onChange={(e) => setOtherComment(e.target.value)}
                    rows={3}
                    placeholder="Comentario opcional…"
                    className="text-sm"
                  />
                )}
              </div>
            </SurfaceCard>
          ) : !candidate.account_id && candidate.hubspot_company_id ? (
            <div className="rounded-xl border border-dashed border-su-brand/30 bg-su-brand-soft/40 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    Empresa vinculada vía HubSpot
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Al aprobar, SellUp creará o vinculará la cuenta automáticamente y asociará
                    este contacto. No se realizarán acciones hasta hacer clic en Aprobar.
                  </p>
                </div>
              </div>
            </div>
          ) : !candidate.account_id ? (
            <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    Sin cuenta SellUp asociada
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    No se puede aprobar porque la empresa no existe en SellUp ni está vinculada a
                    HubSpot. Puedes rechazarlo indicando un motivo.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">Revisión humana</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Aprueba para crear el contacto oficial en SellUp, o recházalo indicando un
                    motivo.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </DrawerShell>
  );
}

function Fallback() {
  return <span className="text-muted-foreground/50">{UNAVAILABLE}</span>;
}

function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>
      <div className="min-w-0 flex-1">
        <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          {label}
        </dt>
        <dd className="mt-0.5 text-xs text-foreground">{children}</dd>
      </div>
    </div>
  );
}
