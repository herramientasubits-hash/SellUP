'use client';

import * as React from 'react';
import { Building2, Check, Globe, Lightbulb, MapPin, ShieldCheck, UserPlus, XCircle } from "@/icons";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChatCardView } from '@/components/chat/chat-card-view';
import type { ChatCardRow } from '@/components/chat/types';
import { SurfaceCard } from '@/components/shared/surface-card';
import { IconTile } from '@/components/utility';
import { APOLLO_CONTACT_ENRICHMENT_GUARDRAILS } from '@/lib/apollo-guardrails';
import type {
  CompanyCandidate,
  ContactEnrichmentRunResult,
} from '@/modules/contact-enrichment/types';
import type {
  ApolloEnrichmentUiResult,
  ContactEnrichmentProvider,
  LushaEnrichmentUiResult,
} from './contact-enrichment-chat-types';
import {
  getContactEnrichmentEmptyStateCopy,
  getLushaEmptyStateCopy,
} from './contact-enrichment-empty-state-copy';

// ── Source badge ────────────────────────────────────────────────────────────

export function SourceBadge({ source }: { source: 'sellup' | 'hubspot' | 'manual' }) {
  if (source === 'manual') {
    return (
      <Badge variant="neutral">
        Manual
      </Badge>
    );
  }
  return (
    <Badge variant={source === 'sellup' ? 'brand' : 'warning'}>
      {source === 'sellup' ? 'SellUp' : 'HubSpot'}
    </Badge>
  );
}

function sourceLabel(source: 'sellup' | 'hubspot' | 'manual'): string {
  if (source === 'manual') return 'Manual';
  if (source === 'hubspot') return 'HubSpot';
  return 'SellUp';
}

// ── Company chip (reused in confirm + result) ─────────────────────────────────

export function CompanyChip({ candidate }: { candidate: CompanyCandidate }) {
  return (
    <SurfaceCard className="flex items-center gap-3 p-3">
      <IconTile icon={<Building2 />} aria-hidden />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{candidate.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          {candidate.domain && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Globe className="h-3 w-3" aria-hidden />
              {candidate.domain}
            </span>
          )}
          {candidate.country && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" aria-hidden />
              {candidate.country}
            </span>
          )}
          <SourceBadge source={candidate.source} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Fuente: {sourceLabel(candidate.source)}</p>
      </div>
    </SurfaceCard>
  );
}

// ── Run result snapshot ───────────────────────────────────────────────────────
//
// El resultado de una corrida dentro de la conversación. Cada bloque de cifras es
// una tarjeta `rows` de `ChatCardView` —la tarjeta de datos del chat del sistema—
// y cada desenlace que no es una cifra (sin credenciales, error del proveedor, sin
// candidatos) es un `Alert` en su tono. Los rótulos, las cifras y sus unidades son
// los mismos de siempre.

