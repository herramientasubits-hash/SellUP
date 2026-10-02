'use server';

/**
 * La etapa en vivo de una corrida del Agente 1, para el chat (migración 143).
 * Solo lectura y solo de la propia corrida: la RLS filtra por `auth.uid()`.
 */

import { readRunProgress, type RunProgressSnapshot } from './run-progress.server';

export async function getAgent1RunProgressAction(clientRequestId: string): Promise<RunProgressSnapshot> {
  return readRunProgress(clientRequestId);
}
