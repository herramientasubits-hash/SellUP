'use client';

/**
 * config-pieces.tsx — piezas pequeñas de la pestaña «Config.»: el interruptor
 * de solo lectura y las notas plegables.
 */

import { Switch } from '@/components/ui/switch';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

export function ReadOnlyToggle({ label, checked, note }: { label: string; checked: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/50 py-2 last:border-0">
      <div className="min-w-0">
        <span className="text-xs text-foreground">{label}</span>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-xs text-text-muted">Solo lectura</span>
        <Switch checked={checked} disabled aria-label={label} className="cursor-not-allowed opacity-50" />
      </div>
    </div>
  );
}

export interface ConfigNote {
  id: string;
  label: string;
  body: string;
}

/** Notas de configuración: cada una se abre por separado, todas plegadas de entrada. */
export function ConfigNotes({ notes }: { notes: readonly ConfigNote[] }) {
  return (
    <Accordion>
      {notes.map((note) => (
        <AccordionItem key={note.id} value={note.id} className="border-border/50">
          <AccordionTrigger className="text-xs">{note.label}</AccordionTrigger>
          <AccordionContent className="text-xs leading-relaxed text-muted-foreground">
            {note.body}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
