/**
 * co-entity-aliases.ts — siglas y apodos de las entidades públicas colombianas más
 * nombradas, para «Proveedores de una empresa».
 *
 * AUDIT-HARDENING-1 (seguimiento del PR #731, decisión de la dueña 16-10).
 *
 * Problema: el paso de compras públicas resuelve la referencia contra el registro de
 * entidades (`_registry`) por el NOMBRE OFICIAL (exacto, o su comienzo). Una sigla
 * nunca es el comienzo del nombre oficial: «ICBF» no encuentra «INSTITUTO COLOMBIANO
 * DE BIENESTAR FAMILIAR», «SENA» no encuentra «SERVICIO NACIONAL DE APRENDIZAJE»,
 * «DIAN» no encuentra la «UNIDAD ADMINISTRATIVA ESPECIAL DIRECCION DE IMPUESTOS Y
 * ADUANAS NACIONALES». Sin coincidencia el paso no corre justo en las entidades más
 * grandes y con más proveedores.
 *
 * Qué hace esta tabla: traduce la sigla al nombre oficial ANTES de buscar. No decide
 * la entidad: sólo cambia el texto que se busca. La elección sigue siendo la de
 * siempre (`_pickPublicBuyer`): una sola entidad, o ninguna; si el nombre oficial
 * coincidiera con varias, el paso responde `_ambiguous_entity` y no corre. Peor caso:
 * no hay coincidencia y todo queda como hoy.
 *
 * De dónde sale: los nombres y NIT se leyeron del dataset público SIGEP II de
 * datos.gov.co (h8rs-jxum) el 16-10-2026. Sólo entran entidades con UN NIT limpio de
 * 9 dígitos, sin NIT repetido con otra entidad y sin nombre dañado. El NIT va aquí
 * como PRUEBA para quien revisa y para `_verify-co-entity-aliases.ts`; la búsqueda
 * no lo usa. Las entidades con NIT sucio en el SIGEP (Ministerio del Trabajo,
 * Vivienda, Defensa, DPS, Ejército, Armada, UPTC…) se dejaron fuera a propósito:
 * hay que revisarlas a mano contra el registro cargado.
 *
 * Para agregar una: la sigla debe ser de USO COMÚN y apuntar a UNA sola entidad;
 * correr `_verify-co-entity-aliases.ts` (sólo lectura) y comprobar que resuelve a
 * ese NIT.
 *
 * Puro: sin red ni base.
 */

export type CoEntityAlias = {
  /** Siglas y apodos con los que la gente nombra a la entidad. */
  aliases: readonly string[];
  /** Nombre oficial (o su comienzo) tal como lo publica el SIGEP, sin tildes. */
  officialName: string;
  /** NIT sin dígito de verificación: prueba para revisar; la búsqueda no lo usa. */
  nit: string;
};

