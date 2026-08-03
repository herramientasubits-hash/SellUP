'use client';

/**
 * wizard-two-round-progress-panel.tsx — presentación de las etapas y el cierre de
 * una corrida Apollo de dos rondas.
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 · § 11.
 *
 * Componentes tontos sobre `wizard-two-round-progress.ts`. Reutilizan la costura
 * de progreso que ya existe (el overlay de generación y el panel de éxito) en vez
 * de introducir una pantalla nueva.
 *
 * Lo que estos componentes NO hacen: afirmar que la ronda 2 corrió. La ejecución
 * es un solo viaje al servidor, así que en vuelo las etapas se listan como PLAN y
 * la ronda condicional se marca como tal. Lo cumplido se afirma después, con el
 * número real de rondas que devolvió el backend.
 */

import {
  APOLLO_TWO_ROUND_CONDITIONAL_NOTICE,
  APOLLO_TWO_ROUND_PLANNED_STEPS_TITLE,
  buildApolloTwoRoundProgressSteps,
  summarizeApolloTwoRoundOutcome,
  type ApolloTwoRoundOutcomeInput,
} from './wizard-two-round-progress';

// ─── Etapas planificadas (en vuelo) ───────────────────────────────────────────

type PlannedStepsProps = {
  maxRounds: number;
};

export function WizardApolloTwoRoundPlannedSteps({ maxRounds }: PlannedStepsProps) {
  const steps = buildApolloTwoRoundProgressSteps({ maxRounds });

  return (
    <div
      className="relative z-10 w-full max-w-[300px] space-y-1.5"
      data-testid="wizard-two-round-planned-steps"
    >
      <p className="text-xs font-medium text-white/80">
        {APOLLO_TWO_ROUND_PLANNED_STEPS_TITLE}
      </p>
      <ol className="space-y-0.5">
        {steps.map((step) => (
          <li key={step.phase} className="text-xs text-white/60">
            {step.label}
            {step.conditional && <span className="text-white/40"> (si hace falta)</span>}
          </li>
        ))}
      </ol>
      <p className="text-xs text-white/50">{APOLLO_TWO_ROUND_CONDITIONAL_NOTICE}</p>
    </div>
  );
}

// ─── Cierre de la corrida ─────────────────────────────────────────────────────

type OutcomeProps = ApolloTwoRoundOutcomeInput;

export function WizardApolloTwoRoundOutcome(props: OutcomeProps) {
  const outcome = summarizeApolloTwoRoundOutcome(props);

  // Sin ninguna línea no se pinta un contenedor vacío: un bloque con borde y sin
  // contenido se lee como un dato que falta por cargar.
  if (
    outcome.roundsLine === null &&
    outcome.targetLine === null &&
    outcome.partialLine === null
  ) {
    return null;
  }

  return (
    <div
      className="space-y-1 rounded-xl border border-border bg-muted/30 px-4 py-3"
      data-testid="wizard-two-round-outcome"
    >
      {outcome.roundsLine && (
        <p className="text-xs text-muted-foreground">{outcome.roundsLine}</p>
      )}
      {outcome.targetLine && (
        <p className="text-xs text-muted-foreground">{outcome.targetLine}</p>
      )}
      {outcome.partialLine && (
        <p className="text-xs text-foreground">{outcome.partialLine}</p>
      )}
      {outcome.filtersLine && (
        <p className="text-xs text-muted-foreground">{outcome.filtersLine}</p>
      )}
    </div>
  );
}
