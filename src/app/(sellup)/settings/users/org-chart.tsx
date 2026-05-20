'use client';

import type { InternalUser, Role } from '@/modules/access/types';

interface OrgNode {
  user: InternalUser;
  children: OrgNode[];
}

function buildTree(users: InternalUser[]): OrgNode[] {
  const active = users.filter((u) => u.access_status === 'active');
  const nodeMap = new Map<string, OrgNode>(
    active.map((u) => [u.id, { user: u, children: [] }])
  );
  const roots: OrgNode[] = [];

  for (const node of nodeMap.values()) {
    const managerId = node.user.manager_id;
    if (managerId && nodeMap.has(managerId)) {
      nodeMap.get(managerId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function getInitials(name: string | null, email: string): string {
  if (name) return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function getRoleName(roleKey: string | null, roles: Role[]): string {
  if (!roleKey) return 'Sin rol';
  return roles.find((r) => r.key === roleKey)?.name ?? roleKey;
}

interface NodeCardProps {
  user: InternalUser;
  roles: Role[];
}

function NodeCard({ user, roles }: NodeCardProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative flex flex-col items-center rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-sm transition-shadow hover:shadow-md w-44">
        <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-su-brand-soft text-sm font-semibold text-su-brand">
          {getInitials(user.full_name, user.email)}
        </div>
        <p className="text-center text-[13px] font-medium text-foreground leading-tight">
          {user.full_name ?? user.email.split('@')[0]}
        </p>
        <p className="mt-0.5 text-center text-[10px] text-muted-foreground truncate w-full text-center">
          {user.email}
        </p>
        <span className="mt-2 inline-flex items-center rounded-full border border-su-brand/20 bg-su-brand-soft px-2 py-0.5 text-[10px] font-medium text-su-brand">
          {getRoleName(user.role_key, roles)}
        </span>
      </div>
    </div>
  );
}

interface TreeNodeProps {
  node: OrgNode;
  roles: Role[];
}

function TreeNode({ node, roles }: TreeNodeProps) {
  const hasChildren = node.children.length > 0;

  return (
    <div className="flex flex-col items-center">
      {/* Card */}
      <NodeCard user={node.user} roles={roles} />

      {/* Connector down */}
      {hasChildren && (
        <div className="h-6 w-px bg-border/60" />
      )}

      {/* Children row */}
      {hasChildren && (
        <div className="flex flex-col items-center">
          {/* Horizontal bar spanning children */}
          {node.children.length > 1 && (
            <div className="relative flex w-full justify-center">
              <div
                className="h-px bg-border/60"
                style={{
                  width: `calc(100% - 88px)`,
                  marginLeft: '44px',
                  marginRight: '44px',
                }}
              />
            </div>
          )}
          <div className="flex items-start gap-8">
            {node.children.map((child) => (
              <div key={child.user.id} className="flex flex-col items-center">
                {/* Vertical connector from bar to child */}
                <div className="h-6 w-px bg-border/60" />
                <TreeNode
                  node={child}
                  roles={roles}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface OrgChartProps {
  users: InternalUser[];
  roles: Role[];
}

export function OrgChart({ users, roles }: OrgChartProps) {
  const roots = buildTree(users);
  const activeCount = users.filter((u) => u.access_status === 'active').length;

  if (activeCount === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        No hay usuarios activos en el organigrama.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex min-w-max flex-col items-center gap-8 px-8 pt-6">
        {roots.length > 1 ? (
          <div className="flex items-start gap-16">
            {roots.map((root) => (
              <TreeNode key={root.user.id} node={root} roles={roles} />
            ))}
          </div>
        ) : roots.length === 1 ? (
          <TreeNode node={roots[0]} roles={roles} />
        ) : null}
      </div>
    </div>
  );
}
