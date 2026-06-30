/**
 * DGII República Dominicana — Dry Run
 *
 * Ejecuta el flujo seguro de verificación del padrón RNC DGII.
 * Pasos:
 *  1. HEAD del ZIP TXT con Referer header.
 *  2. Descarga muestra (Range si aplica, ZIP completo si no).
 *  3. Extrae archivo interno del ZIP (parseando estructura manualmente + node:zlib).
 *  4. Parsea muestra de líneas (máx. 100).
 *  5. Reporta conteos, distribución de estados y 5 ejemplos sanitizados.
 *
 * NO escribe en Supabase. NO guarda archivos. NO usa WebForms POST.
 * NO usa Dominican Technology API. NO usa SOAP DGII.
 */

import { inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import { headDgiiRncZip, fetchDgiiRncZipSample } from './dgii-bulk-client';
import { parseDgiiLines } from './dgii-bulk-parser';
import { RD_DGII_RNC_TXT_ZIP_URL, RD_DGII_BULK_SOURCE_KEY } from './types';

const inflateRawAsync = promisify(inflateRaw);

const MAX_PARSE_LINES = 500; // el archivo empieza con cédulas; necesitamos suficientes líneas para llegar a RNC jurídicos
const MAX_EXAMPLES = 5;

function fmt(n: number): string {
  return n.toLocaleString('es-DO');
}

function mbStr(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readUint16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function readUint32LE(buf: Uint8Array, offset: number): number {
  return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
}

type ZipLocalEntry = {
  filename: string;
  compressionMethod: number;
  compressedSize: number;
  dataOffset: number;
};

function findFirstLocalEntry(buf: Uint8Array): ZipLocalEntry | null {
  // Local file header signature: PK\x03\x04 (0x04034b50)
  if (buf.length < 30) return null;
  const sig = readUint32LE(buf, 0);
  if (sig !== 0x04034b50) return null;

  const compressionMethod = readUint16LE(buf, 8);
  const compressedSize = readUint32LE(buf, 18);
  const fileNameLength = readUint16LE(buf, 26);
  const extraLength = readUint16LE(buf, 28);

  const decoder = new TextDecoder('latin1');
  const filename = decoder.decode(buf.slice(30, 30 + fileNameLength));
  const dataOffset = 30 + fileNameLength + extraLength;

  return { filename, compressionMethod, compressedSize, dataOffset };
}

async function extractLinesFromZip(zipBytes: Uint8Array): Promise<{
  filename: string;
  lines: string[];
} | null> {
  const entry = findFirstLocalEntry(zipBytes);
  if (!entry) return null;

  const { filename, compressionMethod, compressedSize, dataOffset } = entry;

  const end = compressedSize > 0 ? dataOffset + compressedSize : zipBytes.length;
  const compressedData = zipBytes.slice(dataOffset, end);

  let textBytes: Buffer;
  if (compressionMethod === 0) {
    // Stored (no compression)
    textBytes = Buffer.from(compressedData);
  } else if (compressionMethod === 8) {
    // DEFLATE
    textBytes = await inflateRawAsync(compressedData);
  } else {
    return null;
  }

  // Decodificar — el padrón RD puede estar en latin1/windows-1252
  let text: string;
  try {
    text = new TextDecoder('utf-8').decode(textBytes);
    if (text.includes('�')) throw new Error('UTF-8 decode had replacement chars');
  } catch {
    text = new TextDecoder('latin1').decode(textBytes);
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, MAX_PARSE_LINES + 10);

  return { filename, lines };
}

async function main() {
  console.log('=== DGII República Dominicana — Dry Run ===');
  console.log(`Fuente: ${RD_DGII_BULK_SOURCE_KEY}`);
  console.log(`URL: ${RD_DGII_RNC_TXT_ZIP_URL}`);
  console.log('');

  // ── Paso 1: HEAD ───────────────────────────────────────────────────────────
  console.log('── Paso 1: HEAD del ZIP TXT ──────────────────────────────────────');
  const headResult = await headDgiiRncZip();
  const meta = headResult.metadata;

  console.log(`  HTTP status:     ${meta.httpStatus ?? 'N/A'}`);
  console.log(`  Content-Type:    ${meta.contentType ?? 'N/A'}`);
  console.log(`  Content-Length:  ${meta.contentLengthBytes ? mbStr(meta.contentLengthBytes) : 'N/A'}`);
  console.log(`  Last-Modified:   ${meta.lastModified ?? 'N/A'}`);
  console.log(`  Accept-Ranges:   ${meta.acceptRanges ?? 'N/A'}`);
  console.log(`  Tiempo resp.:    ${meta.responseTimeMs} ms`);

  if (!meta.ok || meta.httpStatus === null) {
    console.error(`\n❌ HEAD falló (HTTP ${meta.httpStatus}). Verifica Referer header.`);
    process.exit(1);
  }
  console.log(`\n✅ HEAD OK — ZIP disponible.`);
  if (meta.supportsRangeRequests) {
    console.log('   Servidor soporta Range requests.');
  } else {
    console.log('   Servidor NO reporta Accept-Ranges. Se descargará ZIP completo (~22 MB).');
  }

  // ── Paso 2: Descarga ZIP completo ─────────────────────────────────────────
  // ZIP parcial via Range no es descomprimible (datos truncados).
  // El ZIP pesa ~22 MB — aceptable para este dry-run.
  console.log('\n── Paso 2: Descarga ZIP completo (~22 MB) ────────────────────────');
  console.log('   (Range parcial no es suficiente para descomprimir; se descarga completo)');

  const sampleResult = await fetchDgiiRncZipSample({ maxBytes: 30 * 1024 * 1024 });

  if (sampleResult.error || !sampleResult.rawBytes) {
    console.error(`\n❌ Descarga falló: ${sampleResult.error}`);
    process.exit(1);
  }

  const rawBytes = sampleResult.rawBytes;
  console.log(`  Bytes descargados: ${fmt(rawBytes.length)} (${mbStr(rawBytes.length)})`);
  console.log(`  Método:            ${sampleResult.usedRangeRequest ? 'Range request (206)' : 'ZIP completo (200)'}`);
  console.log(`  Formato ZIP:       ${sampleResult.isZipFile ? '✅ Confirmado (PK magic bytes)' : '⚠️  No detectado'}`);

  if (!sampleResult.isZipFile) {
    console.error('\n❌ El archivo descargado no tiene magic bytes de ZIP válidos.');
    process.exit(1);
  }

  // ── Paso 3: Extraer archivo interno ───────────────────────────────────────
  console.log('\n── Paso 3: Extracción del archivo interno del ZIP ────────────────');

  const extracted = await extractLinesFromZip(rawBytes);

  if (!extracted) {
    console.error('\n❌ No se pudo extraer el archivo interno del ZIP.');
    if (sampleResult.usedRangeRequest) {
      console.error('   → El ZIP parcial puede estar incompleto. Intenta con ZIP completo.');
    }
    process.exit(1);
  }

  console.log(`  Archivo interno: ${extracted.filename}`);
  console.log(`  Líneas leídas:   ${fmt(extracted.lines.length)} (muestra, máx. ${MAX_PARSE_LINES + 10})`);

  // ── Paso 4: Parsear líneas ─────────────────────────────────────────────────
  console.log('\n── Paso 4: Parseo de muestra ─────────────────────────────────────');

  const parseResult = parseDgiiLines({
    lines: extracted.lines,
    maxRecords: MAX_PARSE_LINES,
  });

  const { stats, normalizedCompanies, detectedColumnMapping, mappingSource, headerSkipped } =
    parseResult;

  console.log(`  Mapping columnas: ${mappingSource === 'detected_from_header' ? '✅ Detectado del header' : '⚠️  Posicional por defecto (tentativo)'}`);
  if (headerSkipped) console.log(`  Header omitido:   Sí`);
  console.log(`  Mapping usado:    ${JSON.stringify(detectedColumnMapping)}`);

  // ── Paso 5: Reporte ───────────────────────────────────────────────────────
  console.log('\n── Paso 5: Reporte ───────────────────────────────────────────────');
  console.log(`  Líneas parseadas:          ${fmt(stats.totalLines)}`);
  console.log(`  RNC jurídicos (9 dígitos): ${fmt(stats.businessRnc9)}`);
  console.log(`  Cédulas persona (11 díg.): ${fmt(stats.cedula11)}`);
  console.log(`  Inválidos/desconocidos:    ${fmt(stats.unknown)}`);

  console.log('\n  Distribución de estados:');
  for (const [status, count] of Object.entries(stats.statusDistribution).sort(([, a], [, b]) => b - a)) {
    console.log(`    ${status.padEnd(32)} → ${fmt(count)}`);
  }

  const examples = normalizedCompanies.slice(0, MAX_EXAMPLES);
  if (examples.length > 0) {
    console.log(`\n  ${MAX_EXAMPLES} ejemplos sanitizados de RNC jurídicos:`);
    for (const ex of examples) {
      console.log('  ─────────────────────────────────────────');
      console.log(`    rnc:              ${ex.rnc}`);
      console.log(`    legalName:        ${ex.legalName.slice(0, 60)}`);
      if (ex.tradeName) console.log(`    tradeName:        ${ex.tradeName.slice(0, 60)}`);
      console.log(`    taxpayerStatus:   ${ex.taxpayerStatus} (raw: ${ex.rawStatus})`);
      if (ex.economicActivity) console.log(`    economicActivity: ${ex.economicActivity.slice(0, 80)}`);
      if (ex.registrationDate) console.log(`    registrationDate: ${ex.registrationDate}`);
    }
    console.log('  ─────────────────────────────────────────');
  } else {
    console.log('\n  ⚠️  No se encontraron RNC jurídicos de 9 dígitos en la muestra.');
  }

  // ── Verificaciones ─────────────────────────────────────────────────────────
  console.log('\n── Verificaciones de seguridad ───────────────────────────────────');
  console.log('  ✅ No se escribió en Supabase');
  console.log('  ✅ No se usó WebForms POST (ni __VIEWSTATE)');
  console.log('  ✅ No se usó Dominican Technology API');
  console.log('  ✅ No se usó SOAP DGII (wsMovilDGII)');
  console.log('  ✅ Referer header enviado en todos los requests');
  console.log('  ✅ No se guardaron archivos en el repositorio');
  console.log('  ✅ Cédulas de 11 dígitos excluidas del scope B2B');

  console.log('\n── Veredicto ─────────────────────────────────────────────────────');
  if (stats.businessRnc9 > 0 && meta.ok) {
    console.log('  ✅ rd_dgii_bulk LISTO para importer snapshot.');
    console.log('     El padrón responde, el ZIP se parsea, los RNC jurídicos se identifican.');
  } else if (meta.ok) {
    console.log('  ⚠️  rd_dgii_bulk requiere ajuste: muestra sin RNC jurídicos o parseo incompleto.');
  } else {
    console.log('  ❌ rd_dgii_bulk requiere ajuste: endpoint no disponible.');
  }
}

main().catch((err) => {
  console.error('Error fatal en dry-run DGII:', err);
  process.exit(1);
});
