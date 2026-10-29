/**
 * Tarjeta de acceso del login «Mínimo premium»: el logo, una frase, la zona de
 * autenticación y los tres pasos de SellUp. Sólo tokens del sistema: se ve bien
 * en claro y en oscuro sin excepciones editoriales.
 */

import type { ReactNode } from 'react';
import { BrandTile } from '@/components/layout/app-sidebar';
import { AlertCircle } from '@/icons';

interface LoginAccessCardProps {
  children: ReactNode;
  errorMessage?: string | null;
}

const PASOS = ['Empresas', 'Contactos', 'Primer contacto'] as const;

export function LoginAccessCard({ children, errorMessage }: LoginAccessCardProps) {
  return (
    <div className="relative grid w-full max-w-[420px] gap-8 animate-su-fade-in">
      <header className="grid justify-items-center gap-4 text-center">
        <BrandTile className="size-14 rounded-2xl text-2xl shadow-card" />
        <div className="grid gap-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">
            Sell<span className="text-primary">Up</span>
          </h1>
          <p className="text-sm text-muted-foreground">De la empresa correcta a la primera reunión.</p>
        </div>
      </header>

      <div className="grid gap-4 rounded-3xl border border-border/60 bg-card/80 p-7 shadow-card backdrop-blur-xl">
        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}
        {children}
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Sólo para el equipo comercial de UBITS, con tu correo corporativo.
        </p>
      </div>

      <ol className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground" aria-label="Los tres pasos de SellUp">
        {PASOS.map((paso, i) => (
          <li key={paso} className="rounded-full border border-border/70 bg-card/60 px-3 py-1 backdrop-blur">
            <span className="font-semibold text-primary">{i + 1}</span> · {paso}
          </li>
        ))}
      </ol>
    </div>
  );
}
