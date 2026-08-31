// BR-SOURCE FUNCTIONAL CUT E — el EXTRACTOR ACOTADO de la muestra REAL de Receita.
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ ESTE MÓDULO EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// Los cortes A→D se probaron con CNPJ sintéticos y DV-válidos por construcción, que es lo correcto
// para decidir CONTRATOS y lo insuficiente para decidir COBERTURA. Tres afirmaciones de la cadena
// no se pueden comprobar con datos inventados:
//
//   · que `normalizeBrCompanyLegalName` aplicada a una razão social REAL produzca el mismo valor
//     que el writer persiste — los nombres sintéticos no tienen acentos, ni `M.DIAS`, ni `S/A`,
//     ni los dobles espacios que Receita sí publica;
//   · que un nombre real resuelva a UN establecimiento con la frecuencia que haga útil el CUT C —
//     matriz y filial comparten razão social por construcción legal, y sólo los datos reales dicen
//     cuántas veces eso ocurre;
//   · que el municipio real desempate — la ciudad sólo ayuda si las sucursales están en ciudades
//     distintas, y eso también es un hecho de los datos, no del diseño.
//
// ── 🔴 ESTO NO ES UN BARRIDO NACIONAL ───────────────────────────────────────
//
// No es el benchmark Gate-2, no es el intento #3, no consume una autorización y no toca el ledger
// de intentos. Es una lectura ACOTADA por DOS topes independientes y explícitos —bytes leídos y
// filas aceptadas— que se declaran en la entrada y se REPORTAN en la salida, de modo que un
// barrido completo escondido detrás de un resumen pequeño sea imposible de escribir aquí: los
// contadores son parte del valor de retorno, no un `console.log` opcional.
//
// ── Cómo se hace el join sin leer la nación ─────────────────────────────────
//
// El problema real: el prefijo de ESTABELECIMENTOS y el prefijo de EMPRESAS NO se solapan (un
// dry-run previo del repositorio midió 0/20 de cobertura de join haciendo exactamente eso). La
// salida no es leer más, es leer DIRIGIDO:
//
//   1. Los diez ficheros EMPRESAS están ORDENADOS por `cnpj_basico` y PARTICIONAN el espacio de
//      claves en rangos contiguos y DISJUNTOS. Se comprueba en tiempo de ejecución
//      (`probeCompanyPartRanges`) en lugar de suponerse.
//   2. Por tanto, para un conjunto de `cnpj_basico` conocido, el fichero que lo contiene está
//      determinado y su posición dentro del fichero se alcanza por BÚSQUEDA BINARIA sobre
//      desplazamientos de byte.
//   3. Se lee entonces UNA ventana por rango contiguo pedido, no el fichero.
//
// El resultado es un join REAL con un coste de lectura proporcional a la muestra, no al país.
//
// ── 🔴 Privacidad ──────────────────────────────────────────────────────────
//
// Este módulo DEVUELVE razões sociais y CNPJ porque su consumidor los necesita para construir la
// publicación local. No IMPRIME nada: no hay un `console.log`, ni un `process.stdout.write`, ni un
// throw que incruste un valor de fila. Los ficheros de contacto y de dirección fina de Receita se
// descartan en el propio parser posicional — nunca entran en memoria como campo con nombre.
//
// NO es código de producción: vive bajo `__tests__/support`, nadie lo importa desde `src` fuera de
// las pruebas, no lee un flag, no crea un cliente de Supabase, no llama a un proveedor y no toca
// Producción ni ninguna base remota.

import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { buildBrReceitaCnpjSnapshotRows } from '../../br-receita-cnpj-snapshot-builder';
import type {
  BrReceitaEmpresaRow,
  BrReceitaEstabelecimentoRow,
  BrReceitaLookupRow,
} from '../../br-receita-cnpj-types';

/** La raíz del dataset local. Un ENV la mueve; nada la incrusta. */
export const CUT_E_DATASET_ROOT_ENV = 'SELLUP_BR_RECEITA_LOCAL_ROOT';

/** La ruta por defecto, la del dataset ya descargado. Nunca se descarga nada aquí. */
export const CUT_E_DEFAULT_DATASET_ROOT =
  `${process.env.HOME ?? ''}/Downloads/sellup-source-data/br/receita-cnpj`;

