/**
 * cl-name-keys.ts — claves de nombre de Chile para el RUT por nombre: variantes del
 * nombre del candidato, siglas de organismos públicos y nombre comercial dentro de
 * la razón social del SII.
 *
 * SOURCES-CL-NAME-ALIAS-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué hace falta (medido el 07-10-2026 en Producción) ─────────────────
 *
 * Desde el 01-10, de las empresas chilenas en revisión no traían RUT 50 de 66 de
 * Apollo y 36 de 40 de la búsqueda web. Además del núcleo exacto de siempre
 * (`normalizeChileSiiCore`), fallaban tres formas:
 *
 *   1. El candidato llega con restos de la web o con dos nombres juntos:
 *      «Sernac.cl», «PDI- Policía de Investigaciones de Chile», «Subsecretaría de
 *      Desarrollo Regional y Administrativo | Subdere», «Servicio Nacional para la
 *      Prevención … (SENDA)», «INJUV Chile».
 *   2. Los organismos públicos se conocen por su SIGLA (INJUV, Junaeb, SENDA, PDI),
 *      que el SII no guarda: «INSTITUTO NACIONAL DE LA JUVENTUD».
 *   3. El nombre comercial va al final de una razón social larga: «Transemel» es
 *      «EMPRESA DE TRANSMISION ELECTRICA TRANSEMEL S A».
 *
 * Las variantes (1) y las siglas (2) viven en el código. El nombre comercial (3)
 * necesita mirar el registro entero (¿esa palabra es de UNA sola sociedad?), así
 * que se calcula en la carga y se guarda en una fuente aparte (`cl_sii_name_alias`).
 * Ninguna regla es difusa: cada clave sigue siendo una igualdad exacta.
 */

import { normalizeChileSiiCore } from './cl-sii-registry-rows';

/** De dónde sale una variante del nombre del candidato. */
export type ChileNameVariantOrigin = 'core' | 'web_name' | 'name_part' | 'without_country';

export type ChileNameVariant = { core: string; origin: ChileNameVariantOrigin };

/** Fin de un nombre armado desde la web («Sernac.cl», «Sscoquimbo.redsalud.gob.cl»). */
const WEB_SUFFIX = /\.(?:gob\.cl|gov\.cl|cl|com|org|net)$/i;

/** Separadores entre dos nombres de la misma entidad: « - », «PDI- …», « | », paréntesis. */
const NAME_PART_SEPARATOR = /\s+[-–|]\s*|\s*[-–|]\s+|\s*\|\s*|[()]/;

/** Palabras mínimas de una parte que no es la primera para probarla sola. */
const NAME_PART_MIN_WORDS = 3;

/**
 * Nombres a probar, en orden y sin repetir: el núcleo de siempre, el nombre sin
 * restos de la web, cada parte de un nombre doble y el núcleo sin «Chile» al final.
 * La PRIMERA variante con alguna sociedad decide (lo hace el resolvedor).
 */
export function chileCandidateNameVariants(name: string | null | undefined): ChileNameVariant[] {
  const raw = typeof name === 'string' ? name.trim() : '';
  if (raw.length === 0) return [];
  const out: ChileNameVariant[] = [];
  const seen = new Set<string>();
  const add = (text: string, origin: ChileNameVariantOrigin): void => {
    const core = normalizeChileSiiCore(text);
    if (core.length < 2 || seen.has(core)) return;
    seen.add(core);
    out.push({ core, origin });
  };

  add(raw, 'core');

  if (WEB_SUFFIX.test(raw) && !/\s/.test(raw)) {
    add(raw.replace(WEB_SUFFIX, '').split('.')[0] ?? '', 'web_name');
  }

  // La primera parte siempre; las demás sólo si son un nombre completo (3+ palabras)
  // o la sigla de un organismo público: «Unipdata - Customer Analytics» no debe
  // probar «Customer Analytics», que puede ser otra sociedad.
  const parts = raw.split(NAME_PART_SEPARATOR).map((part) => part.trim()).filter((part) => part.length >= 2);
  if (parts.length > 1) {
    parts.forEach((part, index) => {
      const core = normalizeChileSiiCore(part);
      const isSigla = !core.includes(' ') && core in CL_PUBLIC_ENTITY_SIGLAS;
      if (index === 0 || isSigla || core.split(' ').length >= NAME_PART_MIN_WORDS) add(part, 'name_part');
    });
  }

  for (const variant of [...out]) {
    const words = variant.core.split(' ');
    if (words.length >= 2 && words[words.length - 1] === 'CHILE') add(words.slice(0, -1).join(' '), 'without_country');
  }
  return out;
}

