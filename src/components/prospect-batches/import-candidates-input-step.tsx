'use client';

// ── Importar candidatos — paso 1: configuración y datos ───────────────────────
// Solo pantalla: el estado y las validaciones viven en el drawer.

import { RefreshCw, Settings2, Table2 } from '@/icons';
import { DrawerSection } from '@/components/shared/drawer-section';
import { Field } from '@/components/forms/field';
import { Spinner } from '@/components/feedback/spinner';
import { OptionTile } from '@/components/selection/option-tile';
import { UploadZone } from '@/components/upload/UploadZone';
import { FilePreview } from '@/components/upload/FilePreview';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ImportCandidatesGuide } from './import-candidates-guide';
import { FILE_METHOD_OPTIONS, type FileMethod } from './import-candidates-helpers';

interface ImportCandidatesInputStepProps {
  // Catálogo de industrias
  catalogLoading: boolean;
  catalogError: string | null;
  onRetryCatalog: () => void;
  // Datos a importar
  fileMethod: FileMethod;
  onFileMethodChange: (method: FileMethod) => void;
  pasteText: string;
  onPasteTextChange: (text: string) => void;
  selectedFile: File | null;
  fileError: string | null;
  onFileSelected: (file: File) => void;
  onFileRemoved: () => void;
  // Guía
  showGuide: boolean;
  onShowGuideChange: (open: boolean) => void;
}

export function ImportCandidatesInputStep({
  catalogLoading,
  catalogError,
  onRetryCatalog,
  fileMethod,
  onFileMethodChange,
  pasteText,
  onPasteTextChange,
  selectedFile,
  fileError,
  onFileSelected,
  onFileRemoved,
  showGuide,
  onShowGuideChange,
}: ImportCandidatesInputStepProps) {
  return (
    <div className="space-y-4">
      <DrawerSection title="Configuración de importación" icon={Settings2}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Dueña 13-11 — sin «País de referencia» ni «Industria por defecto». */}
          <div className="min-w-0 rounded-xl bg-surface-muted p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">País e industria</p>
            <p className="mt-1">
              Se toman de cada fila del archivo. Si falta el país, lo detectamos (por la web o con IA) antes de la vista
              previa; si falta la industria, la IA la asigna después de importar.
            </p>
            {catalogLoading && (
              <p role="status" className="mt-2 flex items-center gap-2">
                <Spinner decorative size="sm" /> Cargando catálogo…
              </p>
            )}
            {catalogError && (
              <span className="mt-2 flex flex-wrap items-center gap-x-2 text-destructive">
                No pudimos cargar el catálogo.
                <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={onRetryCatalog}>
                  <RefreshCw className="h-3 w-3" />
                  Reintentar
                </Button>
              </span>
            )}
          </div>
        </div>
      </DrawerSection>

      <DrawerSection
        title="Datos a importar"
        icon={Table2}
        hint="Pega una tabla, una lista o un texto, o sube un archivo."
        contentClassName="space-y-4"
      >
        {/* Selector de método */}
        <div role="radiogroup" aria-label="Método de carga" className="grid grid-cols-2 gap-2">
          {FILE_METHOD_OPTIONS.map((option) => (
            <OptionTile
              key={option.value}
              option={option}
              compact
              selected={fileMethod === option.value}
              onSelect={(value) => onFileMethodChange(value as FileMethod)}
            />
          ))}
        </div>

        {/* Input: pegar tabla */}
        {fileMethod === 'paste' && (
          <Field
            label="Pega empresas en cualquier formato"
            description="Una tabla de Google Sheets, Excel o Gemini (con o sin encabezados), una lista con una empresa por línea, o un texto que las mencione: SellUp reconoce las empresas y sus datos. Si no traen país o industria, se usan los valores seleccionados arriba; lo demás se completa al importar."
          >
            <Textarea
              id="import-paste-text"
              placeholder={`Empresa\tPaís\tSector\tSitio web\nAcme Learning Chile\tChile\tEducación\thttps://acme.cl`}
              className="min-h-44 resize-none font-mono text-xs"
              value={pasteText}
              onChange={(e) => onPasteTextChange(e.target.value)}
            />
          </Field>
        )}

        {/* Input: subir archivo — arrastrar y soltar, o clic para elegir */}
        {fileMethod === 'file' &&
          (selectedFile ? (
            <div className="space-y-2">
              <p className="text-sm font-medium leading-none text-foreground">Archivo elegido</p>
              <FilePreview file={selectedFile} variant="row" removable onRemove={onFileRemoved} />
              <p className="text-xs text-muted-foreground">
                Para usar otro archivo, quita este y elige el nuevo.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <UploadZone
                label="Sube un archivo CSV, Excel (.xlsx) o de texto (.txt)"
                idleText="Arrastra el archivo aquí o haz clic para elegirlo"
                activeText="Suelta el archivo aquí…"
                description="Archivos .csv, .xlsx o .txt · máx. 2 MB · 500 filas"
                error={fileError ?? undefined}
                onChange={(files) => {
                  if (files[0]) onFileSelected(files[0]);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Las columnas se reconocen por su encabezado o por su contenido. Los archivos .xlsm no son soportados.
              </p>
            </div>
          ))}
      </DrawerSection>

      <ImportCandidatesGuide open={showGuide} onOpenChange={onShowGuideChange} />

      <Alert variant="info">
        <AlertDescription className="text-xs">
          Con el formato oficial (ver la guía) la lectura es exacta. Fuera de él, SellUp detecta las empresas por su contenido y, si es texto corrido, las lee con IA.
        </AlertDescription>
      </Alert>
    </div>
  );
}