/** El periodo REAL del dataset local. No se infiere de un reloj. */
export const CUT_E_REAL_PERIOD = '2026-07' as const;
export const CUT_E_REAL_YEAR = 2026 as const;

/** Cuántas partes publica Receita por familia particionada. */
export const CUT_E_PART_COUNT = 10 as const;

// ─── Layout posicional oficial (headerless) ──────────────────────────────────
//
// 🔴 Los índices vienen del layout oficial de Receita, el mismo que
// `BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS` valida por CUENTA (30 y 7). Aquí se
// necesitan además las POSICIONES, y sólo las de los campos que el allowlist de GATE-3 ya admite
// más `nome_fantasia`, que se lee para MEDIR y jamás se persiste (§ 12 del encargo).

export const ESTABELECIMENTO_COLUMNS = 30 as const;
export const EMPRESA_COLUMNS = 7 as const;

const EST_CNPJ_BASICO = 0;
const EST_CNPJ_ORDEM = 1;
const EST_CNPJ_DV = 2;
const EST_MATRIZ_FILIAL = 3;
const EST_NOME_FANTASIA = 4;
const EST_SITUACAO = 5;
const EST_DATA_INICIO = 10;
const EST_CNAE_PRINCIPAL = 11;
const EST_CNAE_SECUNDARIA = 12;
const EST_UF = 19;
const EST_MUNICIPIO = 20;

const EMP_CNPJ_BASICO = 0;
const EMP_RAZAO_SOCIAL = 1;
const EMP_NATUREZA = 2;
const EMP_CAPITAL = 4;
const EMP_PORTE = 5;

const LOOKUP_CODIGO = 0;
const LOOKUP_DESCRICAO = 1;

/**
 * Un establecimiento REAL, ya proyectado al subconjunto que el conector admite.
 *
 * 🔴 `nomeFantasia` viaja SÓLO para el análisis agregado de cobertura (§ 12) y NO tiene ruta hacia
 * la publicación: `toEstabelecimentoRow` no lo emite, porque `BrReceitaEstabelecimentoRow` no
 * tiene dónde ponerlo. La no-persistencia es estructural, no una regla que recordar.
 */
export interface CutERealEstablishment {
  readonly cnpjBasico: string;
  readonly cnpjOrdem: string;
  readonly cnpjDv: string;
  readonly matrizFilial: string;
  readonly nomeFantasia: string;
  readonly situacao: string;
  readonly dataInicio: string;
  readonly cnaePrincipal: string;
  readonly cnaeSecundaria: string;
  readonly uf: string;
  readonly municipioCode: string;
}

export interface CutERealCompany {
  readonly cnpjBasico: string;
  readonly razaoSocial: string;
  readonly naturezaJuridica: string;
  readonly capitalSocial: string;
  readonly porte: string;
}

/**
 * Los contadores de recurso. Parte del VALOR DE RETORNO a propósito: un consumidor que quiera
 * informar la muestra no puede omitirlos sin omitirlos deliberadamente.
 */
export interface CutERealSampleMeters {
  /** Filas de ESTABELECIMENTOS leídas del disco (aceptadas + descartadas). */
  establishmentRowsRead: number;
  /** Filas de ESTABELECIMENTOS que pasaron la validación posicional y entraron en la muestra. */
  establishmentRowsAccepted: number;
  /** Filas de EMPRESAS leídas dentro de las ventanas dirigidas. */
  companyRowsRead: number;
  /** Filas de EMPRESAS retenidas (las que alguna clave de la muestra pedía). */
  companyRowsAccepted: number;
  /** Bytes leídos de ESTABELECIMENTOS. */
  establishmentBytesRead: number;
  /** Bytes leídos de EMPRESAS (ventanas + sondas de la búsqueda binaria). */
  companyBytesRead: number;
  /** Bytes leídos de los catálogos de referencia (municípios, CNAE, naturezas). */
  referenceBytesRead: number;
  /** Partes de ESTABELECIMENTOS efectivamente abiertas. */
  establishmentPartsOpened: number;
  /** Partes de EMPRESAS efectivamente abiertas. */
  companyPartsOpened: number;
  /** Ventanas dirigidas abiertas sobre EMPRESAS. Una por banda contigua pedida. */
  companyWindowsOpened: number;
  /** Cuántas bandas de clave componen la muestra. */
  keyBandsSelected: number;
  /** True si algún tope detuvo la lectura antes de agotar la entrada. */
  boundReached: boolean;
}

