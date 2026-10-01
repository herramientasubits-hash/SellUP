'use client';

import { useState } from 'react';
import { Folder, FolderOpen, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ModalShell } from '@/components/shared/modal-shell';
import { FieldLabel, FieldDescription } from '@/components/forms/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { createOrganizationGroup } from '@/modules/access/actions';
import type { OrganizationGroup } from '@/modules/access/types';

const NO_PARENT = '__root__';

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
        <button
          type="button"
          aria-expanded={hasChildren ? expanded : undefined}
          onClick={() => setExpanded(v => !v)}
          className="flex h-4 w-4 items-center justify-center rounded-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          disabled={!hasChildren}
        >
          {hasChildren
            ? (expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)
            : <span className="h-3.5 w-3.5" />
          }
        </button>

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

export function GroupManagementPanel({ groups: initialGroups }: GroupManagementPanelProps) {
  const [groups] = useState<OrganizationGroup[]>(initialGroups);
  const [showDialog, setShowDialog] = useState(false);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tree = buildTree(groups);

  // Only allow parents at depth 0 or 1 (since max depth is 2)
  const validParents = groups.filter(g => g.depth < 2);

  function groupParentLabel(g: OrganizationGroup): string {
    const prefix = g.depth === 0 ? '' : '  · ';
    return prefix + g.name;
  }

  function reset() {
    setName('');
    setParentId('');
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);

    const result = await createOrganizationGroup({
      name: name.trim(),
      description: null,
      parent_group_id: parentId && parentId !== NO_PARENT ? parentId : null,
    });

    setLoading(false);

    if (!result.success) {
      setError(result.error ?? 'Error desconocido');
      return;
    }

    // Optimistic update: reload the page to get fresh data
    reset();
    setShowDialog(false);
    window.location.reload();
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <p className="text-xs text-muted-foreground">
        {groups.length} {groups.length === 1 ? 'grupo' : 'grupos'} · máximo 3 niveles
      </p>

      {/* Tree */}
      {tree.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 py-8 text-center">
          <Folder className="mx-auto mb-2 h-6 w-6 text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">No hay grupos todavía.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
          {tree.map(root => (
            <TreeNodeRow key={root.group.id} node={root} level={0} />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <ModalShell
        open={showDialog}
        onOpenChange={v => { setShowDialog(v); if (!v) reset(); }}
        title="Crear grupo organizacional"
        description="Define un nuevo grupo o subgrupo. Máximo 3 niveles de profundidad."
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => { setShowDialog(false); reset(); }}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleCreate} disabled={!name.trim() || loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Creando...' : 'Crear grupo'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="gm-name" className="block leading-none">
              Nombre del grupo <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              id="gm-name"
              placeholder="Ej: Colombia, Manufactura, Textiles..."
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <FieldLabel className="block leading-none">Grupo padre <span className="text-xs text-muted-foreground">(opcional)</span></FieldLabel>
            <Select value={parentId || undefined} onValueChange={v => setParentId(v ?? '')}>
              <SelectTrigger className="w-full" aria-label="Grupo padre">
                <SelectValue placeholder="Ninguno (grupo raíz)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>Ninguno (grupo raíz)</SelectItem>
                {validParents.map(g => (
                  <SelectItem key={g.id} value={g.id}>
                    {groupParentLabel(g)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {parentId && parentId !== NO_PARENT && (
              <FieldDescription>
                Nivel: {depthLabel((groups.find(g => g.id === parentId)?.depth ?? 0) + 1)}
              </FieldDescription>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </ModalShell>
    </div>
  );
}
