'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { UserPlus, UserCheck, UserX, Pause, Clock, Layers } from 'lucide-react';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UsersTab, GroupsTab } from './users-groups-tabs';
import type { InternalUser, Role, UserPreapproval, OrganizationGroup } from '@/modules/access/types';

type UserFilter = 'all' | 'active' | 'pending' | 'preapproved' | 'suspended' | 'rejected';

interface UsersSettingsClientProps {
  users: InternalUser[];
  roles: Role[];
  activeUsers: InternalUser[];
  pendingUsers: InternalUser[];
  suspendedUsers: InternalUser[];
  rejectedUsers: InternalUser[];
  preapprovals: UserPreapproval[];
  groups: OrganizationGroup[];
  isAdmin: boolean;
}

const SUMMARY_CARDS: {
  key: UserFilter | 'groups';
  label: string;
  icon: React.ReactNode;
  colorClass: string;
}[] = [
  {
    key: 'pending',
    label: 'Pendientes',
    icon: <UserPlus className="h-4 w-4 text-amber-500" />,
    colorClass: 'bg-amber-500/10',
  },
  {
    key: 'preapproved',
    label: 'Preautorizados',
    icon: <Clock className="h-4 w-4 text-su-brand" />,
    colorClass: 'bg-su-brand-soft',
  },
  {
    key: 'active',
    label: 'Activos',
    icon: <UserCheck className="h-4 w-4 text-emerald-500" />,
    colorClass: 'bg-emerald-500/10',
  },
  {
    key: 'suspended',
    label: 'Suspendidos',
    icon: <Pause className="h-4 w-4 text-orange-500" />,
    colorClass: 'bg-orange-500/10',
  },
  {
    key: 'rejected',
    label: 'Rechazados',
    icon: <UserX className="h-4 w-4 text-destructive" />,
    colorClass: 'bg-destructive/10',
  },
  {
    key: 'groups',
    label: 'Grupos',
    icon: <Layers className="h-4 w-4 text-su-brand" />,
    colorClass: 'bg-su-brand-soft',
  },
];

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
  users, roles, activeUsers, pendingUsers, suspendedUsers, rejectedUsers,
  preapprovals, groups, isAdmin,
}: UsersSettingsClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeTab = searchParams.get('tab') ?? 'usuarios';
  const activeFilter = (searchParams.get('filter') as UserFilter) ?? 'active';

  const counts: Record<string, number> = {
    pending: pendingUsers.length,
    preapproved: preapprovals.length,
    active: activeUsers.length,
    suspended: suspendedUsers.length,
    rejected: rejectedUsers.length,
    groups: groups.length,
  };

  function navigate(tab: string, filter?: UserFilter) {
    router.push(buildUrl(searchParams, tab, filter));
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Summary cards */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 shrink-0">
        {SUMMARY_CARDS.map(card => (
          <SurfaceCard
            key={card.key}
            className="cursor-pointer transition-colors hover:border-su-brand/30"
            onClick={() => {
              if (card.key === 'groups') {
                router.push(buildUrl(searchParams, 'grupos'));
              } else {
                router.push(buildUrl(searchParams, 'usuarios', card.key as UserFilter));
              }
            }}
          >
            <div className="flex items-center gap-3">
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${card.colorClass}`}>
                {card.icon}
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground">{counts[card.key] ?? 0}</p>
                <p className="text-xs text-muted-foreground">{card.label}</p>
              </div>
            </div>
          </SurfaceCard>
        ))}
      </div>

      {/* Main tabs: Usuarios | Grupos */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => navigate(v, v === 'usuarios' ? activeFilter : undefined)}
        className="flex flex-col flex-1 min-h-0 mt-6"
      >
        <TabsList className="bg-muted/50 flex-wrap h-auto gap-1 shrink-0">
          <TabsTrigger value="usuarios" className="gap-2">
            <UserCheck className="h-4 w-4" />
            Usuarios
          </TabsTrigger>
          <TabsTrigger value="grupos" className="gap-2">
            <Layers className="h-4 w-4" />
            Grupos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="usuarios" className="flex-1 min-h-0 mt-2">
          <div className="h-full overflow-y-auto pr-1">
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
          </div>
        </TabsContent>

        <TabsContent value="grupos" className="flex-1 min-h-0 mt-2">
          <div className="h-full overflow-y-auto pr-1">
            <GroupsTab
              users={users}
              groups={groups}
              roles={roles}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}