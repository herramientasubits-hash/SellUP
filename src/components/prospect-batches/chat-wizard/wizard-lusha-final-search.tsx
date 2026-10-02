'use client';

/**
 * Wizard final search step — persist Lusha results as pending review (Q3F-5BB.4)
 *
 * Rendered at the END of the CONVERSATIONAL "Generar con IA" wizard, only when
 * the collected criteria resolve to Lusha (see `resolveWizardLushaCriteria`).
 *
 * On the explicit "Buscar con IA" click this runs Lusha ONCE and PERSISTS the
 * results as a pending-review prospect batch + candidates (the drawer is NOT a
 * results list — the review happens in Prospectos). Safety:
 *   - NO auto-run: persistence fires only from the button onClick (no effects).
 *   - Lusha runs through the read-only preview core → page 0 / size 10 / ≤1
 *     credit guardrails are server-authoritative.
 *   - DB writes are limited to batch + candidates (server action). No accounts,
 *     no HubSpot, no enrichment.
 *   - Lusha is HIDDEN: it surfaces only as traceability ("Fuente usada: Lusha").
 * Criteria are locked (already collected conversationally) and shown as a recap.
 */

import * as React from 'react';
import { Search, RotateCcw, ArrowRight } from "@/icons";
import { AiAnalyzingState } from '@/components/ai/ai-analyzing-state';
import { ChatCardView, type ChatCardRow } from '@/components/chat';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { LockedCriteriaRecap } from '@/components/prospect-batches/lusha-preview-drawer';
import {
  generateLushaPendingReviewBatchAction,
  type GenerateLushaPendingReviewBatchActionResult,
} from '@/modules/prospect-batches/lusha-pending-review-actions';
import type { WizardLushaInput } from '@/modules/prospect-batches/wizard-lusha-criteria';
import type { WizardFinalRecap } from '@/modules/prospect-batches/wizard-final-summary';
// AGENT1-LUSHA-BUDGET-GATE-1 § 6 — mismo comparador y mismo redactor que la ruta
// Apollo, para que el aviso previo de Lusha no pueda divergir del suyo.
import type { WizardBudgetPreflight } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight';
import {
  resolveLushaPreExecutionBudgetBlock,
  resolveLushaPreflightRequiredCredits,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight';
import { mapBudgetExceeded } from './wizard-execution-error-map';

export const WIZARD_LUSHA_SEARCH_LABEL = 'Buscar con IA';
export const WIZARD_LUSHA_SEARCH_LOADING_LABEL = 'Buscando con IA…';
/** Discreet traceability shown only after persistence (never a selector). */
export const WIZARD_LUSHA_PROVIDER_LABEL = 'Lusha';

/**
 * Pre-search cost notice (Q3F-5BB.10A · AGENT1-LUSHA-PRECLICK-UX-CONSISTENCY-FIX-1 § P0).
 *
 * IMPORTANT: We do NOT promise a fixed credit count. Lusha may bill per company
 * returned (api_search), so the honest guardrail is that billing follows the
 * user's Lusha plan and that the real cost is reported after the search.
 *
 * 🔴 Ya no describe la FORMA de la búsqueda con cifras propias. Hasta
 * AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 toda corrida de Lusha era una
 * búsqueda paginada —2 páginas × 10 resultados = 20 empresas— y esas tres cifras
 * eran ciertas para todo el mundo. Con el ejecutor multirrama dejaron de serlo:
 * una macro industria de 3 ramas hace hasta 6 peticiones y puede devolver hasta
 * 60 filas, así que la pantalla prometía un techo TRES veces menor que el real.
 *
 * Y no se sustituyen por «6 peticiones / 60 empresas»: ese número tampoco es
 * universal —depende de cuántas ramas tenga el plan de la macro (2, 4 o 6)— y
 * reescribirlo aquí duplicaría en la UI una regla que vive en el ejecutor, lista
 * para divergir otra vez. La única cifra cuantitativa que esta pantalla enseña
 * es `requiredCredits`, que llega del preflight consciente del plan.
 */
export const WIZARD_LUSHA_TOPUP_COST_NOTICE =
  `Esta búsqueda consulta Lusha siguiendo el plan configurado para la macroindustria seleccionada, sin signals. ` +
  `Cada empresa devuelta puede ser facturable según tu plan de Lusha. ` +
  `El costo real se muestra al finalizar.`;

/**
 * Complemento del aviso anterior, mostrado SÓLO cuando el preflight resolvió el
 * techo: sin esas dos cifras en pantalla, «se muestra abajo» apuntaría a nada.
 */
export const WIZARD_LUSHA_AUTHORIZED_MAX_NOTICE =
  `El máximo de créditos autorizado para esta búsqueda se muestra abajo. ` +
  `El consumo real puede ser menor.`;

/** Injectable persist runner (tests). Default = real server action. */
export type RunLushaPendingReviewSearch = (
  input: WizardLushaInput & { clientRequestId: string },
) => Promise<GenerateLushaPendingReviewBatchActionResult>;

/** The step labels shown while the search + persistence runs (display only). */
export const WIZARD_LUSHA_LOADER_STEPS = [
  'Preparando la búsqueda',
  'Consultando el proveedor configurado',
  'Normalizando empresas',
  'Dejando candidatos listos para revisión',
] as const;

type PanelStatus = 'idle' | 'loading' | 'done';

export interface WizardLushaFinalSearchProps {
  /** Read-only Lusha input built from the wizard's collected criteria. */
  input: WizardLushaInput;
  /**
   * Q3F-5BB.3F — Recap enriquecido (labels humanos del wizard) para el paso
   * final "Revisa tu búsqueda". Solo presentación; no altera la request a Lusha.
   */
  recap?: WizardFinalRecap;
  /** Inyectable para tests. Por defecto usa la server action real. */
  runPersist?: RunLushaPendingReviewSearch;
  /**
   * AGENT1-LUSHA-BUDGET-GATE-1 § 6 — instantánea del período global de Agente 1,
   * resuelta en el servidor. `null` = no se pudo leer ⇒ NO se bloquea nada: la
   * reserva atómica del servidor sigue siendo la única autoridad y este aviso
   * sólo puede retirar una oferta cuyo rechazo ya se conoce.
   */
  budgetPreflight?: WizardBudgetPreflight | null;
  /**
   * Acuñador del `clientRequestId` de la reserva. Inyectable para tests
   * deterministas; por defecto `crypto.randomUUID()`.
   */
  newClientRequestId?: () => string;
  /** Ir a Prospectos (cierra el drawer y refresca la lista). */
  onViewProspects?: () => void;
  /** Reiniciar el wizard para una nueva búsqueda. */
  onGenerateAnother?: () => void;
}

export function WizardLushaFinalSearch({
  input,
  recap,
  runPersist = generateLushaPendingReviewBatchAction,
  budgetPreflight = null,
  newClientRequestId = () => crypto.randomUUID(),
  onViewProspects,
  onGenerateAnother,
}: WizardLushaFinalSearchProps) {
  const [status, setStatus] = React.useState<PanelStatus>('idle');
  const [result, setResult] =
    React.useState<GenerateLushaPendingReviewBatchActionResult | null>(null);

  // AGENT1-LUSHA-BUDGET-GATE-1 § 6 — bloqueo PREVIO al primer clic.
  //
  // Tres propiedades que este bloque no puede romper (las mismas que rigen el
  // preflight de Apollo):
  //   · No autoriza nada. Sólo retira una oferta; la reserva atómica sigue
  //     decidiendo, y la carrera «la UI dice que cabe / otra corrida se lo gasta»
  //     la resuelve ella.
  //   · Sin instantánea no bloquea: convertir «no pude leer» en «no puedes
  //     ejecutar» bloquearía a todo el mundo por un error de diagnóstico.
  //   · No inventa cifras: sin techo resoluble no hay aviso.
  //
  // AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 § 9 — el techo que se compara y
  // el que se muestra son el MISMO, y ahora dependen del plan de la macro
  // industria que el wizard resolvió: una macro compuesta ejecuta varias ramas y
  // su peor caso son 4 o 6 créditos, no 2. El número lo resolvió el servidor con
  // la misma función que la reserva usa; aquí sólo se elige la fila de la macro.
  //
  // AGENT1-LUSHA-MACRO-V2-ROUTING-CUTOVER-1 § 12 — la fila se busca por
  // `macroIndustryKey`, el MISMO vocabulario con el que la ruta decidió y con el
  // que el servidor indexó la tabla. Antes se buscaba por `sectorKey`, así que las
  // nueve macro sin sector equivalente no tenían fila y el aviso caía al respaldo.
  const budgetBlock = resolveLushaPreExecutionBudgetBlock(budgetPreflight, input.macroIndustryKey);
  const budgetMessage = budgetBlock !== null ? mapBudgetExceeded(budgetBlock).message : null;
  const requiredCredits =
    resolveLushaPreflightRequiredCredits(budgetPreflight, input.macroIndustryKey) ?? null;
  const availableCredits = budgetPreflight?.availableCredits ?? null;

  // IMPORTANTE: única vía de ejecución. Invocada solo por el onClick del botón.
  async function handleSearch() {
    if (status === 'loading') return;
    // El aviso es informativo; el bloqueo real lo aplica la reserva atómica del
    // servidor. Esta salida temprana sólo evita un viaje que ya se sabe rechazado.
    if (budgetBlock !== null) return;
    setStatus('loading');
    setResult(null);
    try {
      // § 8 — clientRequestId FRESCO por clic. A diferencia del wizard Apollo
      // —que lo conserva porque además ancla un slot de ejecución durable— aquí
      // reutilizarlo dejaría que un reintento cabalgue una reserva YA liquidada
      // (se liquida también en el camino de error), es decir, gastar sin reserva
      // viva. Un id nuevo obliga a que cada llamada al proveedor tenga la suya.
      const res = await runPersist({ ...input, clientRequestId: newClientRequestId() });
      setResult(res);
    } catch (err) {
      setResult({
        ok: false,
        status: 'error',
        batchId: null,
        createdCandidatesCount: 0,
        skippedCount: 0,
        creditsCharged: null,
        resultsReturned: null,
        reviewUrl: '/accounts?tab=prospectos',
        message: 'No fue posible guardar los prospectos. Intenta de nuevo.',
        error: err instanceof Error ? err.message.slice(0, 200) : 'error',
        pagesRequested: 0,
        expectedMaxCredits: 2,
        creditsChargedTotal: null,
        usefulCandidatesCount: 0,
        excludedExactDuplicatesCount: 0,
        skippedActiveDuplicatesCount: 0,
        possibleDuplicatesCount: 0,
        insertedCandidatesCount: 0,
        topUpTriggered: false,
      });
    } finally {
      setStatus('done');
    }
  }

  // ── Terminal states: confirmation / empty / error (no result cards) ─────────
  if (status === 'done' && result) {
    if (result.ok && result.status === 'success') {
      return (
        <div data-testid="wizard-lusha-final-search">
          <PersistConfirmation
            result={result}
            onViewProspects={onViewProspects}
            onGenerateAnother={onGenerateAnother}
          />
        </div>
      );
    }
    if (result.ok && result.status === 'empty') {
      return (
        <div data-testid="wizard-lusha-final-search">
          <EmptyResult onGenerateAnother={onGenerateAnother} />
        </div>
      );
    }
    return (
      <div data-testid="wizard-lusha-final-search">
        <ErrorResult message={result.message} onRetry={handleSearch} />
      </div>
    );
  }

  // ── Review + search surface (idle / loading) ────────────────────────────────
  return (
    <div className="space-y-6" data-testid="wizard-lusha-final-search">
      <LockedCriteriaRecap
        countryCode={input.countryCode}
        macroIndustryKey={input.macroIndustryKey}
        searchText={input.searchText ?? ''}
        {...(recap ? { recap } : {})}
      />

      <div className="space-y-3">
        <Alert variant="warning" role={undefined}>
          <AlertDescription className="text-xs" data-testid="lusha-preview-cost-notice">
            {WIZARD_LUSHA_TOPUP_COST_NOTICE}
            {requiredCredits !== null ? ` ${WIZARD_LUSHA_AUTHORIZED_MAX_NOTICE}` : ''}
          </AlertDescription>
        </Alert>

        {/* § 6 — el presupuesto GLOBAL de Agente 1, el mismo que gobierna Apollo y
            Tavily. Se muestra sólo cuando el servidor pudo resolver las dos
            cifras: media instantánea no explica nada. */}
        {availableCredits !== null && requiredCredits !== null && (
          <ChatCardView
            data-testid="lusha-budget-preflight"
            card={{
              kind: 'rows',
              title: 'Presupuesto de esta búsqueda',
              rows: [
                {
                  key: 'available',
                  label: 'Presupuesto disponible',
                  value: String(availableCredits),
                  testId: 'lusha-budget-available',
                },
                {
                  key: 'required',
                  label: 'Máximo que puede consumir esta búsqueda',
                  value: String(requiredCredits),
                  testId: 'lusha-budget-required',
                },
              ],
            }}
          />
        )}

        {/* Mismo tratamiento visual que el bloqueo previo de Apollo, y el mismo
            redactor: el bloqueo es igual de real, sólo se conoce antes.
            `role="alert"` porque aparece sin que la usuaria haya actuado. */}
        {budgetMessage !== null && (
          <Alert variant="destructive" data-testid="lusha-budget-preflight-notice">
            <p className="min-w-0 break-words text-xs leading-relaxed text-destructive">{budgetMessage}</p>
          </Alert>
        )}

        <Button
          type="button"
          size="sm"
          disabled={status === 'loading' || budgetBlock !== null}
          onClick={handleSearch}
          data-testid="lusha-preview-run"
        >
          {status === 'loading' ? (
            WIZARD_LUSHA_SEARCH_LOADING_LABEL
          ) : (
            <>
              <Search className="h-3.5 w-3.5" />
              {WIZARD_LUSHA_SEARCH_LABEL}
            </>
          )}
        </Button>
      </div>

      {status === 'loading' && <SearchLoader />}
    </div>
  );
}

// ── Espera de la búsqueda (sin temporizadores ni efectos) ─────────────────────

/**
 * El estado «la IA está trabajando» del sistema (`AiAnalyzingState` de Thema),
 * con la lista de lo que la búsqueda va haciendo debajo. La lista es un PLAN,
 * no un progreso medido: por eso no hay barra ni pasos que se marquen solos.
 */
function SearchLoader() {
  return (
    <div className="space-y-3" data-testid="wizard-lusha-search-loader">
      <AiAnalyzingState title="Buscando empresas candidatas…" />
      <ol className="space-y-1 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3">
        {WIZARD_LUSHA_LOADER_STEPS.map((step) => (
          <li key={step} className="text-xs text-muted-foreground">
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Confirmation (brief — the review happens in Prospectos, not here) ──────────

function PersistConfirmation({
  result,
  onViewProspects,
  onGenerateAnother,
}: {
  result: GenerateLushaPendingReviewBatchActionResult;
  onViewProspects?: () => void;
  onGenerateAnother?: () => void;
}) {
  const count = result.createdCandidatesCount;
  const creditsUsed = result.creditsChargedTotal ?? result.creditsCharged;
  // ── AGENT1-LOCAL-CUT9 § 16 — el panel deja de contar sólo la mitad de pago ──
  //
  // 🔴 `createdCandidatesCount` es el UNIVERSO DURABLE de la ruta de PAGO. Con el
  // hueco parcial activado (CUT-9 § 1) una corrida mixta deja también filas
  // gratuitas en el MISMO lote, así que ese número solo subestima lo que la persona
  // acaba de conseguir: 6 de pago sobre un lote de 10.
  //
  // 🔴 No se sustituye una cifra por otra ni se pinta el objetivo PEDIDO como si
  // fuera lo producido. Se añaden las dos que el resultado ya trae resueltas por
  // `resolveAcceptedForTarget` —la única aritmética de aceptación— y se dejan junto
  // a las de la mitad de pago, que siguen siendo verdad sobre lo que Lusha rindió.
  //
  // Ausente ⇒ el panel no afirma ninguna cifra de aceptación, exactamente como
  // antes de este corte.
  const acceptance = result.acceptedForTarget ?? null;
  const shortBatch = result.batchId ? result.batchId.slice(0, 8) : '—';
  // Q3F-5BB.10A — show what Lusha actually reported, never a "/ máx N créditos"
  // promise. Credits and returned companies are read directly from the result.
  const creditsLabel = creditsUsed === null ? '—' : String(creditsUsed);
  const resultsReturnedLabel =
    result.resultsReturned === null ? '—' : String(result.resultsReturned);

  const metricRows: ChatCardRow[] = [
    {
      key: 'provider',
      label: 'Fuente usada',
      value: WIZARD_LUSHA_PROVIDER_LABEL,
      testId: 'wizard-lusha-persist-provider',
    },
    {
      key: 'useful',
      label: 'Enviadas a revisión',
      value: String(count),
      testId: 'wizard-lusha-persist-useful',
    },
    ...(acceptance !== null
      ? [
          {
            key: 'accepted',
            label: 'Cuentan hacia tu objetivo',
            // 🔴 Aceptadas de TODA la corrida (gratis + pago) sobre el objetivo
            // PEDIDO, nunca filas persistidas y nunca el objetivo solo.
            value: `${acceptance.acceptedForTargetTotal} de ${acceptance.requestedTarget}`,
            testId: 'wizard-lusha-persist-accepted',
          },
          {
            key: 'durable-total',
            label: 'Empresas guardadas en el lote',
            // 🔴 El universo durable del lote, gratuito incluido: se reporta
            // JUNTO a lo aceptado, jamás en su lugar (CUT-7 § 10).
            value: String(acceptance.persistedTotalCandidates),
            testId: 'wizard-lusha-persist-durable-total',
          },
          {
            key: 'remaining',
            label: 'Faltan para el objetivo',
            // 🔴 «no se midió» y «se midió cero» son corridas distintas y el
            // panel no puede pintarlas igual.
            value: acceptance.paidAcceptanceMeasured ? String(acceptance.remainingTarget) : 'sin medir',
            testId: 'wizard-lusha-persist-remaining',
          },
        ]
      : []),
    {
      key: 'results-returned',
      label: 'Empresas devueltas por Lusha',
      value: resultsReturnedLabel,
      testId: 'wizard-lusha-persist-results-returned',
    },
    {
      key: 'possible',
      label: 'Posibles duplicados',
      value: String(result.possibleDuplicatesCount),
      testId: 'wizard-lusha-persist-possible',
    },
    {
      key: 'excluded',
      label: 'Duplicados confirmados excluidos',
      value: String(result.excludedExactDuplicatesCount),
      testId: 'wizard-lusha-persist-excluded',
    },
    // § P0 — sin denominador estático: el techo de peticiones depende de las
    // ramas del plan de la macro industria (2, 4 o 6), así que «/ 2» era falso en
    // cuanto la corrida tenía más de una rama. Lo que sí es un hecho es cuántas
    // consultó ESTA corrida.
    {
      key: 'pages',
      label: 'Páginas consultadas',
      value: String(result.pagesRequested),
      testId: 'wizard-lusha-persist-pages',
    },
    {
      key: 'credits',
      label: 'Créditos reportados por Lusha',
      value: creditsLabel,
      testId: 'wizard-lusha-persist-credits',
    },
    { key: 'batch', label: 'Lote', value: shortBatch },
  ];

  return (
    <div className="space-y-4 animate-su-fade-in" data-testid="wizard-lusha-persist-confirmation">
      <Alert variant="success" role={undefined}>
        <AlertTitle className="text-sm">Empresas candidatas listas para revisión</AlertTitle>
        <AlertDescription className="text-xs">
          Encontramos {count} {count === 1 ? 'empresa' : 'empresas'} y las dejamos en
          Prospectos para que las revises antes de aprobarlas.
        </AlertDescription>
      </Alert>

      <ChatCardView
        data-testid="wizard-lusha-persist-metrics"
        card={{ kind: 'rows', title: 'Resultado de la búsqueda', rows: metricRows }}
      />

      <div className="space-y-1 rounded-xl bg-surface-subtle px-4 py-3 leading-relaxed">
        {/* § P0 — misma razón que arriba: «hasta 20 empresas (2 × 10)» describía
            el ejecutor de una sola rama. El número de empresas que una corrida
            puede devolver lo fija el plan de su macro industria; lo que sí puede
            afirmarse sin divergir es la base de facturación. */}
        <p className="text-xs text-muted-foreground" data-testid="wizard-lusha-persist-billing-note">
          Las empresas devueltas se facturan según tu plan de Lusha. Los créditos que Lusha
          reportó para esta búsqueda están arriba.
        </p>
        <p className="text-xs text-muted-foreground">Nada fue enviado a HubSpot.</p>
        <p className="text-xs text-muted-foreground">Ninguna empresa fue creada todavía.</p>
      </div>

      <div className="space-y-2 pt-1">
        <Button
          type="button"
          size="sm"
          className="w-full"
          onClick={onViewProspects}
          data-testid="wizard-lusha-view-prospects"
        >
          Ver prospectos
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="mx-auto flex text-muted-foreground"
          onClick={onGenerateAnother}
          data-testid="wizard-lusha-generate-another"
        >
          <RotateCcw aria-hidden />
          Generar otra búsqueda
        </Button>
      </div>
    </div>
  );
}

// ── Empty result ──────────────────────────────────────────────────────────────

function EmptyResult({ onGenerateAnother }: { onGenerateAnother?: () => void }) {
  return (
    <div className="space-y-4 animate-su-fade-in" data-testid="wizard-lusha-empty">
      <Alert variant="warning" role={undefined}>
        <AlertTitle className="text-sm">No encontramos empresas nuevas con estos criterios.</AlertTitle>
        <AlertDescription className="text-xs">Prueba con otra industria, país o criterio adicional.</AlertDescription>
      </Alert>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="mx-auto flex text-muted-foreground"
        onClick={onGenerateAnother}
        data-testid="wizard-lusha-generate-another"
      >
        <RotateCcw aria-hidden />
        Generar otra búsqueda
      </Button>
    </div>
  );
}

// ── Error result ──────────────────────────────────────────────────────────────

function ErrorResult({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-4 animate-su-fade-in" data-testid="wizard-lusha-error">
      <Alert variant="destructive" role={undefined}>
        <AlertTitle className="text-sm">No se pudo completar la búsqueda.</AlertTitle>
        <AlertDescription className="break-words text-xs">{message}</AlertDescription>
      </Alert>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        data-testid="lusha-preview-run"
      >
        <Search className="h-3.5 w-3.5" />
        {WIZARD_LUSHA_SEARCH_LABEL}
      </Button>
    </div>
  );
}