/** Un organismo público conocido por su sigla, con el RUT del SII (verificado el 07-10-2026). */
export type ChilePublicEntitySigla = {
  rut: string;
  /** Núcleo de su razón social en `cl_sii_registry`. */
  legalName: string;
  /** Webs oficiales: con una de ellas, la sigla basta aunque sea corta. */
  domains: readonly string[];
  /** La sigla es también una palabra común: nunca vale sin su web. */
  requiresDomain?: boolean;
};

/** Siglas de 5+ letras valen solas; las más cortas sólo con una web oficial. */
export const CL_SIGLA_MIN_LENGTH_WITHOUT_DOMAIN = 5;

/**
 * Organismos públicos y empresas del Estado por su sigla. Cada RUT se leyó del SII
 * (`cl_sii_registry`) el 07-10-2026 por su razón social exacta; se dejaron fuera los
 * que el SII tiene con varios RUT (Sernapesca, Registro Civil por oficinas).
 */
export const CL_PUBLIC_ENTITY_SIGLAS: Readonly<Record<string, ChilePublicEntitySigla>> = Object.freeze({
  INJUV: { rut: '60110000-2', legalName: 'INSTITUTO NACIONAL DE LA JUVENTUD', domains: ['injuv.gob.cl', 'injuv.cl'] },
  JUNAEB: { rut: '60908000-0', legalName: 'JUNTA NACIONAL DE AUXILIO ESCOLAR Y BECA', domains: ['junaeb.cl', 'junaeb.gob.cl'] },
  PDI: { rut: '60506000-5', legalName: 'POLICIA DE INVESTIGACIONES DE CHILE', domains: ['pdichile.cl', 'investigaciones.cl'] },
  SERNAMEG: { rut: '60107000-6', legalName: 'SERVICIO NACIONAL DE LA MUJER Y LA EQUIDAD DE GENERO', domains: ['sernameg.gob.cl'] },
  SERNAC: { rut: '60702000-0', legalName: 'SERVICIO NACIONAL DEL CONSUMIDOR', domains: ['sernac.cl'] },
  SUBDERE: { rut: '60515000-4', legalName: 'SUBSECRETARIA DE DESARROLLO REGIONAL Y ADMINISTRATIVO', domains: ['subdere.gov.cl', 'subdere.gob.cl'] },
  SENDA: {
    rut: '61980170-9',
    legalName: 'SERVICIO NACIONAL PARA LA PREVENCION Y REHABILITACION DEL CONSUMO DE DROGAS Y AL',
    domains: ['senda.gob.cl'],
  },
  CORFO: { rut: '60706000-2', legalName: 'CORPORACION DE FOMENTO DE LA PRODUCCION', domains: ['corfo.cl', 'corfo.gob.cl'] },
  SENCE: { rut: '61531000-K', legalName: 'SERVICIO NACIONAL DE CAPACITACION Y EMPLEO', domains: ['sence.cl', 'sence.gob.cl'] },
  SERNATUR: { rut: '60704000-1', legalName: 'SERVICIO NACIONAL DE TURISMO', domains: ['sernatur.cl'] },
  INDAP: { rut: '61307000-1', legalName: 'INSTITUTO DE DESARROLLO AGROPECUARIO', domains: ['indap.gob.cl', 'indap.cl'] },
  SAG: { rut: '61308000-7', legalName: 'SERVICIO AGRICOLA Y GANADERO', domains: ['sag.gob.cl', 'sag.cl'] },
  JUNJI: { rut: '70072600-2', legalName: 'JUNTA NACIONAL DE JARDINES INFANTILES', domains: ['junji.gob.cl', 'junji.cl'] },
  FONASA: { rut: '61603000-0', legalName: 'FONDO NACIONAL DE SALUD', domains: ['fonasa.cl', 'fonasa.gob.cl'] },
  ISP: { rut: '61605000-1', legalName: 'INSTITUTO DE SALUD PUBLICA DE CHILE', domains: ['ispch.cl', 'ispch.gob.cl'] },
  CENABAST: {
    rut: '61608700-2',
    legalName: 'CENTRAL DE ABASTECIMIENTO DEL SISTEMA NACIONAL DE SERVICIO DE SALUD',
    domains: ['cenabast.cl'],
  },
  SII: { rut: '60803000-K', legalName: 'SERVICIO DE IMPUESTOS INTERNOS DIRECCION', domains: ['sii.cl'] },
  TGR: { rut: '60805000-0', legalName: 'TESORERIA GENERAL DE LA REPUBLICA', domains: ['tgr.cl'] },
  SERNAGEOMIN: { rut: '61702000-9', legalName: 'SERVICIO NACIONAL DE GEOLOGIA Y MINERIA', domains: ['sernageomin.cl'] },
  DGAC: { rut: '61104000-8', legalName: 'DIRECCION GENERAL DE AERONAUTICA CIVIL', domains: ['dgac.gob.cl', 'dgac.cl'] },
  INE: { rut: '60703000-6', legalName: 'INSTITUTO NACIONAL DE ESTADISTICAS', domains: ['ine.gob.cl', 'ine.cl'] },
  CMF: { rut: '60810000-8', legalName: 'COMISION PARA EL MERCADO FINANCIERO', domains: ['cmfchile.cl'] },
  ENAP: { rut: '92604000-6', legalName: 'EMPRESA NACIONAL DEL PETROLEO', domains: ['enap.cl'] },
  CODELCO: { rut: '61704000-K', legalName: 'CORP NACIONAL DEL COBRE DE CHILE', domains: ['codelco.com', 'codelco.cl'] },
  ENAMI: { rut: '61703000-4', legalName: 'EMPRESA NACIONAL DE MINERIA', domains: ['enami.cl'] },
  EFE: { rut: '61216000-7', legalName: 'EMPRESA DE LOS FERROCARRILES DEL ESTADO', domains: ['efe.cl'] },
  ENAER: { rut: '61113000-7', legalName: 'EMPRESA NACIONAL DE AERONAUTICA DE CHILE', domains: ['enaer.cl'] },
  TVN: { rut: '81689800-5', legalName: 'TELEVISION NACIONAL DE CHILE', domains: ['tvn.cl'] },
  ZOFRI: { rut: '70285500-4', legalName: 'ZONA FRANCA DE IQUIQUE', domains: ['zofri.cl'] },
  ANID: { rut: '60915000-9', legalName: 'AGENCIA NACIONAL DE INVESTIGACION Y DESARROLLO', domains: ['anid.cl'] },
  SUSESO: { rut: '61509000-K', legalName: 'SUPERINTENDENCIA DE SEGURIDAD SOCIAL', domains: ['suseso.cl', 'suseso.gob.cl'] },
  CAPREDENA: { rut: '61108000-K', legalName: 'CAJA DE PREVISION DE LA DEFENSA NACIONAL', domains: ['capredena.cl', 'capredena.gob.cl'] },
  IPS: { rut: '61979440-0', legalName: 'INSTITUTO DE PREVISION SOCIAL', domains: ['ips.gob.cl'] },
  FOSIS: { rut: '60109000-7', legalName: 'FONDO DE SOLIDARIDAD E INVERSION SOCIAL', domains: ['fosis.gob.cl', 'fosis.cl'] },
  SENADIS: { rut: '72576700-5', legalName: 'SERVICIO NACIONAL DE LA DISCAPACIDAD', domains: ['senadis.gob.cl', 'senadis.cl'] },
  SENAMA: { rut: '61961000-8', legalName: 'SERVICIO NACIONAL DEL ADULTO MAYOR', domains: ['senama.gob.cl', 'senama.cl'] },
  SENAME: { rut: '61008000-6', legalName: 'SERVICIO NACIONAL DE MENORES', domains: ['sename.cl'] },
  CNE: { rut: '61707000-6', legalName: 'COMISION NACIONAL DE ENERGIA', domains: ['cne.cl'] },
  SML: { rut: '61003000-9', legalName: 'SERVICIO MEDICO LEGAL', domains: ['sml.gob.cl', 'sml.cl'] },
  DT: { rut: '61502000-1', legalName: 'DIRECCION DEL TRABAJO', domains: ['dt.gob.cl', 'direcciondeltrabajo.cl'] },
  SUPERSALUD: { rut: '60819000-7', legalName: 'SUPERINTENDENCIA DE SALUD', domains: ['supersalud.gob.cl', 'supersalud.cl'] },
  SMA: { rut: '61979950-K', legalName: 'SUPERINTENDENCIA DEL MEDIO AMBIENTE', domains: ['sma.gob.cl'] },
  SEC: { rut: '60510000-7', legalName: 'SUPERINTENDENCIA DE ELECTRICIDAD Y COMBUSTIBLES', domains: ['sec.cl', 'sec.gob.cl'] },
  SISS: { rut: '61221000-4', legalName: 'SUPERINTENDENCIA DE SERVICIOS SANITARIOS', domains: ['siss.gob.cl', 'siss.cl'] },
  CHILECOMPRA: { rut: '60808000-7', legalName: 'DIRECCION DE COMPRAS Y CONTRATACION PUBLICA', domains: ['chilecompra.cl'] },
  IND: { rut: '61107000-4', legalName: 'INSTITUTO NACIONAL DE DEPORTES DE CHILE', domains: ['ind.cl', 'ind.gob.cl'] },
  CDE: { rut: '61006000-5', legalName: 'CONSEJO DE DEFENSA DEL ESTADO', domains: ['cde.cl', 'cde.gob.cl'] },
  ADUANA: { rut: '60804000-5', legalName: 'SERVICIO NACIONAL DE ADUANAS', domains: ['aduana.cl'] },
  SENAPRED: { rut: '60509001-K', legalName: 'SERVICIO NACIONAL DE PREVENCION Y RESPUESTA ANTE DESASTRES', domains: ['senapred.cl', 'senapred.gob.cl'] },
  DIRECTEMAR: { rut: '61102014-7', legalName: 'DIRECCION GENERAL DEL TERRITORIO MARITIMO Y M M', domains: ['directemar.cl'] },
  CNR: { rut: '60718000-8', legalName: 'COMISION NACIONAL DE RIEGO', domains: ['cnr.gob.cl', 'cnr.cl'] },
  ENTEL: { rut: '92580000-7', legalName: 'EMPRESA NACIONAL DE TELECOMUNICACIONES', domains: ['entel.cl'] },
  BANCOESTADO: { rut: '97030000-7', legalName: 'BANCO DEL ESTADO DE CHILE', domains: ['bancoestado.cl'] },
  USACH: { rut: '60911000-7', legalName: 'UNIVERSIDAD DE SANTIAGO DE CHILE', domains: ['usach.cl'] },
  // «Metro» es una palabra común: sólo con su web oficial.
  METRO: {
    rut: '61219000-3',
    legalName: 'EMPRESA DE TRANSPORTE DE PASAJEROS METRO',
    domains: ['metro.cl', 'metrosantiago.cl'],
    requiresDomain: true,
  },
});