export const CO_PUBLIC_ENTITY_ALIASES: readonly CoEntityAlias[] = [
  { aliases: ['MINHACIENDA', 'MHCP'], officialName: 'MINISTERIO DE HACIENDA Y CREDITO PUBLICO', nit: '899999090' },
  { aliases: ['MINSALUD'], officialName: 'MINISTERIO DE SALUD Y PROTECCION SOCIAL', nit: '830115226' },
  { aliases: ['MINEDUCACION'], officialName: 'MINISTERIO DE EDUCACION NACIONAL', nit: '899999001' },
  { aliases: ['MINTIC'], officialName: 'MINISTERIO DE TECNOLOGIAS DE LA INFORMACION Y LAS COMUNICACIONES', nit: '899999053' },
  { aliases: ['MININTERIOR'], officialName: 'MINISTERIO DEL INTERIOR', nit: '830114475' },
  { aliases: ['MINJUSTICIA'], officialName: 'MINISTERIO DE JUSTICIA Y DEL DERECHO', nit: '900457461' },
  { aliases: ['MINAGRICULTURA'], officialName: 'MINISTERIO DE AGRICULTURA Y DESARROLLO RURAL', nit: '899999028' },
  { aliases: ['MINAMBIENTE'], officialName: 'MINISTERIO DE AMBIENTE Y DESARROLLO SOSTENIBLE', nit: '830115395' },
  { aliases: ['MINMINAS', 'MINENERGIA'], officialName: 'MINISTERIO DE MINAS Y ENERGIA', nit: '899999022' },
  { aliases: ['MINTRANSPORTE'], officialName: 'MINISTERIO DE TRANSPORTE', nit: '899999055' },
  { aliases: ['MINCOMERCIO'], officialName: 'MINISTERIO DE COMERCIO, INDUSTRIA Y TURISMO', nit: '830115297' },
  { aliases: ['MINCULTURA'], officialName: 'MINISTERIO DE LAS CULTURAS, LAS ARTES Y LOS SABERES', nit: '830034348' },
  { aliases: ['MINCIENCIAS'], officialName: 'MINISTERIO DE CIENCIA, TECNOLOGIA E INNOVACION', nit: '899999296' },
  { aliases: ['CANCILLERIA'], officialName: 'MINISTERIO DE RELACIONES EXTERIORES', nit: '899999042' },
  { aliases: ['MINDEPORTE'], officialName: 'MINISTERIO DEL DEPORTE', nit: '899999306' },
  { aliases: ['MINIGUALDAD'], officialName: 'MINISTERIO DE IGUALDAD Y EQUIDAD', nit: '901733502' },
  { aliases: ['DNP'], officialName: 'DEPARTAMENTO NACIONAL DE PLANEACION', nit: '899999011' },
  { aliases: ['DANE'], officialName: 'DEPARTAMENTO ADMINISTRATIVO NACIONAL DE ESTADISTICA', nit: '899999027' },
  { aliases: ['DAPRE'], officialName: 'DEPARTAMENTO ADMINISTRATIVO DE LA PRESIDENCIA DE LA REPUBLICA', nit: '899999083' },
  { aliases: ['DAFP', 'FUNCION PUBLICA'], officialName: 'DEPARTAMENTO ADMINISTRATIVO DE LA FUNCION PUBLICA', nit: '899999020' },
  { aliases: ['ICBF'], officialName: 'INSTITUTO COLOMBIANO DE BIENESTAR FAMILIAR', nit: '899999239' },
  { aliases: ['SENA'], officialName: 'SERVICIO NACIONAL DE APRENDIZAJE', nit: '899999034' },
  { aliases: ['DIAN'], officialName: 'UNIDAD ADMINISTRATIVA ESPECIAL DIRECCION DE IMPUESTOS Y ADUANAS NACIONALES', nit: '800197268' },
  { aliases: ['INVIAS'], officialName: 'INSTITUTO NACIONAL DE VIAS', nit: '800215807' },
  { aliases: ['ANI'], officialName: 'AGENCIA NACIONAL DE INFRAESTRUCTURA', nit: '830125996' },
  { aliases: ['ANLA'], officialName: 'AUTORIDAD NACIONAL DE LICENCIAS AMBIENTALES', nit: '900467239' },
  { aliases: ['IDEAM'], officialName: 'INSTITUTO DE HIDROLOGIA, METEOROLOGIA Y ESTUDIOS AMBIENTALES', nit: '830000602' },
  { aliases: ['INS'], officialName: 'INSTITUTO NACIONAL DE SALUD', nit: '899999403' },
  { aliases: ['INVIMA'], officialName: 'INSTITUTO NACIONAL DE VIGILANCIA DE MEDICAMENTOS Y ALIMENTOS', nit: '830000167' },
  { aliases: ['IGAC'], officialName: 'INSTITUTO GEOGRAFICO AGUSTIN CODAZZI', nit: '899999004' },
  { aliases: ['ICETEX'], officialName: 'INSTITUTO COLOMBIANO DE CREDITO EDUCATIVO Y ESTUDIOS TECNICOS EN EL EXTERIOR', nit: '899999035' },
  { aliases: ['ICFES'], officialName: 'INSTITUTO COLOMBIANO PARA LA EVALUACION DE LA EDUCACION', nit: '860024301' },
  { aliases: ['ICA'], officialName: 'INSTITUTO COLOMBIANO AGROPECUARIO', nit: '899999069' },
  { aliases: ['INPEC'], officialName: 'INSTITUTO NACIONAL PENITENCIARIO Y CARCELARIO', nit: '800546215' },
  { aliases: ['MIGRACION COLOMBIA'], officialName: 'UNIDAD ADMINISTRATIVA ESPECIAL MIGRACION COLOMBIA', nit: '900477235' },
  { aliases: ['UNGRD'], officialName: 'UNIDAD NACIONAL PARA LA GESTION DEL RIESGO DE DESASTRES', nit: '900478966' },
  { aliases: ['UARIV'], officialName: 'UNIDAD ADMINISTRATIVA ESPECIAL PARA LA ATENCION Y REPARACION INTEGRAL A LAS VICTIMAS', nit: '900490473' },
  { aliases: ['ANT'], officialName: 'AGENCIA NACIONAL DE TIERRAS', nit: '900948953' },
  { aliases: ['ADR'], officialName: 'AGENCIA DE DESARROLLO RURAL', nit: '900948958' },
  { aliases: ['ANE'], officialName: 'AGENCIA NACIONAL DEL ESPECTRO', nit: '900334265' },
  { aliases: ['ANH'], officialName: 'AGENCIA NACIONAL DE HIDROCARBUROS', nit: '830127607' },
  { aliases: ['ANM'], officialName: 'AGENCIA NACIONAL DE MINERIA', nit: '900500018' },
  { aliases: ['CRC'], officialName: 'COMISION DE REGULACION DE COMUNICACIONES', nit: '830002593' },
  { aliases: ['CREG'], officialName: 'COMISION DE REGULACION DE ENERGIA Y GAS', nit: '900034993' },
  { aliases: ['UPME'], officialName: 'UNIDAD DE PLANEACION MINERO ENERGETICA', nit: '830000282' },
  { aliases: ['UNP'], officialName: 'UNIDAD NACIONAL DE PROTECCION', nit: '900475780' },
  { aliases: ['COLPENSIONES'], officialName: 'ADMINISTRADORA COLOMBIANA DE PENSIONES', nit: '900336004' },
  { aliases: ['COLOMBIA COMPRA EFICIENTE', 'CCE'], officialName: 'AGENCIA NACIONAL DE CONTRATACION PUBLICA', nit: '900514813' },
  { aliases: ['ESAP'], officialName: 'ESCUELA SUPERIOR DE ADMINISTRACION PUBLICA', nit: '899999054' },
  { aliases: ['FNA'], officialName: 'FONDO NACIONAL DE AHORRO', nit: '899999284' },
  { aliases: ['AEROCIVIL'], officialName: 'UNIDAD ADMINISTRATIVA ESPECIAL DE AERONAUTICA CIVIL', nit: '899999059' },
  { aliases: ['UGPP'], officialName: 'UNIDAD ADMINISTRATIVA ESPECIAL DE GESTION PENSIONAL Y CONTRIBUCIONES PARAFISCALES', nit: '900373913' },
  { aliases: ['UPRA'], officialName: 'UNIDAD DE PLANIFICACION DE TIERRAS RURALES', nit: '900479658' },
  { aliases: ['SGC'], officialName: 'SERVICIO GEOLOGICO COLOMBIANO', nit: '899999294' },
  { aliases: ['INSOR'], officialName: 'INSTITUTO NACIONAL PARA SORDOS', nit: '860016627' },
  { aliases: ['INCI'], officialName: 'INSTITUTO NACIONAL PARA CIEGOS', nit: '860015971' },
  { aliases: ['SUPERSALUD'], officialName: 'SUPERINTENDENCIA NACIONAL DE SALUD', nit: '860062187' },
  { aliases: ['SIC'], officialName: 'SUPERINTENDENCIA DE INDUSTRIA Y COMERCIO', nit: '800176089' },
  { aliases: ['SUPERSOCIEDADES'], officialName: 'SUPERINTENDENCIA DE SOCIEDADES', nit: '899999086' },
  { aliases: ['SFC', 'SUPERFINANCIERA'], officialName: 'SUPERINTENDENCIA FINANCIERA DE COLOMBIA', nit: '890999057' },
  { aliases: ['SUPERSERVICIOS'], officialName: 'SUPERINTENDENCIA DE SERVICIOS PUBLICOS DOMICILIARIOS', nit: '800250984' },
  { aliases: ['SUPERSUBSIDIO'], officialName: 'SUPERINTENDENCIA DEL SUBSIDIO FAMILIAR', nit: '860503600' },
  { aliases: ['SUPERTRANSPORTE'], officialName: 'SUPERINTENDENCIA DE TRANSPORTE', nit: '800170433' },
  { aliases: ['SNR', 'SUPERNOTARIADO'], officialName: 'SUPERINTENDENCIA DE NOTARIADO Y REGISTRO', nit: '899999007' },
  { aliases: ['SUPERVIGILANCIA'], officialName: 'SUPERINTENDENCIA DE VIGILANCIA Y SEGURIDAD PRIVADA', nit: '800217123' },
  { aliases: ['SUPERSOLIDARIA'], officialName: 'SUPERINTENDENCIA DE LA ECONOMIA SOLIDARIA', nit: '830053043' },
  { aliases: ['CNE'], officialName: 'CONSEJO NACIONAL ELECTORAL', nit: '901717412' },
  { aliases: ['POLICIA NACIONAL', 'PONAL'], officialName: 'DIRECCION GENERAL DE LA POLICIA NACIONAL', nit: '800141397' },
  { aliases: ['ANDJE'], officialName: 'AGENCIA NACIONAL DE DEFENSA JURIDICA DEL ESTADO', nit: '900507741' },
  { aliases: ['ANSV'], officialName: 'AGENCIA NACIONAL DE SEGURIDAD VIAL', nit: '900852998' },
  { aliases: ['UIAF'], officialName: 'UNIDAD DE INFORMACION Y ANALISIS FINANCIERO', nit: '830068074' },
  { aliases: ['MEDICINA LEGAL', 'INMLCF'], officialName: 'INSTITUTO NACIONAL DE MEDICINA LEGAL Y CIENCIAS FORENSES', nit: '800150861' },
  { aliases: ['FONDO ADAPTACION'], officialName: 'FONDO ADAPTACION', nit: '900450205' },
  { aliases: ['ICANH'], officialName: 'INSTITUTO COLOMBIANO DE ANTROPOLOGIA E HISTORIA', nit: '830067892' },
  { aliases: ['UASPE'], officialName: 'UNIDAD ADMINISTRATIVA ESPECIAL DEL SERVICIO PUBLICO DE EMPLEO', nit: '900678508' },
  { aliases: ['PNN'], officialName: 'PARQUES NACIONALES NATURALES DE COLOMBIA', nit: '830016624' },
  { aliases: ['AGN'], officialName: 'ARCHIVO GENERAL DE LA NACION', nit: '800128835' },
  { aliases: ['CASUR'], officialName: 'CAJA DE SUELDOS DE RETIRO DE LA POLICIA NACIONAL', nit: '899999073' },
  { aliases: ['UNAL'], officialName: 'UNIVERSIDAD NACIONAL DE COLOMBIA', nit: '899999063' },
  { aliases: ['UPN'], officialName: 'UNIVERSIDAD PEDAGOGICA NACIONAL', nit: '899999124' },
  { aliases: ['UNAD'], officialName: 'UNIVERSIDAD NACIONAL ABIERTA Y A DISTANCIA', nit: '860512780' },
  { aliases: ['UIS'], officialName: 'UNIVERSIDAD INDUSTRIAL DE SANTANDER', nit: '890201213' },
  { aliases: ['UTP'], officialName: 'UNIVERSIDAD TECNOLOGICA DE PEREIRA', nit: '891480035' },
  { aliases: ['UNIVALLE'], officialName: 'UNIVERSIDAD DEL VALLE', nit: '890399010' },
  { aliases: ['UNICAUCA'], officialName: 'UNIVERSIDAD DEL CAUCA', nit: '891500319' },
  { aliases: ['UNICARTAGENA'], officialName: 'UNIVERSIDAD DE CARTAGENA', nit: '890480123' },
  { aliases: ['UDISTRITAL'], officialName: 'UNIVERSIDAD DISTRITAL FRANCISCO JOSE DE CALDAS', nit: '899999230' },
];

