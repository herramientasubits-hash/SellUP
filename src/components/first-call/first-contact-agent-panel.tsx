'use client';

import * as React from 'react';
import { ChatPanel, ChatQuestionPanel } from '@/components/chat';
import { AgentChatTimeline } from '@/components/agent-chat/agent-chat-timeline';
import type { AgentChatMessage } from '@/components/agent-chat/agent-chat-types';
import { AiAnalyzingState } from '@/components/ai/ai-analyzing-state';
import { Stepper } from '@/components/navigation/stepper';
import { getFirstCallProgress } from '@/modules/speech/actions';
import type { FirstCallContactOption } from '@/modules/speech/first-call-contacts';
import {
  BEST_PRODUCT,
  DEFAULT_SELECTION,
  FIRST_CONTACT_STEPS,
  NO_DECISION_MAKER,
  buildFirstContactRequestBody,
  channelOptions,
  contactIdsFrom,
  decisionMakerOptions,
  goalOptions,
  normalizeDecisionMakerSelection,
  normalizeProductSelection,
  preparationsCount,
  productKeysFrom,
  productOptions,
  summaryText,
  type FirstContactSelection,
} from '@/modules/speech/first-contact-wizard';
import {
  FIRST_CALL_CHANNELS,
  FIRST_CALL_CHANNEL_LABELS,
  MAX_CONTACTS_PER_RUN,
  goalsLabel,
  orderGoals,
  RESEARCH_PROGRESS_LABELS,
  type FirstCallChannel,
  type FirstCallGoal,
  type ResearchProgressStage,
} from '@/server/agents/first-call/types';
import { UBITS_PRODUCTS, ubitsProductName } from '@/server/agents/first-call/ubits-messaging-library';

/** Cada cuánto se mira el avance mientras trabaja. */
const PROGRESS_POLL_MS = 2_500;

const STAGE_PERCENT: Readonly<Record<ResearchProgressStage, number>> = {
  reading_sellup: 10,
  reading_site: 25,
  reading_news: 40,
  extracting: 60,
  writing: 80,
  done: 100,
};

type Phase = 'asking' | 'running' | 'done' | 'error';

type RunResponse =
  | { ok: true; packIds: string[]; packStatuses: string[]; reusedBrief: boolean }
  | { ok: false; code: string; message: string };

export interface FirstContactRegenerateSeed {
  packId: string;
  contactId: string | null;
  channel: FirstCallChannel;
  goal: FirstCallGoal;
  goals?: FirstCallGoal[];
  productFocus: string | null;
}

export interface FirstContactAgentPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  accountName: string;
  contacts: readonly FirstCallContactOption[];
  /** ¿Hay una investigación vigente? Entonces se reusa (y se ofrece investigar de nuevo). */
  hasFreshBrief: boolean;
  /** Lo que llega marcado (desde un contacto, «lo que falta» u otra versión). */
  initialSelection?: Partial<FirstContactSelection>;
  /** Otra versión de una preparación: el motivo es opcional. */
  regenerate?: FirstContactRegenerateSeed;
  /** Al terminar con éxito (para recargar datos). */
  onDone?: () => void;
  /** «Ver el primer contacto»: a dónde lleva el botón final. */
  onViewResult?: () => void;
}

function seedSelection(props: Pick<FirstContactAgentPanelProps, 'initialSelection' | 'regenerate' | 'contacts'>): FirstContactSelection {
  if (props.regenerate) {
    return {
      contactIds: props.regenerate.contactId ? [props.regenerate.contactId] : [],
      channels: [props.regenerate.channel],
      goals: props.regenerate.goals ?? [props.regenerate.goal],
      productKeys: (props.regenerate.productFocus ?? '').split(',').filter((k) => UBITS_PRODUCTS.some((p) => p.key === k)),
    };
  }
  const known = new Set(props.contacts.map((c) => c.id));
  const contactIds = (props.initialSelection?.contactIds ?? []).filter((id) => known.has(id));
  return {
    ...DEFAULT_SELECTION,
    ...props.initialSelection,
    contactIds: contactIds.length > 0 ? contactIds : props.contacts[0] ? [props.contacts[0].id] : [],
  };
}

