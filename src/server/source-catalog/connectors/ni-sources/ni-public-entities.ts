/**
 * ni-public-entities.ts — entidades públicas de Nicaragua con su web oficial, para
 * la capa gratuita de Gobierno.
 *
 * SOURCES-NI-CLOSE-2. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Nicaragua no publica un directorio de instituciones accesible desde fuera del país
 * (la Ley de Presupuesto y los portales del Estado no responden). Esta tabla sale de
 * los dominios `.gob.ni` y `.edu.ni` que registran Common Crawl y el Internet
 * Archive (2024-2026), con DNS vigente medido el 07-10-2026, y el nombre oficial de
 * cada institución (título de su web). Sólo entra un dominio que es claramente de UNA
 * institución: se dejan fuera los portales de trámites, los programas y los dominios
 * dudosos (dos webs para una misma alcaldía, títulos genéricos).
 *
 * Ninguna fuente accesible da el RUC de ministerios ni alcaldías: la fila queda sin
 * RUC salvo que la entidad esté, con el mismo nombre, en una fuente con RUC (la lista
 * de Grandes Contribuyentes trae a las empresas del Estado).
 */

export type NiPublicEntityKind = 'national' | 'territorial' | 'state_company' | 'public_university';

export type NiPublicEntity = { domain: string; name: string; kind: NiPublicEntityKind };