/** Dominio sin protocolo, sin «www.» y en minúsculas. */
function plainDomain(domainOrUrl: string | null | undefined): string | null {
  if (typeof domainOrUrl !== 'string' || domainOrUrl.trim().length === 0) return null;
  try {
    const url = domainOrUrl.includes('://') ? domainOrUrl : `https://${domainOrUrl}`;
    return new URL(url).hostname.toLowerCase().replace(/^www\d*\./, '');
  } catch {
    return null;
  }
}

/**
 * La sigla de un organismo público, si alguna variante del nombre la es. Una sigla
 * de 5+ letras basta sola; una más corta (PDI, SAG, DT) sólo con una de sus webs
 * oficiales, que la confirma. Con la web oficial también vale aunque el nombre no
 * sea la sigla («Policía de Investigaciones» en pdichile.cl lo resuelve el núcleo).
 */
export function chilePublicEntityBySigla(
  variants: readonly ChileNameVariant[],
  domainOrUrl: string | null | undefined,
): ChilePublicEntitySigla | null {
  const domain = plainDomain(domainOrUrl);
  for (const variant of variants) {
    if (variant.core.includes(' ')) continue;
    const entity = CL_PUBLIC_ENTITY_SIGLAS[variant.core];
    if (!entity) continue;
    const domainConfirms = domain !== null && entity.domains.some((d) => domain === d || domain.endsWith(`.${d}`));
    if (domainConfirms) return entity;
    if (entity.requiresDomain !== true && variant.core.length >= CL_SIGLA_MIN_LENGTH_WITHOUT_DOMAIN) return entity;
  }
  return null;
}