export function RunResultSnapshot({
  runResult,
  candidate,
  apolloResult,
  lushaResult,
  provider,
  onCreateManualContact,
}: {
  runResult: ContactEnrichmentRunResult;
  candidate: CompanyCandidate | null;
  apolloResult?: ApolloEnrichmentUiResult | null;
  lushaResult?: LushaEnrichmentUiResult | null;
  provider?: ContactEnrichmentProvider;
  onCreateManualContact?: () => void;
}) {
  const accountId = candidate?.sellupAccountId ?? null;
  const snapshot = runResult.existingContactsSnapshot;
  const combined = snapshot?.combined;
  const sellup = snapshot?.sellup;
  const hubspot = snapshot?.hubspot;

  const lushaCredentialsMissing =
    provider === 'lusha' &&
    (lushaResult?.status === 'missing_api_key' || lushaResult?.status === 'disabled');

  const lushaCompanyContextError =
    provider === 'lusha' &&
    (lushaResult?.status === 'invalid_account' || lushaResult?.status === 'not_found');

  const lushaProviderError = provider === 'lusha' && lushaResult?.status === 'provider_error';

  const lushaTerminalError = lushaCredentialsMissing || lushaCompanyContextError || lushaProviderError;

  const runRows: ChatCardRow[] = [
    ...(candidate ? [{ key: 'company', label: 'Empresa', value: candidate.name }] : []),
    {
      key: 'candidates',
      label: 'Candidatos',
      value: String(
        lushaResult
          ? lushaResult.candidatesCreated
          : apolloResult
            ? apolloResult.totalCandidates
            : runResult.candidatesCount,
      ),
    },
    { key: 'run-id', label: 'Run ID', value: runResult.runId },
  ];

  const existingRows: ChatCardRow[] = [
    {
      key: 'sellup',
      label: 'SellUp',
      value:
        sellup?.status === 'skipped'
          ? `omitido — ${sellup.reason}`
          : sellup?.status === 'error'
            ? 'error al leer'
            : String(sellup?.count ?? 0),
    },
    {
      key: 'hubspot',
      label: 'HubSpot',
      value:
        hubspot?.status === 'skipped'
          ? `omitido${hubspot.reason ? ` — ${hubspot.reason}` : ''}`
          : hubspot?.status === 'error'
            ? 'error al leer'
            : String(hubspot?.count ?? 0),
    },
    // Total para deduplicación — siempre visible, incluido 0 (Hito 17A.2B)
    {
      key: 'total',
      label: 'Total para deduplicación',
      value: String(combined?.totalExistingContacts ?? 0),
    },
  ];

  const incompleteRows: ChatCardRow[] = combined
    ? [
        { key: 'missing-email', label: 'Sin email', count: combined.incompleteContacts.missingEmail },
        { key: 'missing-phone', label: 'Sin teléfono', count: combined.incompleteContacts.missingPhone },
        {
          key: 'missing-linkedin',
          label: 'Sin LinkedIn',
          count: combined.incompleteContacts.missingLinkedin,
        },
      ]
        .filter((row) => row.count > 0)
        .map((row) => ({ key: row.key, label: row.label, value: String(row.count) }))
    : [];

  return (
    <div className="space-y-3" data-testid="run-result-snapshot">
      <div className="flex flex-wrap items-center gap-2">
        <IconTile
          icon={lushaTerminalError ? <XCircle /> : <Check />}
          tone={lushaTerminalError ? 'warning' : 'positive'}
          size="sm"
          aria-hidden
        />
        <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">
          {lushaTerminalError ? 'Run no ejecutado' : 'Run creado'}
        </p>
        {provider === 'lusha' && lushaResult?.status === 'missing_api_key' ? (
          <Badge variant="warning">Sin credenciales</Badge>
        ) : provider === 'lusha' && lushaResult?.status === 'disabled' ? (
          <Badge variant="neutral">Desactivado</Badge>
        ) : provider === 'lusha' && lushaCompanyContextError ? (
          <Badge variant="warning">Sin contexto de empresa</Badge>
        ) : provider === 'lusha' && lushaResult?.status === 'provider_error' ? (
          <Badge variant="negative">Error del proveedor</Badge>
        ) : (
          <Badge variant="positive">
            {apolloResult?.status === 'ready_for_review' || lushaResult?.status === 'ready_for_review' || lushaResult?.providerStatus === 'success'
              ? 'Listo para revisión'
              : apolloResult?.status === 'completed' || lushaResult?.status === 'completed'
                ? 'Completado'
                : 'Listo para enriquecer'}
          </Badge>
        )}
      </div>

      <ChatCardView data-testid="run-result-run" card={{ kind: 'rows', rows: runRows }} />

      {snapshot && (
        <ChatCardView
          data-testid="run-result-existing"
          card={{ kind: 'rows', title: 'Contactos existentes detectados', rows: existingRows }}
        />
      )}

      {incompleteRows.length > 0 && (
        <ChatCardView
          data-testid="run-result-incomplete"
          card={{ kind: 'rows', title: 'Contactos incompletos', rows: incompleteRows }}
        />
      )}

      {apolloResult ? (
        <ApolloResultSummary
          result={apolloResult}
          runId={runResult.runId}
          accountId={accountId}
          companyName={candidate?.name ?? null}
          companyDomain={candidate?.domain ?? null}
          onCreateManualContact={onCreateManualContact}
        />
      ) : lushaCredentialsMissing ? (
        <Alert variant="warning" role="note">
          <AlertDescription className="text-xs text-warning">
            {lushaResult?.status === 'missing_api_key'
              ? 'Lusha no pudo acceder a la credencial configurada en Supabase Vault desde este runtime. No se ejecutó el proveedor y no se crearon candidatos.'
              : 'Lusha está desactivado en este entorno. No se ejecutó el proveedor y no se crearon candidatos.'}
          </AlertDescription>
        </Alert>
      ) : lushaCompanyContextError ? (
        <Alert variant="warning" role="note">
          <AlertDescription className="text-xs text-warning">
            No se pudo resolver suficiente contexto de la empresa para ejecutar Lusha. No se crearon candidatos.
          </AlertDescription>
        </Alert>
      ) : lushaProviderError ? (
        <Alert variant="destructive" role="note">
          <AlertDescription className="text-xs text-destructive">
            {lushaResult?.error ??
              'No fue posible completar la búsqueda con Lusha. El proveedor devolvió un error durante la búsqueda. Intenta nuevamente más tarde o revisa el estado de la integración.'}
          </AlertDescription>
        </Alert>
      ) : lushaResult && lushaResult.candidatesCreated === 0 ? (
        <LushaEmptyState result={lushaResult} />
      ) : lushaResult ? (
        <p className="text-xs text-muted-foreground">
          Los candidatos quedaron pendientes de revisión. No se crearon contactos finales.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {provider === 'lusha'
            ? 'Lusha buscará o enriquecerá perfiles para crear candidatos revisables con email corporativo cuando esté disponible. Teléfono deshabilitado en esta fase. No se crean contactos finales ni se escribe en HubSpot.'
            : 'Apollo buscará perfiles de RR. HH. para crear candidatos revisables. No se crean contactos finales ni se escribe en HubSpot.'}
        </p>
      )}
    </div>
  );
}

