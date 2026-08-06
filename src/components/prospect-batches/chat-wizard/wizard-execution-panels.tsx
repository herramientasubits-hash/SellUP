'use client';

/**
 * wizard-execution-panels.tsx — paneles del wizard DURANTE y DESPUÉS de la
 * ejecución: overlay de generación, panel de envío y panel de éxito.
 *
 * Extraídos de `wizard-conversation-summary.tsx` (A1-APOLLO-QA-CONTROL-SURFACE-1):
 * al añadir las etapas y el cierre de la modalidad de dos rondas (§ 11) ese
 * archivo pasaba el techo de tamaño del repo. Estos tres paneles son la fase
 * post-configuración del wizard y no comparten estado con los de configuración.
 *
 * Sin cambios de comportamiento respecto de la versión anterior: mismos textos,
 * mismos toasts, mismo `router.refresh()`, mismo cierre automático.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Pencil, AlertCircle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  WizardApolloTwoRoundPlannedSteps,
  WizardApolloTwoRoundOutcome,
} from './wizard-two-round-progress-panel';
import {
  buildNoNewCandidatesCompactBreakdown,
  toNoNewCandidatesBreakdownRows,
  type NoNewCandidatesBreakdown,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-no-new-candidates-copy';
// A1-APOLLO-PERSISTENCE-READINESS-4 § 8 — la prioridad de causas vive en un solo
// núcleo puro: fallo de almacenamiento por encima de historial y calidad.
import {
  buildWizardPersistenceBreakdown,
  resolveWizardResultCopy,
  type WizardPersistenceBreakdownRow,
  type WizardPersistenceOutcome,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-result-copy';
import {
  buildWizardTargetSummary,
  type WizardTargetSummaryInput,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-target-summary-copy';
import type { WizardExecutionStatus } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-types';

// ── Wizard generation overlay ─────────────────────────────────────────────────

export type WizardGenerationOverlayProps = {
  /** § 11 — listar las etapas de la modalidad de dos rondas. */
  showApolloTwoRoundStages: boolean;
  maxRounds: number | null;
};

function WizardGenerationOverlay({
  showApolloTwoRoundStages,
  maxRounds,
}: WizardGenerationOverlayProps) {
  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 p-8 overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label="Generando empresas candidatas"
      style={{
        background:
          'linear-gradient(135deg, var(--su-ai-stop-1), var(--su-ai-stop-2), var(--su-ai-stop-3), var(--su-ai-stop-4), var(--su-ai-stop-5))',
      }}
    >
      {/* Mirror shine sweep */}
      <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-[-12deg] bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.06)_20%,rgba(255,255,255,0.35)_50%,rgba(255,255,255,0.06)_80%,transparent_100%)] animate-su-mirror-shine" />

      {/* Sparkle icon */}
      <div className="animate-su-float relative z-10">
        <Sparkles className="h-12 w-12 text-white/80" strokeWidth={1.5} />
      </div>

      {/* Main label */}
      <div className="relative z-10 text-center space-y-1">
        <p className="text-lg font-bold text-white">Generando empresas candidatas</p>
        <p className="text-sm text-white/70">Procesando búsqueda con IA</p>
      </div>

      {/* Body text */}
      <p className="relative z-10 text-xs text-white/60 text-center max-w-[280px]">
        Filtrando resultados y preparando candidatos para revisión
      </p>

      {/* § 11 — etapas de la modalidad de dos rondas, presentadas como PLAN. La
          ejecución es un único viaje al servidor, así que el cliente no sabe en
          qué ronda está: marcar la ronda 2 como cumplida sería afirmar un gasto
          de Apollo que puede no haber ocurrido. */}
      {showApolloTwoRoundStages && maxRounds !== null && (
        <WizardApolloTwoRoundPlannedSteps maxRounds={maxRounds} />
      )}

      {/* Indeterminate progress bar */}
      <div className="relative z-10 w-full max-w-[280px]">
        <div className="h-2 w-full rounded-full bg-white/20 overflow-hidden">
          <div className="h-full w-2/3 rounded-full bg-white/80 animate-su-pulse" />
        </div>
      </div>
    </div>
  );
}

// ── Submitting panel ──────────────────────────────────────────────────────────

export function SubmittingPanel({
  showApolloTwoRoundStages,
  maxRounds,
}: WizardGenerationOverlayProps) {
  return (
    <WizardGenerationOverlay
      showApolloTwoRoundStages={showApolloTwoRoundStages}
      maxRounds={maxRounds}
    />
  );
}

// ── Desglose administrativo de la escritura ───────────────────────────────────

