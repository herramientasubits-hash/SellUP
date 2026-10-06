'use client';

/**
 * Secciones de SOLO LECTURA de la ficha del candidato (Agente 2A).
 *
 * Cada una pinta lo que recibe: ninguna llama a una acción de servidor ni
 * decide elegibilidad. Salieron de `contact-candidate-detail-sheet.tsx` sin
 * cambiar un solo texto; el bloque de teléfono (revelado, créditos, supresión)
 * se quedó allí a propósito.
 */

import * as React from 'react';
import {
  AlertTriangle,
  Briefcase,
  Building2,
  Calendar,
  Copy,
  Gauge,
  Globe,
  Hash,
  Info,
  PhoneCall,
  ShieldCheck,
  Tag,
  User,
  UserSearch,
} from '@/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { DetailItem, DetailList } from '@/components/shared/detail-list';
import { DrawerSection } from '@/components/shared/drawer-section';
import { SurfaceCard } from '@/components/shared/surface-card';
import type {
  ContactCandidateCompanyConsistency,
  LushaPersonIdentityEvidenceV1,
  PendingContactCandidate,
} from '@/modules/contact-enrichment/types';
import {
  CANDIDATE_SOURCE_LABEL,
  DUPLICATE_LABELS,
  PHONE_REVEAL_PROVIDER_LABEL,
  RELEVANCE_LABELS,
  RELEVANCE_VARIANT,
  SOURCE_LABELS,
  UNAVAILABLE,
  formatDate,
  toPercent,
} from './contact-candidate-detail-format';
import {
  IDENTITY_TONE_STYLES,
  resolveIdentityDisplay,
} from './contact-candidate-identity-display';
import { readCandidateCompanyReassignment } from '@/modules/contact-enrichment/candidate-company-reassignment-core';

/**
 * Un par etiqueta/valor de la ficha: el `DetailItem` del sistema, con el vacío
 * de este drawer («No disponible») en vez del genérico.
 */
export function CandidateDetailItem(
  props: React.ComponentProps<typeof DetailItem>,
) {
  return <DetailItem emptyLabel={UNAVAILABLE} {...props} />;
}

/**
 * Lo que decide, antes que nada: qué tan bien encaja, qué tan fiable es el dato
 * y si ya lo teníamos.
 */
export function CandidateSummarySection({
  candidate,
}: {
  candidate: PendingContactCandidate;
}) {
  const relevance = candidate.enrichment_metadata?.relevance;
  const relevanceScore = toPercent(relevance?.score);
  const qualityScore = toPercent(relevance?.quality_score);
  const confidenceLabel = toPercent(candidate.confidence);

  return (
    <section aria-label="Resumen del candidato">
      <SurfaceCard className="p-4">
        <DetailList columns={4}>
          <DetailItem icon={Gauge} label="Relevancia" emptyLabel="Sin calcular">
            {relevance?.status ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <Badge variant={RELEVANCE_VARIANT[relevance.status] ?? 'neutral'}>
                  {RELEVANCE_LABELS[relevance.status] ?? relevance.status}
                </Badge>
                {relevanceScore && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {relevanceScore}
                  </span>
                )}
              </span>
            ) : null}
          </DetailItem>
          <DetailItem icon={ShieldCheck} label="Calidad del dato" emptyLabel="Sin calcular">
            {qualityScore ? <span className="tabular-nums">{qualityScore}</span> : null}
          </DetailItem>
          <DetailItem icon={Gauge} label="Confianza" emptyLabel="Sin calcular">
            {confidenceLabel ? <span className="tabular-nums">{confidenceLabel}</span> : null}
          </DetailItem>
          <DetailItem icon={Copy} label="Duplicidad">
            {DUPLICATE_LABELS[candidate.duplicate_status] ?? candidate.duplicate_status}
          </DetailItem>
        </DetailList>
      </SurfaceCard>
    </section>
  );
}

