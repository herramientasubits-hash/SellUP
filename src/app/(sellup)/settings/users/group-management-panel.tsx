'use client';

import { useState } from 'react';
import { Folder, FolderOpen, ChevronDown, ChevronRight } from "@/icons";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import type { OrganizationGroup } from '@/modules/access/types';

interface GroupManagementPanelProps {
  groups: OrganizationGroup[];
}

interface GroupTreeNode {
  group: OrganizationGroup;
  children: GroupTreeNode[];
}

function buildTree(groups: OrganizationGroup[]): GroupTreeNode[] {
  const map = new Map<string, GroupTreeNode>(groups.map(g => [g.id, { group: g, children: [] }]));
  const roots: GroupTreeNode[] = [];

  for (const node of map.values()) {
    const pid = node.group.parent_group_id;
    if (pid && map.has(pid)) {
      map.get(pid)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sort = (nodes: GroupTreeNode[]) => {
    nodes.sort((a, b) => a.group.name.localeCompare(b.group.name));
    nodes.forEach(n => sort(n.children));
  };
  sort(roots);
  return roots;
}

function depthLabel(depth: number): string {
  return ['Nivel 1 (raíz)', 'Nivel 2', 'Nivel 3'][depth] ?? `Nivel ${depth + 1}`;
}

function depthBadgeVariant(depth: number): 'brand' | 'warning' | 'positive' | 'neutral' {
  return (['brand', 'warning', 'positive'] as const)[depth] ?? 'neutral';
}

interface TreeNodeRowProps {
  node: GroupTreeNode;
  level: number;
}

function TreeNodeRow({ node, level }: TreeNodeRowProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-surface-muted transition-colors cursor-default"
        style={{ paddingLeft: `${12 + level * 20}px` }}
      >
        {hasChildren ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Contraer' : 'Expandir'} ${node.group.name}`}
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </Button>
        ) : (
          <span className="h-7 w-7 shrink-0" aria-hidden="true" />
        )}

        {hasChildren
          ? <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
          : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        }

        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={node.group.name}>{node.group.name}</span>

        <Badge variant={depthBadgeVariant(node.group.depth)} className="shrink-0">
          {depthLabel(node.group.depth)}
        </Badge>
      </div>

      {hasChildren && expanded && (
        <div>
          {node.children.map(child => (
            <TreeNodeRow key={child.group.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * El árbol de grupos: quién cuelga de quién y en qué nivel está cada uno.
 * Solo se lee; los grupos se crean con «Agregar grupo», en la barra de
 * acciones de la pantalla.
 */
export function GroupManagementPanel({ groups }: GroupManagementPanelProps) {
  const tree = buildTree(groups);

  if (tree.length === 0) {
    return (
      <EmptyState
        variant="plain"
        icon={Folder}
        title="Todavía no hay grupos"
        description="Crea el primero con «Agregar grupo» para organizar al equipo por país, área o línea de negocio."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {groups.length} {groups.length === 1 ? 'grupo' : 'grupos'} · máximo 3 niveles
      </p>
      <div>
        {tree.map(root => (
          <TreeNodeRow key={root.group.id} node={root} level={0} />
        ))}
      </div>
    </div>
  );
}
