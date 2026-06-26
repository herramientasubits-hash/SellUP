'use client';

import * as React from 'react';
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
} from 'lucide-react';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Badge } from '@/components/ui/badge';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { getPendingContactCandidateById } from '@/modules/contact-enrichment/actions';
import type {
  PendingContactCandidate,
  ContactRelevanceStatus,
  ContactDuplicateStatus,
  ContactSource,
} from '@/modules/contact-enrichment/types';

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
 * Side panel de solo lectura para revisar un candidato del Agente 2A (ajuste
 * posterior a 17A.4A). Reutiliza el shell compartido `DrawerShell` + `SurfaceCard`,
 * el mismo patrón que el detalle de Cuentas/Prospectos (fetch por id con loading,
 * `null` ⇒ "no disponible"). NO incluye aprobar/rechazar ni crea contactos
 * finales: esas acciones llegan en 17A.4B.
 */
export function ContactCandidateDetailSheet({
  candidateId,
  open,
  onClose,
}: ContactCandidateDetailSheetProps) {
  const [candidate, setCandidate] = React.useState<PendingContactCandidate | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [notFound, setNotFound] = React.useState(false);

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
      });
    }
  }, [open, candidateId]);

  const relevance = candidate?.enrichment_metadata?.relevance;
  const relevanceScore = toPercent(relevance?.score);
  const qualityScore = toPercent(relevance?.quality_score);
  const confidenceLabel = toPercent(candidate?.confidence);
  const apolloAttempt = candidate?.enrichment_metadata?.apollo_search_attempt ?? null;
  const matchedKeywords = relevance?.matched_keywords?.filter(Boolean) ?? [];

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

          {/* 5. Estado del flujo (informativo, no accionable) */}
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">
                  Este candidato aún no ha sido aprobado ni rechazado.
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  La aprobación/rechazo se implementará en el siguiente hito.
                </p>
              </div>
            </div>
          </div>
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
