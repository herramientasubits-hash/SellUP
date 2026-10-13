/**
 * ve-public-entities.ts — entes públicos de Venezuela con su web oficial, para la
 * capa gratuita de Gobierno.
 *
 * SOURCES-VE-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Venezuela no publica un directorio de entes con RIF alcanzable (Gobierno en Línea
 * y la mayoría de portales del Estado no responden desde fuera del país). Esta tabla
 * sale de 645 dominios candidatos (`.gob.ve` de Common Crawl 2026 y entes de
 * Wikidata), cada uno abierto UNA vez el 13-10-2026 (robots.txt respetado, sin saltar
 * bloqueos): sólo entra la web principal de UN ente (fuera portales de trámites,
 * intranets, aulas virtuales, programas, embajadas, circuitos judiciales, subsitios,
 * páginas vacías o en construcción, y webs hackeadas o con spam). El nombre oficial
 * sale de la propia página; el RIF, sólo si la portada lo muestra con su dígito
 * verificador. Las alcaldías llevan el estado entre paréntesis.
 *
 * Quedan fuera, por estar caídas, bloqueadas o prohibir el rastreo, entes grandes como
 * PDVSA, el SENIAT, el TSJ, el CNE, la UCV o la ULA.
 */

export type VePublicEntityKind =
  | 'national'
  | 'territorial_state'
  | 'territorial_municipality'
  | 'state_company'
  | 'public_university'
  | 'hospital';

export type VePublicEntity = {
  domain: string;
  name: string;
  kind: VePublicEntityKind;
  /** RIF que muestra la propia portada (con verificador), o `null`. */
  rif: string | null;
  /** Wikidata (Q…), si la entidad está allí. */
  wikidata: string | null;
};