/** 1. Información principal. */
export function CandidateMainInfoSection({
  candidate,
}: {
  candidate: PendingContactCandidate;
}) {
  return (
    <DrawerSection icon={User} title="Información principal">
      <DetailList>
        <CandidateDetailItem icon={User} label="Nombre completo">
          {candidate.full_name || null}
        </CandidateDetailItem>
        <CandidateDetailItem icon={Briefcase} label="Cargo">
          {candidate.title || null}
        </CandidateDetailItem>
        <CandidateDetailItem icon={Building2} label="Empresa">
          {candidate.company_name || null}
        </CandidateDetailItem>
        <CandidateDetailItem icon={Globe} label="Dominio de la empresa">
          {candidate.company_domain || null}
        </CandidateDetailItem>
        <CandidateDetailItem icon={Tag} label={CANDIDATE_SOURCE_LABEL}>
          <Badge variant="outline">
            {SOURCE_LABELS[candidate.source] ?? candidate.source}
          </Badge>
        </CandidateDetailItem>
        <CandidateDetailItem icon={Calendar} label="Fecha de creación">
          {formatDate(candidate.created_at)}
        </CandidateDetailItem>
      </DetailList>
    </DrawerSection>
  );
}

/**
 * 3. Señales de la evaluación — relevancia, calidad, confianza y duplicidad
 * están en el resumen de arriba; aquí queda el porqué. Sin señales no se pinta.
 */
export function CandidateSignalsSection({
  candidate,
}: {
  candidate: PendingContactCandidate;
}) {
  const matchedKeywords =
    candidate.enrichment_metadata?.relevance?.matched_keywords?.filter(Boolean) ?? [];
  if (matchedKeywords.length === 0) return null;

  return (
    <DrawerSection
      icon={Gauge}
      title="Señales detectadas"
      hint="Lo que el filtro de relevancia encontró en el perfil para puntuarlo."
      badge={matchedKeywords.length}
    >
      <ul className="flex flex-wrap gap-1">
        {matchedKeywords.map((kw) => (
          <li key={kw}>
            <Badge variant="outline">{kw}</Badge>
          </li>
        ))}
      </ul>
    </DrawerSection>
  );
}

