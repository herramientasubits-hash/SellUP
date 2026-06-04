/**
 * Tarjeta de acceso para login.
 * Contiene título, descripción, badge de entorno y zona de autenticación.
 */

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface LoginAccessCardProps {
  children: ReactNode;
  errorMessage?: string | null;
}

function AlertCircleIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      className="mt-0.5 shrink-0"
      aria-hidden="true"
    >
      <circle cx="7.5" cy="7.5" r="6.5" stroke="currentColor" strokeWidth="1.3" />
      <line
        x1="7.5"
        y1="4.5"
        x2="7.5"
        y2="8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="7.5" cy="10.5" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function LoginAccessCard({ children, errorMessage }: LoginAccessCardProps) {
  return (
    <div className="w-full max-w-[440px] animate-su-fade-in">
      {/* Logo visible solo en mobile */}
      <div className="mb-8 flex items-center justify-center lg:hidden">
        <h1 className="text-3xl font-extrabold tracking-tight">
          <span className="text-foreground">Sell</span>
          <span className="su-gradient-text">Up</span>
        </h1>
      </div>

      <Card className="border-border/40 shadow-xl shadow-black/[0.06]">
        <CardContent className="space-y-7 px-7 py-7">
          {/* Encabezado */}
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">
              Bienvenido a SellUp
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Ingresa con tu cuenta corporativa para continuar.
            </p>
          </div>

          {/* Badge de entorno */}
          <Badge variant="outline" className="gap-1.5 py-1.5 text-xs font-medium border-su-success/20 bg-su-success/5 text-su-success">
            <span className="h-1.5 w-1.5 rounded-full bg-su-success animate-su-pulse" />
            Acceso interno UBITS
          </Badge>

          {/* Mensaje de error */}
          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
            >
              <AlertCircleIcon />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Acción de autenticación */}
          {children}

          <Separator className="bg-border/40" />

          {/* Nota de seguridad */}
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground/60">
            El acceso está destinado exclusivamente al equipo autorizado de
            operación comercial.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
