'use client';

import { useRef, useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Move, GitBranch } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SurfaceCard } from '@/components/shared/surface-card';
import { UserAvatar } from './user-avatar';
import type { InternalUser, Role } from '@/modules/access/types';

// ─── Tree building ────────────────────────────────────────────────────────────

interface OrgNode {
  user: InternalUser;
  children: OrgNode[];
}

function buildTree(users: InternalUser[]): OrgNode[] {
  const active = users.filter(u => u.access_status === 'active');
  const nodeMap = new Map<string, OrgNode>(active.map(u => [u.id, { user: u, children: [] }]));
  const roots: OrgNode[] = [];

  for (const node of nodeMap.values()) {
    const mid = node.user.manager_id;
    if (mid && nodeMap.has(mid)) {
      nodeMap.get(mid)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function getRoleName(roleKey: string | null, roles: Role[]): string {
  if (!roleKey) return 'Sin rol';
  return roles.find(r => r.key === roleKey)?.name ?? roleKey;
}

// ─── Node card ────────────────────────────────────────────────────────────────

function NodeCard({ user, roles }: { user: InternalUser; roles: Role[] }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <SurfaceCard noPadding className="flex w-44 flex-col items-center px-4 py-3">
        <UserAvatar name={user.full_name} email={user.email} size="xl" className="mb-2" />
        <p className="w-full break-words text-center text-sm font-medium leading-tight text-foreground">
          {user.full_name ?? user.email.split('@')[0]}
        </p>
        <p className="mt-0.5 w-full truncate text-center text-xs text-muted-foreground" title={user.email}>
          {user.email}
        </p>
        <Badge variant="brand" className="mt-2 max-w-full">
          <span className="truncate">{getRoleName(user.role_key, roles)}</span>
        </Badge>
      </SurfaceCard>
    </div>
  );
}

// ─── Tree node ────────────────────────────────────────────────────────────────

function TreeNode({ node, roles }: { node: OrgNode; roles: Role[] }) {
  const hasChildren = node.children.length > 0;

  return (
    <div className="flex flex-col items-center">
      <NodeCard user={node.user} roles={roles} />

      {hasChildren && <div className="h-6 w-px bg-border/60" />}

      {hasChildren && (
        <div className="flex flex-col items-center">
          {node.children.length > 1 && (
            <div className="relative flex w-full justify-center">
              <div className="mx-11 h-px flex-1 bg-border/60" />
            </div>
          )}
          <div className="flex items-start gap-8">
            {node.children.map(child => (
              <div key={child.user.id} className="flex flex-col items-center">
                <div className="h-6 w-px bg-border/60" />
                <TreeNode node={child} roles={roles} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Canvas with pan/zoom ─────────────────────────────────────────────────────

interface OrgChartProps {
  users: InternalUser[];
  roles: Role[];
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.0;
const SCALE_STEP = 0.15;

export function OrgChart({ users, roles }: OrgChartProps) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const roots = buildTree(users);
  const activeCount = users.filter(u => u.access_status === 'active').length;

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    setIsDragging(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setTranslate(t => ({ x: t.x + dx, y: t.y + dy }));
  }, [isDragging]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);
  const handleMouseLeave = useCallback(() => setIsDragging(false), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY / 600;
    setScale(s => clampScale(s + delta));
  }, []);

  const zoomIn  = () => setScale(s => clampScale(s + SCALE_STEP));
  const zoomOut = () => setScale(s => clampScale(s - SCALE_STEP));
  const reset   = () => { setScale(1); setTranslate({ x: 0, y: 0 }); };

  if (activeCount === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="El organigrama está vacío"
        description="Aparecerá cuando haya personas con acceso activo y su jefe directo asignado."
      />
    );
  }

  return (
    <SurfaceCard className="relative h-full min-h-[400px] select-none p-5">
      {/* Zoom controls */}
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={zoomIn}
          title="Acercar"
          aria-label="Acercar"
        >
          <ZoomIn />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={zoomOut}
          title="Alejar"
          aria-label="Alejar"
        >
          <ZoomOut />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={reset}
          title="Restablecer vista"
          aria-label="Restablecer vista"
        >
          <Maximize2 />
        </Button>
      </div>

      {/* Drag hint */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-border/60 bg-card/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
        <Move className="h-3 w-3" />
        Arrastra para navegar · Rueda para zoom
      </div>

      {/* Scale indicator */}
      <div className="absolute bottom-3 right-3 z-10 rounded-md border border-border/60 bg-card/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
        {Math.round(scale * 100)}%
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className={`h-full w-full overflow-hidden rounded-xl bg-surface-subtle ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      >
        <div
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            willChange: 'transform',
          }}
          className="flex min-w-max flex-col items-center gap-8 px-8 pt-8 pb-8"
        >
          {roots.length > 1 ? (
            <div className="flex items-start gap-16">
              {roots.map(root => <TreeNode key={root.user.id} node={root} roles={roles} />)}
            </div>
          ) : roots.length === 1 ? (
            <TreeNode node={roots[0]} roles={roles} />
          ) : null}
        </div>
      </div>
    </SurfaceCard>
  );
}
