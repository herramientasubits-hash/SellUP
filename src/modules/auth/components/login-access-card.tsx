/**
 * Tarjeta de acceso para login.
 * Contiene título, descripción, badge de entorno y zona de autenticación.
 */

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { BrandMark } from '@/components/layout/app-sidebar';
import { AlertCircle } from '@/icons';

interface LoginAccessCardProps {
  children: ReactNode;
  errorMessage?: string | null;
}

export function LoginAccessCard({ children, errorMessage }: LoginAccessCardProps) {
  return (
    <div className="w-full max-w-[440px] animate-su-fade-in">
      {/* Logo visible solo en mobile */}
      <div className="mb-8 flex items-center justify-center lg:hidden">
        <BrandMark />
      </div>

      <Card className="rounded-2xl border-border/60 shadow-card">
        <CardContent className="space-y-7 px-7 py-7">
          {/* Encabezado */}
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Bienvenido a SellUp
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Ingresa con tu cuenta corporativa para continuar.
            </p>
          </div>

          {/* Badge de entorno */}
          <Badge variant="positive" className="gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-su-pulse" aria-hidden="true" />
            Acceso interno UBITS
          </Badge>

          {/* Mensaje de error */}
          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Acción de autenticación */}
          {children}

          <Separator className="bg-border/50" />

          {/* Nota de seguridad */}
          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            El acceso está destinado exclusivamente al equipo autorizado de
            operación comercial.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
