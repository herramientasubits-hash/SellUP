/**
 * run-progress.ts — en qué paso va una corrida del Agente 1, para que el chat lo
 * diga EN VIVO (AGENT1-RUN-LIVE-PROGRESS-1, migración 143).
 *
 * La corrida es un único viaje al servidor: el chat no recibe nada hasta que
 * termina. Para contar lo que pasa mientras tanto, el servidor anota la etapa en
 * `agent1_run_progress` y el chat la lee cada poco.
 *
 * Reglas:
 *   * Una etapa se anota cuando EMPIEZA de verdad: al llamar a la dependencia que
 *     la ejecuta (`withRunProgress`), nunca por tiempo ni por una barra que avance
 *     sola. Si Apollo no corre, el chat nunca dice «Buscando con Apollo».
 *   * Informativo: un fallo al anotar no cambia la corrida ni su resultado.
 *   * No se toca el orquestador: se envuelven sus dependencias. Así el orden de
 *     las etapas es el orden REAL en que el orquestador las llama.
 *
 * Puro salvo lo que inyecta quien llama (la escritura).
 */

export const RUN_PROGRESS_STAGES = [
  'starting',
  'free_sources',
  'tavily',
  'claude_review',
  'apollo',
  'lusha',
  'claude_search',
  'reviewing',
] as const;

export type RunProgressStage = (typeof RUN_PROGRESS_STAGES)[number];

/** Lo que el chat muestra en cada etapa: qué está haciendo el agente, en presente. */
export const RUN_PROGRESS_LABELS: Readonly<Record<RunProgressStage, string>> = {
  starting: 'Preparando la búsqueda',
  free_sources: 'Revisando el banco de empresas y los registros gratuitos del país',
  tavily: 'Buscando empresas en la web con Tavily',
  claude_review: 'Claude está revisando las empresas encontradas',
  apollo: 'Buscando empresas con Apollo y completando sus datos',
  lusha: 'Completando la búsqueda con Lusha',
  claude_search: 'Claude está buscando más empresas en la web',
  reviewing: 'Revisando lo encontrado',
};

/**
 * Cuánto de la corrida se ha recorrido al EMPEZAR cada etapa, en el orden en
 * que el orquestador las llama. La barra del chat avanza por etapas REALES (las
 * que anota el servidor), nunca por tiempo: si una etapa tarda, la barra espera
 * con ella. `reviewing` no tiene valor propio: es el respiro entre etapas y la
 * barra no retrocede.
 */
export const RUN_PROGRESS_PERCENT: Readonly<Record<Exclude<RunProgressStage, 'reviewing'>, number>> = {
  starting: 5,
  free_sources: 15,
  tavily: 30,
  claude_review: 45,
  apollo: 55,
  lusha: 75,
  claude_search: 88,
};

/** El avance tras ver `stage`: nunca retrocede (una etapa saltada no resta). */
export function nextRunProgressPercent(previous: number, stage: RunProgressStage | null): number {
  if (!stage || stage === 'reviewing') return previous;
  return Math.max(previous, RUN_PROGRESS_PERCENT[stage]);
}

/** Texto cuando todavía no hay etapa anotada (o no se pudo leer). */
export const RUN_PROGRESS_FALLBACK_LABEL = RUN_PROGRESS_LABELS.starting;

export type RunProgressReporter = (stage: RunProgressStage) => void;

/** Las dependencias del orquestador que abren una etapa, y cuál. */
const STAGE_BY_DEP = {
  runPrePaidNoveltyDiscovery: 'free_sources',
  runTavilyPipeline: 'tavily',
  rescueBatchInline: 'claude_review',
  runApolloPipeline: 'apollo',
  runLushaWaterfallLeg: 'lusha',
  runClaudeCompanySearchLeg: 'claude_search',
} as const satisfies Record<string, RunProgressStage>;

type StageDepName = keyof typeof STAGE_BY_DEP;

type AsyncFn<A extends unknown[], R> = (...args: A) => Promise<R>;

function wrapStage<A extends unknown[], R>(
  fn: AsyncFn<A, R>,
  stage: RunProgressStage,
  report: RunProgressReporter,
): AsyncFn<A, R> {
  return async (...args: A) => {
    report(stage);
    try {
      return await fn(...args);
    } finally {
      // Lo que venga después (otra etapa o el cierre) lo sobrescribe; si no viene
      // nada, el chat no se queda diciendo que sigue buscando.
      report('reviewing');
    }
  };
}

/**
 * Devuelve las mismas dependencias, con las que abren una etapa envueltas para
 * anotarla al empezar. Las que no están (opcionales ausentes) siguen ausentes.
 */
export function withRunProgress<D extends Partial<Record<StageDepName, unknown>>>(
  deps: D,
  report: RunProgressReporter,
): D {
  const wrapped: Record<string, unknown> = { ...deps };
  for (const name of Object.keys(STAGE_BY_DEP) as StageDepName[]) {
    const fn = deps[name];
    if (typeof fn === 'function') {
      wrapped[name] = wrapStage(fn as AsyncFn<unknown[], unknown>, STAGE_BY_DEP[name], report);
    }
  }
  return wrapped as D;
}

export type RunProgressStore = {
  /** Anota (o reemplaza) la etapa de la corrida. */
  write: (row: { stage: RunProgressStage; label: string }) => Promise<void>;
  /** Borra la fila al terminar: el chat ya tiene el resultado. */
  clear: () => Promise<void>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El `clientRequestId` de la solicitud cruda, sólo si tiene forma de uuid. */
export function readClientRequestId(request: unknown): string | null {
  if (typeof request !== 'object' || request === null) return null;
  const value = (request as { clientRequestId?: unknown }).clientRequestId;
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

/**
 * Un anotador que escribe en orden (cada escritura espera a la anterior) y que
 * nunca lanza: un fallo se registra y la corrida sigue. Repetir la misma etapa
 * seguida no vuelve a escribir.
 */
export function createRunProgressReporter(
  store: RunProgressStore,
  onError: (error: unknown) => void = () => {},
): { report: RunProgressReporter; finish: () => Promise<void> } {
  let queue: Promise<void> = Promise.resolve();
  let last: RunProgressStage | null = null;

  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch(onError);
    return queue;
  };

  const report: RunProgressReporter = (stage) => {
    if (stage === last) return;
    last = stage;
    void enqueue(() => store.write({ stage, label: RUN_PROGRESS_LABELS[stage] }));
  };

  const finish = () => enqueue(() => store.clear());

  return { report, finish };
}
