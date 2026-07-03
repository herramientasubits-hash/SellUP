'use client';

import React, { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart2, BrainCircuit } from 'lucide-react';

type ProvidersTab = 'consumo' | 'ia';

function resolveTab(raw: string | null): ProvidersTab {
  if (raw === 'ia') return 'ia';
  return 'consumo';
}

interface ProvidersTabsProps {
  consumoContent: React.ReactNode;
  iaContent: React.ReactNode;
  defaultTab?: string | null;
}

export function ProvidersTabs({ consumoContent, iaContent, defaultTab }: ProvidersTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = resolveTab(searchParams.get('tab') ?? defaultTab ?? null);

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === 'consumo') {
        params.delete('tab');
      } else {
        params.set('tab', value);
      }
      const query = params.toString();
      router.replace(query ? `/settings/providers?${query}` : '/settings/providers', {
        scroll: false,
      });
    },
    [router, searchParams],
  );

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
      <TabsList className="bg-muted/50">
        <TabsTrigger value="consumo" className="gap-2">
          <BarChart2 className="h-4 w-4" />
          Consumo y presupuestos
        </TabsTrigger>
        <TabsTrigger value="ia" className="gap-2">
          <BrainCircuit className="h-4 w-4" />
          Configuración IA
        </TabsTrigger>
      </TabsList>

      <TabsContent value="consumo">{consumoContent}</TabsContent>

      <TabsContent value="ia">{iaContent}</TabsContent>
    </Tabs>
  );
}
