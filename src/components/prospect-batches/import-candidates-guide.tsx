'use client';

// ── Importar candidatos — guía del contrato oficial de columnas ───────────────

import { Info, Copy } from '@/icons';
import { toast } from 'sonner';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EXTERNAL_IMPORT_CONTRACT } from '@/modules/prospect-batches/import-candidates-parser';

interface ImportCandidatesGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function copyExample() {
  const headers = EXTERNAL_IMPORT_CONTRACT.map((c) => c.officialHeader).join('\t');
  const values = EXTERNAL_IMPORT_CONTRACT.map((c) => c.example).join('\t');
  navigator.clipboard.writeText(`${headers}\n${values}`);
  toast.success('Ejemplo copiado en formato TSV al portapapeles');
}

export function ImportCandidatesGuide({ open, onOpenChange }: ImportCandidatesGuideProps) {
  return (
    <Accordion value={open ? ['guide'] : []} onValueChange={(v) => onOpenChange(v.includes('guide'))}>
      <AccordionItem value="guide">
        <AccordionTrigger className="px-0 py-2 text-xs font-semibold text-foreground">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-primary" />
            Ver guía del contrato oficial de importación
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 pt-1">
          <p className="text-xs text-muted-foreground leading-relaxed">
            SellUp tiene un <strong>contrato oficial de columnas</strong> en español. Puedes copiar tablas desde Excel, Google Sheets, o directamente desde los chats con <strong>Claude, Gemini o ChatGPT</strong>. El parser resolverá automáticamente los siguientes campos:
          </p>

          <div className="max-h-56 overflow-auto rounded-xl border border-border/60">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Columna oficial</TableHead>
                  <TableHead className="text-center">Estado</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Ejemplo / Aliases</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {EXTERNAL_IMPORT_CONTRACT.map((col) => (
                  <TableRow key={col.field}>
                    <TableCell className="font-semibold text-foreground">
                      {col.officialHeader}
                    </TableCell>
                    <TableCell className="text-center">
                      {col.required ? (
                        <Badge variant="negative">Requerido</Badge>
                      ) : col.recommended ? (
                        <Badge variant="brand">Recomendado</Badge>
                      ) : (
                        <Badge variant="neutral">Opcional</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground leading-normal">
                      {col.description}
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground leading-normal">
                      <span className="italic block text-foreground mb-0.5">Ej: {col.example}</span>
                      <span className="block max-w-40 truncate text-xs text-muted-foreground" title={col.aliases.join(', ')}>
                        Aliases: {col.aliases.join(', ')}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Alert variant="info">
            <AlertTitle className="pr-28 text-xs">Ejemplo de tabla copiable</AlertTitle>
            <AlertAction className="top-2.5 right-2.5">
              <Button type="button" variant="ghost" size="xs" onClick={copyExample}>
                <Copy className="h-3 w-3" />
                Copiar ejemplo
              </Button>
            </AlertAction>
            <AlertDescription className="min-w-0 space-y-2 text-xs">
              <pre className="overflow-x-auto rounded-md border border-border/50 bg-card p-2 font-mono text-xs text-muted-foreground">
                {EXTERNAL_IMPORT_CONTRACT.map((c) => c.officialHeader).join('\t')}{'\n'}
                {EXTERNAL_IMPORT_CONTRACT.map((c) => c.example).join('\t')}
              </pre>
              <p className="leading-normal">
                Tip: Puedes copiar este ejemplo, pegarlo en Google Sheets o Excel, rellenar tus datos y luego copiar la tabla para pegarla en el campo superior. También puedes pegar directamente una tabla generada por Claude, Gemini o GPT. SellUp intentará reconocer las columnas e ignorar las filas separadoras o el texto introductorio, incluso si viene como tabla Markdown con pipes.
              </p>
            </AlertDescription>
          </Alert>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
