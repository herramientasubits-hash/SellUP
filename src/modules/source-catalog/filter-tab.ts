import type { AiFlowStatus, ConnectionMode, SellupUse } from '@/server/agents/prospecting-toolkit/types';

export type TabId = 'operativas' | 'manuales' | 'todas';

export type FilterableSource = {
  sellupUse: SellupUse;
  aiFlowStatus: AiFlowStatus;
  connectionMode: ConnectionMode;
};

export function filterTab<T extends FilterableSource>(sources: T[], tab: TabId): T[] {
  return sources.filter((s) => {
    switch (tab) {
      case 'operativas': {
        return (
          s.sellupUse !== 'technical_container' &&
          s.sellupUse !== 'contextual_signal' &&
          s.sellupUse !== 'manual_reference' &&
          s.sellupUse !== 'not_for_ai_flow' &&
          (
            s.aiFlowStatus === 'connected' ||
            s.aiFlowStatus === 'connected_post_approval' ||
            s.aiFlowStatus === 'eligible_not_connected' ||
            s.aiFlowStatus === 'partial_pending_data' ||
            s.aiFlowStatus === 'source_guided' ||
            s.aiFlowStatus === 'pending_classification' ||
            s.aiFlowStatus === 'signal_connected_read_only' ||
            s.aiFlowStatus === 'dry_run_validated' ||
            s.aiFlowStatus === 'snapshot_persisted' ||
            s.aiFlowStatus === 'controlled_pilot' ||
            s.aiFlowStatus === 'limited_manual_expansion'
          )
        );
      }
      case 'manuales': {
        if (s.sellupUse === 'technical_container') return false;
        return (
          s.aiFlowStatus === 'manual_only' ||
          s.aiFlowStatus === 'signal_connected_read_only' ||
          s.sellupUse === 'manual_reference' ||
          s.sellupUse === 'contextual_signal' ||
          (s.sellupUse === 'commercial_signal' && s.connectionMode === 'not_connected')
        );
      }
      case 'todas':
        return true;
    }
  });
}
