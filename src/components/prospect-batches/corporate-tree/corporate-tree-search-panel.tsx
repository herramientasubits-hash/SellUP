'use client';

import * as React from 'react';
import { ChatPanel } from '@/components/chat';
import { GitBranch } from '@/icons';
import { useCorporateTreeEnabled } from '@/modules/prospect-batches/agent-runs/agent-runs-client';
import { AGENT_RUNS_PROCESS_CENTER_OPEN_EVENT } from '@/components/prospect-batches/agent-runs-tray/agent-runs-tray';
import type { CorporateTreeRootRef } from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';
import { CorporateTreeFlow } from './corporate-tree-flow';

/**
 * Agente 1 · Búsqueda en árbol desde una fila (AGENT1-CORPORATE-TREE-1): el mismo
 * panel del agente, con la empresa ya elegida.
 */
export function CorporateTreeSearchPanel({
  root,
  onClose,
}: {
  root: CorporateTreeRootRef | null;
  onClose: () => void;
}) {
  return (
    <ChatPanel
      open={!!root}
      onOpenChange={(open) => !open && onClose()}
      subtitle={root ? `Árbol de ${root.name}` : 'Árbol de una empresa'}
      onMinimize={() => {
        onClose();
        window.dispatchEvent(new Event(AGENT_RUNS_PROCESS_CENTER_OPEN_EVENT));
      }}
    >
      {root && (
        <CorporateTreeFlow
          key={`${root.candidateId ?? ''}:${root.accountId ?? ''}:${root.name}`}
          initialRoot={root}
          onOpenBatch={onClose}
        />
      )}
    </ChatPanel>
  );
}

/**
 * Lo que una tabla necesita para ofrecer «Buscar en árbol»: si está encendida,
 * cómo abrirla y el panel que hay que pintar.
 */
export function useCorporateTreeAction(): {
  enabled: boolean;
  open: (root: CorporateTreeRootRef) => void;
  menuItem: (root: CorporateTreeRootRef) => { id: string; label: string; icon: typeof GitBranch; onClick: () => void } | null;
  panel: React.ReactNode;
} {
  const enabled = useCorporateTreeEnabled();
  const [root, setRoot] = React.useState<CorporateTreeRootRef | null>(null);
  const open = React.useCallback((next: CorporateTreeRootRef) => setRoot(next), []);
  const menuItem = React.useCallback(
    (next: CorporateTreeRootRef) =>
      enabled ? { id: 'corporate-tree', label: 'Buscar en árbol', icon: GitBranch, onClick: () => setRoot(next) } : null,
    [enabled],
  );
  const close = React.useCallback(() => setRoot(null), []);
  return React.useMemo(
    () => ({ enabled, open, menuItem, panel: <CorporateTreeSearchPanel root={root} onClose={close} /> }),
    [enabled, open, menuItem, root, close],
  );
}
