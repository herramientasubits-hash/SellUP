import type { AiFlowStatus, ConnectionMode, SellupUse } from '@/server/agents/prospecting-toolkit/types';

export type OperationalClassification = {
  sellupUse: SellupUse;
  aiFlowStatus: AiFlowStatus;
  connectionMode: ConnectionMode;
  nextAction: string;
};

const FALLBACK: OperationalClassification = {
  sellupUse: 'manual_reference',
  aiFlowStatus: 'manual_only',
  connectionMode: 'not_connected',
  nextAction: 'Pendiente clasificación operativa',
};

export function resolveOperationalClassification(
  source: {
    sellupUse?: SellupUse | null;
    aiFlowStatus?: AiFlowStatus | null;
    connectionMode?: ConnectionMode | null;
    nextAction?: string | null;
  },
): OperationalClassification {
  if (source.sellupUse && source.aiFlowStatus && source.connectionMode) {
    return {
      sellupUse: source.sellupUse,
      aiFlowStatus: source.aiFlowStatus,
      connectionMode: source.connectionMode,
      nextAction: source.nextAction ?? FALLBACK.nextAction,
    };
  }
  return FALLBACK;
}
