'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { LayoutList, GitBranch, Layers } from "@/icons";
import { SegmentedControl } from '@/components/selection/segmented-control';

interface ActiveUsersPanelProps {
  userCount: number;
  listContent: ReactNode;
  orgContent: ReactNode;
  groupsContent: ReactNode;
}

type View = 'list' | 'org' | 'groups';

const VIEW_OPTIONS = [
  { value: 'list', label: 'Lista', icon: LayoutList },
  { value: 'org', label: 'Organigrama', icon: GitBranch },
  { value: 'groups', label: 'Grupos', icon: Layers },
];

export function ActiveUsersPanel({ userCount, listContent, orgContent, groupsContent }: ActiveUsersPanelProps) {
  const [view, setView] = useState<View>('list');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {userCount} {userCount === 1 ? 'usuario activo' : 'usuarios activos'}
        </span>

        <SegmentedControl
          size="sm"
          ariaLabel="Vista de usuarios activos"
          className="w-fit"
          options={VIEW_OPTIONS}
          value={view}
          onChange={(next) => setView(next as View)}
        />
      </div>

      {view === 'list'   && listContent}
      {view === 'org'    && orgContent}
      {view === 'groups' && groupsContent}
    </div>
  );
}