export interface CutERealSample {
  readonly establishments: readonly CutERealEstablishment[];
  readonly companiesByBasico: ReadonlyMap<string, CutERealCompany>;
  readonly municipalities: readonly BrReceitaLookupRow[];
  readonly cnaes: readonly BrReceitaLookupRow[];
  readonly naturezas: readonly BrReceitaLookupRow[];
  readonly meters: CutERealSampleMeters;
}

export interface CutERealSampleBounds {
  /** Qué partes de ESTABELECIMENTOS se muestrean, en orden. Determinista. */
  readonly establishmentParts: readonly number[];
  /** Tope de bytes por parte de ESTABELECIMENTOS. */
  readonly maxBytesPerEstablishmentPart: number;
  /** Tope global de filas ACEPTADAS. Se para en seco al alcanzarlo. */
  readonly maxAcceptedEstablishments: number;
  /** Tope de bytes por ventana dirigida de EMPRESAS. */
  readonly maxBytesPerCompanyWindow: number;
  /**
   * Cuántos dígitos iniciales de `cnpj_basico` definen una BANDA de claves.
   *
   * 🔴 Es el parámetro que hace acotado el join. Los establecimientos de un prefijo de
   * ESTABELECIMENTOS están DISPERSOS por todo el espacio de claves (los ficheros no están
   * ordenados globalmente), y una ventana que tenga que abarcar de la clave mínima a la máxima
   * pedida es el fichero ENTERO. Agrupar las claves pedidas en bandas contiguas y leer UNA ventana
   * por banda cambia el coste de «rango observado» a «densidad observada».
   */
  readonly keyBandDigits: number;
  /** Cuántas bandas se conservan, las más POBLADAS primero. Cada una es una ventana. */
  readonly maxKeyBands: number;
}

/** Los topes por defecto: los MÁS PEQUEÑOS que cubren las cinco cohortes del encargo. */
export const CUT_E_DEFAULT_BOUNDS: CutERealSampleBounds = {
  establishmentParts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  maxBytesPerEstablishmentPart: 6 * 1024 * 1024,
  maxAcceptedEstablishments: 50_000,
  maxBytesPerCompanyWindow: 24 * 1024 * 1024,
  keyBandDigits: 3,
  maxKeyBands: 24,
};

// ─── Localización del dataset ────────────────────────────────────────────────

export interface CutEDatasetLayout {
  readonly root: string;
  readonly periodDir: string;
  readonly extractedDir: string;
  readonly period: string;
}

/**
 * Resuelve el dataset local, o devuelve el MOTIVO por el que no está.
 *
 * Nunca descarga, nunca crea un directorio y nunca escribe. Un dataset ausente es un skip legítimo
 * de la suite, no un fallo del código bajo prueba.
 */
export async function resolveCutERealDataset(): Promise<
  { layout: CutEDatasetLayout; skip: false } | { layout: null; skip: string }
> {
  const root = process.env[CUT_E_DATASET_ROOT_ENV] ?? CUT_E_DEFAULT_DATASET_ROOT;
  const periodDir = join(root, CUT_E_REAL_PERIOD);
  const extractedDir = join(periodDir, 'extracted');
  try {
    const info = await stat(extractedDir);
    if (!info.isDirectory()) {
      return { layout: null, skip: `${extractedDir} no es un directorio` };
    }
  } catch {
    return {
      layout: null,
      skip:
        `el dataset real de Receita ${CUT_E_REAL_PERIOD} no está en este equipo ` +
        `(se esperaba ${extractedDir}; muévelo con ${CUT_E_DATASET_ROOT_ENV})`,
    };
  }
  return { layout: { root, periodDir, extractedDir, period: CUT_E_REAL_PERIOD }, skip: false };
}

/** El único fichero regular dentro de un directorio de familia extraída. */
async function soleFileIn(dir: string): Promise<string | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const file = entries.find((entry) => entry.isFile() && !entry.name.startsWith('.'));
    return file ? join(dir, file.name) : null;
  } catch {
    return null;
  }
}

