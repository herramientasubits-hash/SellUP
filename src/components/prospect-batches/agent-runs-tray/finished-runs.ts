/**
 * Al terminar una búsqueda, la pantalla se recarga para ver lo que se encontró (dueña
 * 20-10), también si el asistente estaba minimizado o cerrado: antes sólo recargaba el
 * panel abierto al terminar.
 */
import * as React from 'react';

type RunLike = { clientRequestId: string; status: 'queued' | 'running' | 'succeeded' | 'failed' };

const isActive = (status: RunLike['status']) => status === 'queued' || status === 'running';

/** Las corridas que estaban en curso la vez anterior y ahora terminaron. */
export function newlyFinishedRuns<T extends RunLike>(previous: ReadonlyMap<string, RunLike['status']>, runs: readonly T[]): T[] {
  return runs.filter((run) => !isActive(run.status) && isActive(previous.get(run.clientRequestId) ?? 'succeeded'));
}

/** Recarga los datos de la pantalla cuando termina alguna corrida que estaba en curso. */
export function useRefreshOnFinishedRuns(runs: readonly RunLike[], refresh: () => void): void {
  const previous = React.useRef<Map<string, RunLike['status']>>(new Map());
  const refreshRef = React.useRef(refresh);
  React.useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  React.useEffect(() => {
    const finished = newlyFinishedRuns(previous.current, runs);
    previous.current = new Map(runs.map((run) => [run.clientRequestId, run.status]));
    if (finished.length > 0) refreshRef.current();
  }, [runs]);
}