// ── Lusha empty-after-filtering state (Hito 17B.4X.7C.3D) ───────────────────
//
// Lusha executed correctly and consumed credits, but every raw profile was
// filtered out by relevance/company-consistency checks. This is a business
// outcome, not a provider error — must never be confused with
// missing_api_key/disabled/provider_error (those render above, before this
// branch is reached).

function LushaEmptyState({ result }: { result: LushaEnrichmentUiResult }) {
  const copy = getLushaEmptyStateCopy({
    rawResultsCount: result.rawResultsCount,
    creditsUsed: result.creditsUsed,
  });

  return (
    <>
      <Alert role="note">
        <AlertTitle className="text-sm">{copy.headline}</AlertTitle>
        <AlertDescription className="text-xs">{copy.detail}</AlertDescription>
        <AlertDescription className="text-xs">{copy.notAnError}</AlertDescription>
      </Alert>
      <ChatCardView
        data-testid="lusha-empty-metrics"
        card={{
          kind: 'rows',
          rows: [
            { key: 'raw', label: 'Resultados brutos', value: String(result.rawResultsCount) },
            { key: 'credits', label: 'Créditos usados', value: String(result.creditsUsed ?? 0) },
            { key: 'phone-reveal', label: 'Reveal de teléfono', value: 'no ejecutado' },
          ],
        }}
      />
    </>
  );
}

// ── Apollo pre-flight card (Hito 17A.6B) ─────────────────────────────────────