const establishmentPartDir = (layout: CutEDatasetLayout, part: number): string =>
  join(layout.extractedDir, `estabelecimentos${part}`);

const companyPartDir = (layout: CutEDatasetLayout, part: number): string =>
  join(layout.extractedDir, `empresas${part}`);

// ─── Lectura acotada, en streaming, latin1 ───────────────────────────────────

/** Un campo posicional, sin comillas envolventes. Nunca lanza: un índice ausente es cadena vacía. */
function field(cells: readonly string[], index: number): string {
  const raw = cells[index];
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

interface BoundedLineReadResult {
  readonly bytesRead: number;
  readonly boundReached: boolean;
}

/**
 * Lee líneas desde `offset` invocando `onLine` hasta que una de tres cosas ocurra: se agota el
 * fichero, se supera `maxBytes`, o `onLine` devuelve `'stop'`.
 *
 * 🔴 Descarta SIEMPRE la última línea parcial del búfer, y por tanto nunca entrega a `onLine` una
 * fila truncada que parecería tener menos columnas de las que tiene. Una fila cortada por un tope
 * de bytes es una fila NO LEÍDA, no una fila inválida.
 */
async function readBoundedLines(
  path: string,
  options: {
    readonly offset: number;
    readonly maxBytes: number;
    readonly onLine: (line: string) => 'continue' | 'stop';
  },
): Promise<BoundedLineReadResult> {
  const handle = await open(path, 'r');
  const chunk = Buffer.alloc(1024 * 1024);
  let position = options.offset;
  let bytesRead = 0;
  let carry = '';
  let boundReached = false;
  let stopped = false;

  try {
    while (bytesRead < options.maxBytes) {
      const want = Math.min(chunk.length, options.maxBytes - bytesRead);
      const { bytesRead: got } = await handle.read(chunk, 0, want, position);
      if (got === 0) break;
      position += got;
      bytesRead += got;
      // latin1 es 1 byte por carácter, así que un corte de búfer nunca parte un carácter.
      const text = carry + chunk.subarray(0, got).toString('latin1');
      const lines = text.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') continue;
        if (options.onLine(line.endsWith('\r') ? line.slice(0, -1) : line) === 'stop') {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
      if (bytesRead >= options.maxBytes) {
        boundReached = true;
        break;
      }
    }
  } finally {
    await handle.close();
  }

  return { bytesRead, boundReached: boundReached || stopped };
}

/** Lee un catálogo de referencia completo — son ficheros de kilobytes, no de gigabytes. */
async function readLookupFile(
  path: string | null,
): Promise<{ rows: BrReceitaLookupRow[]; bytesRead: number }> {
  if (path === null) return { rows: [], bytesRead: 0 };
  const rows: BrReceitaLookupRow[] = [];
  const { bytesRead } = await readBoundedLines(path, {
    offset: 0,
    maxBytes: 8 * 1024 * 1024,
    onLine: (line) => {
      const cells = line.split(';');
      const codigo = field(cells, LOOKUP_CODIGO);
      const descricao = field(cells, LOOKUP_DESCRICAO);
      if (codigo !== '') rows.push({ codigo, descricao });
      return 'continue';
    },
  });
  return { rows, bytesRead };
}

// ─── Búsqueda binaria por desplazamiento sobre un fichero ORDENADO ───────────

/** La primera clave COMPLETA en o después de `offset`, con los bytes que costó mirarla. */
async function keyAtOffset(
  path: string,
  offset: number,
): Promise<{ key: string | null; bytesRead: number }> {
  const handle = await open(path, 'r');
  const probe = Buffer.alloc(64 * 1024);
  try {
    const { bytesRead } = await handle.read(probe, 0, probe.length, offset);
    if (bytesRead === 0) return { key: null, bytesRead: 0 };
    const text = probe.subarray(0, bytesRead).toString('latin1');
    const lines = text.split('\n');
    // En un desplazamiento > 0 la primera línea es casi con certeza parcial: se descarta.
    const usable = offset === 0 ? lines : lines.slice(1);
    const line = usable.find((candidate) => candidate.trim() !== '');
    if (line === undefined) return { key: null, bytesRead };
    return { key: field(line.split(';'), EMP_CNPJ_BASICO), bytesRead };
  } finally {
    await handle.close();
  }
}

/**
 * El desplazamiento de byte desde el que leer para alcanzar `target` en un fichero ORDENADO.
 *
 * Devuelve un límite INFERIOR seguro: el consumidor lee hacia delante y descarta lo anterior. Un
 * `target` menor que la primera clave del fichero devuelve 0, y uno mayor que la última devuelve
 * el tamaño (ventana vacía) — ninguno de los dos es un error.
 */
async function seekOffsetForKey(
  path: string,
  target: string,
): Promise<{ offset: number; bytesRead: number }> {
  const { size } = await stat(path);
  let low = 0;
  let high = size;
  let bytesRead = 0;

  while (high - low > 512 * 1024) {
    const middle = low + Math.floor((high - low) / 2);
    const probe = await keyAtOffset(path, middle);
    bytesRead += probe.bytesRead;
    if (probe.key === null || probe.key >= target) {
      high = middle;
    } else {
      low = middle;
    }
  }

  // Se retrocede una holgura para no quedar por delante de la primera fila buscada: la línea
  // parcial descartada en la sonda puede ser exactamente la que se quiere.
  return { offset: Math.max(0, low - 64 * 1024), bytesRead };
}

// ─── Extracción ──────────────────────────────────────────────────────────────

/**
 * Construye la muestra REAL acotada.
 *
 * Determinista: mismas partes, mismos topes y mismo dataset ⇒ misma muestra, byte por byte. No hay
 * reloj, ni aleatoriedad, ni orden de directorio que influya (el fichero de cada familia se
 * localiza por nombre de directorio, y los ficheros se recorren desde el desplazamiento 0).
 */
export async function extractCutERealSample(
  layout: CutEDatasetLayout,
  bounds: CutERealSampleBounds = CUT_E_DEFAULT_BOUNDS,
): Promise<CutERealSample> {
  const meters: CutERealSampleMeters = {
    establishmentRowsRead: 0,
    establishmentRowsAccepted: 0,
    companyRowsRead: 0,
    companyRowsAccepted: 0,
    establishmentBytesRead: 0,
    companyBytesRead: 0,
    referenceBytesRead: 0,
    establishmentPartsOpened: 0,
    companyPartsOpened: 0,
    companyWindowsOpened: 0,
    keyBandsSelected: 0,
    boundReached: false,
  };

  // ── 1. ESTABELECIMENTOS: un prefijo acotado por parte, TODOS candidatos. ──
  //
  // Nada se descarta todavía por su clave: la selección por banda es una decisión sobre el
  // conjunto completo de candidatos, y tomarla mientras se lee sesgaría la muestra hacia lo que se
  // leyó primero.
  const candidates: CutERealEstablishment[] = [];

  for (const part of bounds.establishmentParts) {
    const path = await soleFileIn(establishmentPartDir(layout, part));
    if (path === null) continue;
    meters.establishmentPartsOpened += 1;

    const outcome = await readBoundedLines(path, {
      offset: 0,
      maxBytes: bounds.maxBytesPerEstablishmentPart,
      onLine: (line) => {
        meters.establishmentRowsRead += 1;
        const cells = line.split(';');
        // 🔴 Fail-closed por LAYOUT: una fila que no trae las 30 columnas oficiales no se
        // "repara", se descarta. Reparar posiciones es inventar el dato de una columna.
        if (cells.length !== ESTABELECIMENTO_COLUMNS) return 'continue';
        const cnpjBasico = field(cells, EST_CNPJ_BASICO);
        const cnpjOrdem = field(cells, EST_CNPJ_ORDEM);
        const cnpjDv = field(cells, EST_CNPJ_DV);
        if (cnpjBasico === '' || cnpjOrdem === '' || cnpjDv === '') return 'continue';

        candidates.push({
          cnpjBasico,
          cnpjOrdem,
          cnpjDv,
          matrizFilial: field(cells, EST_MATRIZ_FILIAL),
          nomeFantasia: field(cells, EST_NOME_FANTASIA),
          situacao: field(cells, EST_SITUACAO),
          dataInicio: field(cells, EST_DATA_INICIO),
          cnaePrincipal: field(cells, EST_CNAE_PRINCIPAL),
          cnaeSecundaria: field(cells, EST_CNAE_SECUNDARIA),
          uf: field(cells, EST_UF),
          municipioCode: field(cells, EST_MUNICIPIO),
        });
        return 'continue';
      },
    });

    meters.establishmentBytesRead += outcome.bytesRead;
    if (outcome.boundReached) meters.boundReached = true;
  }

  // ── 2. Las BANDAS más pobladas. La muestra es su unión. ──────────────────
  const bandOf = (key: string): string => key.slice(0, Math.max(1, bounds.keyBandDigits));
  const bandCounts = new Map<string, number>();
  for (const row of candidates) {
    const band = bandOf(row.cnpjBasico);
    bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1);
  }
  // Orden determinista: por población descendente y, a igualdad, por banda ascendente. Sin
  // desempate estable la muestra dependería del orden de inserción de un Map.
  const selectedBands = [...bandCounts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, bounds.maxKeyBands)
    .map(([band]) => band);
  const selected = new Set(selectedBands);
  meters.keyBandsSelected = selected.size;
  if (selected.size < bandCounts.size) meters.boundReached = true;

  const establishments: CutERealEstablishment[] = [];
  for (const row of candidates) {
    if (!selected.has(bandOf(row.cnpjBasico))) continue;
    if (establishments.length >= bounds.maxAcceptedEstablishments) {
      meters.boundReached = true;
      break;
    }
    establishments.push(row);
  }
  meters.establishmentRowsAccepted = establishments.length;

  // ── 3. EMPRESAS: una ventana DIRIGIDA por banda contigua. ────────────────
  //
  // 🔴 Las diez partes particionan el espacio de `cnpj_basico` en rangos disjuntos, así que la
  // parte que sirve una banda está DETERMINADA. Bandas contiguas dentro de la misma parte se
  // fusionan en una sola ventana: dos seeks para leer un tramo que ya se iba a recorrer entero
  // serían dos veces el mismo trabajo.
  const companiesByBasico = new Map<string, CutERealCompany>();
  const wanted = new Set(establishments.map((row) => row.cnpjBasico));

  if (wanted.size > 0) {
    const partRanges = await probeCompanyPartRanges(layout);
    meters.companyBytesRead += partRanges.reduce((total, range) => total + range.bytesRead, 0);

    const partOf = (key: string): number | null =>
      partRanges.find((range) => key >= range.first && key <= range.last)?.part ?? null;

    // Las bandas EFECTIVAMENTE presentes en la muestra, ordenadas.
    const sampledBands = [...new Set([...wanted].map(bandOf))].sort();

    interface Window {
      readonly part: number;
      readonly from: string;
      to: string;
    }
    const windows: Window[] = [];
    for (const band of sampledBands) {
      const from = band.padEnd(8, '0');
      const to = band.padEnd(8, '9');
      const part = partOf(from);
      if (part === null) continue;
      const previous = windows[windows.length - 1];
      // Fusiona sólo dentro de la MISMA parte y sólo si las bandas son consecutivas.
      if (previous !== undefined && previous.part === part && nextBand(previous.to, bounds.keyBandDigits) === band) {
        previous.to = to;
        continue;
      }
      windows.push({ part, from, to });
    }

    for (const window of windows) {
      const path = await soleFileIn(companyPartDir(layout, window.part));
      if (path === null) continue;
      meters.companyPartsOpened += 1;
      meters.companyWindowsOpened += 1;

      const seek = await seekOffsetForKey(path, window.from);
      meters.companyBytesRead += seek.bytesRead;

      const outcome = await readBoundedLines(path, {
        offset: seek.offset,
        maxBytes: bounds.maxBytesPerCompanyWindow,
        onLine: (line) => {
          meters.companyRowsRead += 1;
          const cells = line.split(';');
          if (cells.length !== EMPRESA_COLUMNS) return 'continue';
          const cnpjBasico = field(cells, EMP_CNPJ_BASICO);
          if (cnpjBasico === '') return 'continue';
          // Ordenado: pasada la banda no queda nada por encontrar en esta ventana.
          if (cnpjBasico > window.to) return 'stop';
          if (!wanted.has(cnpjBasico) || companiesByBasico.has(cnpjBasico)) return 'continue';

          companiesByBasico.set(cnpjBasico, {
            cnpjBasico,
            razaoSocial: field(cells, EMP_RAZAO_SOCIAL),
            naturezaJuridica: field(cells, EMP_NATUREZA),
            capitalSocial: field(cells, EMP_CAPITAL),
            porte: field(cells, EMP_PORTE),
          });
          meters.companyRowsAccepted += 1;
          return 'continue';
        },
      });

      meters.companyBytesRead += outcome.bytesRead;
      if (outcome.boundReached) meters.boundReached = true;
    }
  }

  // ── 4. Catálogos de referencia. Kilobytes. ───────────────────────────────
  const municipios = await readLookupFile(await soleFileIn(join(layout.extractedDir, 'municipios')));
  const cnaes = await readLookupFile(await soleFileIn(join(layout.extractedDir, 'cnaes')));
  const naturezas = await readLookupFile(await soleFileIn(join(layout.extractedDir, 'naturezas')));
  meters.referenceBytesRead = municipios.bytesRead + cnaes.bytesRead + naturezas.bytesRead;

  return {
    establishments,
    companiesByBasico,
    municipalities: municipios.rows,
    cnaes: cnaes.rows,
    naturezas: naturezas.rows,
    meters,
  };
}

/** La banda inmediatamente siguiente, o `null` si `to` ya es la última posible. */
function nextBand(to: string, digits: number): string | null {
  const band = to.slice(0, Math.max(1, digits));
  const next = String(Number(band) + 1).padStart(band.length, '0');
  return next.length === band.length ? next : null;
}

export interface CompanyPartRange {
  readonly part: number;
  readonly first: string;
  readonly last: string;
  readonly bytesRead: number;
}

/**
 * Los rangos `[primera, última]` clave de cada parte de EMPRESAS.
 *
 * 🔴 Se MIDE, no se supone. Que las diez partes estén ordenadas y particionen el espacio de claves
 * es el hecho del que depende todo el join dirigido, y un dataset de otro mes podría no cumplirlo:
 * comprobarlo en tiempo de ejecución convierte una suposición silenciosa en un dato observable, y
 * `assertCompanyPartsPartitionKeySpace` lo convierte en una aserción.
 */
export async function probeCompanyPartRanges(
  layout: CutEDatasetLayout,
): Promise<readonly CompanyPartRange[]> {
  const ranges: CompanyPartRange[] = [];
  for (let part = 0; part < CUT_E_PART_COUNT; part += 1) {
    const path = await soleFileIn(companyPartDir(layout, part));
    if (path === null) continue;
    const { size } = await stat(path);
    const head = await keyAtOffset(path, 0);
    // Una sonda a 64 KiB del final basta para ver la última línea completa.
    const tail = await keyAtOffset(path, Math.max(0, size - 64 * 1024));
    if (head.key === null || tail.key === null) continue;
    ranges.push({
      part,
      first: head.key,
      last: tail.key,
      bytesRead: head.bytesRead + tail.bytesRead,
    });
  }
  return ranges.sort((a, b) => (a.first < b.first ? -1 : 1));
}

/** True cuando los rangos están ordenados y NO se solapan — la premisa del join dirigido. */
export function companyPartsPartitionKeySpace(ranges: readonly CompanyPartRange[]): boolean {
  if (ranges.length === 0) return false;
  for (const range of ranges) {
    if (range.first > range.last) return false;
  }
  const sorted = [...ranges].sort((a, b) => (a.first < b.first ? -1 : 1));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]!.first <= sorted[i - 1]!.last) return false;
  }
  return true;
}