function answerText(step: number, selection: FirstContactSelection, contacts: readonly FirstCallContactOption[]): string {
  switch (FIRST_CONTACT_STEPS[step]?.id) {
    case 'decisores':
      return selection.contactIds.length === 0
        ? 'Sin decisor'
        : selection.contactIds.map((id) => contacts.find((c) => c.id === id)?.name ?? 'Contacto').join(', ');
    case 'canales':
      return selection.channels.map((c) => FIRST_CALL_CHANNEL_LABELS[c]).join(', ');
    case 'objetivo':
      return goalsLabel(selection.goals);
    case 'productos':
      return selection.productKeys.length === 0
        ? 'El que mejor conecte'
        : selection.productKeys.map((k) => ubitsProductName(k) ?? k).join(', ');
    default:
      return '';
  }
}

const QUESTIONS: Readonly<Record<string, string>> = {
  decisores: '¿A quién vas a contactar?',
  canales: '¿Por qué canales?',
  objetivo: '¿Qué buscas con este primer contacto?',
  productos: '¿Qué productos de UBITS quieres poner sobre la mesa?',
  resumen: '¿Empiezo?',
};

/**
 * El Agente 3 en el panel «Agente IA» (el mismo de los Agentes 1 y 2A): pasos
 * arriba, la conversación en el medio y la pregunta acoplada abajo. Se pueden
 * elegir varios decisores, canales y productos: investiga una vez y prepara una
 * versión por decisor y canal.
 */