export function ApolloPreflightCard({ provider }: { provider?: ContactEnrichmentProvider }) {
  const g = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS;
  const isLusha = provider === 'lusha';
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <IconTile icon={<ShieldCheck />} size="sm" aria-hidden />
        <p className="text-sm font-semibold text-foreground">
          {isLusha ? 'Control de enriquecimiento Lusha' : 'Control de créditos Apollo'}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {isLusha
          ? 'SellUp buscará o enriquecerá perfiles con Lusha. Solo se busca email corporativo; teléfono deshabilitado en esta fase.'
          : 'SellUp buscará contactos con email, teléfono o LinkedIn. Solo intentará completar los perfiles con mayor probabilidad de ser útiles. Para controlar costos, no realizará reveal automático de teléfonos sin confirmación.'}
      </p>
      {isLusha ? (
        <>
          <ChatCardView
            data-testid="preflight-lusha"
            card={{
              kind: 'rows',
              title: 'Búsqueda / enriquecimiento Lusha',
              rows: [
                { key: 'attempts', label: 'Máximo de intentos', value: '3' },
                { key: 'results', label: 'Máximo de resultados a evaluar', value: '15' },
                { key: 'email', label: 'Email corporativo', value: 'habilitado si está disponible' },
                { key: 'phone', label: 'Teléfono', value: 'deshabilitado en esta fase' },
                { key: 'phone-reveal', label: 'Reveal automático de teléfono', value: 'no disponible' },
              ],
            }}
          />
          <p className="text-xs text-muted-foreground">
            Lusha puede consumir créditos según disponibilidad del proveedor. SellUp limita
            resultados e intentos para evitar corridas amplias. Los candidatos quedan en revisión
            humana; no se crean contactos finales ni se escribe en HubSpot.
          </p>
        </>
      ) : (
        <>
          <ChatCardView
            data-testid="preflight-apollo-search"
            card={{
              kind: 'rows',
              title: 'Búsqueda Apollo',
              rows: [
                { key: 'attempts', label: 'Máximo de intentos', value: String(g.maxSearchAttempts) },
                {
                  key: 'results',
                  label: 'Máximo de resultados a evaluar',
                  value: String(g.maxSearchResultsPerRun),
                },
                {
                  key: 'credits',
                  label: 'Créditos máximos de búsqueda',
                  value:
                    g.maxEstimatedSearchCreditsPerRun === 0
                      ? 'sin costo'
                      : `${g.maxEstimatedSearchCreditsPerRun} créditos`,
                },
              ],
            }}
          />
          <ChatCardView
            data-testid="preflight-apollo-completion"
            card={{
              kind: 'rows',
              title: 'Completion de perfiles',
              rows: [
                {
                  key: 'profiles',
                  label: 'Máximo de perfiles a completar',
                  value: String(g.maxCompletionCandidates),
                },
                {
                  key: 'credits',
                  label: 'Créditos máximos estimados de completion',
                  value: String(g.maxCompletionCreditsPerRun),
                },
                {
                  key: 'phone',
                  label: 'Teléfono (de búsqueda)',
                  value: 'se conserva si Apollo lo entrega',
                },
                {
                  key: 'phone-reveal',
                  label: 'Reveal automático de teléfono',
                  value: `~${g.phoneRevealCredits} créditos — ${
                    g.automaticPhoneRevealEnabled ? 'activado' : 'requiere confirmación'
                  }`,
                },
              ],
            }}
          />
          <p className="text-xs text-muted-foreground">
            La búsqueda puede consumir créditos según el plan. SellUp limita resultados e intentos
            para evitar corridas amplias. Solo se completarán perfiles de alta relevancia (RR. HH.,
            Talento, Aprendizaje, Cultura).
            <br />
            <span className="mt-1 inline-block">
              Nota: para sincronizar con HubSpot, el contacto aprobado deberá tener email.
            </span>
          </p>
        </>
      )}
    </div>
  );
}

// ── Apollo empty state (Hito 17A.7A + 17A.7C) ───────────────────────────────

interface ApolloEmptyStateProps {
  result: ApolloEnrichmentUiResult;
  runId?: string | null;
  accountId?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  onCreateManualContact?: () => void;
}

function ApolloEmptyState({ result, runId, accountId, onCreateManualContact }: ApolloEmptyStateProps) {
  const copy = getContactEnrichmentEmptyStateCopy({
    rawResultsCount: result.rawResultsCount,
    rejectedByRelevance: result.rejectedByRelevance,
    candidatesCreated: result.candidatesCreated,
    noActionableContactsFound: result.noActionableContactsFound,
    noReviewableContactsFound: result.noReviewableContactsFound,
    searchGuardrail: result.searchGuardrail,
    completionAttempted: result.completionAttempted,
    actualCreditsTotal: result.costGuardrail?.actual_credits_total,
  });

  const canCreateManual = !!(runId && accountId && onCreateManualContact);

  return (
    <Alert variant="warning" role="note">
      <AlertTitle className="text-sm text-foreground">{copy.headline}</AlertTitle>
      <AlertDescription className="text-xs">{copy.detail}</AlertDescription>
      <AlertDescription className="text-xs">{copy.notAnError}</AlertDescription>

      <div className="space-y-2 pt-2">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5 text-primary" aria-hidden />
          <p className="text-xs font-medium text-foreground">Qué puedes hacer</p>
        </div>
        <ul className="space-y-1.5">
          {copy.tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-xs text-muted-foreground">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden />
              {tip}
            </li>
          ))}
        </ul>
      </div>

      {canCreateManual && (
        <div className="pt-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-2"
            onClick={onCreateManualContact}
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            Crear contacto manualmente
          </Button>
        </div>
      )}
    </Alert>
  );
}

// ── Apollo result summary (Hito 17A.3A) ───────────────────────────────────────

interface ApolloResultSummaryProps {
  result: ApolloEnrichmentUiResult;
  runId?: string | null;
  accountId?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  onCreateManualContact?: () => void;
}

