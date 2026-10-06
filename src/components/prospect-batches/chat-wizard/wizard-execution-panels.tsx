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

import { useAgentRuns } from '@/modules/prospect-batches/agent-runs/agent-runs-client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from "@/icons";
import { toast } from 'sonner';
import { AiAnalyzingState } from '@/components/ai/ai-analyzing-state';
import { ChatCardView, type ChatCardRow } from '@/components/chat';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { WizardApolloTwoRoundOutcome } from './wizard-two-round-progress-panel';
import {
  RUN_PROGRESS_FALLBACK_LABEL,
  RUN_PROGRESS_PERCENT,
  RUN_PROGRESS_STAGES,
  nextRunProgressPercent,
  type RunProgressStage,
} from '@/modules/prospect-batches/chat-wizard-execution/run-progress';
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
  buildWizardAcceptedForTargetSummary,
  buildWizardTargetSummary,
  type WizardTargetSummaryInput,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-target-summary-copy';
import type { WizardExecutionStatus } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-types';
import type { AcceptedForTargetSummary } from '@/modules/prospect-batches/accepted-for-target';

// ── Wizard generation overlay ─────────────────────────────────────────────────

/** Cada cuánto se pregunta al servidor en qué etapa va la corrida. */
const RUN_PROGRESS_POLL_MS = 1500;

export type WizardGenerationOverlayProps = {
  /**
   * AGENT1-RUN-LIVE-PROGRESS-1 — el id de esta corrida, con el que el servidor
   * anota su etapa. `null` = no se puede seguir: se muestra el texto genérico.
   */
  clientRequestId: string | null;
  /**
   * Cuándo empezó la corrida, para que el contador de segundos sea el real al
   * volver a abrirla desde el Centro de procesos. Ausente = desde que se pinta.
   */
  startedAtMs?: number | null;
};

/**
 * Lee la etapa de la ruta `/api/prospect-batches/run-progress`. Es una ruta y no
 * una server action: el cliente despacha las server actions de una en una, y la
 * consulta se quedaba en cola detrás de la propia corrida hasta que terminaba.
 */
type RunProgressSnapshotView = { label: string; stage: RunProgressStage | null };

