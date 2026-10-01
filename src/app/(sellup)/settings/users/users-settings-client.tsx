'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { UserCheck, Layers } from "@/icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UsersTab, GroupsTab } from './users-groups-tabs';
import type { InternalUser, Role, UserPreapproval, OrganizationGroup } from '@/modules/access/types';

type UserFilter = 'all' | 'active' | 'pending' | 'preapproved' | 'suspended' | 'rejected';

interface UsersSettingsClientProps {
  users: InternalUser[];
  roles: Role[];
  activeUsers: InternalUser[];
  preapprovals: UserPreapproval[];
  groups: OrganizationGroup[];
  isAdmin: boolean;
}

function buildUrl(searchParams: URLSearchParams, tab: string, filter?: UserFilter) {
  const params = new URLSearchParams(searchParams.toString());
  params.set('tab', tab);
  if (tab === 'usuarios' && filter) {
    params.set('filter', filter);
  } else {
    params.delete('filter');
  }
  return `/settings/users?${params.toString()}`;
}

export function UsersSettingsClient({
  users, roles, activeUsers, preapprovals, groups, isAdmin,
}: UsersSettingsClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeTab = searchParams.get('tab') ?? 'usuarios';
  const activeFilter = (searchParams.get('filter') as UserFilter) ?? 'active';

  function navigate(tab: string, filter?: UserFilter) {
    router.push(buildUrl(searchParams, tab, filter));
  }

  return (
    // Usuarios | Grupos. Los conteos por estado viven en la fila de chips de
    // la pestaña «Usuarios»; aquí solo se dice cuántos grupos hay.
    <Tabs
      value={activeTab}
      onValueChange={(v) => navigate(v, v === 'usuarios' ? activeFilter : undefined)}
      className="gap-4"
    >
      <TabsList aria-label="Usuarios o grupos" className="shrink-0">
        <TabsTrigger value="usuarios" className="gap-2">
          <UserCheck className="h-4 w-4" />
          Usuarios
        </TabsTrigger>
        <TabsTrigger value="grupos" className="gap-2">
          <Layers className="h-4 w-4" />
          Grupos
          {groups.length > 0 && (
            <span className="rounded-full bg-surface-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
              {groups.length}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="usuarios">
        <UsersTab
          users={users}
          roles={roles}
          allUsers={users}
          activeUsers={activeUsers}
          groups={groups}
          preapprovals={preapprovals}
          isAdmin={isAdmin}
          initialFilter={activeFilter}
          onFilterChange={(f) => navigate('usuarios', f)}
        />
      </TabsContent>

      <TabsContent value="grupos">
        <GroupsTab
          users={users}
          groups={groups}
          roles={roles}
          isAdmin={isAdmin}
        />
      </TabsContent>
    </Tabs>
  );
}