function ApolloResultSummary({ result, runId, accountId, companyName, companyDomain, onCreateManualContact }: ApolloResultSummaryProps) {
  if (result.providerStatus === 'error' || result.providerStatus === 'skipped') {
    return (
      <Alert variant="warning" role="note">
        <AlertDescription className="text-xs text-warning">
          {result.error ?? 'Apollo no pudo ejecutarse. No se crearon candidatos.'}
        </AlertDescription>
      </Alert>
    );
  }

  const hasNoReviewableCandidates = result.candidatesCreated === 0;

  const resultRows: ChatCardRow[] = [
    { key: 'found', label: 'Perfiles encontrados', value: String(result.rawResultsCount) },
    {
      key: 'filtered',
      label: 'Filtrados por relevancia/calidad',
      value: String(result.rejectedByRelevance),
    },
    {
      key: 'completion-attempted',
      label: 'Intentos de completar datos',
      value: String(result.completionAttempted),
    },
    {
      key: 'actionable',
      label: 'Candidatos con datos accionables',
      value: String(result.actionableContactsCount),
    },
    {
      key: 'ready',
      label: 'Candidatos listos para revisión',
      value: String(result.candidatesCreated),
    },
    { key: 'duplicates', label: 'Duplicados omitidos', value: String(result.duplicatesSkipped) },
    ...(result.possibleDuplicates > 0
      ? [
          {
            key: 'possible-duplicates',
            label: 'Posibles duplicados',
            value: String(result.possibleDuplicates),
          },
        ]
      : []),
    {
      key: 'final-status',
      label: 'Estado final',
      value: result.status === 'ready_for_review' ? 'Listo para revisión' : 'Completado',
    },
  ];

  const cost = result.costGuardrail;
  const costRows: ChatCardRow[] = cost
    ? [
        { key: 'email', label: 'Email/básico', value: String(cost.actual_credits_email) },
        cost.phone_completion_enabled
          ? { key: 'phone', label: 'Teléfono', value: String(cost.actual_credits_phone) }
          : { key: 'phone-reveal', label: 'Reveal automático de teléfono', value: 'no ejecutado' },
        {
          key: 'total',
          label: 'Total',
          value:
            cost.actual_credits_total === 0 && result.completionAttempted === 0
              ? 'sin créditos de completion'
              : `${cost.actual_credits_total} créditos`,
          // El aviso del guardrail explica la cifra del total: va pegado a ella.
          hint: cost.guardrail_blocked
            ? `Guardrail activado — algunos perfiles no se completaron para no superar el límite de ${cost.max_credits_per_run} créditos.`
            : null,
        },
      ]
    : [];

  const search = result.searchGuardrail;
  const searchRows: ChatCardRow[] = search
    ? [
        { key: 'evaluated', label: 'Resultados evaluados', value: String(result.rawResultsCount) },
        {
          key: 'credits',
          label: 'Créditos de búsqueda',
          value:
            search.estimated_search_credits === 0
              ? 'sin costo'
              : `${search.estimated_search_credits} créditos`,
          hint: search.blocked_by_search_budget
            ? `Búsqueda detenida al alcanzar el límite de ${search.max_results_per_run} resultados.`
            : null,
        },
        ...(search.stopped_early_reason
          ? [
              {
                key: 'stop-reason',
                label: 'Motivo de corte',
                value:
                  search.stopped_early_reason === 'target_reviewable_reached'
                    ? 'objetivo alcanzado'
                    : search.stopped_early_reason === 'search_budget_reached'
                      ? 'límite de resultados alcanzado'
                      : 'intentos agotados',
              },
            ]
          : []),
      ]
    : [];

  return (
    <>
      <ChatCardView
        data-testid="apollo-result"
        card={{ kind: 'rows', title: 'Resultado de Apollo', rows: resultRows }}
      />

      {hasNoReviewableCandidates ? (
        <ApolloEmptyState
          result={result}
          runId={runId}
          accountId={accountId}
          companyName={companyName}
          companyDomain={companyDomain}
          onCreateManualContact={onCreateManualContact}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Los candidatos quedaron pendientes de revisión. No se crearon contactos finales.
        </p>
      )}

      {cost && (
        <>
          <ChatCardView
            data-testid="apollo-completion-credits"
            card={{ kind: 'rows', title: 'Créditos de completion', rows: costRows }}
          />
          {result.completionAttempted > 0 && result.actionableContactsCount === 0 && (
            <p className="text-xs text-muted-foreground">
              Se intentó completar datos en {result.completionAttempted} perfil
              {result.completionAttempted !== 1 ? 'es' : ''}, pero Apollo no devolvió canales
              accionables.
            </p>
          )}
        </>
      )}

      {search && (
        <ChatCardView
          data-testid="apollo-search"
          card={{ kind: 'rows', title: 'Búsqueda Apollo', rows: searchRows }}
        />
      )}
    </>
  );
}