async function fetchRunProgress(clientRequestId: string): Promise<RunProgressSnapshotView | null> {
  try {
    const response = await fetch(
      `/api/prospect-batches/run-progress?clientRequestId=${encodeURIComponent(clientRequestId)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { progress?: { label?: unknown; stage?: unknown } | null };
    if (typeof body.progress?.label !== 'string') return null;
    const stage = (RUN_PROGRESS_STAGES as readonly unknown[]).includes(body.progress.stage)
      ? (body.progress.stage as RunProgressStage)
      : null;
    return { label: body.progress.label, stage };
  } catch {
    return null;
  }
}

/**
 * La etapa actual de la corrida, leída del servidor cada poco. Nunca se inventa:
 * hasta que el servidor anota una, se dice «Preparando la búsqueda»; si una
 * lectura falla, se queda la última que sí llegó.
 */
function useRunProgress(clientRequestId: string | null): { label: string; percent: number } {
  const [label, setLabel] = React.useState(RUN_PROGRESS_FALLBACK_LABEL);
  const [percent, setPercent] = React.useState(RUN_PROGRESS_PERCENT.starting);
  React.useEffect(() => {
    if (!clientRequestId) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const snapshot = await fetchRunProgress(clientRequestId);
      if (cancelled) return;
      if (snapshot) {
        setLabel(snapshot.label);
        setPercent((previous) => nextRunProgressPercent(previous, snapshot.stage));
      }
      timer = setTimeout(poll, RUN_PROGRESS_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [clientRequestId]);
  return { label, percent };
}

/**
 * La espera de la generación: el bloque grande de «la IA está trabajando»
 * (`AiAnalyzingState`), ocupando el cuerpo del panel, con lo que el agente hace
 * AHORA como titular — «Revisando el banco de empresas…», «Buscando
 * empresas con Apollo…», «Completando la búsqueda con Lusha»—, tal como el
 * servidor lo anota al empezar cada etapa.
 *
 * La barra avanza por ETAPAS reales (`RUN_PROGRESS_PERCENT`): sube cuando el
 * servidor anota que empezó una etapa nueva, nunca por tiempo, y no retrocede.
 * Si una etapa tarda, la barra espera con ella. Los segundos también son reales.
 */
/** AGENT1-PARALLEL-RUNS-TRAY-1 — la corrida vive en el shell, no en este panel. */
export const WIZARD_RUN_BACKGROUND_NOTE =
  'Puedes minimizar esta ventana o empezar otra búsqueda con «+»: esta sigue en el Centro de procesos, arriba a la derecha.';
export const WIZARD_RUN_QUEUED_TITLE = 'En espera: empieza en cuanto se libere un lugar';

function WizardGenerationOverlay({ clientRequestId, startedAtMs }: WizardGenerationOverlayProps) {
  const progress = useRunProgress(clientRequestId);
  const runs = useAgentRuns();
  const queued = runs.some((run) => run.clientRequestId === clientRequestId && run.status === 'queued');
  const label = queued ? WIZARD_RUN_QUEUED_TITLE : progress.label;
  const percent = queued ? 0 : progress.percent;
  const [startedAt] = React.useState(() => startedAtMs ?? Date.now());
  const [seconds, setSeconds] = React.useState(() => Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
  React.useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="wizard-generation-overlay">
      <AiAnalyzingState
        className="flex-1"
        title={label}
        progress={percent}
        detail="Progreso de la búsqueda"
        caption={
          seconds > 0
            ? `Generando empresas candidatas · ${seconds} s`
            : 'Generando empresas candidatas'
        }
      />
      {/* Dueña 06-10: el aviso quedaba pegado a la línea del loader; con aire arriba y abajo. */}
      <p className="px-6 pb-6 pt-5 text-center text-xs leading-relaxed text-muted-foreground" data-testid="wizard-run-background-note">
        {WIZARD_RUN_BACKGROUND_NOTE}
      </p>
    </div>
  );
}

// ── Submitting panel ──────────────────────────────────────────────────────────

export function SubmittingPanel({ clientRequestId, startedAtMs }: WizardGenerationOverlayProps) {
  return <WizardGenerationOverlay clientRequestId={clientRequestId} startedAtMs={startedAtMs} />;
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
    <ChatCardView
      data-testid="wizard-persistence-breakdown"
      card={{ kind: 'rows', title: 'Qué se guardó', rows }}
    />
  );
}

// ── Success panel ─────────────────────────────────────────────────────────────
// Closes the drawer and refreshes the global candidates list.
// Does NOT navigate to a batch-detail route — that view no longer exists.

export type SuccessPanelProps = {
  status: WizardExecutionStatus | null;
  /**
   * AGENT1-APOLLO-CONTINUATION-WIZARD-WIRING § 4 — la corrida quedó EN PAUSA
   * con trabajo encolado.
   *
   * 🔴 Cambia dos comportamientos y ninguno es cosmético:
   *
   *   1. el panel NO se cierra solo. Cerrarse es la forma en que esta pantalla
   *      dice «ya está»; con trabajo pendiente eso sería falso;
   *   2. el panel NO afirma que no hubo empresas nuevas. Una corrida en pausa
   *      tiene organizaciones pagadas SIN MIRAR: anunciarla como un vacío
   *      invita a repetir —y volver a pagar— una búsqueda que no hacía falta.
   *
   * Tampoco pinta cifras de aceptación: en pausa el writer todavía no ha
   * contado nada, así que no hay resumen que enseñar sin adelantarse.
   *
   * El estado vivo lo pinta `WizardApolloContinuationPanel`, montado en la raíz
   * del mago, que sobrevive a los cambios de paso y al cierre de este panel.
   */
  continuationPending?: boolean;
  noveltyExhausted?: boolean;
  /**
   * AGENT1-LOCAL-CUT8 § 3 — FILAS DURABLES que la corrida dejó en el lote.
   *
   * 🔴 Nunca el objetivo. La prop `targetPersistibleCandidates` que vivía aquí
   * se ha retirado: el llamador la alimentaba con el MISMO campo que
   * `candidateCount`, así que el panel anunciaba el objetivo como si fueran los
   * candidatos encontrados. El objetivo pedido llega ahora dentro de
   * `acceptedForTarget`, que es su autoridad, y se pinta en el resumen.
   */
  candidateCount?: number;
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
  /**
   * AGENT1-LOCAL-CUT8 §§ 1, 4 — el resumen CANÓNICO de aceptación hacia el
   * objetivo, tal como el servidor lo resolvió. `null` cuando esta ejecución no
   * declaró aceptación (p. ej. `already_started`): entonces no se pinta, en vez
   * de rellenarse con ceros.
   */
  acceptedForTarget?: AcceptedForTargetSummary | null;
};

export function SuccessPanel({ status, continuationPending = false, noveltyExhausted, candidateCount, onClose, onEditSearch, twoRoundOutcome, targetEligibleCompanies, noNewCandidatesBreakdown, persistenceOutcome, targetSummary, acceptedForTarget }: SuccessPanelProps) {
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

  // CUT-8 — el resumen canónico se FORMATEA aquí y se decide su aritmética en
  // ninguna parte: `buildWizardAcceptedForTargetSummary` sólo elige cómo se
  // escribe cada cifra ya resuelta por el servidor.
  const acceptedForTargetRows =
    acceptedForTarget != null
      ? buildWizardAcceptedForTargetSummary(acceptedForTarget).rows
      : null;

  React.useEffect(() => {
    // § 4 — EN PAUSA: se refresca el listado (lo que la corrida ya guardó es
    // real) y se para aquí. Ni toast de éxito, ni toast de vacío, ni cierre
    // automático: la corrida no ha terminado.
    if (continuationPending) {
      router.refresh();
      return;
    }
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
        // 🔴 CUT-8 § 3 — las filas que la persona va a encontrar en el listado,
        // no el objetivo que pidió. Con el objetivo aquí, una corrida que pidió
        // 10 y guardó 4 anunciaba «Encontramos 10».
        description: candidateCount
          ? `Encontramos ${candidateCount} prospectos nuevos para revisar.`
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
        {/* El panel entero ya es el `alert`; el aviso de dentro no repite rol. */}
        <Alert variant="destructive" role={undefined}>
          <AlertTitle className="text-sm">{resultCopy.heading}</AlertTitle>
          <AlertDescription className="break-words text-xs">{resultCopy.body}</AlertDescription>
        </Alert>
        <WizardPersistenceBreakdown rows={persistenceBreakdownRows} />
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    );
  }

  // § 4 — con trabajo pendiente NO se pinta el bloque de «no encontramos
  // empresas nuevas». Todavía hay organizaciones pagadas sin evaluar, así que
  // la pregunta «¿hubo empresas nuevas?» aún no tiene respuesta. Quien cuenta
  // cómo va es el panel de continuación de la cabecera del mago; aquí sólo
  // queda la salida.
  if (continuationPending) {
    return (
      <div className="space-y-3 animate-su-fade-in" data-testid="wizard-success-paused">
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
    const breakdownRows: ChatCardRow[] =
      noNewCandidatesBreakdown === null || noNewCandidatesBreakdown === undefined
        ? []
        : toNoNewCandidatesBreakdownRows(
            buildNoNewCandidatesCompactBreakdown(noNewCandidatesBreakdown, {
              candidatesCreatedCount: candidateCount ?? 0,
            }),
          ).map((row) => ({ key: row.key, label: row.label, value: String(row.count), hint: row.hint }));

    return (
      <div className="space-y-4 animate-su-fade-in" role="status">
        {/* El panel entero ya es el `status`; el aviso de dentro no repite rol. */}
        <Alert variant="warning" role={undefined}>
          <AlertTitle className="text-sm">
            {resultCopy.heading ?? 'No encontramos empresas nuevas con estos criterios.'}
          </AlertTitle>
          <AlertDescription className="break-words text-xs">{noNewBody}</AlertDescription>
        </Alert>

        {breakdownRows.length > 0 && (
          <ChatCardView
            data-testid="wizard-no-new-candidates-breakdown"
            rowTestIdPrefix="wizard-no-new-candidates"
            valueTestIdSuffix="count"
            card={{ kind: 'rows', title: 'Qué pasó con lo encontrado', rows: breakdownRows }}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onEditSearch}>
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
      : status === 'success_target_reached' && candidateCount
      ? `Encontramos ${candidateCount} prospectos nuevos para revisar.`
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
        <Alert variant="success" role="status">
          <AlertTitle className="text-sm">{heading}</AlertTitle>
          <AlertDescription className="text-xs">{body}</AlertDescription>
        </Alert>
      )}

      {/* PERSISTENCE-READINESS-4 § 8 — persistencia PARCIAL. Hay candidatos que
          revisar, y además se perdió parte de lo encontrado. Decirlo aquí evita
          que el usuario concluya que el listado está completo y repita la
          búsqueda para «recuperar» el resto. */}
      {isPersistenceFailure && (
        <Alert variant="warning">
          <AlertTitle className="text-sm">{resultCopy.heading}</AlertTitle>
          <AlertDescription className="break-words text-xs">{resultCopy.body}</AlertDescription>
        </Alert>
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
      {/* 🔴 AGENT1-LOCAL-CUT8 §§ 1, 4 — cuando el servidor envió la aceptación
          canónica, ES la que se pinta, y por el MISMO camino de copy y el mismo
          marcado que ya existía. Nada de una segunda tarjeta con su propio
          formato: dos superficies describiendo la misma corrida es como empiezan
          a contradecirse.

          `targetSummary` sigue siendo el respaldo para una corrida que no la
          declaró; sin ninguna de las dos, no se pinta resumen. */}
      {acceptedForTargetRows !== null && (
        <ChatCardView
          data-testid="wizard-target-summary"
          card={{ kind: 'rows', title: 'Resultado de la búsqueda', rows: acceptedForTargetRows }}
        />
      )}

      {acceptedForTargetRows === null && targetSummary && (
        <ChatCardView
          data-testid="wizard-target-summary"
          card={{
            kind: 'rows',
            title: 'Resultado de la búsqueda',
            rows: buildWizardTargetSummary(targetSummary).rows,
          }}
        />
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
