'use client';

import { useRef, useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Move } from 'lucide-react';
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

function getInitials(name: string | null, email: string): string {
  if (name) return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function getRoleName(roleKey: string | null, roles: Role[]): string {
  if (!roleKey) return 'Sin rol';
  return roles.find(r => r.key === roleKey)?.name ?? roleKey;
}

// ─── Node card ────────────────────────────────────────────────────────────────

function NodeCard({ user, roles }: { user: InternalUser; roles: Role[] }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex flex-col items-center rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-sm transition-shadow hover:shadow-md w-44">
        <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-su-brand-soft text-sm font-semibold text-su-brand">
          {getInitials(user.full_name, user.email)}
        </div>
        <p className="text-center text-[13px] font-medium text-foreground leading-tight">
          {user.full_name ?? user.email.split('@')[0]}
        </p>
        <p className="mt-0.5 w-full truncate text-center text-[10px] text-muted-foreground">
          {user.email}
        </p>
        <span className="mt-2 inline-flex items-center rounded-full border border-su-brand/20 bg-su-brand-soft px-2 py-0.5 text-[10px] font-medium text-su-brand">
          {getRoleName(user.role_key, roles)}
        </span>
      </div>
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
              <div className="h-px bg-border/60" style={{ width: 'calc(100% - 88px)', marginLeft: '44px', marginRight: '44px' }} />
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
      <div className="py-16 text-center text-muted-foreground">
        No hay usuarios activos en el organigrama.
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[400px] select-none">
      {/* Zoom controls */}
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1">
        <button
          onClick={zoomIn}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground shadow-sm hover:text-foreground hover:border-border transition-colors"
          title="Acercar"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={zoomOut}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground shadow-sm hover:text-foreground hover:border-border transition-colors"
          title="Alejar"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={reset}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground shadow-sm hover:text-foreground hover:border-border transition-colors"
          title="Restablecer vista"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Drag hint */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-border/40 bg-card/80 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
        <Move className="h-3 w-3" />
        Arrastra para navegar · Rueda para zoom
      </div>

      {/* Scale indicator */}
      <div className="absolute bottom-3 right-3 z-10 rounded-md border border-border/40 bg-card/80 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
        {Math.round(scale * 100)}%
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className={`h-full w-full overflow-hidden rounded-xl border border-border/40 bg-muted/10 ${
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
    </div>
  );
}
