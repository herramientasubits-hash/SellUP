'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getFlagEmoji } from '@/components/prospect-batches/candidate-detail-helpers';
import { ExternalLink, GitBranch } from '@/icons';
import type { CorporateTreeNodeView } from '@/modules/prospect-batches/corporate-tree/corporate-tree-batch-groups';
import { useCorporateTreeAction } from './corporate-tree-search-panel';

/** Como mucho, niveles del árbol (lo fija la migración 157). */
const MAX_DEPTH = 4;

/**
 * Agente 1 · Búsqueda en árbol — FASE C: el lote como árbol (la empresa de partida arriba y
 * cada empresa debajo de la que depende). Desde cualquier empresa se puede «Buscar su árbol»:
 * se abre el agente con esa empresa ya elegida y el árbol nuevo queda un nivel más abajo.
 */
export function CorporateTreeHierarchyList({ nodes }: { nodes: readonly CorporateTreeNodeView[] }) {
  const tree = useCorporateTreeAction();
  return (
    <>
      <ul className="flex flex-col gap-1" aria-label="Árbol de empresas">
        {nodes.map((node) => (
          <TreeNode key={node.item.id} node={node} level={0} onBranch={tree.enabled ? tree.open : null} />
        ))}
      </ul>
      {tree.panel}
    </>
  );
}

function TreeNode({
  node,
  level,
  onBranch,
}: {
  node: CorporateTreeNodeView;
  level: number;
  onBranch: ReturnType<typeof useCorporateTreeAction>['open'] | null;
}) {
  const { item } = node;
  const canBranch = !!onBranch && node.relation !== 'root' && (item.depth ?? 1) < MAX_DEPTH;
  return (
    <li>
      <div className="flex flex-col gap-1 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-subtle sm:flex-row sm:items-start sm:justify-between sm:gap-x-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            <span>
              {item.countryCode ? `${getFlagEmoji(item.countryCode)} ` : ''}
              {item.name}
            </span>
            <Badge variant="neutral">{node.relationLabel}</Badge>
          </p>
          {item.relationDetail && <p className="text-xs text-muted-foreground">{item.relationDetail}</p>}
          {item.groupWebsite && (
            <p className="text-xs text-muted-foreground">
              {item.candidateId
                ? `Sin web propia: usa la del grupo (${item.groupWebsite}). Entró por su número fiscal oficial.`
                : `Web del grupo: ${item.groupWebsite}`}
            </p>
          )}
          {item.foundInApollo && <p className="text-xs text-muted-foreground">Filial y web según la fuente principal.</p>}
          {item.websiteUnverified && (
            <p className="text-xs text-warning">Web no comprobada: el sitio no deja revisarla. Confírmala antes de aprobar.</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge variant={item.statusTone}>{item.statusLabel}</Badge>
          {item.evidenceUrl && (
            <a
              href={item.evidenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              Fuente
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
          {canBranch && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onBranch!({
                  name: item.name,
                  countryCode: item.countryCode,
                  candidateId: item.candidateId,
                  parentRelationshipId: item.relationshipId ?? null,
                })
              }
            >
              <GitBranch aria-hidden="true" />
              Buscar su árbol
            </Button>
          )}
        </div>
      </div>
      {node.children.length > 0 && (
        <ul className="ml-2 flex flex-col gap-1 border-l border-border/60 pl-2 sm:ml-4 sm:pl-3">
          {node.children.map((child) => (
            <TreeNode key={child.item.id} node={child} level={level + 1} onBranch={onBranch} />
          ))}
        </ul>
      )}
    </li>
  );
}