export const NI_PUBLIC_ENTITIES: readonly NiPublicEntity[] = Object.freeze([
  // ── Poderes del Estado y órganos de control ──
  { domain: 'asamblea.gob.ni', name: 'Asamblea Nacional', kind: 'national' },
  { domain: 'poderjudicial.gob.ni', name: 'Poder Judicial', kind: 'national' },
  { domain: 'cse.gob.ni', name: 'Consejo Supremo Electoral', kind: 'national' },
  { domain: 'cgr.gob.ni', name: 'Contraloría General de la República', kind: 'national' },
  { domain: 'pgj.gob.ni', name: 'Procuraduría General de Justicia', kind: 'national' },
  { domain: 'ministeriopublico.gob.ni', name: 'Ministerio Público', kind: 'national' },
  { domain: 'pddh.gob.ni', name: 'Procuraduría para la Defensa de los Derechos Humanos', kind: 'national' },
  { domain: 'policia.gob.ni', name: 'Policía Nacional', kind: 'national' },
  { domain: 'tta.gob.ni', name: 'Tribunal Aduanero y Tributario Administrativo', kind: 'national' },
  // ── Ministerios ──
  { domain: 'hacienda.gob.ni', name: 'Ministerio de Hacienda y Crédito Público', kind: 'national' },
  { domain: 'minsa.gob.ni', name: 'Ministerio de Salud', kind: 'national' },
  { domain: 'mined.gob.ni', name: 'Ministerio de Educación', kind: 'national' },
  { domain: 'mag.gob.ni', name: 'Ministerio Agropecuario', kind: 'national' },
  { domain: 'marena.gob.ni', name: 'Ministerio del Ambiente y los Recursos Naturales', kind: 'national' },
  { domain: 'mem.gob.ni', name: 'Ministerio de Energía y Minas', kind: 'national' },
  { domain: 'mific.gob.ni', name: 'Ministerio de Fomento, Industria y Comercio', kind: 'national' },
  { domain: 'mitrab.gob.ni', name: 'Ministerio del Trabajo', kind: 'national' },
  { domain: 'mti.gob.ni', name: 'Ministerio de Transporte e Infraestructura', kind: 'national' },
  { domain: 'migob.gob.ni', name: 'Ministerio del Interior', kind: 'national' },
  { domain: 'midef.gob.ni', name: 'Ministerio de Defensa', kind: 'national' },
  { domain: 'mifamilia.gob.ni', name: 'Ministerio de la Familia, Adolescencia y Niñez', kind: 'national' },
  { domain: 'minim.gob.ni', name: 'Ministerio de la Mujer', kind: 'national' },
  { domain: 'minjuve.gob.ni', name: 'Ministerio de la Juventud', kind: 'national' },
  { domain: 'economiafamiliar.gob.ni', name: 'Ministerio de Economía Familiar, Comunitaria, Cooperativa y Asociativa', kind: 'national' },
  // ── Entes autónomos, institutos y comisiones ──
  { domain: 'bcn.gob.ni', name: 'Banco Central de Nicaragua', kind: 'national' },
  { domain: 'siboif.gob.ni', name: 'Superintendencia de Bancos y de Otras Instituciones Financieras', kind: 'national' },
  { domain: 'uaf.gob.ni', name: 'Unidad de Análisis Financiero', kind: 'national' },
  { domain: 'fogade.gob.ni', name: 'Fondo de Garantía de Depósitos', kind: 'national' },
  { domain: 'conami.gob.ni', name: 'Comisión Nacional de Microfinanzas', kind: 'national' },
  { domain: 'cnzf.gob.ni', name: 'Comisión Nacional de Zonas Francas', kind: 'national' },
  { domain: 'dgi.gob.ni', name: 'Dirección General de Ingresos', kind: 'national' },
  { domain: 'dga.gob.ni', name: 'Dirección General de Servicios Aduaneros', kind: 'national' },
  { domain: 'cetrex.gob.ni', name: 'Centro de Trámites de las Exportaciones', kind: 'national' },
  { domain: 'inss.gob.ni', name: 'Instituto Nicaragüense de Seguridad Social', kind: 'national' },
  { domain: 'ine.gob.ni', name: 'Instituto Nicaragüense de Energía', kind: 'national' },
  { domain: 'inaa.gob.ni', name: 'Instituto Nicaragüense de Acueductos y Alcantarillados', kind: 'national' },
  { domain: 'inac.gob.ni', name: 'Instituto Nicaragüense de Aeronáutica Civil', kind: 'national' },
  { domain: 'inafor.gob.ni', name: 'Instituto Nacional Forestal', kind: 'national' },
  { domain: 'inc.gob.ni', name: 'Instituto Nicaragüense de Cultura', kind: 'national' },
  { domain: 'ind.gob.ni', name: 'Instituto Nicaragüense de Deportes', kind: 'national' },
  { domain: 'ineter.gob.ni', name: 'Instituto Nicaragüense de Estudios Territoriales', kind: 'national' },
  { domain: 'inide.gob.ni', name: 'Instituto Nacional de Información de Desarrollo', kind: 'national' },
  { domain: 'inpesca.gob.ni', name: 'Instituto Nicaragüense de la Pesca y Acuicultura', kind: 'national' },
  { domain: 'inta.gob.ni', name: 'Instituto Nicaragüense de Tecnología Agropecuaria', kind: 'national' },
  { domain: 'intur.gob.ni', name: 'Instituto Nicaragüense de Turismo', kind: 'national' },
  { domain: 'invur.gob.ni', name: 'Instituto de la Vivienda Urbana y Rural', kind: 'national' },
  { domain: 'ipsa.gob.ni', name: 'Instituto de Protección y Sanidad Agropecuaria', kind: 'national' },
  { domain: 'telcor.gob.ni', name: 'Instituto Nicaragüense de Telecomunicaciones y Correos', kind: 'national' },
  { domain: 'ana.gob.ni', name: 'Autoridad Nacional del Agua', kind: 'national' },
  { domain: 'ania.gob.ni', name: 'Agencia Nicaragüense de Investigación de Accidentes e Incidentes', kind: 'national' },
  { domain: 'conicyt.gob.ni', name: 'Consejo Nicaragüense de Ciencia y Tecnología', kind: 'national' },
  { domain: 'sinapred.gob.ni', name: 'Sistema Nacional para la Prevención, Mitigación y Atención de Desastres', kind: 'national' },
  { domain: 'fise.gob.ni', name: 'Fondo de Inversión Social de Emergencia', kind: 'national' },
  { domain: 'fomav.gob.ni', name: 'Fondo de Mantenimiento Vial', kind: 'national' },
  { domain: 'cornap.gob.ni', name: 'Corporaciones Nacionales del Sector Público', kind: 'national' },
  // ── Empresas del Estado ──
  { domain: 'enel.gob.ni', name: 'Empresa Nicaragüense de Electricidad', kind: 'state_company' },
  { domain: 'enatrel.gob.ni', name: 'Empresa Nacional de Transmisión Eléctrica', kind: 'state_company' },
  { domain: 'enabas.gob.ni', name: 'Empresa Nicaragüense de Alimentos Básicos', kind: 'state_company' },
  { domain: 'epn.gob.ni', name: 'Empresa Portuaria Nacional', kind: 'state_company' },
  { domain: 'eniminas.gob.ni', name: 'Empresa Nicaragüense de Minas', kind: 'state_company' },
  { domain: 'correos.gob.ni', name: 'Correos de Nicaragua', kind: 'state_company' },
  { domain: 'commema.gob.ni', name: 'Corporación Municipal de Mercados de Managua', kind: 'state_company' },
  // ── Gobiernos regionales y alcaldías ──
  { domain: 'craccs.gob.ni', name: 'Gobierno Regional Autónomo Costa Caribe Sur', kind: 'territorial' },
  { domain: 'managua.gob.ni', name: 'Alcaldía de Managua', kind: 'territorial' },
  { domain: 'alcaldiadechinandega.gob.ni', name: 'Alcaldía de Chinandega', kind: 'territorial' },
  { domain: 'alcaldiadematagalpa.gob.ni', name: 'Alcaldía de Matagalpa', kind: 'territorial' },
  { domain: 'alcaldiajinotega.gob.ni', name: 'Alcaldía de Jinotega', kind: 'territorial' },
  { domain: 'masaya.gob.ni', name: 'Alcaldía de Masaya', kind: 'territorial' },
  { domain: 'alcaldiagranada.gob.ni', name: 'Alcaldía de Granada', kind: 'territorial' },
  { domain: 'alcaldiamunicipalrivas.gob.ni', name: 'Alcaldía de Rivas', kind: 'territorial' },
  { domain: 'juigalpan.gob.ni', name: 'Alcaldía de Juigalpa', kind: 'territorial' },
  { domain: 'jinotepealcaldia.gob.ni', name: 'Alcaldía de Jinotepe', kind: 'territorial' },
  { domain: 'tipitapa.gob.ni', name: 'Alcaldía de Tipitapa', kind: 'territorial' },
  { domain: 'alcaldiaocotal.gob.ni', name: 'Alcaldía de Ocotal', kind: 'territorial' },
  { domain: 'alcaldiasebaco.gob.ni', name: 'Alcaldía de Sébaco', kind: 'territorial' },
  { domain: 'alcaldiaciudaddario.gob.ni', name: 'Alcaldía de Ciudad Darío', kind: 'territorial' },
  { domain: 'alcaldiaquezalguaque.gob.ni', name: 'Alcaldía de Quezalguaque', kind: 'territorial' },
  { domain: 'alcaldiadetola.gob.ni', name: 'Alcaldía de Tola', kind: 'territorial' },
  { domain: 'santotomaschontales.gob.ni', name: 'Alcaldía de Santo Tomás', kind: 'territorial' },
  { domain: 'bluefields.gob.ni', name: 'Alcaldía de Bluefields', kind: 'territorial' },
  { domain: 'puertocabezas.gob.ni', name: 'Alcaldía de Puerto Cabezas', kind: 'territorial' },
  { domain: 'cornisland.gob.ni', name: 'Alcaldía de Corn Island', kind: 'territorial' },
  { domain: 'alcaldiaelrama.gob.ni', name: 'Alcaldía de El Rama', kind: 'territorial' },
  { domain: 'alcaldiakukrahill.gob.ni', name: 'Alcaldía de Kukra Hill', kind: 'territorial' },
  { domain: 'alcaldiabonanza.gob.ni', name: 'Alcaldía de Bonanza', kind: 'territorial' },
  // ── Universidades públicas ──
  { domain: 'unan.edu.ni', name: 'Universidad Nacional Autónoma de Nicaragua, Managua', kind: 'public_university' },
  { domain: 'unanleon.edu.ni', name: 'Universidad Nacional Autónoma de Nicaragua, León', kind: 'public_university' },
  { domain: 'uni.edu.ni', name: 'Universidad Nacional de Ingeniería', kind: 'public_university' },
  { domain: 'una.edu.ni', name: 'Universidad Nacional Agraria', kind: 'public_university' },
  { domain: 'unm.edu.ni', name: 'Universidad Nacional Multidisciplinaria Ricardo Morales Avilés', kind: 'public_university' },
  { domain: 'uncsm.edu.ni', name: 'Universidad Nacional Casimiro Sotelo Montenegro', kind: 'public_university' },
  { domain: 'uncpggl.edu.ni', name: 'Universidad Nacional Comandante Padre Gaspar García Laviana', kind: 'public_university' },
  { domain: 'unhsjm.edu.ni', name: 'Universidad Nacional Héroes San José de las Mulas', kind: 'public_university' },
  { domain: 'ualn.edu.ni', name: 'Universidad Abierta en Línea de Nicaragua', kind: 'public_university' },
  { domain: 'tecnacional.edu.ni', name: 'Tecnológico Nacional', kind: 'public_university' },
  { domain: 'bicu.edu.ni', name: 'Bluefields Indian & Caribbean University', kind: 'public_university' },
  { domain: 'uraccan.edu.ni', name: 'Universidad de las Regiones Autónomas de la Costa Caribe Nicaragüense', kind: 'public_university' },
]);

/** Etiqueta del tipo de entidad para la columna «Industria». */
export const NI_PUBLIC_ENTITY_KIND_LABEL: Readonly<Record<NiPublicEntityKind, string>> = {
  national: 'Entidad pública nacional',
  territorial: 'Gobierno territorial',
  state_company: 'Empresa del Estado',
  public_university: 'Universidad pública',
};
