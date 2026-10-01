'use client';

// ── Importar candidatos — paso 1: configuración y datos ───────────────────────
// Solo pantalla: el estado y las validaciones viven en el drawer.

import { RefreshCw, Settings2, Table2 } from '@/icons';
import { DrawerSection } from '@/components/shared/drawer-section';
import { Field } from '@/components/forms/field';
import { SearchableSelect, type SearchableSelectOption } from '@/components/forms/searchable-select';
import { Spinner } from '@/components/feedback/spinner';
import { OptionTile } from '@/components/selection/option-tile';
import { UploadZone } from '@/components/upload/UploadZone';
import { FilePreview } from '@/components/upload/FilePreview';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LATAM_COUNTRIES } from '@/modules/accounts/types';
import { getFlagEmoji } from '@/components/accounts/account-form-helpers';
import { ImportCandidatesGuide } from './import-candidates-guide';
import { FILE_METHOD_OPTIONS, type FileMethod } from './import-candidates-helpers';

interface ImportCandidatesInputStepProps {
  // Valores por defecto del lote
  countryCode: string;
  onCountryChange: (value: string | null) => void;
  industryId: string;
  onIndustryChange: (value: string) => void;
  industryOptions: SearchableSelectOption[];
  subindustriesEnabled: boolean;
  subindustryId: string;
  onSubindustryChange: (value: string) => void;
  subindustryOptions: SearchableSelectOption[];
  subindustryCountryWarning: boolean;
  // Catálogo de industrias
  catalogReady: boolean;
  catalogEmpty: boolean;
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
  countryCode,
  onCountryChange,
  industryId,
  onIndustryChange,
  industryOptions,
  subindustriesEnabled,
  subindustryId,
  onSubindustryChange,
  subindustryOptions,
  subindustryCountryWarning,
  catalogReady,
  catalogEmpty,
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
          <Field
            label="País de referencia"
            required
            description="Se usará en filas que no incluyan país."
            className="min-w-0"
          >
            <Select value={countryCode} onValueChange={onCountryChange}>
              <SelectTrigger className="!w-full">
                <SelectValue placeholder="País" />
              </SelectTrigger>
              <SelectContent className="!w-auto !min-w-[200px]">
                {LATAM_COUNTRIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {getFlagEmoji(c.code)} {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Industria por defecto"
            description="Se usará únicamente en filas que no incluyan industria."
            className="min-w-0"
          >
            {catalogLoading ? (
              <div role="status" className="flex h-10 items-center gap-2">
                <Spinner decorative size="sm" />
                <span className="text-xs text-muted-foreground">Cargando catálogo…</span>
              </div>
            ) : catalogError ? (
              <Alert variant="destructive" className="p-3">
                <AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span>No pudimos cargar el catálogo.</span>
                  <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={onRetryCatalog}>
                    <RefreshCw className="h-3 w-3" />
                    Reintentar
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <SearchableSelect
                options={industryOptions}
                value={industryId}
                onValueChange={onIndustryChange}
                placeholder={catalogEmpty ? 'No hay un catálogo publicado disponible.' : 'Industria'}
                searchPlaceholder="Buscar industria…"
                emptyMessage="No se encontraron industrias."
                disabled={!catalogReady || catalogEmpty}
              />
            )}
          </Field>

          {/* Subindustria por defecto — sólo si el catálogo publica subindustrias */}
          {subindustriesEnabled && (
            <Field
              label="Subindustria por defecto (opcional)"
              description="Opcional. Se usará únicamente en filas que no incluyan subindustria."
              className="min-w-0 sm:col-span-2"
            >
              <div className="space-y-1.5">
                {subindustryCountryWarning && (
                  <p role="status" className="text-xs font-medium text-warning">
                    La subindustria seleccionada no está disponible para el nuevo país y fue eliminada.
                  </p>
                )}
                <SearchableSelect
                  options={subindustryOptions}
                  value={subindustryId}
                  onValueChange={onSubindustryChange}
                  placeholder="Sin subindustria por defecto"
                  searchPlaceholder="Buscar subindustria…"
                  emptyMessage="Selecciona un país e industria primero."
                  disabled={!catalogReady || !industryId || !countryCode || catalogLoading || !!catalogError}
                />
              </div>
            </Field>
          )}
        </div>
      </DrawerSection>

      <DrawerSection
        title="Datos a importar"
        icon={Table2}
        hint="Pega una tabla o sube un archivo."
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
            label="Pega el contenido copiado desde Google Sheets o Excel"
            description="Acepta separadores tab, coma, punto y coma o tablas Markdown (incluso si vienen con texto explicativo alrededor). La primera fila válida será interpretada como encabezados. Si el archivo no trae país o industria, SellUp usará los valores seleccionados arriba."
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
                label="Sube un archivo CSV o Excel (.xlsx)"
                idleText="Arrastra el archivo aquí o haz clic para elegirlo"
                activeText="Suelta el archivo aquí…"
                description="Archivos .csv o .xlsx · máx. 2 MB · 500 filas"
                error={fileError ?? undefined}
                onChange={(files) => {
                  if (files[0]) onFileSelected(files[0]);
                }}
              />
              <p className="text-xs text-muted-foreground">
                La primera fila debe contener los encabezados. Los archivos .xlsm no son soportados.
              </p>
            </div>
          ))}
      </DrawerSection>

      <ImportCandidatesGuide open={showGuide} onOpenChange={onShowGuideChange} />

      <Alert variant="info">
        <AlertDescription className="text-xs">
          Puedes copiar desde Google Sheets/Excel o subir un archivo CSV/XLSX.
        </AlertDescription>
      </Alert>
    </div>
  );
}
