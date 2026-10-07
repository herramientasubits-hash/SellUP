/**
 * ec-public-entity-classifier.ts — qué entidades públicas del catastro del SRI
 * ofrece la capa gratuita de Ecuador, y en qué industria.
 *
 * SOURCES-EC-PUBLIC-ENTITIES-1 (dueña 07-10: «adelante», regla por tipo mientras
 * no haya conteo oficial de servidores). Medido en Prod 07-10: 3.232 entidades
 * públicas con RUC en `ec_sri_registry`, pero la mayoría NO son la cabeza de una
 * institución: 797 juntas parroquiales (pocas personas), 526 dependencias
 * (direcciones distritales, facultades, zonas), 210 cuerpos de bomberos, 243
 * empresas públicas municipales (agua, aseo, mercados).
 *
 * El conteo oficial de servidores por entidad (SIITH del Ministerio del Trabajo,
 * datosabiertos.gob.ec) está bloqueado desde fuera de Ecuador. Hasta tenerlo, el
 * tamaño lo da el TIPO de entidad, con una regla conservadora:
 *
 *   · Gobierno: instituciones NACIONALES cabeza (ministerios, secretarías,
 *     superintendencias, agencias, función judicial, IESS…), los 24 gobiernos
 *     PROVINCIALES, los MUNICIPIOS de capitales de provincia y de los cantones de
 *     más de 150.000 habitantes, y las UNIVERSIDADES públicas (cabeza, no
 *     facultades ni sedes).
 *   · Salud: HOSPITALES públicos generales, de especialidades, docentes o del IESS
 *     (nunca los básicos ni los «del día»).
 *
 * Todo lo demás no se ofrece. Puro: sin env, sin I/O.
 */

import { normalizeEcCompanyCore } from './ec-company-name-core';
import { canonicalEcLocalGovernment } from './ec-entity-name-core';

export const EC_PUBLIC_ENTITY_RULES_VERSION = 'ec-public-entities-v1';

export type EcPublicEntityKind = 'national' | 'provincial' | 'municipal' | 'university' | 'hospital';

export type EcPublicEntityClass = {
  kind: EcPublicEntityKind;
  macroIndustryKey: 'government' | 'health_pharma';
  /** Orden de oferta: primero lo más grande (nacional), después el resto. */
  priority: number;
};

/** Las 24 provincias (para reconocer al gobierno provincial cabeza). */
const PROVINCES: ReadonlySet<string> = new Set([
  'AZUAY', 'BOLIVAR', 'CANAR', 'CARCHI', 'CHIMBORAZO', 'COTOPAXI', 'EL ORO', 'ESMERALDAS', 'GALAPAGOS',
  'GUAYAS', 'IMBABURA', 'LOJA', 'LOS RIOS', 'MANABI', 'MORONA SANTIAGO', 'NAPO', 'ORELLANA', 'PASTAZA',
  'PICHINCHA', 'SANTA ELENA', 'SANTO DOMINGO DE LOS TSACHILAS', 'SUCUMBIOS', 'TUNGURAHUA', 'ZAMORA CHINCHIPE',
]);

/**
 * Cantones cuyo municipio se ofrece: capitales de provincia (por el nombre del
 * cantón) y cantones de más de 150.000 habitantes (censo INEC 2022).
 */
const LARGE_CANTONS: ReadonlySet<string> = new Set([
  // Capitales de provincia.
  'CUENCA', 'GUARANDA', 'AZOGUES', 'TULCAN', 'RIOBAMBA', 'LATACUNGA', 'MACHALA', 'ESMERALDAS', 'SAN CRISTOBAL',
  'GUAYAQUIL', 'IBARRA', 'SAN MIGUEL DE IBARRA', 'LOJA', 'BABAHOYO', 'PORTOVIEJO', 'MORONA', 'TENA', 'FRANCISCO DE ORELLANA',
  'PASTAZA', 'QUITO', 'SANTA ELENA', 'SANTO DOMINGO', 'LAGO AGRIO', 'AMBATO', 'ZAMORA',
  // Más de 150.000 habitantes.
  'DURAN', 'MANTA', 'QUEVEDO', 'MILAGRO', 'SAN FRANCISCO DE MILAGRO', 'DAULE',
]);

/** Señales de que la fila es una DEPENDENCIA y no la cabeza de la institución. */
const SUBUNIT = /\b(DIRECCION (DISTRITAL|PROVINCIAL|ZONAL|REGIONAL)|COORDINACION ZONAL|DELEGACION|SUBSECRETARIA|ZONA|ZONAL|SUCURSAL|OFICINA|AGENCIA ZONAL|FACULTAD|EXTENSION|SEDE|NUCLEO|UNIDAD|CENTRO DE SALUD|DISTRITO \d|\d{2}D\d{2})\b/;