export function FirstContactAgentPanel(props: FirstContactAgentPanelProps) {
  const { open, onOpenChange, accountId, accountName, contacts, hasFreshBrief, regenerate, onDone, onViewResult } = props;
  const [step, setStep] = React.useState(0);
  const [selection, setSelection] = React.useState<FirstContactSelection>(() => seedSelection(props));
  const [markedProducts, setMarkedProducts] = React.useState<string[]>(() => {
    const seeded = seedSelection(props).productKeys;
    return seeded.length > 0 ? seeded : [BEST_PRODUCT];
  });
  const [markedContacts, setMarkedContacts] = React.useState<string[]>(() => {
    const seeded = seedSelection(props).contactIds;
    return seeded.length > 0 ? seeded : [NO_DECISION_MAKER];
  });
  const [phase, setPhase] = React.useState<Phase>('asking');
  const [stage, setStage] = React.useState<ResearchProgressStage | null>(null);
  const [willResearch, setWillResearch] = React.useState(!hasFreshBrief);
  const [result, setResult] = React.useState<{ total: number; toReview: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const reset = React.useCallback(() => {
    const seeded = seedSelection(props);
    setStep(0);
    setSelection(seeded);
    setMarkedContacts(seeded.contactIds.length > 0 ? seeded.contactIds : [NO_DECISION_MAKER]);
    setMarkedProducts(seeded.productKeys.length > 0 ? seeded.productKeys : [BEST_PRODUCT]);
    setPhase('asking');
    setStage(null);
    setResult(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se reinicia con lo que llegó al abrir
  }, [props.initialSelection, props.regenerate, props.contacts]);

  // Cada vez que se abre, empieza con lo que llega marcado (ajuste de estado al cambiar
  // `open`, durante el render: el patrón de React para esto, sin efecto).
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && phase !== 'running') reset();
  }

  React.useEffect(() => {
    if (phase !== 'running') return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const current = await getFirstCallProgress(accountId);
        if (!cancelled && current) setStage(current);
      } catch {
        // El avance es cosmético: si una lectura falla, la siguiente lo intenta.
      }
    }, PROGRESS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [phase, accountId]);

  // Lo último que se pidió: «Reintentar» lo repite igual (investigar de nuevo, motivo).
  const [lastRun, setLastRun] = React.useState<{ refresh: boolean; reason: string | null }>({ refresh: false, reason: null });

  const run = async (refresh: boolean, reason: string | null) => {
    setLastRun({ refresh, reason });
    const research = !hasFreshBrief || refresh;
    setWillResearch(research);
    setPhase('running');
    setError(null);
    setStage(research ? 'reading_sellup' : 'writing');
    try {
      const response = await fetch('/api/agent3/first-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildFirstContactRequestBody({
            accountId,
            selection,
            refreshResearch: refresh,
            regenerateFromPackId: regenerate?.packId ?? null,
            regenerationReason: reason,
          }),
        ),
      });
      // Sin sesión, el proxy redirige a /login y la respuesta es la página, no JSON.
      if (response.redirected && new URL(response.url).pathname.startsWith('/login')) {
        setError('Tu sesión se cerró. Vuelve a iniciar sesión e inténtalo de nuevo.');
        setPhase('error');
        return;
      }
      const body = (await response.json().catch(() => null)) as RunResponse | null;
      if (!body || !body.ok) {
        setError(body && !body.ok ? body.message : 'Algo falló al preparar el primer contacto. Vuelve a intentarlo.');
        setPhase('error');
        return;
      }
      setResult({ total: body.packIds.length, toReview: body.packStatuses.filter((s) => s === 'needs_review').length });
      setPhase('done');
      onDone?.();
    } catch {
      setError('No pudimos conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.');
      setPhase('error');
    } finally {
      setStage(null);
    }
  };

  const advance = (patch: Partial<FirstContactSelection>) => {
    setSelection((prev) => ({ ...prev, ...patch }));
    setStep((s) => Math.min(s + 1, FIRST_CONTACT_STEPS.length - 1));
  };

  /** «Volver»: la pregunta anterior, con lo ya elegido marcado. */
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const stepId = FIRST_CONTACT_STEPS[step].id;
  const total = preparationsCount(selection);

  const messages: AgentChatMessage[] = [
    {
      id: 'intro',
      role: 'assistant',
      content: regenerate
        ? `Preparo otra versión para ${accountName}. Puedes cambiar a quién, por dónde o el enfoque, y decirme qué quieres distinto.`
        : `Preparo el primer contacto con ${accountName}: investigo la empresa y escribo qué decir a cada decisor, en cada canal que elijas.`,
    },
  ];
  for (let i = 0; i < step; i += 1) {
    const id = FIRST_CONTACT_STEPS[i].id;
    messages.push({ id: `q-${id}`, role: 'assistant', content: QUESTIONS[id] });
    messages.push({
      id: `a-${id}`,
      role: 'user',
      content: answerText(i, selection, contacts),
      // Corregir una respuesta sin esperar al final: vuelve a esa pregunta con lo elegido marcado.
      onEditRequest: phase === 'asking' ? () => setStep(i) : undefined,
    });
  }
  if (stepId === 'resumen') {
    messages.push({ id: 'summary', role: 'assistant', content: summaryText(selection, contacts, !hasFreshBrief) });
  }
  if (phase === 'done' && result) {
    messages.push({
      id: 'done',
      role: 'assistant',
      content:
        result.toReview > 0
          ? `Listo: ${result.total === 1 ? 'una preparación' : `${result.total} preparaciones`}, ${result.toReview} con avisos para revisar antes de usarlas.`
          : `Listo: ${result.total === 1 ? 'una preparación lista' : `${result.total} preparaciones listas`} para usar.`,
    });
  }
  if (phase === 'error' && error) messages.push({ id: 'error', role: 'system', tone: 'error', content: error });

  const question = (() => {
    if (phase === 'running') return null;
    if (phase === 'done') {
      return (
        <ChatQuestionPanel
          title="¿Qué hacemos ahora?"
          options={[
            ...(onViewResult ? [{ value: 'view', label: 'Ver el primer contacto', description: 'La investigación y las preparaciones de la empresa.' }] : []),
            { value: 'again', label: 'Preparar otra', description: 'Otro decisor, otro canal u otro enfoque.' },
          ]}
          onAnswer={(value) => {
            if (value === 'view') {
              onOpenChange(false);
              onViewResult?.();
            } else reset();
          }}
        />
      );
    }
    if (phase === 'error') {
      return (
        <ChatQuestionPanel
          title="¿Lo intento de nuevo?"
          options={[
            { value: 'retry', label: 'Reintentar' },
            { value: 'edit', label: 'Cambiar algo' },
          ]}
          onAnswer={(value) => {
            if (value === 'retry') void run(lastRun.refresh, lastRun.reason);
            else {
              setPhase('asking');
              setStep(0);
            }
          }}
        />
      );
    }
    switch (stepId) {
      case 'decisores':
        return (
          <ChatQuestionPanel
            title={QUESTIONS.decisores}
            description={
              contacts.length === 0
                ? 'Esta empresa todavía no tiene contactos activos: el mensaje pedirá averiguar quién decide.'
                : `Puedes elegir hasta ${MAX_CONTACTS_PER_RUN}. A cada uno le hablo de lo que le importa a su cargo.`
            }
            mode="multiple"
            // Sin `max`: el tope de 5 lo aplica la selección, y «Sin decisor» siempre se puede marcar.
            options={decisionMakerOptions(contacts)}
            selected={markedContacts}
            onSelectionChange={(next) => setMarkedContacts((prev) => normalizeDecisionMakerSelection(prev, next))}
            onSubmitSelection={() => advance({ contactIds: contactIdsFrom(markedContacts) })}
            submitLabel="Continuar"
          />
        );
      case 'canales':
        return (
          <ChatQuestionPanel
            title={QUESTIONS.canales}
            onBack={goBack}
            description="Escribo un mensaje para cada canal, con el mismo enfoque."
            mode="multiple"
            max={FIRST_CALL_CHANNELS.length}
            options={channelOptions()}
            selected={selection.channels}
            onSelectionChange={(next) => setSelection((prev) => ({ ...prev, channels: next as FirstCallChannel[] }))}
            onSubmitSelection={(values) => advance({ channels: values as FirstCallChannel[] })}
            submitLabel="Continuar"
          />
        );
      case 'objetivo':
        return (
          <ChatQuestionPanel
            title={QUESTIONS.objetivo}
            onBack={goBack}
            description="Puedes elegir varios: el mensaje los encadena en este orden."
            mode="multiple"
            max={goalOptions().length}
            options={goalOptions()}
            selected={selection.goals}
            onSelectionChange={(next) => setSelection((prev) => ({ ...prev, goals: next as FirstCallGoal[] }))}
            onSubmitSelection={(values) => advance({ goals: orderGoals(values as FirstCallGoal[]) })}
            submitLabel="Continuar"
          />
        );
      case 'productos':
        return (
          <ChatQuestionPanel
            title={QUESTIONS.productos}
            onBack={goBack}
            description="Elige uno o varios, o «El que mejor conecte» para que el agente elija según lo que encuentre."
            mode="multiple"
            options={productOptions()}
            selected={markedProducts}
            filterPlaceholder="Buscar producto"
            onSelectionChange={(next) => setMarkedProducts((prev) => normalizeProductSelection(prev, next))}
            onSubmitSelection={() => advance({ productKeys: productKeysFrom(markedProducts) })}
            submitLabel="Continuar"
          />
        );
      default:
        return (
          <ChatQuestionPanel
            title={QUESTIONS.resumen}
            onBack={goBack}
            description={total > 1 ? `Saldrán ${total} preparaciones.` : undefined}
            options={[
              { value: 'go', label: regenerate ? 'Preparar otra versión' : 'Preparar', description: 'Con lo que elegiste.' },
              ...(hasFreshBrief
                ? [{ value: 'refresh', label: 'Investigar de nuevo y preparar', description: 'Si algo cambió en la empresa hace poco.' }]
                : []),
              { value: 'edit', label: 'Cambiar algo', description: 'Volver a elegir decisores, canales o productos.' },
            ]}
            otherPlaceholder={regenerate ? '¿Qué quieres distinto en esta versión?' : undefined}
            otherLabel="Qué cambiar"
            onOther={(text) => void run(false, text)}
            onAnswer={(value) => {
              if (value === 'edit') setStep(0);
              else void run(value === 'refresh', null);
            }}
          />
        );
    }
  })();

  return (
    <ChatPanel
      open={open}
      onOpenChange={onOpenChange}
      subtitle={`Primer contacto · ${accountName}`}
      markMotion={phase === 'running' ? 'thinking' : 'breathing'}
      onNewConversation={reset}
      newConversationLabel="Empezar de nuevo"
      newConversationDisabled={phase === 'running'}
      closeDisabled={phase === 'running'}
    >
      <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="first-contact-agent">
        <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <div className="flex min-h-full flex-col gap-4">
            <Stepper
              size="sm"
              steps={[...FIRST_CONTACT_STEPS]}
              current={phase === 'asking' ? step : FIRST_CONTACT_STEPS.length}
              onStepClick={phase === 'asking' ? (index) => index < step && setStep(index) : undefined}
              aria-label="Pasos del primer contacto"
            />
            <AgentChatTimeline messages={messages} />
            {phase === 'running' && (
              <AiAnalyzingState
                title={stage ? RESEARCH_PROGRESS_LABELS[stage] : 'Empezando'}
                progress={stage ? (willResearch ? STAGE_PERCENT[stage] : stage === 'writing' ? 50 : STAGE_PERCENT[stage]) : 5}
                detail={total === 1 ? 'Una preparación' : `${total} preparaciones`}
                caption="No cierres este panel mientras trabaja."
              />
            )}
          </div>
        </div>
        {question && <div className="shrink-0 px-4 pb-4 pt-2">{question}</div>}
      </div>
    </ChatPanel>
  );
}