// ─── Proyección a la entrada del parser REAL ─────────────────────────────────

/**
 * Proyecta un establecimiento real a la fila que el constructor REAL consume.
 *
 * 🔴 Los campos de contacto y de dirección fina NO se emiten. No es que se emitan vacíos: no se
 * emiten. El extractor nunca los leyó a una propiedad con nombre, así que aquí no hay nada que
 * olvidar excluir. Y `nome_fantasia` tampoco tiene destino: `BrReceitaEstabelecimentoRow` no
 * declara el campo.
 */
export function toEstabelecimentoRow(
  establishment: CutERealEstablishment,
): BrReceitaEstabelecimentoRow {
  return {
    cnpj_basico: establishment.cnpjBasico,
    cnpj_ordem: establishment.cnpjOrdem,
    cnpj_dv: establishment.cnpjDv,
    identificador_matriz_filial: establishment.matrizFilial || null,
    situacao_cadastral: establishment.situacao || null,
    cnae_fiscal_principal: establishment.cnaePrincipal || null,
    cnae_fiscal_secundaria: establishment.cnaeSecundaria || null,
    data_inicio_atividade: establishment.dataInicio || null,
    municipio: establishment.municipioCode || null,
    uf: establishment.uf || null,
  };
}

export function toEmpresaRow(company: CutERealCompany): BrReceitaEmpresaRow {
  return {
    cnpj_basico: company.cnpjBasico,
    razao_social: company.razaoSocial || null,
    natureza_juridica: company.naturezaJuridica || null,
    porte_empresa: company.porte || null,
    capital_social: company.capitalSocial || null,
  };
}

