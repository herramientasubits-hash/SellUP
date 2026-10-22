'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  ChatAgentMessage,
  ChatComposer,
  ChatQuestionPanel,
  ChatThread,
  ChatUserMessage,
  type ChatMessage,
  type ChatQuestionOptionDetail,
} from '@/components/chat';
import { getFlagEmoji } from '@/components/accounts/account-form-helpers';
import { SubmittingPanel } from '@/components/prospect-batches/chat-wizard/wizard-execution-panels';
import { Stepper, type StepperStep } from '@/components/navigation/stepper';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import {
  executeAgentRunViaRoute,
  fetchAgentRunsStatus,
  getAgentRunsStore,
} from '@/modules/prospect-batches/agent-runs/agent-runs-client';
import { waitForTreeRunResult } from '@/modules/prospect-batches/corporate-tree/corporate-tree-run-recovery';
import { openAgentRun } from '@/components/prospect-batches/agent-runs-tray/agent-run-opener';
import {
  corporateTreePendingSummary,
  type CorporateTreePending,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-batch-groups';
import { corporateTreeGroupSentence } from '@/modules/prospect-batches/corporate-tree/corporate-tree-group-signal';
import {
  CORPORATE_TREE_BRANCHES,
  CORPORATE_TREE_BRANCH_DESCRIPTIONS,
  CORPORATE_TREE_LIMITS,
  CORPORATE_TREE_RELATION_LABELS,
  isCorporateTreeBranch,
  type CorporateTreeBranch,
  type CorporateTreeRootRef,
  type CorporateTreeRunPayload,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';

/**
 * Agente 1 · Búsqueda en árbol — la conversación (AGENT1-CORPORATE-TREE-1).
 *
 * Mismas piezas que el asistente por criterios: el agente pregunta en el hilo y
 * se contesta en la tarjeta acoplada abajo (`ChatQuestionPanel`); el nombre de la
 * empresa se escribe en la caja del chat. La corrida la lleva el almacén del
 * shell, así que sigue si se cierra el panel y aparece en el Centro de procesos.
 */

type Step = 'company' | 'branches' | 'countries' | 'confirm' | 'running' | 'done' | 'failed';

/** `inReview`: las que quedaron en «Por revisar»; `null` = no se sabe (respuesta recuperada). */
type Outcome = {
  redirectPath: string | null;
  inReview: number | null;
  message: string | null;
  /** Lo que no entró a revisión y por qué; `null` si la respuesta no lo trajo. */
  pending?: CorporateTreePending | null;
};

export type CorporateTreeFlowProps = {
  /** Empresa elegida desde una fila: se salta la pregunta del nombre. */
  initialRoot?: CorporateTreeRootRef | null;
  /** «Volver» a elegir el tipo de búsqueda (sólo dentro del asistente). */
  onBack?: () => void;
  /** Al abrir el lote desde el resultado. */
  onOpenBatch?: () => void;
  /**
   * Como en «por criterios»: al terminar con empresas para revisar se avisa, se
   * actualiza la lista y se cierra el panel. Sin él, el resultado queda en el hilo.
   */
  onClose?: () => void;
  /**
   * Como en «por criterios»: el id de la búsqueda en vuelo (o `null`). Con él, el «+»
   * del panel deja empezar OTRA búsqueda mientras ésta sigue en el Centro de procesos
   * (Prod 15-10: en el árbol no se podían correr varias a la vez).
   */
  onRunningChange?: (clientRequestId: string | null) => void;
};

const BRANCH_OPTIONS: readonly ChatQuestionOptionDetail[] = CORPORATE_TREE_BRANCHES.map((branch) => ({
  value: branch,
  label: CORPORATE_TREE_RELATION_LABELS[branch],
  description: CORPORATE_TREE_BRANCH_DESCRIPTIONS[branch],
}));

const COUNTRY_OPTIONS: readonly ChatQuestionOptionDetail[] = LATAM_COUNTRIES.map((c) => ({
  value: c.code,
  label: `${getFlagEmoji(c.code)} ${c.name}`,
}));

const ALL_COUNTRY_CODES = LATAM_COUNTRIES.map((c) => c.code);

const CONFIRM_OPTIONS: readonly ChatQuestionOptionDetail[] = [
  {
    value: 'launch',
    label: 'Buscar el árbol',
    description: 'Claude busca cada rama en la web (unos US$0,2 por rama, estimado). Apollo da las filiales con 1 crédito. No usa Lusha.',
  },
  { value: 'restart', label: 'Cambiar la empresa' },
];

function agent(id: string, text: string): ChatMessage {
  return { id, role: 'agent', text, createdAt: 0, status: 'done' };
}

function user(id: string, text: string): ChatMessage {
  return { id, role: 'user', text, createdAt: 0, status: 'done' };
}

function countriesSummary(codes: readonly string[]): string {
  if (codes.length === ALL_COUNTRY_CODES.length) return 'Todos los países';
  return LATAM_COUNTRIES.filter((c) => codes.includes(c.code))
    .map((c) => c.name)
    .join(', ');
}

/** Fuera del componente: se llama sólo desde el lanzamiento (evento), nunca al pintar. */
function nowMs(): number {
  return Date.now();
}

function newClientRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '00000000-0000-4000-8000-000000000000'.replace(/0/g, () => Math.floor(Math.random() * 16).toString(16));
}

export function CorporateTreeFlow({ initialRoot = null, onBack, onOpenBatch, onClose, onRunningChange }: CorporateTreeFlowProps) {
  const router = useRouter();
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [root, setRoot] = React.useState<CorporateTreeRootRef | null>(initialRoot);
  const [step, setStep] = React.useState<Step>(initialRoot ? 'branches' : 'company');
  const [nameDraft, setNameDraft] = React.useState('');
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [branches, setBranches] = React.useState<CorporateTreeBranch[]>([...CORPORATE_TREE_BRANCHES]);
  const [countryCodes, setCountryCodes] = React.useState<string[]>(ALL_COUNTRY_CODES);
  const [answered, setAnswered] = React.useState<{ branches: boolean; countries: boolean }>({ branches: false, countries: false });
  const [run, setRun] = React.useState<{ id: string; startedAtMs: number } | null>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);

  const inFlightRequestId = step === 'running' && run ? run.id : null;
  React.useEffect(() => {
    onRunningChange?.(inFlightRequestId);
  }, [inFlightRequestId, onRunningChange]);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, [step]);

  const messages = React.useMemo(() => {
    const list: ChatMessage[] = [
      agent('tree-intro', 'Busco la familia de una empresa: su grupo y matriz, sus filiales y dónde opera en otros países. Lo que encuentre llega a «Por revisar», agrupado por rama.'),
    ];
    if (!initialRoot || step === 'company') list.push(agent('tree-company-q', '¿De qué empresa quieres ver el árbol? Escribe su nombre.'));
    if (root) list.push(user('tree-company-a', root.name));
    if (root && step !== 'company') {
      list.push(agent('tree-branches-q', '¿Qué ramas busco?'));
      if (answered.branches) list.push(user('tree-branches-a', branches.map((b) => CORPORATE_TREE_RELATION_LABELS[b]).join(', ')));
    }
    if (answered.branches) {
      list.push(agent('tree-countries-q', '¿En qué países busco?'));
      if (answered.countries) list.push(user('tree-countries-a', countriesSummary(countryCodes)));
    }
    if (step === 'done' && outcome) {
      list.push(
        agent(
          'tree-done',
          outcome.inReview === null
            ? `Listo: el árbol de ${root?.name ?? 'la empresa'} quedó guardado. Abre el lote para ver cada rama.`
            : outcome.inReview > 0
              ? `Listo: ${outcome.inReview} ${outcome.inReview === 1 ? 'empresa relacionada quedó' : 'empresas relacionadas quedaron'} en «Por revisar». ${corporateTreePendingSummary(outcome.pending ?? null)}`
              : `Terminé el árbol de ${root?.name ?? 'la empresa'}: nada nuevo para revisar todavía. ${corporateTreePendingSummary(outcome.pending ?? null)}`,
        ),
      );
    }
    return list;
  }, [initialRoot, root, step, answered, branches, countryCodes, outcome]);

  function submitName(text: string) {
    const name = text.trim();
    if (name.length < CORPORATE_TREE_LIMITS.rootNameMinChars) {
      setNameError('Escribe el nombre de la empresa.');
      return;
    }
    setNameError(null);
    setNameDraft('');
    setRoot({ name: name.slice(0, CORPORATE_TREE_LIMITS.rootNameMaxChars) });
    setStep('branches');
  }

  /**
   * `refresh`: no reutilizar el árbol guardado del grupo (el botón «Buscar de nuevo» del aviso).
   * Ese botón se pulsa con el panel ya cerrado: la búsqueda se abre en el agente con su cargador,
   * como cualquier búsqueda (dueña 22-10: antes corría sin que se viera).
   */
  async function launch(refresh = false) {
    if (!root) return;
    const id = newClientRequestId();
    const startedAtMs = nowMs();
    setRun({ id, startedAtMs });
    setStep('running');
    const payload: CorporateTreeRunPayload = {
      searchMode: 'corporate_tree',
      clientRequestId: id,
      rootName: root.name,
      rootWebsite: root.website ?? null,
      rootCountryCode: root.countryCode ?? null,
      rootCandidateId: root.candidateId ?? null,
      rootAccountId: root.accountId ?? null,
      branches,
      countryCodes,
      ...(refresh ? { refresh: true } : {}),
      ...(root.parentRelationshipId ? { parentRelationshipId: root.parentRelationshipId } : {}),
    };
    const store = getAgentRunsStore();
    try {
      const started = store
        ? store.startRun({ title: `Árbol · ${root.name}`, concurrencyKey: `tree:${root.name.toLowerCase()}`, payload })
        : executeAgentRunViaRoute(payload);
      if (refresh && store) openAgentRun(id, (href) => router.push(href));
      const result = await started;
      if (result.ok) {
        finish({
          redirectPath: result.redirectPath,
          inReview: result.candidateCount ?? null,
          message: null,
          pending: result.corporateTree ?? null,
        });
      } else {
        fail(result.message ?? 'No fue posible completar la búsqueda.');
      }
    } catch (error) {
      // La respuesta no llegó, pero la corrida puede haber terminado en el servidor:
      // se sigue por su id (el loader sigue) antes de decir que falló.
      console.warn('[corporate-tree] la respuesta de la corrida no llegó; se sigue por su id', error);
      const recovered = await waitForTreeRunResult(id, {
        fetchStatus: fetchAgentRunsStatus,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        nowMs,
        startedAtMs,
        isCancelled: () => !mounted.current,
      });
      if (recovered) {
        store?.reconcile(id, { status: 'succeeded', batchId: recovered.batchId, candidateCount: recovered.candidateCount });
        finish({ redirectPath: `/prospect-batches/${recovered.batchId}`, inReview: null, message: null });
      } else {
        const message = 'No recibimos la respuesta de la búsqueda. Si terminó, su lote aparece en «Búsquedas»; si no, inténtalo de nuevo.';
        store?.reconcile(id, { status: 'failed', message });
        fail(message);
      }
    }
  }

  function fail(message: string) {
    if (!mounted.current) return;
    setOutcome({ redirectPath: null, inReview: null, message });
    setStep('failed');
  }

  /**
   * Como en «por criterios»: aviso, lista de «Por revisar» actualizada y el agente se
   * cierra SIEMPRE (dueña 14-10). El lote se abre desde el aviso, «Búsquedas» o el
   * Centro de procesos.
   */
  function finish(next: Outcome) {
    router.refresh();
    const name = root?.name ?? 'la empresa';
    // Mismo aviso que «por criterios» (sin botón): el lote se abre desde «Búsquedas»
    // o el Centro de procesos.
    // Con el árbol guardado, el vendedor puede pedir una búsqueda nueva (pagada) desde el aviso.
    const searchAgain = next.pending?.reusedSavedTree
      ? { action: { label: 'Buscar de nuevo', onClick: () => void launch(true) } }
      : {};
    if (next.inReview === 0) {
      toast.info('No se encontraron empresas nuevas.', {
        description: `Árbol de ${name}. ${corporateTreePendingSummary(next.pending ?? null)}`,
        ...searchAgain,
      });
    } else {
      toast.success('Prospectos generados correctamente.', {
        description:
          next.inReview === null
            ? 'Ya puedes revisarlos en el listado de prospectos.'
            : `Árbol de ${name}: ${next.inReview} ${next.inReview === 1 ? 'empresa nueva' : 'empresas nuevas'} para revisar en el listado de prospectos. ${corporateTreeGroupSentence(next.pending?.groupSignal ?? null)}`.trim(),
        ...searchAgain,
      });
    }
    if (!mounted.current) return;
    setOutcome(next);
    setStep('done');
    onClose?.();
  }

  function restart() {
    setRoot(null);
    setAnswered({ branches: false, countries: false });
    setBranches([...CORPORATE_TREE_BRANCHES]);
    setCountryCodes(ALL_COUNTRY_CODES);
    setOutcome(null);
    setRun(null);
    setStep('company');
  }

  const question = (() => {
    switch (step) {
      case 'branches':
        return (
          <ChatQuestionPanel
            aria-label="Ramas del árbol"
            title="¿Qué ramas busco?"
            description="Vienen marcadas las tres; desmarca las que no quieras."
            titleRef={titleRef}
            mode="multiple"
            options={BRANCH_OPTIONS}
            selected={branches}
            // Con empresa ya dada desde fuera no hay pregunta anterior en este flujo.
            onBack={initialRoot ? null : () => setStep('company')}
            onSelectionChange={(values) => setBranches(values.filter(isCorporateTreeBranch))}
            onSubmitSelection={(values) => {
              const picked = values.filter(isCorporateTreeBranch);
              if (picked.length === 0) return;
              setBranches(picked);
              setAnswered((prev) => ({ ...prev, branches: true }));
              setStep('countries');
            }}
          />
        );
      case 'countries':
        return (
          <ChatQuestionPanel
            aria-label="Países del árbol"
            title="¿En qué países busco?"
            description="Vienen marcados todos; desmarca los que no quieras."
            titleRef={titleRef}
            mode="multiple"
            options={COUNTRY_OPTIONS}
            selected={countryCodes}
            onBack={() => setStep('branches')}
            filterPlaceholder="Filtrar países"
            onSelectionChange={setCountryCodes}
            onSubmitSelection={(values) => {
              if (values.length === 0) return;
              setCountryCodes(values);
              setAnswered((prev) => ({ ...prev, countries: true }));
              setStep('confirm');
            }}
          />
        );
      case 'confirm':
        return (
          <ChatQuestionPanel
            aria-label="Confirmar la búsqueda en árbol"
            title={`¿Busco el árbol de ${root?.name ?? 'la empresa'}?`}
            titleRef={titleRef}
            options={CONFIRM_OPTIONS}
            onBack={() => setStep('countries')}
            onAnswer={(value) => (value === 'launch' ? void launch() : restart())}
          />
        );
      default:
        return null;
    }
  })();

  // Como en «por criterios»: los pasos arriba y, mientras busca, la espera ocupa el
  // panel entero (la conversación vuelve al terminar).
  const stepperSteps: StepperStep[] = [
    ...(onBack ? [{ id: 'type', label: 'Tipo' }] : []),
    { id: 'company', label: 'Empresa' },
    { id: 'branches', label: 'Ramas' },
    { id: 'countries', label: 'Países' },
    { id: 'review', label: 'Revisión', ...(step === 'failed' ? { status: 'error' as const } : {}) },
  ];
  const stepIndex: Record<Step, number> = { company: 0, branches: 1, countries: 2, confirm: 3, running: 3, failed: 3, done: 4 };
  const stepperCurrent = stepIndex[step] + (onBack ? 1 : 0);
  const running = step === 'running' && run !== null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="corporate-tree-flow">
      <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="flex min-h-full flex-col gap-4">
          <Stepper size="sm" steps={stepperSteps} current={stepperCurrent} aria-label="Pasos de la búsqueda en árbol" />

          {running && run && <SubmittingPanel clientRequestId={run.id} startedAtMs={run.startedAtMs} />}

          {!running && (
          <ChatThread
            messages={messages}
            aria-label="Conversación de la búsqueda en árbol"
            className="gap-4"
            renderMessage={(message) =>
              message.role === 'user' ? <ChatUserMessage message={message} /> : <ChatAgentMessage message={message} isLast={false} />
            }
          />
          )}

          {step === 'done' && outcome?.redirectPath && (
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={outcome.redirectPath} onClick={onOpenBatch}>
                  Ver el lote
                </Link>
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={restart}>
                Buscar otra empresa
              </Button>
            </div>
          )}

          {step === 'failed' && outcome?.message && (
            <div className="flex flex-col gap-2">
              <Alert variant="destructive">
                <AlertDescription className="text-xs">{outcome.message}</AlertDescription>
              </Alert>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => setStep('confirm')}>
                  Intentar de nuevo
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={restart}>
                  Cambiar la empresa
                </Button>
              </div>
            </div>
          )}

          {step === 'company' && onBack && (
            <div>
              <Button type="button" size="sm" variant="ghost" onClick={onBack}>
                Elegir otro tipo de búsqueda
              </Button>
            </div>
          )}
        </div>
      </div>

      {question && <div className="shrink-0 px-4 pb-4 pt-2">{question}</div>}

      {step === 'company' && (
        <div className="shrink-0 px-4 pb-4 pt-2">
          {nameError && (
            <p className="pb-2 text-xs text-destructive" role="alert">
              {nameError}
            </p>
          )}
          <ChatComposer
            compact
            autoFocus
            value={nameDraft}
            onChange={setNameDraft}
            onSend={(text) => submitName(text)}
            placeholder="Nombre de la empresa, p. ej. Grupo Éxito"
          />
        </div>
      )}
    </div>
  );
}
