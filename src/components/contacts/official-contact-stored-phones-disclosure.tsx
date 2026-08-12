'use client';

// «Ver más números» del contacto OFICIAL — disclosure de lo YA almacenado
// (AGENT2A-PHONE-REVEAL-4O-H4)
//
// ── QUÉ HACE Y QUÉ NO ──────────────────────────────────────────
//
// Abre lo que ya está guardado en la colección oficial del contacto. NO
// busca, NO revela, NO llama a ningún proveedor y NO gasta un crédito: la única
// cosa que ocurre al pulsar es un `SELECT` a través de
// `getOfficialContactStoredPhonesAction`. Este componente no importa el cliente de
// Apollo, ni el de Lusha, ni la acción de reveal, ni la del waterfall, ni nada de
// presupuesto, ni la aprobación, ni la edición manual, y un test estático falla si
// esas importaciones aparecen.
//
// Es deliberadamente distinto —en verbo y en aspecto— de cualquier futuro «Buscar
// más números», que sí costaría dinero y que este hito NO añade, ni siquiera
// deshabilitado: un botón gris con ese texto ya enseña que existe algo que gastar,
// y todavía no existe.
//
// ── REUSO ──────────────────────────────────────────────────────
//
// Misma semántica, misma interacción y mismo aspecto que el disclosure del
// candidato (4O-G): disclosure en sitio y no modal, carga perezosa al abrir, olvido
// al cerrar, `aria-expanded`/`aria-controls`, una fila por número con su tipo y sus
// fuentes. Las etiquetas de tipo y de fuente se importan de
// `phone-display-labels.ts` —el módulo neutral que 4O-G extrajo precisamente para
// que dos superficies roten igual el mismo hecho— así que no hay ninguna tabla
// duplicada que pueda divergir.
//
// ── POR QUÉ UN DISCLOSURE Y NO UN MODAL ────────────────────────
//
// El contenido son dos o tres líneas por número dentro de un drawer que ya está
// abierto. Un diálogo encima de un drawer roba el foco, tapa el contacto y hace que
// consultar un dato secundario se sienta como una operación. Se usa una sección
// expandible en el sitio, accesible por teclado, sin añadir ninguna dependencia.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
//
// Los números se piden CUANDO se abre, no antes: mientras el operador no lo pida,
// lo único que ha viajado al navegador es un entero. Al cerrar se olvidan, y al
// cambiar de contacto también, así que una supresión (DSAR) o una retirada por
// proveedor aplicadas después desaparecen en la siguiente apertura sin necesidad de
// tiempo real. No se imprime ningún número en consola.

import * as React from 'react';
import { ChevronDown, ChevronUp, Phone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  getOfficialContactStoredPhonesAction,
  type StoredOfficialPhonesResult,
} from '@/modules/contact-enrichment/official-contact-stored-phones-actions';
import type { StoredOfficialPhoneView } from '@/modules/contact-enrichment/official-contact-stored-phones-core';
import {
  resolvePhoneSourceLabel,
  resolvePhoneTypeLabel,
} from '@/components/contact-enrichment/phone-display-labels';
import {
  getOfficialStoredPhonesCtaLabel,
  getOfficialStoredPhonesHeading,
  OFFICIAL_STORED_PHONES_COLLAPSE_LABEL,
  OFFICIAL_STORED_PHONES_EMPTY_COPY,
  OFFICIAL_STORED_PHONES_ERROR_COPY,
  OFFICIAL_STORED_PHONES_LOADING_COPY,
  OFFICIAL_STORED_PHONES_SOURCE_SEPARATOR,
  OFFICIAL_STORED_PHONES_SOURCES_LABEL,
} from './official-contact-stored-phones-copy';

export interface OfficialContactStoredPhonesDisclosureProps {
  readonly contactId: string;
  /**
   * Cuántos números adicionales dice el servidor que hay. Llega ya resuelto por el
   * resumen; este componente no lo calcula ni lo adivina.
   */
  readonly additionalCount: number;
}

type LoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly phones: readonly StoredOfficialPhoneView[] }
  | { readonly kind: 'error' };

/** Una fila: número, tipo y —cuando la hay— su procedencia. */
function StoredOfficialPhoneRow({ phone }: { phone: StoredOfficialPhoneView }) {
  const typeLabel = resolvePhoneTypeLabel(phone.type);
  // Un mismo número observado por Apollo y por Lusha es UNA fila con DOS fuentes.
  // Se muestran las dos: elegir una inventaría una exclusividad que no existe.
  const sourceLabels = phone.sources
    .map((source) => resolvePhoneSourceLabel(source))
    .filter((label): label is string => typeof label === 'string');

  return (
    <li className="flex flex-col gap-1 py-2">
      <span className="inline-flex flex-wrap items-center gap-2">
        <a href={`tel:${phone.number}`} className="break-all text-sm text-foreground hover:underline">
          {phone.number}
        </a>
        <Badge className="border-0 bg-su-brand-soft text-su-brand text-[10px] font-semibold">
          {typeLabel}
        </Badge>
      </span>
      {sourceLabels.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wide text-muted-foreground/70">
            {OFFICIAL_STORED_PHONES_SOURCES_LABEL}:
          </span>{' '}
          <span className="text-foreground">
            {sourceLabels.join(OFFICIAL_STORED_PHONES_SOURCE_SEPARATOR)}
          </span>
        </p>
      )}
    </li>
  );
}

/**
 * Sección «Ver más números» del contacto oficial. Se renderiza SOLO cuando hay
 * extras: la decisión de si existe vive en el padre, que es quien tiene el conteo
 * del servidor.
 */
export function OfficialContactStoredPhonesDisclosure({
  contactId,
  additionalCount,
}: OfficialContactStoredPhonesDisclosureProps) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<LoadState>({ kind: 'idle' });
  const panelId = `official-stored-phones-${contactId}`;

  // Cambiar de contacto invalida por completo lo cargado. Se ajusta durante el
  // render —patrón ya usado en el drawer del candidato para adaptar estado a una
  // prop— para que los números del contacto anterior no lleguen a pintarse ni un
  // solo frame sobre el nuevo.
  const [ownerId, setOwnerId] = React.useState(contactId);
  if (ownerId !== contactId) {
    setOwnerId(contactId);
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
      let result: StoredOfficialPhonesResult;
      try {
        result = await getOfficialContactStoredPhonesAction({ contactId });
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
  }, [contactId, open]);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="h-auto gap-1.5 px-0 text-[11px] font-medium text-su-brand hover:bg-transparent hover:underline"
      >
        <Phone className="h-3 w-3" />
        {open
          ? OFFICIAL_STORED_PHONES_COLLAPSE_LABEL
          : getOfficialStoredPhonesCtaLabel(additionalCount)}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </Button>

      {open && (
        <div id={panelId} className="rounded-md border border-border/60 bg-muted/30 px-3 py-1">
          {state.kind === 'loading' && (
            <p className="py-2 text-[11px] text-muted-foreground">
              {OFFICIAL_STORED_PHONES_LOADING_COPY}
            </p>
          )}
          {state.kind === 'error' && (
            <p className="py-2 text-[11px] text-muted-foreground">
              {OFFICIAL_STORED_PHONES_ERROR_COPY}
            </p>
          )}
          {state.kind === 'loaded' && state.phones.length === 0 && (
            <p className="py-2 text-[11px] text-muted-foreground">
              {OFFICIAL_STORED_PHONES_EMPTY_COPY}
            </p>
          )}
          {state.kind === 'loaded' && state.phones.length > 0 && (
            <>
              <p className="pt-2 text-[11px] uppercase tracking-wide text-muted-foreground/70">
                {getOfficialStoredPhonesHeading(state.phones.length)}
              </p>
              <ul className="divide-y divide-border/50">
                {state.phones.map((phone) => (
                  <StoredOfficialPhoneRow key={phone.id} phone={phone} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