/** 3a. Consistencia de identidad (Hito 17B.4W.6) — observacional. */
export function CandidateIdentityConsistencySection({
  personIdentity,
}: {
  personIdentity: LushaPersonIdentityEvidenceV1 | null;
}) {
  const identityDisplay = resolveIdentityDisplay(personIdentity);
  const showIdentityEvidence = personIdentity?.identity_consistency === 'mismatch';

  return (
    <DrawerSection
      icon={ShieldCheck}
      tone="neutral"
      title="Consistencia de identidad"
      /* § 8.3: copy NEUTRAL respecto al proveedor. El texto anterior
         nombraba a Lusha ("la persona encontrada en Lusha"), lo que sugería
         que Lusha había participado en el teléfono cuando lo único que
         indica es `candidate.source`. Este bloque compara identidades del
         CANDIDATO y del enriquecimiento; no dice nada del proveedor
         telefónico, así que tampoco debe nombrar a ninguno. */
      hint="Compara la identidad del candidato encontrado por la fuente original con la identidad devuelta durante el enriquecimiento."
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
          {identityDisplay.tone === 'consistent' ? (
            <ShieldCheck className="h-3.5 w-3.5 text-success" />
          ) : identityDisplay.tone === 'mismatch' ? (
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
          ) : (
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <Badge className={`${IDENTITY_TONE_STYLES[identityDisplay.tone]} border-0`}>
            {identityDisplay.label}
          </Badge>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {identityDisplay.description}
          </p>
          {showIdentityEvidence && (
            <div className="space-y-0.5 pt-1 text-xs text-muted-foreground">
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
    </DrawerSection>
  );
}

/**
 * 3b. Consistencia con la empresa (Hito 17A.9G). Sólo cuando el correo apunta a
 * otro dominio: es un aviso para revisar, no un bloqueo.
 */
export function CandidateCompanyConsistencyNotice({
  companyConsistency,
}: {
  companyConsistency: ContactCandidateCompanyConsistency | null;
}) {
  const showConsistencyWarning =
    companyConsistency?.status === 'possible_mismatch' ||
    companyConsistency?.status === 'possible_related_domain';
  if (!showConsistencyWarning || !companyConsistency) return null;

  return (
    <Alert variant="warning" role="note">
      <AlertTitle className="text-sm">
        {companyConsistency.status === 'possible_related_domain'
          ? 'Posible empresa relacionada'
          : 'Revisar pertenencia a empresa'}
      </AlertTitle>
      <AlertDescription className="text-xs leading-relaxed">
        {companyConsistency.explanation}
      </AlertDescription>
      {companyConsistency.email_domain &&
        companyConsistency.expected_domain &&
        companyConsistency.email_domain !== companyConsistency.expected_domain && (
          <AlertDescription className="break-words text-xs tabular-nums">
            Correo: @{companyConsistency.email_domain} · Empresa:{' '}
            {companyConsistency.expected_domain}
          </AlertDescription>
        )}
    </Alert>
  );
}

/** 4. Trazabilidad. */
export function CandidateTraceabilitySection({
  candidate,
  phoneRevealProviderLabel,
  companyAction,
}: {
  candidate: PendingContactCandidate;
  /** Nombre visible de `phone_reveal_provider`; `null` si no hubo intento. */
  phoneRevealProviderLabel: string | null;
  /**
   * AGENT2A-CANDIDATE-COMPANY-REASSIGN-1: el botón «Reasignar empresa». Lo construye la ficha
   * (que es quien llama al servidor); esta sección sólo lo coloca.
   */
  companyAction?: React.ReactNode;
}) {
  const apolloAttempt = candidate.enrichment_metadata?.apollo_search_attempt ?? null;
  const reassignment = readCandidateCompanyReassignment(candidate.enrichment_metadata);
  const withoutCompany = !candidate.account_id && !candidate.hubspot_company_id;

  return (
    <DrawerSection icon={Hash} tone="neutral" title="Trazabilidad" action={companyAction}>
      {withoutCompany && (
        <Alert variant="warning" role="note" className="mb-3">
          <AlertTitle className="text-sm">Sin empresa asociada</AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">
            Este candidato no está asociado a una cuenta de SellUp ni a una empresa de HubSpot, por
            eso no se puede aprobar. Usa «Reasignar empresa» para asociarlo.
          </AlertDescription>
        </Alert>
      )}
      <DetailList>
        <CandidateDetailItem icon={Hash} label="ID del candidato">
          <span className="font-mono text-xs break-all">{candidate.id}</span>
        </CandidateDetailItem>
        {/* «Ejecución», no «búsqueda»: con el desglose del waterfall a la
            vista, esa palabra se leería como un crédito de búsqueda. */}
        <CandidateDetailItem icon={Hash} label="ID de la ejecución">
          {candidate.enrichment_run_id ? (
            <span className="font-mono text-xs break-all">{candidate.enrichment_run_id}</span>
          ) : null}
        </CandidateDetailItem>
        <CandidateDetailItem icon={Tag} label={CANDIDATE_SOURCE_LABEL}>
          {SOURCE_LABELS[candidate.source] ?? candidate.source}
        </CandidateDetailItem>
        {/* § 8.2 en Trazabilidad: el eje del teléfono, junto al del candidato
            pero nunca fundido con él. Solo si hubo intento real. */}
        {phoneRevealProviderLabel && (
          <CandidateDetailItem icon={PhoneCall} label={PHONE_REVEAL_PROVIDER_LABEL}>
            {phoneRevealProviderLabel}
          </CandidateDetailItem>
        )}
        {apolloAttempt && (
          <CandidateDetailItem
            icon={UserSearch}
            label="Intento de búsqueda Apollo"
            className="sm:col-span-2"
          >
            <span className="text-xs">{apolloAttempt}</span>
          </CandidateDetailItem>
        )}
        {candidate.account_id && (
          <CandidateDetailItem icon={Building2} label="ID de la empresa en SellUp">
            <span className="font-mono text-xs break-all">{candidate.account_id}</span>
          </CandidateDetailItem>
        )}
        {candidate.hubspot_company_id && (
          <CandidateDetailItem icon={Globe} label="ID de la empresa en HubSpot">
            <span className="font-mono text-xs break-all">{candidate.hubspot_company_id}</span>
          </CandidateDetailItem>
        )}
        {reassignment && (
          <CandidateDetailItem
            icon={Building2}
            label="Empresa reasignada"
            className="sm:col-span-2"
          >
            <span className="text-xs">
              {reassignment.company_name}
              {reassignment.company_domain ? ` · ${reassignment.company_domain}` : ''}
              {' · '}
              {reassignment.selected_source === 'hubspot' ? 'desde HubSpot' : 'desde SellUp'}
              {reassignment.reassigned_at ? ` · ${formatDate(reassignment.reassigned_at)}` : ''}
              {' · antes: '}
              {reassignment.original.company_name ?? 'sin empresa'}
            </span>
          </CandidateDetailItem>
        )}
      </DetailList>
    </DrawerSection>
  );
}