/** Dependencia nombrada DESPUÉS de la institución: «MINISTERIO DE GOBIERNO - ESCUELA DE …», «ADUANA - DISTRITO QUITO». */
const SUBUNIT_TAIL = / (ESCUELA|REGIONAL|DISTRITO|SUBDIRECCION|HOSPITAL DEL DIA)\b/;

/** «GOBIERNO AUTONOMO DESCENTRALIZADO DE SAN MIGUEL DE IBARRA»: sin «municipal» ni «cantón». */
const BARE_GAD = /^GOBIERNO AUTONOMO DESCENTRALIZADO (?:DE |DEL )?(.+)$/;

/** Cabezas nacionales. */
const NATIONAL_HEAD = new RegExp(
  '^(' +
    [
      'MINISTERIO',
      'SECRETARIA (NACIONAL|GENERAL|TECNICA|DE)',
      'SUPERINTENDENCIA',
      'AGENCIA (NACIONAL|DE REGULACION)',
      'INSTITUTO ECUATORIANO DE SEGURIDAD SOCIAL',
      'INSTITUTO DE SEGURIDAD SOCIAL DE LAS FUERZAS ARMADAS',
      'INSTITUTO DE SEGURIDAD SOCIAL DE LA POLICIA NACIONAL',
      'INSTITUTO NACIONAL',
      'SERVICIO (NACIONAL|DE RENTAS INTERNAS|ECUATORIANO|DE ACREDITACION|INTEGRADO)',
      'CONSEJO DE LA JUDICATURA',
      'CONSEJO NACIONAL ELECTORAL',
      'CONSEJO DE PARTICIPACION CIUDADANA',
      'CORTE (NACIONAL|CONSTITUCIONAL)',
      'FISCALIA GENERAL',
      'DEFENSORIA (DEL PUEBLO|PUBLICA)',
      'CONTRALORIA GENERAL',
      'PROCURADURIA GENERAL',
      'ASAMBLEA NACIONAL',
      'PRESIDENCIA DE LA REPUBLICA',
      'VICEPRESIDENCIA DE LA REPUBLICA',
      'BANCO CENTRAL DEL ECUADOR',
      'BANCO DE DESARROLLO DEL ECUADOR',
      'BANECUADOR',
      'CORPORACION FINANCIERA NACIONAL',
      'POLICIA NACIONAL',
      'DIRECCION GENERAL DE REGISTRO CIVIL',
      'CONSEJO DE GOBIERNO DEL REGIMEN ESPECIAL',
    ].join('|') +
    ')\\b',
);

const UNIVERSITY_HEAD = /^(UNIVERSIDAD|ESCUELA POLITECNICA|ESCUELA SUPERIOR POLITECNICA)\b/;

/** Hospitales que no son pequeños: generales, de especialidades, docentes, del IESS… */
const LARGE_HOSPITAL = /\b(GENERAL|ESPECIALIDADES|DOCENTE|IESS|PEDIATRICO|GINECO|OBSTETRIC|PSIQUIATRICO|ONCOLOGIC|METROPOLITANO|MILITAR|NAVAL|POLICIA)/;
const SMALL_HOSPITAL = /\b(BASICO|DEL DIA)\b/;

/** La clase de una entidad PÚBLICA del SRI (RUC con tercer dígito 6), o `null` si no se ofrece. */
export function classifyEcPublicEntity(legalName: string | null | undefined): EcPublicEntityClass | null {
  const core = normalizeEcCompanyCore(legalName);
  if (core.length === 0) return null;

  const local = canonicalEcLocalGovernment(core);
  if (local !== null) {
    if (local.startsWith('GAD PROVINCIAL ') && PROVINCES.has(local.slice('GAD PROVINCIAL '.length))) {
      return { kind: 'provincial', macroIndustryKey: 'government', priority: 2 };
    }
    if (local.startsWith('GAD MUNICIPAL ') && LARGE_CANTONS.has(local.slice('GAD MUNICIPAL '.length))) {
      return { kind: 'municipal', macroIndustryKey: 'government', priority: 2 };
    }
    return null;
  }
  const bare = BARE_GAD.exec(core);
  if (bare && LARGE_CANTONS.has(bare[1])) return { kind: 'municipal', macroIndustryKey: 'government', priority: 2 };

  if (SUBUNIT.test(core) || SUBUNIT_TAIL.test(core)) return null;
  if (core.startsWith('HOSPITAL ')) {
    return LARGE_HOSPITAL.test(core) && !SMALL_HOSPITAL.test(core)
      ? { kind: 'hospital', macroIndustryKey: 'health_pharma', priority: 2 }
      : null;
  }
  if (UNIVERSITY_HEAD.test(core)) return { kind: 'university', macroIndustryKey: 'government', priority: 2 };
  if (NATIONAL_HEAD.test(core)) return { kind: 'national', macroIndustryKey: 'government', priority: 3 };
  return null;
}