/**
 * Clave de comparación de una sigla: sin tildes, mayúsculas, sin puntos ni espacios
 * («I.C.B.F.» y «icbf» dan lo mismo; «Min Salud» y «MinSalud» también) y sin el
 * artículo inicial («la DIAN»).
 */
export function coEntityAliasKey(raw: string): string {
  const words = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[.'"`´]/g, '')
    .replace(/[^A-Z0-9Ñ]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length > 1 && (words[0] === 'LA' || words[0] === 'EL')) words.shift();
  return words.join('');
}

const ALIAS_INDEX: ReadonlyMap<string, CoEntityAlias> = new Map(
  CO_PUBLIC_ENTITY_ALIASES.flatMap((entry) => entry.aliases.map((alias) => [coEntityAliasKey(alias), entry] as const)),
);

/**
 * La entidad que nombra la referencia SI la referencia ES una sigla conocida (toda
 * la referencia, no un fragmento: «ICBF» sí, «ICBF Bogotá» no), o `null`.
 */
export function findCoEntityAlias(reference: string): CoEntityAlias | null {
  const key = coEntityAliasKey(reference);
  return key === '' ? null : (ALIAS_INDEX.get(key) ?? null);
}

/** Nombre oficial al que se traduce la sigla, o `null` si no es una sigla conocida. */
export function resolveCoEntityAlias(reference: string): string | null {
  return findCoEntityAlias(reference)?.officialName ?? null;
}