/** Una marca de un grupo grande, con la sociedad que la opera según el SII. */
export type ChileGroupBrand = {
  rut: string;
  /** Núcleo de su razón social en `cl_sii_registry`. */
  legalName: string;
  /** Webs oficiales de la marca: sin una de ellas, la marca nunca decide. */
  domains: readonly string[];
};

/**
 * SOURCES-CL-RETAIL-BRANDS-1 — marcas de los grupos grandes del comercio cuyo nombre no
 * es el de la sociedad que las opera. Prod 07-10 (Chile × Retail, 070a2921): «Paris» es
 * PARIS ADMINISTRADORA (Cencosud), pero el SII tiene otras 5 sociedades «PARIS» sin
 * trabajadores. Cada RUT se leyó del SII el 07-10-2026 (la sociedad con más
 * trabajadores de la marca). Son palabras comunes: SIEMPRE con su web oficial.
 */
export const CL_GROUP_BRANDS: Readonly<Record<string, ChileGroupBrand>> = Object.freeze({
  PARIS: { rut: '96973670-5', legalName: 'PARIS ADMINISTRADORA', domains: ['paris.cl'] },
  JUMBO: { rut: '76134941-4', legalName: 'ADMINISTRADORA DE SUPERMERCADOS HIPER', domains: ['jumbo.cl'] },
  'SANTA ISABEL': { rut: '76134946-5', legalName: 'ADMINISTRADORA DE SUPERMERCADOS EXPRESS', domains: ['santaisabel.cl'] },
  EASY: { rut: '77562427-2', legalName: 'EASY ADMINISTRADORA', domains: ['easy.cl'] },
  LIDER: { rut: '76042014-K', legalName: 'WALMART CHILE', domains: ['lider.cl', 'walmartchile.cl'] },
  UNIMARC: { rut: '81537600-5', legalName: 'RENDIC HERMANOS', domains: ['unimarc.cl'] },
  TOTTUS: { rut: '78627210-6', legalName: 'HIPERMERCADOS TOTTUS', domains: ['tottus.cl'] },
  RIPLEY: { rut: '83382700-6', legalName: 'COMERCIAL ECCSA', domains: ['ripley.cl'] },
  'CRUZ VERDE': { rut: '89807200-2', legalName: 'FARMACIAS CRUZ VERDE', domains: ['cruzverde.cl'] },
  AHUMADA: { rut: '76378831-8', legalName: 'FARMACIAS AHUMADA', domains: ['farmaciasahumada.cl'] },
});