export const VE_PUBLIC_ENTITIES: readonly VePublicEntity[] = Object.freeze([
  // ── Poderes, ministerios y entes nacionales ──
  { domain: 'abae.gob.ve', name: 'Agencia Bolivariana para Actividades Espaciales (ABAE)', kind: 'national', rif: null, wikidata: null },
  { domain: 'agn.gob.ve', name: 'Archivo General de la Nación', kind: 'national', rif: null, wikidata: null },
  { domain: 'asambleanacional.gob.ve', name: 'Asamblea Nacional', kind: 'national', rif: null, wikidata: null },
  { domain: 'bcv.org.ve', name: 'Banco Central de Venezuela', kind: 'national', rif: 'G-20000110-0', wikidata: 'Q2570775' },
  { domain: 'reddearte.gob.ve', name: 'Centro Nacional de Artesanía', kind: 'national', rif: null, wikidata: null },
  { domain: 'cneh.gob.ve', name: 'Centro Nacional de Estudios Históricos (CNEH)', kind: 'national', rif: null, wikidata: null },
  { domain: 'cenipa.gob.ve', name: 'Centro Nacional de Investigación de Pesca y Acuicultura (CENIPA)', kind: 'national', rif: null, wikidata: null },
  { domain: 'cntq.gob.ve', name: 'Centro Nacional de Tecnología Química (CNTQ)', kind: 'national', rif: null, wikidata: 'Q133811874' },
  { domain: 'cnti.gob.ve', name: 'Centro Nacional de Tecnologías de Información (CNTI)', kind: 'national', rif: 'G-20004417-9', wikidata: null },
  { domain: 'cenal.gob.ve', name: 'Centro Nacional del Libro (CENAL)', kind: 'national', rif: null, wikidata: null },
  { domain: 'cass.gob.ve', name: 'Comisión Antidumping y Sobre Subsidios (CASS)', kind: 'national', rif: null, wikidata: null },
  { domain: 'cnc.gob.ve', name: 'Comisión Nacional de Casinos, Salas de Bingo y Máquinas Traganíqueles (CNC)', kind: 'national', rif: null, wikidata: null },
  { domain: 'conalot.gob.ve', name: 'Comisión Nacional de Lotería (CONALOT)', kind: 'national', rif: null, wikidata: null },
  { domain: 'conatel.gob.ve', name: 'Comisión Nacional de Telecomunicaciones (CONATEL)', kind: 'national', rif: 'G-20000826-1', wikidata: 'Q940077' },
  { domain: 'conati.gob.ve', name: 'Comisión Nacional de las Tecnologías de Información (CONATI)', kind: 'national', rif: 'G-20011386-3', wikidata: null },
  { domain: 'cnu.gob.ve', name: 'Consejo Nacional de Universidades (CNU)', kind: 'national', rif: 'G-20000092-9', wikidata: null },
  { domain: 'cgr.gob.ve', name: 'Contraloría General de la República', kind: 'national', rif: 'G-20000026-0', wikidata: null },
  { domain: 'corpocentro.gob.ve', name: 'Corporación de Desarrollo de la Región Central (CORPOCENTRO)', kind: 'national', rif: 'G-20008343-3', wikidata: null },
  { domain: 'defensoria.gob.ve', name: 'Defensoría del Pueblo', kind: 'national', rif: null, wikidata: null },
  { domain: 'dgnb.gob.ve', name: 'Dirección General Nacional de Bomberos', kind: 'national', rif: null, wikidata: null },
  { domain: 'pcivil.gob.ve', name: 'Dirección Nacional de Protección Civil y Administración de Desastres', kind: 'national', rif: 'G-20009764-7', wikidata: null },
  { domain: 'fonacit.gob.ve', name: 'Fondo Nacional de Ciencia, Tecnología e Innovación (FONACIT)', kind: 'national', rif: 'G-20007786-7', wikidata: 'Q30297376' },
  { domain: 'cidata.gob.ve', name: 'Fundación Centro de Investigaciones de Astronomía y Tecnologías Aplicadas Francisco J. Duarte (CIDATA)', kind: 'national', rif: null, wikidata: null },
  { domain: 'ciepe.gob.ve', name: 'Fundación Centro de Investigaciones del Estado para la Producción Experimental Agroindustrial (CIEPE)', kind: 'national', rif: 'G-20008103-1', wikidata: null },
  { domain: 'infocentro.gob.ve', name: 'Fundación Infocentro', kind: 'national', rif: 'G-20007728-0', wikidata: null },
  { domain: 'libreriasdelsur.gob.ve', name: 'Fundación Librerías del Sur', kind: 'national', rif: null, wikidata: null },
  { domain: 'misionjosegregoriohernandez.gob.ve', name: 'Fundación Misión José Gregorio Hernández', kind: 'national', rif: null, wikidata: null },
  { domain: 'misionpiar.gob.ve', name: 'Fundación Misión Piar', kind: 'national', rif: 'G-20006045-0', wikidata: null },
  { domain: 'misionsucre.gob.ve', name: 'Fundación Misión Sucre', kind: 'national', rif: 'G-20003871-3', wikidata: null },
  { domain: 'bnv.gob.ve', name: 'Instituto Autónomo Biblioteca Nacional y de Servicios de Bibliotecas', kind: 'national', rif: null, wikidata: null },
  { domain: 'igvsb.gob.ve', name: 'Instituto Geográfico de Venezuela Simón Bolívar (IGVSB)', kind: 'national', rif: null, wikidata: 'Q24961802' },
  { domain: 'inces.gob.ve', name: 'Instituto Nacional de Capacitación y Educación Socialista (INCES)', kind: 'national', rif: null, wikidata: null },
  { domain: 'inapymi.gob.ve', name: 'Instituto Nacional de Desarrollo de la Pequeña y Mediana Industria (INAPYMI)', kind: 'national', rif: null, wikidata: null },
  { domain: 'ine.gob.ve', name: 'Instituto Nacional de Estadística (INE)', kind: 'national', rif: null, wikidata: null },
  { domain: 'inhrr.gob.ve', name: 'Instituto Nacional de Higiene Rafael Rangel (INHRR)', kind: 'national', rif: 'G-20000101-1', wikidata: null },
  { domain: 'inia.gob.ve', name: 'Instituto Nacional de Investigaciones Agrícolas (INIA)', kind: 'national', rif: null, wikidata: null },
  { domain: 'inameh.gob.ve', name: 'Instituto Nacional de Meteorología e Hidrología (INAMEH)', kind: 'national', rif: null, wikidata: null },
  { domain: 'inparques.gob.ve', name: 'Instituto Nacional de Parques (INPARQUES)', kind: 'national', rif: 'G-20000632-3', wikidata: 'Q5917567' },
  { domain: 'insai.gob.ve', name: 'Instituto Nacional de Salud Agrícola Integral (INSAI)', kind: 'national', rif: null, wikidata: null },
  { domain: 'inti.gob.ve', name: 'Instituto Nacional de Tierras (INTI)', kind: 'national', rif: 'G-20002387-2', wikidata: null },
  { domain: 'intt.gob.ve', name: 'Instituto Nacional de Transporte Terrestre (INTT)', kind: 'national', rif: 'G-20002414-3', wikidata: 'Q109593830' },
  { domain: 'inj.gob.ve', name: 'Instituto Nacional de la Juventud (INJ)', kind: 'national', rif: null, wikidata: null },
  { domain: 'inamujer.gob.ve', name: 'Instituto Nacional de la Mujer (INAMUJER)', kind: 'national', rif: null, wikidata: null },
  { domain: 'inea.gob.ve', name: 'Instituto Nacional de los Espacios Acuáticos (INEA)', kind: 'national', rif: 'G-20002141-1', wikidata: null },
  { domain: 'insopesca.gob.ve', name: 'Instituto Socialista de la Pesca y Acuicultura (INSOPESCA)', kind: 'national', rif: 'G-20000339-1', wikidata: null },
  { domain: 'ivic.gob.ve', name: 'Instituto Venezolano de Investigaciones Científicas (IVIC)', kind: 'national', rif: null, wikidata: null },
  { domain: 'ivpa.gob.ve', name: 'Instituto Venezolano de Planificación Aplicada (IVPA)', kind: 'national', rif: 'G-20008209-7', wikidata: null },
  { domain: 'ivss.gob.ve', name: 'Instituto Venezolano de los Seguros Sociales (IVSS)', kind: 'national', rif: null, wikidata: 'Q9008775' },
  { domain: 'idea.gob.ve', name: 'Instituto de Estudios Avanzados (IDEA)', kind: 'national', rif: 'G-20005439-5', wikidata: 'Q30282009' },
  { domain: 'ife.gob.ve', name: 'Instituto de Ferrocarriles del Estado (IFE)', kind: 'national', rif: 'G-20000124-0', wikidata: null },
  { domain: 'ipasme.gob.ve', name: 'Instituto de Previsión y Asistencia Social para el Personal del Ministerio de Educación (IPASME)', kind: 'national', rif: 'G-20008000-0', wikidata: null },
  { domain: 'minaguas.gob.ve', name: 'Ministerio del Poder Popular de Atención de las Aguas', kind: 'national', rif: null, wikidata: null },
  { domain: 'mincyt.gob.ve', name: 'Ministerio del Poder Popular de Ciencia y Tecnología', kind: 'national', rif: null, wikidata: null },
  { domain: 'desarrollominero.gob.ve', name: 'Ministerio del Poder Popular de Desarrollo Minero Ecológico e Industrias Básicas', kind: 'national', rif: null, wikidata: 'Q108257421' },
  { domain: 'minhidrocarburos.gob.ve', name: 'Ministerio del Poder Popular de Hidrocarburos', kind: 'national', rif: null, wikidata: 'Q37288623' },
  { domain: 'mincomercionacional.gob.ve', name: 'Ministerio del Poder Popular de Industrias y Comercio Nacional', kind: 'national', rif: null, wikidata: null },
  { domain: 'minpesca.gob.ve', name: 'Ministerio del Poder Popular de Pesca y Acuicultura', kind: 'national', rif: null, wikidata: null },
  { domain: 'mppp.gob.ve', name: 'Ministerio del Poder Popular de Planificación', kind: 'national', rif: null, wikidata: 'Q16607800' },
  { domain: 'minhvi.gob.ve', name: 'Ministerio del Poder Popular para Hábitat y Vivienda', kind: 'national', rif: 'G-20011652-8', wikidata: 'Q6017558' },
  { domain: 'mppre.gob.ve', name: 'Ministerio del Poder Popular para Relaciones Exteriores y Comercio Internacional', kind: 'national', rif: null, wikidata: 'Q16607763' },
  { domain: 'mpprijp.gob.ve', name: 'Ministerio del Poder Popular para Relaciones Interiores, Justicia y Paz', kind: 'national', rif: null, wikidata: null },
  { domain: 'mindeporte.gob.ve', name: 'Ministerio del Poder Popular para el Deporte', kind: 'national', rif: 'G-20017189-8', wikidata: null },
  { domain: 'minec.gob.ve', name: 'Ministerio del Poder Popular para el Ecosocialismo', kind: 'national', rif: 'G-20011653-6', wikidata: 'Q25406610' },
  { domain: 'mppsp.gob.ve', name: 'Ministerio del Poder Popular para el Servicio Penitenciario', kind: 'national', rif: null, wikidata: 'Q16607777' },
  { domain: 'mppt.gob.ve', name: 'Ministerio del Poder Popular para el Transporte', kind: 'national', rif: 'G-20012311-7', wikidata: 'Q38298873' },
  { domain: 'mintur.gob.ve', name: 'Ministerio del Poder Popular para el Turismo', kind: 'national', rif: 'G-20013132-2', wikidata: 'Q16607782' },
  { domain: 'minagricultura.gob.ve', name: 'Ministerio del Poder Popular para la Agricultura y Tierras', kind: 'national', rif: null, wikidata: 'Q6017563' },
  { domain: 'minpal.gob.ve', name: 'Ministerio del Poder Popular para la Alimentación', kind: 'national', rif: 'G-20004327-0', wikidata: 'Q109557603' },
  { domain: 'mippci.gob.ve', name: 'Ministerio del Poder Popular para la Comunicación y la Información', kind: 'national', rif: null, wikidata: 'Q3814736' },
  { domain: 'mincultura.gob.ve', name: 'Ministerio del Poder Popular para la Cultura', kind: 'national', rif: null, wikidata: 'Q16607787' },
  { domain: 'portal.mppeu.gob.ve', name: 'Ministerio del Poder Popular para la Educación Universitaria', kind: 'national', rif: null, wikidata: null },
  { domain: 'mppee.gob.ve', name: 'Ministerio del Poder Popular para la Energía Eléctrica', kind: 'national', rif: null, wikidata: 'Q9033378' },
  { domain: 'minjuventud.gob.ve', name: 'Ministerio del Poder Popular para la Juventud', kind: 'national', rif: null, wikidata: null },
  { domain: 'minmujer.gob.ve', name: 'Ministerio del Poder Popular para la Mujer y la Igualdad de Género', kind: 'national', rif: null, wikidata: 'Q16607797' },
  { domain: 'mpps.gob.ve', name: 'Ministerio del Poder Popular para la Salud', kind: 'national', rif: null, wikidata: 'Q4141111' },
  { domain: 'comunas.gob.ve', name: 'Ministerio del Poder Popular para las Comunas, Movimientos Sociales y Agricultura Urbana', kind: 'national', rif: null, wikidata: null },
  { domain: 'minpi.gob.ve', name: 'Ministerio del Poder Popular para los Pueblos Indígenas', kind: 'national', rif: null, wikidata: null },
  { domain: 'oncti.gob.ve', name: 'Observatorio Nacional de Ciencia, Tecnología e Innovación (ONCTI)', kind: 'national', rif: null, wikidata: 'Q132803452' },
  { domain: 'oncdoft.gob.ve', name: 'Oficina Nacional Contra la Delincuencia Organizada y Financiamiento al Terrorismo (ONCDOFT)', kind: 'national', rif: null, wikidata: null },
  { domain: 'onapre.gob.ve', name: 'Oficina Nacional de Presupuesto (ONAPRE)', kind: 'national', rif: null, wikidata: null },
  { domain: 'pgr.gob.ve', name: 'Procuraduría General de la República', kind: 'national', rif: null, wikidata: null },
  { domain: 'imprentanacional.gob.ve', name: 'Servicio Autónomo Imprenta Nacional y Gaceta Oficial', kind: 'national', rif: null, wikidata: null },
  { domain: 'sacs.gob.ve', name: 'Servicio Autónomo de Contraloría Sanitaria (SACS)', kind: 'national', rif: 'G-20007772-7', wikidata: null },
  { domain: 'saren.gob.ve', name: 'Servicio Autónomo de Registros y Notarías (SAREN)', kind: 'national', rif: null, wikidata: 'Q6126010' },
  { domain: 'sapi.gob.ve', name: 'Servicio Autónomo de la Propiedad Intelectual (SAPI)', kind: 'national', rif: 'G-20008399-9', wikidata: null },
  { domain: 'sencamer.gob.ve', name: 'Servicio Desconcentrado de Normalización, Calidad, Metrología y Reglamentos Técnicos (SENCAMER)', kind: 'national', rif: 'G-20001596-9', wikidata: null },
  { domain: 'safonapp.gob.ve', name: 'Servicio Fondo Nacional del Poder Popular (SAFONAPP)', kind: 'national', rif: null, wikidata: null },
  { domain: 'sunai.gob.ve', name: 'Superintendencia Nacional de Auditoría Interna (SUNAI)', kind: 'national', rif: null, wikidata: null },
  { domain: 'sundde.gob.ve', name: 'Superintendencia Nacional para la Defensa de los Derechos Socioeconómicos (SUNDDE)', kind: 'national', rif: 'G-20010920-3', wikidata: null },
  { domain: 'sudeca.gob.ve', name: 'Superintendencia de Cajas de Ahorro (SUDECA)', kind: 'national', rif: null, wikidata: null },
  { domain: 'suscerte.gob.ve', name: 'Superintendencia de Servicios de Certificación Electrónica (SUSCERTE)', kind: 'national', rif: null, wikidata: null },
  { domain: 'sudeaseg.gob.ve', name: 'Superintendencia de la Actividad Aseguradora (SUDEASEG)', kind: 'national', rif: 'G-20008047-7', wikidata: null },
  { domain: 'unif.gob.ve', name: 'Unidad Nacional de Inteligencia Financiera (UNIF)', kind: 'national', rif: null, wikidata: null },
  // ── Gobernaciones y entes estadales ──
  { domain: 'contraloriaestadoamazonas.gob.ve', name: 'Contraloría del Estado Amazonas', kind: 'territorial_state', rif: null, wikidata: null },
  { domain: 'contraloriaestadobarinas.gob.ve', name: 'Contraloría del Estado Barinas', kind: 'territorial_state', rif: null, wikidata: null },
  { domain: 'cgesucre.gob.ve', name: 'Contraloría del Estado Sucre', kind: 'territorial_state', rif: null, wikidata: null },
  { domain: 'insalud.gob.ve', name: 'Fundación Instituto Carabobeño para la Salud (INSALUD)', kind: 'territorial_state', rif: 'G-20004989-8', wikidata: null },
  { domain: 'amazonas.gob.ve', name: 'Gobernación del Estado Amazonas', kind: 'territorial_state', rif: null, wikidata: 'Q170453' },
  { domain: 'anzoategui.gob.ve', name: 'Gobernación del Estado Anzoátegui', kind: 'territorial_state', rif: null, wikidata: 'Q190922' },
  { domain: 'apure.gob.ve', name: 'Gobernación del Estado Apure', kind: 'territorial_state', rif: 'G-20004805-0', wikidata: 'Q41146' },
  { domain: 'carabobo.gob.ve', name: 'Gobernación del Estado Carabobo', kind: 'territorial_state', rif: 'G-20000152-6', wikidata: 'Q191186' },
  { domain: 'laguaira.gob.ve', name: 'Gobernación del Estado La Guaira', kind: 'territorial_state', rif: null, wikidata: 'Q205843' },
  { domain: 'lara.gob.ve', name: 'Gobernación del Estado Lara', kind: 'territorial_state', rif: null, wikidata: 'Q205796' },
  { domain: 'miranda.gob.ve', name: 'Gobernación del Estado Miranda', kind: 'territorial_state', rif: 'G-20004596-5', wikidata: 'Q191174' },
  { domain: 'portuguesa.gob.ve', name: 'Gobernación del Estado Portuguesa', kind: 'territorial_state', rif: null, wikidata: 'Q205784' },
  { domain: 'tachira.gob.ve', name: 'Gobernación del Estado Táchira', kind: 'territorial_state', rif: null, wikidata: 'Q41144' },
  { domain: 'tifm.gob.ve', name: 'Gobierno del Territorio Insular Francisco de Miranda', kind: 'territorial_state', rif: null, wikidata: null },
  { domain: 'procuraduria.aragua.gob.ve', name: 'Procuraduría General del Estado Aragua', kind: 'territorial_state', rif: null, wikidata: null },
  // ── Alcaldías y entes municipales ──
  { domain: 'caracas.gob.ve', name: 'Alcaldía de Caracas (Municipio Libertador, Distrito Capital)', kind: 'territorial_municipality', rif: null, wikidata: 'Q887222' },
  { domain: 'alcaldiadeheres.gob.ve', name: 'Alcaldía del Municipio Angostura del Orinoco (Bolívar)', kind: 'territorial_municipality', rif: null, wikidata: null },
  { domain: 'alcaldiacaroni.gob.ve', name: 'Alcaldía del Municipio Caroní (Bolívar)', kind: 'territorial_municipality', rif: 'G-20000363-4', wikidata: 'Q2354199' },
  { domain: 'chacao.gob.ve', name: 'Alcaldía del Municipio Chacao (Miranda)', kind: 'territorial_municipality', rif: null, wikidata: 'Q374734' },
  { domain: 'lecheria.gov.ve', name: 'Alcaldía del Municipio Diego Bautista Urbaneja (Anzoátegui)', kind: 'territorial_municipality', rif: 'G-20001136-0', wikidata: 'Q2023615' },
  { domain: 'alcaldiagirardot.gob.ve', name: 'Alcaldía del Municipio Girardot (Aragua)', kind: 'territorial_municipality', rif: null, wikidata: null },
  { domain: 'alcaldiadeguaicaipuro.gob.ve', name: 'Alcaldía del Municipio Guaicaipuro (Miranda)', kind: 'territorial_municipality', rif: null, wikidata: null },
  { domain: 'alcaldiaderibas.gob.ve', name: 'Alcaldía del Municipio José Félix Ribas (Aragua)', kind: 'territorial_municipality', rif: null, wikidata: null },
  { domain: 'alcaldialibertador-carabobo.gob.ve', name: 'Alcaldía del Municipio Libertador (Carabobo)', kind: 'territorial_municipality', rif: null, wikidata: null },
  { domain: 'alcaldiademara.gob.ve', name: 'Alcaldía del Municipio Mara (Zulia)', kind: 'territorial_municipality', rif: null, wikidata: 'Q1820462' },
  { domain: 'alcaldiadenaguanagua.gob.ve', name: 'Alcaldía del Municipio Naguanagua (Carabobo)', kind: 'territorial_municipality', rif: 'G-20004231-1', wikidata: null },
  { domain: 'alcaldiapaez.gob.ve', name: 'Alcaldía del Municipio Páez (Portuguesa)', kind: 'territorial_municipality', rif: null, wikidata: 'Q2408036' },
  { domain: 'alcaldiasancristobal.gob.ve', name: 'Alcaldía del Municipio San Cristóbal (Táchira)', kind: 'territorial_municipality', rif: null, wikidata: null },
  { domain: 'alcaldiadesandiego.gob.ve', name: 'Alcaldía del Municipio San Diego (Carabobo)', kind: 'territorial_municipality', rif: null, wikidata: null },
  { domain: 'alcaldiadesanfelipe.gob.ve', name: 'Alcaldía del Municipio San Felipe (Yaracuy)', kind: 'territorial_municipality', rif: null, wikidata: null },
  { domain: 'alcaldiasanfrancisco.gob.ve', name: 'Alcaldía del Municipio San Francisco (Zulia)', kind: 'territorial_municipality', rif: null, wikidata: null },
  { domain: 'alcaldiamunicipiosucre.gob.ve', name: 'Alcaldía del Municipio Sucre (Miranda)', kind: 'territorial_municipality', rif: 'G-20000148-8', wikidata: null },
  { domain: 'alcaldiadevalencia.gob.ve', name: 'Alcaldía del Municipio Valencia (Carabobo)', kind: 'territorial_municipality', rif: 'G-20100002-7', wikidata: null },
  { domain: 'alcaldiadezamora.com', name: 'Alcaldía del Municipio Zamora (Miranda)', kind: 'territorial_municipality', rif: null, wikidata: 'Q1129558' },
  { domain: 'concejolossalias.gob.ve', name: 'Concejo Municipal del Municipio Los Salias (Miranda)', kind: 'territorial_municipality', rif: null, wikidata: null },
  { domain: 'cmchacao.gob.ve', name: 'Contraloría del Municipio Chacao (Miranda)', kind: 'territorial_municipality', rif: 'G-20000239-5', wikidata: null },
  { domain: 'cmcarvajal.gob.ve', name: 'Contraloría del Municipio San Rafael de Carvajal (Trujillo)', kind: 'territorial_municipality', rif: 'G-20001915-8', wikidata: null },
  { domain: 'bomberosvalencia.gob.ve', name: 'Instituto Autónomo Municipal Cuerpo de Bomberos de Valencia', kind: 'territorial_municipality', rif: null, wikidata: null },
  { domain: 'induval.gob.ve', name: 'Instituto del Desarrollo Urbano del Centro de Valencia (INDUVAL)', kind: 'territorial_municipality', rif: null, wikidata: null },
  // ── Empresas del Estado ──
  { domain: 'bdt.com.ve', name: 'Banco Digital de los Trabajadores', kind: 'state_company', rif: 'G-20009148-7', wikidata: 'Q5728123' },
  { domain: 'bancoex.gob.ve', name: 'Banco de Comercio Exterior (BANCOEX)', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'bt.com.ve', name: 'Banco del Tesoro, C.A. Banco Universal', kind: 'state_company', rif: 'G-20005187-6', wikidata: 'Q5718196' },
  { domain: 'baer.gob.ve', name: 'Bolivariana de Aeropuertos, S.A. (BAER)', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'bolipuertos.gob.ve', name: 'Bolivariana de Puertos, S.A. (BOLIPUERTOS)', kind: 'state_company', rif: 'G-20016315-1', wikidata: null },
  { domain: 'metrolosteques.gob.ve', name: 'C.A. Metro Los Teques', kind: 'state_company', rif: 'J-30568342-5', wikidata: null },
  { domain: 'metrovalencia.gob.ve', name: 'C.A. Metro Valencia', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'metrodemaracaibo.gob.ve', name: 'C.A. Metro de Maracaibo', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'cabelum.gob.ve', name: 'CVG Conductores de Aluminio del Caroní, C.A. (CVG CABELUM)', kind: 'state_company', rif: 'G-20016281-3', wikidata: null },
  { domain: 'cantv.com.ve', name: 'Compañía Anónima Nacional Teléfonos de Venezuela (CANTV)', kind: 'state_company', rif: 'J-00124134-5', wikidata: 'Q4302263' },
  { domain: 'camerbasma.alcaldiapaez.gob.ve', name: 'Compañía Municipal de Mercado, Abastos y Mataderos del Municipio Páez (CAMERBASMA)', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'comresis.alcaldiapaez.gob.ve', name: 'Compañía Municipal de Recuperación Económica y Social del Municipio Páez (COMRESIS)', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'comter.alcaldiapaez.gob.ve', name: 'Compañía Municipal de Transportes Terrestres del Municipio Páez (COMTER)', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'csn.gob.ve', name: 'Complejo Siderúrgico Nacional, C.A. (CSN)', kind: 'state_company', rif: 'G-20010279-9', wikidata: null },
  { domain: 'cpsa.gob.ve', name: 'Conglomerado Productivo, S.A.', kind: 'state_company', rif: 'G-20010469-4', wikidata: null },
  { domain: 'corpoelec.gob.ve', name: 'Corporación Eléctrica Nacional, S.A. (CORPOELEC)', kind: 'state_company', rif: 'G-20010014-1', wikidata: null },
  { domain: 'corpovex.gob.ve', name: 'Corporación Venezolana de Comercio Exterior, S.A. (CORPOVEX)', kind: 'state_company', rif: 'G-20011022-8', wikidata: null },
  { domain: 'cvg.gob.ve', name: 'Corporación Venezolana de Guayana (CVG)', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'codecyt.gob.ve', name: 'Corporación para el Desarrollo Científico y Tecnológico, S.A. (CODECYT)', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'cuspal.gob.ve', name: 'Corporación Única de Servicios Productivos y Alimentarios, C.A. (CUSPAL)', kind: 'state_company', rif: 'G-20012200-5', wikidata: null },
  { domain: 'correodelorinoco.gob.ve', name: 'Correo del Orinoco', kind: 'state_company', rif: 'G-20009059-6', wikidata: null },
  { domain: 'dianca.gob.ve', name: 'Diques y Astilleros Nacionales, C.A. (DIANCA)', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'industriacanaima.gob.ve', name: 'Industria Canaima, C.A.', kind: 'state_company', rif: 'G-20010288-8', wikidata: null },
  { domain: 'industriasdiana.gob.ve', name: 'Industrias Diana, C.A.', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'logicasa.gob.ve', name: 'Logística Casa, S.A. (LOGICASA)', kind: 'state_company', rif: 'G-20008732-3', wikidata: null },
  { domain: 'pescalba.gob.ve', name: 'Pescalba, S.A.', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'pdval.gob.ve', name: 'Productora y Distribuidora Venezolana de Alimentos, S.A. (PDVAL)', kind: 'state_company', rif: 'G-20010024-9', wikidata: null },
  { domain: 'quimbiotec.gob.ve', name: 'Quimbiotec, C.A.', kind: 'state_company', rif: 'J-00287475-9', wikidata: null },
  { domain: 'rnv.gob.ve', name: 'Radio Nacional de Venezuela, C.A. (RNV)', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'redtv.gob.ve', name: 'RedTV, C.A. – Red de Transmisiones de Venezuela', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'sitssa.gob.ve', name: 'Sistema Integral de Transporte Superficial, S.A. (SITSSA)', kind: 'state_company', rif: null, wikidata: null },
  { domain: 'telecom.gob.ve', name: 'Telecom Venezuela', kind: 'state_company', rif: 'G-20005143-4', wikidata: null },
  { domain: 'tves.gob.ve', name: 'Televisora Venezolana Social (TVES)', kind: 'state_company', rif: 'G-20007687-9', wikidata: null },
  { domain: 'vit.gob.ve', name: 'Venezolana de Industria Tecnológica, C.A. (VIT)', kind: 'state_company', rif: null, wikidata: null },
  // ── Universidades públicas ──
  { domain: 'unefm.edu.ve', name: 'Universidad Nacional Experimental Francisco de Miranda (UNEFM)', kind: 'public_university', rif: null, wikidata: 'Q6156554' },
  { domain: 'udo.education', name: 'Universidad de Oriente (UDO)', kind: 'public_university', rif: null, wikidata: 'Q7894330' },
  // ── Hospitales públicos ──
  { domain: 'cardiologicoinfantil.gob.ve', name: 'Hospital Cardiológico Infantil Latinoamericano Dr. Gilberto Rodríguez Ochoa', kind: 'hospital', rif: null, wikidata: 'Q16493408' },
  { domain: 'huc.gob.ve', name: 'Hospital Universitario de Caracas', kind: 'hospital', rif: null, wikidata: 'Q13605001' },
  { domain: 'sahum.gob.ve', name: 'Servicio Autónomo Hospital Universitario de Maracaibo (SAHUM)', kind: 'hospital', rif: null, wikidata: 'Q16576159' },
]);