// ─── El constructor REAL, aplicado a la muestra REAL ─────────────────────────

/**
 * 🔴 BR-SOURCE CUT E1 — este bloque ANTES contenía un workaround, y ya no.
 *
 * CUT E encontró que `assertSanitizedRawData` LANZABA ante una colisión, y que una excepción en
 * mitad del lote se llevaba el lote completo: DOS filas reales impedían publicar el mes entero.
 * Para poder MEDIR igualmente, este módulo bisecaba la entrada por bloques, localizaba las filas
 * culpables, las excluía y las contaba — todo por FUERA del parser.
 *
 * Ese workaround ha sido ELIMINADO. CUT E1 corrigió la disposición en el producto: el parser
 * rechaza la fila y sigue. Por tanto el arnés hace UNA sola llamada, con la muestra COMPLETA, y no
 * excluye nada: si volviera a aparecer un abort global, esta función LANZARÍA y CUT E fallaría, que
 * es exactamente lo que debe ocurrir. El arnés ya no tapa el defecto.
 *
 * 🔴 Los rechazos por sanitización se leen del RESULTADO del parser (`reasonCode:
 * 'sanitized_raw_data_collision'`), no de un mensaje de excepción parseado con una expresión
 * regular. Son un dato del producto, no un artefacto del arnés.
 */