/** Palabras de comercio que se quitan del principio para reconocer la marca («Supermercado Jumbo»). */
const BRAND_LEADING_WORDS = /^(?:SUPERMERCADOS?|HIPERMERCADOS?|HIPER|TIENDAS?|FARMACIAS?)\s+/;

/**
 * La marca de un grupo grande, si alguna variante del nombre la es y la web del
 * candidato es la oficial de esa marca. Sin web oficial, nunca.
 */
export function chileGroupBrandByDomain(
  variants: readonly ChileNameVariant[],
  domainOrUrl: string | null | undefined,
): ChileGroupBrand | null {
  const domain = plainDomain(domainOrUrl);
  if (domain === null) return null;
  for (const variant of variants) {
    const brand = CL_GROUP_BRANDS[variant.core] ?? CL_GROUP_BRANDS[variant.core.replace(BRAND_LEADING_WORDS, '')];
    if (!brand) continue;
    if (brand.domains.some((d) => domain === d || domain.endsWith(`.${d}`))) return brand;
  }
  return null;
}

/** Una entidad de las tablas curadas (marca de grupo o sigla pública). */
export type ChileOfficialDomainEntity = { rut: string; legalName: string; via: 'group_brand' | 'public_entity_sigla' };

/**
 * SOURCES-CL-OFFICIAL-DOMAIN-1 — la web del candidato ES la oficial de una marca de
 * grupo o de un organismo público de las tablas: eso basta, aunque el nombre venga
 * mal armado. Prod 07-10 (Chile × Retail, ecf6b342): la búsqueda web trajo «Tiendas y
 * horarios Easy» (el título de la página) con easy.cl y quedó sin RUT. Las webs de las
 * tablas son de UNA sola entidad cada una; un subdominio también es suyo.
 */
export function chileEntityByOfficialDomain(domainOrUrl: string | null | undefined): ChileOfficialDomainEntity | null {
  const domain = plainDomain(domainOrUrl);
  if (domain === null) return null;
  const owns = (domains: readonly string[]) => domains.some((d) => domain === d || domain.endsWith(`.${d}`));
  for (const brand of Object.values(CL_GROUP_BRANDS)) {
    if (owns(brand.domains)) return { rut: brand.rut, legalName: brand.legalName, via: 'group_brand' };
  }
  for (const entity of Object.values(CL_PUBLIC_ENTITY_SIGLAS)) {
    if (owns(entity.domains)) return { rut: entity.rut, legalName: entity.legalName, via: 'public_entity_sigla' };
  }
  return null;
}

