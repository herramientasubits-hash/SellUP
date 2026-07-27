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

import { CheckCircle2, Lock } from 'lucide-react';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';

export const BR_RECEITA_CNPJ_SOURCE_KEY = 'br_receita_dados_abertos';

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

// ─── Component ────────────────────────────────────────────────────────────────

export function BrReceitaCnpjStatusCard() {
  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Estado técnico — Brasil · Receita CNPJ"
        description="Preparación técnica / dry-run local listo. La fuente aún no importa, no escribe en Supabase y no alimenta el runtime de prospección."
      />

      <dl className="grid gap-3 sm:grid-cols-2">
        {BR_RECEITA_READY_ITEMS.map((item) => (
          <div
            key={item.label}
            className="flex items-start gap-2.5 rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <div className="min-w-0">
              <dt className="flex items-center gap-2 text-[0.8125rem] font-medium text-foreground">
                {item.label}
                <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  Listo
                </span>
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
            className="flex items-start gap-2.5 rounded-md border border-border/50 bg-muted/30 px-3 py-2.5"
          >
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <dt className="flex items-center gap-2 text-[0.8125rem] font-medium text-foreground">
                {item.label}
                <span className="inline-flex items-center rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Bloqueado
                </span>
              </dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {item.detail}
              </dd>
            </div>
          </div>
        ))}
      </dl>

      <p className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        Esta fuente está preparada técnicamente para validaciones locales y
        dry-run, pero todavía no ejecuta importaciones, no escribe en Supabase y
        no alimenta el runtime de prospección. La importación, el runtime, la
        integración live con Agent 1 y la sincronización con HubSpot siguen
        deshabilitadas hasta un hito separado con aprobación explícita.
      </p>
    </SurfaceCard>
  );
}
