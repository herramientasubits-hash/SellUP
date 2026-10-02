'use client';

/**
 * wizard-two-round-progress-panel.tsx — presentación del cierre de una corrida
 * Apollo de dos rondas.
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 · § 11.
 *
 * Componentes tontos sobre `wizard-two-round-progress.ts`. Reutilizan la costura
 * de progreso que ya existe (el overlay de generación y el panel de éxito) en vez
 * de introducir una pantalla nueva.
 *
 * Lo que estos componentes NO hacen: afirmar que la ronda 2 corrió. Lo cumplido
 * se afirma después, con el número real de rondas que devolvió el backend.
 */

import {
  summarizeApolloTwoRoundOutcome,
  type ApolloTwoRoundOutcomeInput,
} from './wizard-two-round-progress';

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
      className="space-y-1 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3 leading-relaxed"
      data-testid="wizard-two-round-outcome"
    >
      {outcome.roundsLine && (
        <p className="text-xs text-muted-foreground">{outcome.roundsLine}</p>
      )}
      {outcome.targetLine && (
        <p className="text-xs text-muted-foreground">{outcome.targetLine}</p>
      )}
      {outcome.partialLine && (
        <p className="text-xs font-medium text-foreground">{outcome.partialLine}</p>
      )}
      {outcome.filtersLine && (
        <p className="text-xs text-muted-foreground">{outcome.filtersLine}</p>
      )}
    </div>
  );
}
