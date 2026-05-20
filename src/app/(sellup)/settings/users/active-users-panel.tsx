'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { LayoutList, GitBranch, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ActiveUsersPanelProps {
  userCount: number;
  listContent: ReactNode;
  orgContent: ReactNode;
  groupsContent: ReactNode;
}

type View = 'list' | 'org' | 'groups';

export function ActiveUsersPanel({ userCount, listContent, orgContent, groupsContent }: ActiveUsersPanelProps) {
  const [view, setView] = useState<View>('list');

  const tabs: { id: View; label: string; icon: ReactNode }[] = [
    { id: 'list',   label: 'Lista',       icon: <LayoutList className="h-3.5 w-3.5" /> },
    { id: 'org',    label: 'Organigrama', icon: <GitBranch  className="h-3.5 w-3.5" /> },
    { id: 'groups', label: 'Grupos',      icon: <Layers     className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {userCount} {userCount === 1 ? 'usuario activo' : 'usuarios activos'}
        </span>

        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 p-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                view === tab.id
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'list'   && listContent}
      {view === 'org'    && orgContent}
      {view === 'groups' && groupsContent}
    </div>
  );
}
