'use client';

import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart2, BrainCircuit } from 'lucide-react';

interface ProvidersTabsProps {
  consumoContent: React.ReactNode;
  iaContent: React.ReactNode;
}

export function ProvidersTabs({ consumoContent, iaContent }: ProvidersTabsProps) {
  return (
    <Tabs defaultValue="consumo" className="space-y-6">
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

      <TabsContent value="consumo">
        {consumoContent}
      </TabsContent>

      <TabsContent value="ia">
        {iaContent}
      </TabsContent>
    </Tabs>
  );
}
