'use client';

import { useMemo, useState } from 'react';
import { Users, Folder, FolderOpen, UserPlus } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListItem, ListItemGroup } from '@/components/data-display';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Heading } from '@/components/typography';
import type { InternalUser, OrganizationGroup, Role } from '@/modules/access/types';
import { buildOrgGroupForest, type OrgGroupNode } from '@/modules/access/group-tree';
import { AssignUsersToGroupDialog } from './assign-users-to-group-dialog';
import { UserAvatar } from './user-avatar';

interface GroupsViewProps {
  users: InternalUser[];
  groups: OrganizationGroup[];
  roles: Role[];
  isAdmin?: boolean;
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

function getRoleName(roleKey: string | null, roles: Role[]): string {
  if (!roleKey) return 'Sin rol';
  return roles.find(r => r.key === roleKey)?.name ?? roleKey;
}

interface MemberListProps {
  members: InternalUser[];
  roles: Role[];
  label: string;
}

/** Las personas de un grupo, cada una en su fila: nombre y rol. */
function MemberList({ members, roles, label }: MemberListProps) {
  return (
    <ListItemGroup aria-label={label} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {members.map(user => (
        <ListItem
          key={user.id}
          size="sm"
          leading={<UserAvatar name={user.full_name} email={user.email} size="sm" />}
          title={user.full_name ?? user.email.split('@')[0]}
          description={getRoleName(user.role_key, roles)}
        />
      ))}
    </ListItemGroup>
  );
}

interface GroupNodeProps {
  node: GroupNode;
  roles: Role[];
  allGroups: OrganizationGroup[];
  allActiveUsers: InternalUser[];
  isAdmin: boolean;
  /** Un subgrupo se pinta como sección dentro de la tarjeta de su grupo raíz. */
  isNested?: boolean;
}

function GroupNodeSection({ node, roles, allGroups, allActiveUsers, isAdmin, isNested = false }: GroupNodeProps) {
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const hasMembers = node.members.length > 0;
  const hasChildren = node.children.length > 0;
  const totalMembers = countMembers(node);
  const groupName = node.group.name || 'Grupo sin nombre';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {hasChildren ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <Heading level={6} as={isNested ? 'h4' : 'h3'} className="text-sm">
            {groupName}
          </Heading>
          {node.group.description && (
            <p className="text-xs text-muted-foreground">{node.group.description}</p>
          )}
        </div>
        <Badge variant="neutral" className="shrink-0 tabular-nums">
          <Users className="mr-1 h-3 w-3" aria-hidden="true" />
          {totalMembers} {totalMembers === 1 ? 'persona' : 'personas'}
        </Badge>
        {isAdmin && (
          <Button size="xs" variant="outline" onClick={() => setShowAssignDialog(true)}>
            <UserPlus />
            Agregar usuarios
          </Button>
        )}
      </div>

      {isAdmin && (
        <AssignUsersToGroupDialog
          group={node.group}
          allGroups={allGroups}
          activeUsers={allActiveUsers}
          open={showAssignDialog}
          onClose={() => setShowAssignDialog(false)}
        />
      )}

      {hasMembers && (
        <MemberList members={node.members} roles={roles} label={`Personas de ${groupName}`} />
      )}

      {!hasMembers && !hasChildren && (
        <p className="text-xs text-muted-foreground">
          {isAdmin
            ? 'Todavía no tiene personas. Usa «Agregar usuarios» para asignarlas.'
            : 'Todavía no tiene personas asignadas.'}
        </p>
      )}

      {/* Subgrupos: secciones sangradas, sin caja dentro de la caja. */}
      {hasChildren && (
        <div className="space-y-4 border-l border-border/60 pl-4">
          {node.children.map(child => (
            <GroupNodeSection
              key={child.group.id}
              node={child}
              roles={roles}
              allGroups={allGroups}
              allActiveUsers={allActiveUsers}
              isAdmin={isAdmin}
              isNested
            />
          ))}
        </div>
      )}
    </div>
  );
}

function countMembers(node: GroupNode): number {
  return node.members.length + node.children.reduce((acc, c) => acc + countMembers(c), 0);
}

export function GroupsView({ users, groups, roles, isAdmin = false }: GroupsViewProps) {
  const activeUsers = useMemo(() => users.filter(u => u.access_status === 'active'), [users]);
  const tree = useMemo(() => buildGroupTree(groups, activeUsers), [groups, activeUsers]);
  const ungrouped = useMemo(() => activeUsers.filter(u => !u.group_id), [activeUsers]);

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={Folder}
        title="Todavía no hay grupos"
        description="Crea el primero con «Agregar grupo» y después asígnale personas."
      />
    );
  }

  return (
    <div className="space-y-4">
      {tree.map(root => (
        <SurfaceCard key={root.group.id}>
          <GroupNodeSection
            node={root}
            roles={roles}
            allGroups={groups}
            allActiveUsers={activeUsers}
            isAdmin={isAdmin}
          />
        </SurfaceCard>
      ))}

      {/* Personas activas que todavía no están en ningún grupo */}
      {ungrouped.length > 0 && (
        <SurfaceCard className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <Heading level={6} as="h3" className="text-sm">
                Sin grupo asignado
              </Heading>
              <p className="text-xs text-muted-foreground">
                Personas activas que todavía no pertenecen a ningún grupo.
              </p>
            </div>
            <Badge variant="neutral" className="shrink-0 tabular-nums">
              {ungrouped.length} {ungrouped.length === 1 ? 'persona' : 'personas'}
            </Badge>
          </div>
          <MemberList members={ungrouped} roles={roles} label="Personas sin grupo asignado" />
        </SurfaceCard>
      )}
    </div>
  );
}