/**
 * AGENT1-APOLLO-CANDIDATE-INSERT-FORENSICS-1 § 7 — las cinco cifras de la
 * escritura, para cerrar una corrida parcial sin abrir la base de datos.
 *
 * Vive junto al aviso de persistencia y no dentro de él: el aviso dice QUÉ pasó,
 * estas filas dicen CUÁNTAS empresas hubo detrás de cada cosa. «Guardados» y
 * «candidatos completos» son columnas distintas a propósito — en la corrida
 * `9a9acf99` valían 3 y 0.
 */
function WizardPersistenceBreakdown({ rows }: { rows: WizardPersistenceBreakdownRow[] }) {
  if (rows.length === 0) return null;
  return (
    <dl
      className="space-y-2 rounded-xl border border-border bg-card px-5 py-4"
      data-testid="wizard-persistence-breakdown"
    >
      {rows.map((row) => (
        <div
          key={row.key}
          className="space-y-0.5"
          data-testid={`wizard-persistence-breakdown-row-${row.key}`}
        >
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd
              className="text-xs font-semibold tabular-nums text-foreground"
              data-testid={`wizard-persistence-breakdown-value-${row.key}`}
            >
              {row.value}
            </dd>
          </div>
          {row.hint !== null && (
            <p className="text-[10px] leading-snug text-muted-foreground">{row.hint}</p>
          )}
        </div>
      ))}
    </dl>
  );
}

// ── Success panel ─────────────────────────────────────────────────────────────
// Closes the drawer and refreshes the global candidates list.
// Does NOT navigate to a batch-detail route — that view no longer exists.

export type SuccessPanelProps = {
  status: WizardExecutionStatus | null;
  noveltyExhausted?: boolean;
  candidateCount?: number;
  targetPersistibleCandidates?: number;
  onClose: () => void;
  onEditSearch: () => void;
  /** § 11 — cifras reales de dos rondas. `null` = la modalidad no corrió. */
  twoRoundOutcome: { roundsExecuted: number | null; eligibleCompaniesFound: number | null } | null;
  /** Objetivo efectivo de la corrida, para poder afirmar si se alcanzó. */
  targetEligibleCompanies: number | null;
  /**
   * QUERY-QUALITY-2 § 8 — distribución REAL de descartes. `null` cuando el
   * servidor no la envió: entonces el copy no afirma ninguna causa concreta.
   */
  noNewCandidatesBreakdown?: NoNewCandidatesBreakdown | null;
  /**
   * A1-APOLLO-PERSISTENCE-READINESS-4 § 8 — cifras reales de la persistencia.
   * `null` cuando el servidor no las envió.
   */
  persistenceOutcome?: WizardPersistenceOutcome | null;
  /**
   * AGENT1-APOLLO-LINKEDIN-QUALITY-INTEGRATION-1 § H — cifras canónicas de la
   * corrida. `null`/ausente cuando el servidor no las envió: entonces el resumen
   * no se pinta en vez de rellenarse con ceros.
   */
  targetSummary?: WizardTargetSummaryInput | null;
};

