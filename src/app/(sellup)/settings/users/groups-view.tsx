'use client';

import { useMemo } from 'react';
import { Users, Folder, FolderOpen, ChevronRight } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { InternalUser, OrganizationGroup, Role } from '@/modules/access/types';
import { buildOrgGroupForest, type OrgGroupNode } from '@/modules/access/group-tree';

interface GroupsViewProps {
  users: InternalUser[];
  groups: OrganizationGroup[];
  roles: Role[];
}

interface GroupNode {
  group: OrganizationGroup;
  children: GroupNode[];
  members: InternalUser[];
}

// Shares the hierarchy ordering with the /ai-usage Grupo filter via
// buildOrgGroupForest (roots + children sorted by name per level). Members are
// attached on top of that shared structure so both surfaces nest identically.
function buildGroupTree(groups: OrganizationGroup[], users: InternalUser[]): GroupNode[] {
  const membersByGroup = new Map<string, InternalUser[]>();
  for (const user of users) {
    if (!user.group_id) continue;
    const arr = membersByGroup.get(user.group_id) ?? [];
    arr.push(user);
    membersByGroup.set(user.group_id, arr);
  }

  const attach = (node: OrgGroupNode<OrganizationGroup>): GroupNode => ({
    group: node.group,
    members: membersByGroup.get(node.group.id) ?? [],
    children: node.children.map(attach),
  });

  return buildOrgGroupForest(groups).map(attach);
}

function getInitials(name: string | null, email: string): string {
  if (name) return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function getRoleName(roleKey: string | null, roles: Role[]): string {
  if (!roleKey) return 'Sin rol';
  return roles.find(r => r.key === roleKey)?.name ?? roleKey;
}

interface MemberChipProps {
  user: InternalUser;
  roles: Role[];
}

function MemberChip({ user, roles }: MemberChipProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-card px-3 py-2">
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className="bg-su-brand-soft text-su-brand text-[10px]">
          {getInitials(user.full_name, user.email)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground leading-tight">
          {user.full_name ?? user.email.split('@')[0]}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {getRoleName(user.role_key, roles)}
        </p>
      </div>
    </div>
  );
}

interface GroupNodeCardProps {
  node: GroupNode;
  roles: Role[];
  depth?: number;
}

function GroupNodeCard({ node, roles, depth = 0 }: GroupNodeCardProps) {
  const hasMembers = node.members.length > 0;
  const hasChildren = node.children.length > 0;
  const totalDescendants = countMembers(node);

  const depthStyles = [
    'border-border/60',
    'border-border/40 ml-4',
    'border-border/30 ml-8',
  ];

  return (
    <div className={`rounded-xl border bg-card ${depthStyles[depth] ?? depthStyles[2]}`}>
      {/* Group header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
        {hasChildren ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-su-brand" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-foreground">{node.group.name}</span>
          {node.group.description && (
            <span className="ml-2 text-xs text-muted-foreground">{node.group.description}</span>
          )}
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground border-border/60">
          <Users className="mr-1 h-3 w-3" />
          {totalDescendants}
        </Badge>
      </div>

      {/* Members grid */}
      {hasMembers && (
        <div className="px-4 py-3">
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {node.members.map(u => (
              <MemberChip key={u.id} user={u} roles={roles} />
            ))}
          </div>
        </div>
      )}

      {!hasMembers && !hasChildren && (
        <div className="px-4 py-4 text-center text-xs text-muted-foreground">
          Sin usuarios asignados
        </div>
      )}

      {/* Subgroups */}
      {hasChildren && (
        <div className="px-4 pb-4 space-y-3 pt-2">
          {node.children.map(child => (
            <div key={child.group.id} className="flex gap-2">
              <div className="flex flex-col items-center mt-2">
                <ChevronRight className="h-3.5 w-3.5 text-border shrink-0" />
              </div>
              <div className="flex-1">
                <GroupNodeCard node={child} roles={roles} depth={Math.min(depth + 1, 2)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function countMembers(node: GroupNode): number {
  return node.members.length + node.children.reduce((acc, c) => acc + countMembers(c), 0);
}

export function GroupsView({ users, groups, roles }: GroupsViewProps) {
  const activeUsers = useMemo(() => users.filter(u => u.access_status === 'active'), [users]);
  const tree = useMemo(() => buildGroupTree(groups, activeUsers), [groups, activeUsers]);
  const ungrouped = useMemo(() => activeUsers.filter(u => !u.group_id), [activeUsers]);

  if (groups.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <Folder className="mx-auto mb-3 h-8 w-8 opacity-30" />
        <p className="text-sm">No hay grupos organizacionales creados.</p>
        <p className="text-xs mt-1 opacity-70">Usa &quot;Gestionar grupos&quot; para crear la estructura.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tree.map(root => (
        <GroupNodeCard key={root.group.id} node={root} roles={roles} depth={0} />
      ))}

      {/* Ungrouped users */}
      {ungrouped.length > 0 && (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/20">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-muted-foreground">Sin grupo asignado</span>
            <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground border-border/50">
              {ungrouped.length}
            </Badge>
          </div>
          <div className="px-4 py-3 grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {ungrouped.map(u => (
              <MemberChip key={u.id} user={u} roles={roles} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