/**
 * SOURCES-CL-RETAIL-BRANDS-1 — desempate de homónimos por tamaño: si un nombre exacto
 * lo comparten varias sociedades y UNA sola informa este mínimo de trabajadores
 * mientras las demás informan 0 o nada, es esa. Prod 07-10: «TRICOT» = TRICOT S.A.
 * (130 trabajadores) y otra sociedad sin trabajadores.
 */
export const CL_HOMONYM_MIN_WORKERS = 50;

/**
 * Trabajadores mínimos del dueño de un nombre comercial guardado como alias. Lo que
 * protege es la unicidad (la palabra sale en UNA sola sociedad); el mínimo sólo deja
 * fuera a las sociedades sin actividad. Transemel informa 18 (Prod 07-10).
 */
export const CL_BRAND_ALIAS_MIN_WORKERS = 10;

/** Largo mínimo de la palabra que hace de nombre comercial. */
export const CL_BRAND_ALIAS_MIN_LENGTH = 5;

/**
 * Palabras que nunca son un nombre comercial aunque cierren una razón social. La
 * regla de unicidad (la palabra sale en UNA sola sociedad de todo el registro) ya
 * descarta casi todas; esta lista sólo evita alias absurdos en sociedades únicas.
 */
const NOT_A_BRAND: ReadonlySet<string> = new Set([
  'CHILE', 'CHILENA', 'CHILENO', 'SANTIAGO', 'INTERNACIONAL', 'INTERNATIONAL', 'INVERSIONES', 'SERVICIOS',
  'COMERCIAL', 'COMERCIALIZADORA', 'INGENIERIA', 'CONSTRUCCION', 'CONSTRUCCIONES', 'CONSTRUCTORA',
  'INMOBILIARIA', 'TRANSPORTES', 'TRANSPORTE', 'SALUD', 'MEDICA', 'MEDICOS', 'CLINICA', 'CAPACITACION',
  'ASESORIAS', 'CONSULTORES', 'CONSULTORIA', 'GROUP', 'GRUPO', 'HOLDING', 'CORPORACION', 'FUNDACION',
  'SOCIEDAD', 'EMPRESA', 'EMPRESAS', 'COMPANIA', 'INDUSTRIAL', 'INDUSTRIAS', 'LIMITADA', 'AGRICOLA',
  'FORESTAL', 'MINERA', 'ENERGIA', 'ELECTRICA', 'SEGURIDAD', 'PROFESIONALES', 'PRODUCCIONES', 'ALIMENTOS',
  'DISTRIBUIDORA', 'IMPORTADORA', 'EXPORTADORA', 'TECNOLOGIA', 'TECNOLOGIAS', 'SOLUCIONES', 'SISTEMAS',
  'LOGISTICA', 'NORTE', 'ORIENTE', 'PONIENTE', 'CENTRAL', 'METROPOLITANA', 'METROPOLITANO', 'REGIONAL',
  'NACIONAL', 'ESTADO', 'PROVINCIAL', 'COMUNAL', 'MUNICIPAL', 'EDUCACIONAL', 'EDUCACION', 'DEPORTES',
]);

/**
 * La palabra final de una razón social que PUEDE ser su nombre comercial
 * («EMPRESA DE TRANSMISION ELECTRICA TRANSEMEL» → «TRANSEMEL»), o null. La carga
 * sólo la guarda si además es de UNA sola sociedad en todo el registro y esa
 * sociedad informa 10+ trabajadores.
 */
export function chileBrandTailKey(core: string): string | null {
  const words = core.trim().split(' ').filter(Boolean);
  if (words.length < 2) return null;
  const last = words[words.length - 1];
  if (last.length < CL_BRAND_ALIAS_MIN_LENGTH || !/^[A-Z][A-Z0-9&]*$/.test(last) || /^\d+$/.test(last)) return null;
  return NOT_A_BRAND.has(last) ? null : last;
}

/** Palabras distintas de un núcleo (para contar en cuántas sociedades sale cada una). */
export function chileCoreWords(core: string): string[] {
  return [...new Set(core.trim().split(' ').filter((word) => word.length >= CL_BRAND_ALIAS_MIN_LENGTH))];
}