export function SuccessPanel({ status, noveltyExhausted, candidateCount, targetPersistibleCandidates, onClose, onEditSearch, twoRoundOutcome, targetEligibleCompanies, noNewCandidatesBreakdown, persistenceOutcome, targetSummary }: SuccessPanelProps) {
  const router = useRouter();

  // QUERY-QUALITY-2 § 8 + PERSISTENCE-READINESS-4 § 8 — el texto sale de lo que
  // REALMENTE pasó, y la causa de mayor prioridad gana: un fallo de
  // almacenamiento se anuncia como tal y NUNCA como historial, aunque la
  // distribución de descartes tenga resultados «ya sugeridos» (es exactamente el
  // caso de LIVE-QA-2: 8 descartes de historial y una empresa perdida al
  // guardarla).
  const resultCopy = resolveWizardResultCopy({
    persistence: persistenceOutcome ?? null,
    noNewCandidates:
      noNewCandidatesBreakdown ?? {
        hubspotDuplicateCount: 0,
        sellupDuplicateCount: 0,
        cooldownCount: 0,
        repeatedAcrossRoundsCount: 0,
        qualityRejectedCount: 0,
        countryRejectedCount: 0,
        sectorRejectedCount: 0,
        ownershipRejectedCount: 0,
        noveltyExhausted: noveltyExhausted === true,
        secondRoundSkippedReason: null,
      },
  });
  const isPersistenceFailure = resultCopy.source === 'persistence_failure';
  // FORENSICS-1 § 7 — éxito PARCIAL: ni el bloque verde de «todo listo» ni el
  // rojo de «no pudimos guardar nada». La corrida `9a9acf99` guardó 3 de 4 y
  // ambas presentaciones habrían mentido.
  const isPartialPersistence = resultCopy.cause === 'persistence_partial';
  const persistenceBreakdownRows = buildWizardPersistenceBreakdown(persistenceOutcome ?? null);

  React.useEffect(() => {
    if (status === 'completed_with_errors') {
      // No se cierra solo: el usuario tiene que leer que NO repita la búsqueda.
      //
      // A1-APOLLO-PERSISTENCE-READINESS-4-FIX — y NO se emite `toast.error`. El
      // panel inline de más abajo ya muestra el mismo titular y el mismo cuerpo,
      // así que el toast sólo duplicaba el mensaje; la invariante 20.R del wizard
      // exige precisamente que los errores vivan en la UI inline y no en toasts,
      // para no apilarlos en los fallos reintentables.
      router.refresh();
      return;
    }
    if (isPartialPersistence) {
      // FORENSICS-1 § 7 — NO se cierra solo y NO se emite un toast de éxito.
      // Cerrar el drawer con un «Prospectos generados correctamente» era lo que
      // dejaba al usuario sin enterarse de que una empresa se había perdido, y
      // le pedía implícitamente que repitiera —y volviera a pagar— la búsqueda.
      router.refresh();
      return;
    }
    if (status === 'no_new_candidates') {
      // Do NOT auto-close — show the panel so the user can act.
      toast.info('No se encontraron empresas nuevas.', {
        description: resultCopy.body,
      });
      router.refresh();
      return;
    }
    if (status === 'already_started') {
      toast.info('Esta búsqueda ya había sido iniciada.', {
        description: 'Actualizamos el listado para mostrar los resultados disponibles.',
      });
    } else if (status === 'success_target_reached') {
      toast.success('¡Objetivo alcanzado!', {
        description: targetPersistibleCandidates
          ? `Encontramos ${targetPersistibleCandidates} prospectos nuevos para revisar.`
          : 'Prospectos generados correctamente.',
      });
    } else {
      toast.success('Prospectos generados correctamente.', {
        description: 'Ya puedes revisarlos en el listado de prospectos.',
      });
    }
    router.refresh();
    onClose();
  // onClose and router.refresh are stable references; status is captured once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // § 8 — fallo de almacenamiento: el gasto ya ocurrió, así que la única acción
  // ofrecida es cerrar. NO se ofrece «Editar búsqueda»: reeditar y relanzar es
  // justo lo que el copy pide no hacer, y ponerlo a un clic contradice el texto.
  if (status === 'completed_with_errors') {
    return (
      <div className="space-y-4 animate-su-fade-in" role="alert">
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-5 py-4">
          <AlertCircle
            className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-destructive">
              {resultCopy.heading}
            </p>
            <p className="text-xs text-destructive/80">{resultCopy.body}</p>
          </div>
        </div>
        <WizardPersistenceBreakdown rows={persistenceBreakdownRows} />
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    );
  }

  if (status === 'no_new_candidates') {
    const noNewBody = resultCopy.body;

    // SCALE-SECOND-ROUND-FIX-1B § 3 — el desglose REAL debajo del texto de causa.
    // Sustituye al mensaje genérico como única explicación: el copy dice QUÉ pasó y
    // estas cifras dicen CUÁNTAS empresas hubo detrás. Las repeticiones entre rondas
    // se muestran como tales y nunca se suman a las empresas únicas.
    const breakdownRows =
      noNewCandidatesBreakdown === null || noNewCandidatesBreakdown === undefined
        ? []
        : toNoNewCandidatesBreakdownRows(
            buildNoNewCandidatesCompactBreakdown(noNewCandidatesBreakdown, {
              candidatesCreatedCount: candidateCount ?? 0,
            }),
          );

    return (
      <div className="space-y-4 animate-su-fade-in" role="status">
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800/40 dark:bg-amber-900/10">
          <AlertCircle
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          <div className="space-y-2">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              {resultCopy.heading ?? 'No encontramos empresas nuevas con estos criterios.'}
            </p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/70">
              {noNewBody}
            </p>

            {breakdownRows.length > 0 && (
              <dl
                className="mt-1 space-y-1 border-t border-amber-200 pt-2 dark:border-amber-800/40"
                data-testid="wizard-no-new-candidates-breakdown"
              >
                {breakdownRows.map((row) => (
                  <div key={row.key} className="space-y-0.5" data-testid={`wizard-no-new-candidates-row-${row.key}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-xs text-muted-foreground">{row.label}</dt>
                      <dd
                        className="text-xs font-semibold tabular-nums text-foreground"
                        data-testid={`wizard-no-new-candidates-count-${row.key}`}
                      >
                        {row.count}
                      </dd>
                    </div>
                    {row.hint !== null && (
                      <p className="text-[10px] leading-snug text-muted-foreground">{row.hint}</p>
                    )}
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onEditSearch} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Editar búsqueda
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    );
  }

  const heading =
    status === 'already_started'
      ? 'Búsqueda ya iniciada'
      : status === 'success_target_reached'
      ? '¡Objetivo alcanzado!'
      : 'Candidatos generados';

  const body =
    status === 'already_started'
      ? 'Esta búsqueda ya había sido iniciada. Actualizamos la lista para mostrar sus resultados.'
      : status === 'success_target_reached' && targetPersistibleCandidates
      ? `Encontramos ${targetPersistibleCandidates} prospectos nuevos para revisar.`
      : candidateCount
      ? `Se generaron ${candidateCount} candidatos disponibles para revisión.`
      : 'Los candidatos fueron generados y ya están disponibles para revisión.';

  return (
    <div className="space-y-3 animate-su-fade-in">
      {/* FORENSICS-1 § 7 — con persistencia parcial NO se pinta el bloque verde.
          Un titular de éxito con una marca de verificación es exactamente lo que
          hizo que la corrida `9a9acf99` se leyera como completa mientras perdía
          al único candidato que contaba hacia el objetivo. El aviso ámbar de más
          abajo pasa a ser el titular de la corrida. */}
      {!isPartialPersistence && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 dark:border-emerald-800/40 dark:bg-emerald-900/10">
          <CheckCircle2
            className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              {heading}
            </p>
            <p className="text-xs text-emerald-600/80 dark:text-emerald-400/70">
              {body}
            </p>
          </div>
        </div>
      )}

      {/* PERSISTENCE-READINESS-4 § 8 — persistencia PARCIAL. Hay candidatos que
          revisar, y además se perdió parte de lo encontrado. Decirlo aquí evita
          que el usuario concluya que el listado está completo y repita la
          búsqueda para «recuperar» el resto. */}
      {isPersistenceFailure && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800/40 dark:bg-amber-900/10" role="alert">
          <AlertCircle
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              {resultCopy.heading}
            </p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/70">
              {resultCopy.body}
            </p>
          </div>
        </div>
      )}

      {/* § 7 — el desglose administrativo acompaña SIEMPRE al aviso de
          persistencia: sin él «se perdió uno» no dice si era completo, si era un
          duplicado tardío o si fue una avería de escritura. */}
      {isPersistenceFailure && (
        <WizardPersistenceBreakdown rows={persistenceBreakdownRows} />
      )}

      {/* INTEGRATION-1 § H — las cuatro cifras separadas. Guardadas, completas y
          válidas, pendientes de revisión, y si el objetivo se alcanzó. Un solo
          número no puede responder «cuántas guardamos» y «cuántas sirven». */}
      {targetSummary && (
        <dl
          className="space-y-2 rounded-xl border border-border bg-card px-5 py-4"
          data-testid="wizard-target-summary"
        >
          {buildWizardTargetSummary(targetSummary).rows.map((row) => (
            <div key={row.key} className="space-y-0.5" data-testid={`wizard-target-summary-row-${row.key}`}>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-muted-foreground">{row.label}</dt>
                <dd
                  className="text-xs font-semibold tabular-nums text-foreground"
                  data-testid={`wizard-target-summary-value-${row.key}`}
                >
                  {row.value}
                </dd>
              </div>
              {row.hint !== null && (
                <p className="text-[10px] leading-snug text-muted-foreground">{row.hint}</p>
              )}
            </div>
          ))}
        </dl>
      )}

      {/* § 11 — cierre honesto de la modalidad de dos rondas: rondas REALMENTE
          ejecutadas y si el objetivo se alcanzó. Cuando no se alcanzó, se dice
          cuántas empresas se encontraron y que los filtros no se relajaron. */}
      {twoRoundOutcome && targetEligibleCompanies !== null && (
        <WizardApolloTwoRoundOutcome
          roundsExecuted={twoRoundOutcome.roundsExecuted}
          eligibleCompaniesFound={twoRoundOutcome.eligibleCompaniesFound}
          targetEligibleCompanies={targetEligibleCompanies}
        />
      )}

      {/* FORENSICS-1 § 7 — con persistencia parcial el panel ya no se cierra
          solo, así que necesita su propia salida. Sólo «Cerrar»: el copy pide
          explícitamente no relanzar la búsqueda, y poner «Editar búsqueda» a un
          clic contradiría el texto igual que en el fallo total. */}
      {isPartialPersistence && (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      )}
    </div>
  );
}
