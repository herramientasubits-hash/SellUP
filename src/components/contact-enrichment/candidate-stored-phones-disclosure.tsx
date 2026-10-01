'use client';

// «Ver más números» — disclosure de los teléfonos YA almacenados
// (AGENT2A-PHONE-REVEAL-4O-G)
//
// ── QUÉ HACE Y QUÉ NO ──────────────────────────────────────────
//
// Abre lo que ya está guardado. NO busca, NO revela, NO llama a ningún proveedor
// y NO gasta un crédito: la única cosa que ocurre al pulsar es un `SELECT` a
// través de `getCandidateStoredPhonesAction`. Este componente no importa el
// cliente de Apollo, ni el de Lusha, ni la acción de reveal, ni la del waterfall,
// ni nada de presupuesto, y un test estático falla si esas importaciones
// aparecen.
//
// Es deliberadamente distinto —en verbo y en aspecto— de cualquier futuro «Buscar
// más números», que sí costaría dinero y que este hito NO añade, ni siquiera
// deshabilitado: un botón gris con ese texto ya enseña que existe algo que gastar,
// y todavía no existe.
//
// ── POR QUÉ UN DISCLOSURE Y NO UN MODAL ────────────────────────
//
// El contenido son dos o tres líneas por número dentro de un drawer que ya está
// abierto. Un diálogo encima de un drawer roba el foco, tapa el candidato y hace
// que consultar un dato secundario se sienta como una operación. Se usa una
// sección expandible en el sitio, con `aria-expanded`/`aria-controls`, que es
// accesible por teclado sin añadir ninguna dependencia nueva.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
//
// Los números se piden CUANDO se abre, no antes: mientras el operador no lo pida,
// lo único que ha viajado al navegador es un entero. Al cerrar se olvidan, y al
// cambiar de candidato también, así que una supresión (DSAR) aplicada después
// desaparece en la siguiente apertura sin necesidad de tiempo real. No se imprime
// ningún número en consola.

import * as React from 'react';
import { ChevronDown, ChevronUp, Phone } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  getCandidateStoredPhonesAction,
  type StoredCandidatePhonesResult,
} from '@/modules/contact-enrichment/candidate-stored-phones-actions';
import type { StoredCandidatePhoneView } from '@/modules/contact-enrichment/candidate-stored-phones-core';
import { resolvePhoneSourceLabel, resolvePhoneTypeLabel } from './phone-display-labels';
import {
  getStoredPhonesCtaLabel,
  getStoredPhonesHeading,
  STORED_PHONES_COLLAPSE_LABEL,
  STORED_PHONES_EMPTY_COPY,
  STORED_PHONES_ERROR_COPY,
  STORED_PHONES_LOADING_COPY,
  STORED_PHONES_SOURCE_SEPARATOR,
  STORED_PHONES_SOURCES_LABEL,
} from './candidate-stored-phones-copy';

export interface CandidateStoredPhonesDisclosureProps {
  readonly candidateId: string;
  /**
   * Cuántos números adicionales dice el servidor que hay. Llega ya resuelto por
   * el resumen; este componente no lo calcula ni lo adivina.
   */
  readonly additionalCount: number;
}

type LoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly phones: readonly StoredCandidatePhoneView[] }
  | { readonly kind: 'error' };

/** Una fila: número, tipo y —cuando la hay— su procedencia. */
function StoredPhoneRow({ phone }: { phone: StoredCandidatePhoneView }) {
  const typeLabel = resolvePhoneTypeLabel(phone.type);
  // Un mismo número observado por Apollo y por Lusha es UNA fila con DOS fuentes.
  // Se muestran las dos: elegir una inventaría una exclusividad que no existe.
  const sourceLabels = phone.sources
    .map((source) => resolvePhoneSourceLabel(source))
    .filter((label): label is string => typeof label === 'string');

  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-lg border border-border/60 bg-surface-subtle px-3 py-2">
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="break-all text-sm font-medium tabular-nums text-foreground">{phone.number}</span>
        <Badge variant="brand">{typeLabel}</Badge>
      </span>
      {sourceLabels.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="text-muted-foreground">
            {STORED_PHONES_SOURCES_LABEL}:
          </span>{' '}
          <span className="text-foreground">
            {sourceLabels.join(STORED_PHONES_SOURCE_SEPARATOR)}
          </span>
        </p>
      )}
    </li>
  );
}

/**
 * Sección «Ver más números». Se renderiza SOLO cuando hay extras: la decisión de
 * si existe vive en el padre, que es quien tiene el conteo del servidor.
 */
export function CandidateStoredPhonesDisclosure({
  candidateId,
  additionalCount,
}: CandidateStoredPhonesDisclosureProps) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<LoadState>({ kind: 'idle' });
  const panelId = `stored-phones-${candidateId}`;

  // Cambiar de candidato invalida por completo lo cargado. Se ajusta durante el
  // render —patrón ya usado en el drawer para adaptar estado a una prop— para que
  // los números del candidato anterior no lleguen a pintarse ni un solo frame
  // sobre el nuevo.
  const [ownerId, setOwnerId] = React.useState(candidateId);
  if (ownerId !== candidateId) {
    setOwnerId(candidateId);
    setOpen(false);
    setState({ kind: 'idle' });
  }

  const handleToggle = React.useCallback(() => {
    if (open) {
      // Cerrar OLVIDA lo leído. Así la próxima apertura vuelve a preguntar y una
      // supresión aplicada mientras tanto surte efecto sin tiempo real.
      setOpen(false);
      setState({ kind: 'idle' });
      return;
    }

    setOpen(true);
    setState({ kind: 'loading' });
    void (async () => {
      let result: StoredCandidatePhonesResult;
      try {
        result = await getCandidateStoredPhonesAction({ candidateId });
      } catch {
        // Un fallo de LECTURA se queda en un fallo de lectura: no hay reintento
        // automático y, sobre todo, no hay camino alterno hacia un proveedor.
        setState({ kind: 'error' });
        return;
      }
      if (result.status !== 'ok') {
        setState({ kind: 'error' });
        return;
      }
      setState({ kind: 'loaded', phones: result.phones });
    })();
  }, [candidateId, open]);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={handleToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="-ml-2 gap-1.5 text-primary"
      >
        <Phone className="h-3 w-3" />
        {open ? STORED_PHONES_COLLAPSE_LABEL : getStoredPhonesCtaLabel(additionalCount)}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </Button>

      {open && (
        <div id={panelId} className="space-y-1.5">
          {state.kind === 'loading' && (
            <p className="rounded-lg border border-border/60 bg-surface-subtle px-3 py-2 text-xs text-muted-foreground">
              {STORED_PHONES_LOADING_COPY}
            </p>
          )}
          {state.kind === 'error' && (
            <p className="rounded-lg border border-border/60 bg-surface-subtle px-3 py-2 text-xs text-muted-foreground">
              {STORED_PHONES_ERROR_COPY}
            </p>
          )}
          {state.kind === 'loaded' && state.phones.length === 0 && (
            <p className="rounded-lg border border-border/60 bg-surface-subtle px-3 py-2 text-xs text-muted-foreground">
              {STORED_PHONES_EMPTY_COPY}
            </p>
          )}
          {state.kind === 'loaded' && state.phones.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                {getStoredPhonesHeading(state.phones.length)}
              </p>
              <ul className="space-y-1.5">
                {state.phones.map((phone) => (
                  <StoredPhoneRow key={phone.id} phone={phone} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
