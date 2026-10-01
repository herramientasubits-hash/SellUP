/**
 * Status card for Brazil · Receita Federal CNPJ Dados Abertos (br_receita_dados_abertos).
 *
 * Presentational-only card (BR-SOURCE-8-UI). Communicates the current technical
 * stage of the Brazil source: Legal/Privacy approved and local validations
 * (parser, manifest validator, local dry-run) ready, while import, runtime
 * enrichment, HubSpot sync, and live prospect generation remain BLOCKED until a
 * separate milestone with explicit approval.
 *
 * Guardrails (display only — no I/O, no DB writes, no API calls, no CTAs):
 *   noImportCta          : renders no import / download / execute action
 *   noRuntimeCta         : renders no runtime / activate / connect action
 *   noAgent1Cta          : renders no Agent 1 live integration action
 *   noHubspotCta         : renders no HubSpot sync action
 *   importStaysBlocked   : import flag is false
 *   runtimeStaysBlocked  : runtime flag is false
 *   hubspotStaysBlocked  : HubSpot sync flag is false
 *   liveStaysBlocked     : live generation flag is false
 *
 * Hito: BR-SOURCE-8-UI
 */

import { CheckCircle2, Lock, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';

export const BR_RECEITA_CNPJ_SOURCE_KEY = 'br_receita_dados_abertos';

// ─── Reconciliación de clave (BR-SOURCE-8-UI-FIX1) ────────────────────────────
// La UI/registry conserva la clave existente para no duplicar la fuente de
// Brasil; los contratos técnicos (parser, staging, dry-run) usan la canónica.

/** Clave existente del catálogo/UI (no se renombra: ya está en uso). */
export const BR_RECEITA_REGISTRY_SOURCE_KEY = 'br_receita_dados_abertos';

/** Clave técnica canónica en los contratos de parser/staging/dry-run. */
export const BR_RECEITA_CANONICAL_TECHNICAL_SOURCE_KEY =
  'br_receita_cnpj_dados_abertos';

/** Copy presentacional que explica la reconciliación de claves. */
export const BR_RECEITA_SOURCE_KEY_RECONCILIATION_COPY =
  'La interfaz conserva la clave existente del catálogo para evitar duplicar la fuente. Los contratos técnicos de parser, staging y dry-run usan la clave canónica br_receita_cnpj_dados_abertos.';

export type BrReceitaStatusItem = {
  label: string;
  detail: string;
};

/** Capacidades técnicas listas (locales, sin import ni runtime). */
export const BR_RECEITA_READY_ITEMS: readonly BrReceitaStatusItem[] = [
  {
    label: 'Legal / Privacy',
    detail: 'GO Legal y de Privacidad aprobado — tratamiento CNPJ con masking.',
  },
  {
    label: 'Parser',
    detail: 'Parser de muestra local oficial, sin descarga ni ingesta.',
  },
  {
    label: 'Validador de manifiesto',
    detail: 'Validación local de manifiesto (metadata, sin filas ni CNPJ).',
  },
  {
    label: 'Dry-run local',
    detail: 'Reporte de dry-run local sobre archivo real, solo lectura acotada.',
  },
] as const;

/** Capacidades BLOQUEADAS hasta un hito separado con aprobación explícita. */
export const BR_RECEITA_BLOCKED_ITEMS: readonly BrReceitaStatusItem[] = [
  {
    label: 'Importación',
    detail: 'No ejecuta importaciones ni descarga el dataset real.',
  },
  {
    label: 'Runtime enrichment',
    detail: 'No alimenta el runtime de prospección.',
  },
  {
    label: 'Integración live Agent 1',
    detail: 'Sin generación live de prospectos ni expansión.',
  },
  {
    label: 'Sincronización HubSpot',
    detail: 'Sin sincronización con HubSpot.',
  },
] as const;

// ─── Display-only invariants (exported for unit tests) ────────────────────────

export function isBrReceitaLegalApproved(): boolean {
  return true;
}

export function isBrReceitaParserReady(): boolean {
  return true;
}

export function isBrReceitaManifestValidatorReady(): boolean {
  return true;
}

export function isBrReceitaLocalDryRunReady(): boolean {
  return true;
}

export function isBrReceitaImportEnabled(): boolean {
  return false;
}

export function isBrReceitaRuntimeEnabled(): boolean {
  return false;
}

export function isBrReceitaAgent1LiveEnabled(): boolean {
  return false;
}

export function isBrReceitaHubspotSyncEnabled(): boolean {
  return false;
}

export function isBrReceitaLiveGenerationEnabled(): boolean {
  return false;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CoverageCardHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-border/40"
      >
        <Icon className="h-4 w-4" />
      </span>
      <SurfaceCardHeader
        title={title}
        description={description}
        actions={actions}
        className="mb-0 min-w-0 flex-1 flex-wrap"
      />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BrReceitaCnpjStatusCard() {
  return (
    <SurfaceCard>
      <CoverageCardHeader
        icon={ShieldCheck}
        title="Estado técnico — Brasil · Receita CNPJ"
        description="Preparación técnica / dry-run local listo. La fuente aún no importa, no escribe en Supabase y no alimenta el runtime de prospección."
      />

      <div className="mb-5 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Reconciliación de clave</h3>
        <dl className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              Clave de catálogo existente
            </dt>
            <dd className="break-all font-mono text-xs text-foreground">
              {BR_RECEITA_REGISTRY_SOURCE_KEY}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              Clave técnica canónica
            </dt>
            <dd className="break-all font-mono text-xs text-foreground">
              {BR_RECEITA_CANONICAL_TECHNICAL_SOURCE_KEY}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {BR_RECEITA_SOURCE_KEY_RECONCILIATION_COPY}
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        {BR_RECEITA_READY_ITEMS.map((item) => (
          <div
            key={item.label}
            className="flex items-start gap-2.5 rounded-lg border border-success/20 bg-success/10 px-3 py-2.5"
          >
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <div className="min-w-0">
              <dt className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                {item.label}
                <Badge variant="positive">Listo</Badge>
              </dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {item.detail}
              </dd>
            </div>
          </div>
        ))}

        {BR_RECEITA_BLOCKED_ITEMS.map((item) => (
          <div
            key={item.label}
            className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-surface-subtle px-3 py-2.5"
          >
            <Lock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <dt className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                {item.label}
                <Badge variant="neutral">Bloqueado</Badge>
              </dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {item.detail}
              </dd>
            </div>
          </div>
        ))}
      </dl>

      <p className="mt-5 rounded-xl border border-warning/25 bg-warning/15 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        Esta fuente está preparada técnicamente para validaciones locales y
        dry-run, pero todavía no ejecuta importaciones, no escribe en Supabase y
        no alimenta el runtime de prospección. La importación, el runtime, la
        integración live con Agent 1 y la sincronización con HubSpot siguen
        deshabilitadas hasta un hito separado con aprobación explícita.
      </p>
    </SurfaceCard>
  );
}