export interface CutERealBuildOutcome {
  /** Lo que el constructor REAL aceptó, ya proyectado a la forma persistible. */
  readonly snapshots: ReturnType<typeof buildBrReceitaCnpjSnapshotRows>['snapshots'];
  /** TODOS los rechazos del constructor, con su categoría. Nada se filtra aquí. */
  readonly rejected: ReturnType<typeof buildBrReceitaCnpjSnapshotRows>['rejected'];
  /** El resumen del constructor, tal cual. Incluye la reconciliación y los contadores. */
  readonly summary: ReturnType<typeof buildBrReceitaCnpjSnapshotRows>['summary'];
  /** Sólo los rechazos por colisión de sanitización (CUT E1). */
  readonly sanitizationRejections: ReturnType<typeof buildBrReceitaCnpjSnapshotRows>['rejected'];
  /** Cuántas filas se ofrecieron al constructor. */
  readonly offeredRows: number;
}

/**
 * Construye los snapshots de la muestra real con el constructor REAL, en UNA llamada.
 *
 * No bisecta, no captura excepciones, no excluye filas y no relaja ninguna política. Si el parser
 * lanza, la excepción PROPAGA: un abort global vuelve a ser un fallo visible del corte, no algo que
 * el arnés absorbe.
 */
export function buildCutERealSnapshots(sample: CutERealSample): CutERealBuildOutcome {
  const establishmentRows = sample.establishments.map(toEstabelecimentoRow);
  const empresasRows = [...sample.companiesByBasico.values()].map(toEmpresaRow);

  const parsed = buildBrReceitaCnpjSnapshotRows({
    sourceYear: CUT_E_REAL_YEAR,
    sourcePeriod: CUT_E_REAL_PERIOD,
    empresasRows,
    estabelecimentosRows: establishmentRows,
    cnaesRows: [...sample.cnaes],
    municipiosRows: [...sample.municipalities],
    naturezasRows: [...sample.naturezas],
  });

  return {
    snapshots: parsed.snapshots,
    rejected: parsed.rejected,
    summary: parsed.summary,
    sanitizationRejections: parsed.rejected.filter(
      (row) => row.reasonCode === 'sanitized_raw_data_collision',
    ),
    offeredRows: establishmentRows.length,
  };
}
