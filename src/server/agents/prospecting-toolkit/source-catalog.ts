/**
 * Prospecting Toolkit — Catálogo estructurado de fuentes.
 *
 * Cubre las fuentes oficiales por país que SellUp conoce (Colombia, México,
 * Chile, Perú, Ecuador, Brasil, República Dominicana, Argentina, Guatemala,
 * Honduras, Costa Rica, Panamá, El Salvador, Paraguay, Uruguay, Estados Unidos
 * y España) más fuentes globales como fallback (OpenCorporates, Apollo).
 *
 * Las fuentes con aiFlowStatus `connected_identity_in_run` (número fiscal por
 * nombre en cada corrida) y `connected_free_discovery` (capa gratuita por
 * industria) describen cómo trabaja hoy el Agente 1, pero NO entran en
 * `getCatalogContext().recommendedSources` (ver isSourceEnabledForAutomatedFlow):
 * no cambian la puntuación de candidatos ni los planes de consulta.
 * Lusha: presente pero marcada como "no discovery" — filtrada en getCatalogContext.
 *
 * Principios:
 * - P0: fuente primaria oficial, alta confianza para el país
 * - P1: complementaria o de nicho, útil pero no suficiente sola
 * - P2: global o pagada, fallback de último recurso
 */

import type { CatalogSource } from './types';

// ─── Identificadores fiscales por país ────────────────────────────────────────

export const FISCAL_IDENTIFIERS: Record<string, string> = {
  AR: 'CUIT',
  BO: 'NIT',
  BR: 'CNPJ',
  CL: 'RUT',
  CO: 'NIT',
  CR: 'Cédula Jurídica',
  DO: 'RNC',
  EC: 'RUC',
  GT: 'NIT',
  HN: 'RTN',
  MX: 'RFC',
  NI: 'RUC',
  PA: 'RUC',
  PE: 'RUC',
  PY: 'RUC',
  SV: 'NRC/NIT',
  UY: 'RUT',
  US: 'EIN',
  ES: 'NIF',
  VE: 'RIF',
};

// ─── Riesgos conocidos por país ───────────────────────────────────────────────

export const COUNTRY_RISKS: Record<string, string[]> = {
  CO: [
    'SIIS/Supersociedades cubre principalmente empresas medianas/grandes; microempresas pueden no aparecer.',
    'RUES puede tener datos desactualizados en sectores informales.',
    'SECOP II solo cubre proveedores del Estado; no representa todo el mercado.',
    'No asumir que toda empresa registrada en RUES está activa.',
    'Validar NIT antes de presentar la empresa — errores de transcripción son frecuentes.',
  ],
  MX: [
    'DENUE API tiene límite de registros por consulta; paginar correctamente.',
    'SIEM puede tener datos con 1-2 años de antigüedad para PYMES.',
    'DENUE nunca publica el RFC. El RFC por nombre sale de los contratos de CompraNet: sólo personas morales que le vendieron al Estado (2023-2025).',
    'Empresas del sector informal no aparecen en registros oficiales.',
    'CANAIVE/AMIA solo cubren sus sectores específicos.',
  ],
  CL: [
    'El RUT por nombre sale primero de la Nómina de personas jurídicas del SII (desde 1993, sin término de giro, con trabajadores informados) y, de respaldo, del Registro de Empresas y Sociedades (sólo constituidas desde 2013).',
    'ChileCompra (Mercado Público) solo cubre proveedores y compras del Estado chileno.',
    'Datos de contacto en fuentes públicas chilenas son escasos.',
    'No confundir RUT de persona natural con RUT de empresa.',
    'SII proporciona validación fiscal pero no perfil de empresa completo.',
  ],
  PE: [
    'SUNAT Padrón RUC es la fuente más confiable pero solo contiene datos tributarios.',
    'SEACE/OSCE solo cubre proveedores de contrataciones del Estado.',
    'PRODUCE Manufactura solo cubre sector manufacturero.',
    'Alta informalidad en algunos sectores — registros incompletos.',
    'Verificar estado activo en SUNAT antes de prospectar.',
  ],
  EC: [
    'SCVS/Supercias cubre principalmente grandes empresas obligadas a reportar.',
    'SERCOP cubre solo proveedores del Estado ecuatoriano.',
    'Datos de contacto en fuentes oficiales ecuatorianas son muy limitados.',
    'Distinguir RUC de persona natural vs empresa antes de prospectar.',
  ],
  BO: [
    'Bolivia no publica un padrón descargable: el NIT por nombre se consulta en vivo en el registro de comercio (SEPREC) y puede tardar o fallar.',
    'Peticiones espaciadas y como mucho 45 segundos por corrida (unas 8-10 empresas): las demás quedan sin NIT.',
    'Las empresas unipersonales (personas) nunca se ofrecen; nombres repetidos o genéricos no dan un NIT seguro.',
  ],
  BR: [
    'CNPJ es la fuente más completa de LatAm pero puede incluir empresas inactivas.',
    'cnpj.ws es un tercero no oficial; validar disponibilidad y TOS antes de usar.',
    'Volumen masivo requiere filtrado cuidadoso por situação: Ativa.',
    'Datos de contacto en Receita Federal son mínimos.',
  ],
  AR: [
    'El número fiscal (CUIT) sale del Registro Nacional de Sociedades: sólo sociedades activas; no cubre personas humanas con actividad comercial.',
    'La capa gratuita por industria sólo propone sociedades que además son proveedoras del Estado (COMPR.AR): no representa todo el mercado.',
    'Un nombre repetido entre varias sociedades no da un CUIT seguro; queda como señal.',
  ],
  DO: [
    'El padrón de la DGII cubre RNC de empresas (9 dígitos); las personas físicas con cédula quedan fuera.',
    'La actividad económica de la DGII es texto libre: la capa gratuita sólo usa las actividades de la tabla aprobada por la dueña.',
    'La capa gratuita sólo propone empresas activas que además son proveedoras del Estado (DGCP).',
  ],
  GT: [
    'El NIT por nombre sólo cubre sociedades inscritas como proveedoras del Estado en el RGAE (snapshot 2025).',
    'El snapshot es de un solo año: altas y bajas posteriores no se reflejan.',
    'Nombres repetidos o genéricos no dan un NIT seguro.',
  ],
  HN: [
    'El RTN por nombre sólo cubre personas jurídicas que participaron en compras públicas (ONCAE y SEFIN, 2018-2026).',
    'Las personas naturales nunca se guardan: su RTN lleva el año de nacimiento.',
    'Nombres repetidos o genéricos no dan un RTN seguro.',
  ],
  PA: [
    'Panamá no publica un padrón de RUC abierto: el RUC por nombre sólo cubre personas jurídicas proveedoras del Estado (PanamaCompraEnCifras).',
    'Las cédulas de personas naturales nunca se guardan.',
    'Nombres repetidos o genéricos no dan un RUC seguro.',
  ],
  SV: [
    'Sin número fiscal por nombre: El Salvador no publica una fuente gratuita con razón social + NIT (COMPRASAL sólo da el nombre; el NIT de los contribuyentes es confidencial).',
  ],
  NI: [
    'Sin número fiscal por nombre: Nicaragua no publica una fuente gratuita y accesible con razón social + RUC (DGI y SISCAE no responden desde fuera del país).',
  ],
  VE: [
    'Sin número fiscal por nombre: el SENIAT exige captcha y busca por RIF, no por nombre; el RNC sólo cubre contratistas del Estado y no tiene descarga masiva.',
  ],
  PY: [
    'El padrón público de RUC (SET/DNIT) sólo trae sociedades activas con RUC 80…; no indica sector ni tamaño.',
    'El RUC se guarda con dígito verificador (por ejemplo 80002201-7).',
    'Un nombre repetido no da un RUC seguro; queda como señal.',
  ],
  CR: [
    'Costa Rica no publica un padrón completo de sociedades: la cédula por nombre cubre PYMES activas del MEIC (enero de 2025) y proveedores del Estado de SICOP con nombre.',
    'Las empresas grandes casi no aparecen (la lista del MEIC es de micro, pequeñas y medianas).',
    'Nombres repetidos o genéricos no dan una cédula segura.',
  ],
  UY: [
    'El RUT por nombre sólo cubre empresas que alguna vez fueron proveedoras del Estado (RUPE).',
    'Empresas que nunca vendieron al Estado no aparecen.',
    'Nombres repetidos o genéricos no dan un RUT seguro.',
  ],
  US: [
    'No existe un registro público de EIN para todas las empresas: sólo cubre empresas que presentan ante la SEC y organizaciones sin ánimo de lucro grandes del IRS.',
    'Empresas privadas que no cotizan ni presentan ante la SEC no tienen EIN público.',
    'El EIN no tiene dígito verificador: un error de transcripción no se detecta.',
  ],
  ES: [
    'España no publica el NIF de las empresas en ningún registro abierto.',
    'El NIF por nombre sólo cubre sociedades que ganaron contratos públicos (Plataforma de Contratación del Sector Público).',
    'Empresas que nunca contrataron con el sector público no aparecen.',
  ],
};

// ─── Reglas globales del agente ───────────────────────────────────────────────

export const GLOBAL_RULES: string[] = [
  'No usar Lusha para discovery; solo para enriquecimiento de contactos bajo demanda.',
  'Apollo solo como fallback explícito cuando fuentes públicas no alcanzan el objetivo.',
  'HubSpot duplicate check obligatorio antes de presentar empresa como nueva.',
  'No inventar website, LinkedIn, ni datos de contacto.',
  'Máximo 25 empresas candidatas por ejecución.',
  'Usar identificador fiscal del país como ancla de deduplicación cuando esté disponible.',
];

// ─── Catálogo de fuentes ──────────────────────────────────────────────────────

export const CATALOG_SOURCES: CatalogSource[] = [

  // ── Colombia ────────────────────────────────────────────────────────────────
  {
    key: 'co_siis',
    name: 'Supersociedades SIIS',
    sellupUse: 'enrichment',
    aiFlowStatus: 'connected',
    connectionMode: 'automatic_enrichment',
    nextAction:
      'Snapshot SIIS 2024 cargado con 10.000 empresas. Es la primera fuente de NIT por nombre en cada corrida del Agente 1 (Apollo, Lusha, Tavily, Claude, banco, rescate e importación) y alimenta la capa gratuita colombiana por industria (tabla de actividades CIIU aprobada por la dueña el 06-10-2026) antes de pagar a proveedores. La carga de su web (SECOP II y correo de Supersociedades, sólo si el dominio lleva el nombre: ≈4.900 de 10.000) espera la autorización de la dueña. Recargar cuando SIIS publique un nuevo año (ya existe el corte 2025 en datos.gov.co).',
    countryCodes: ['CO'],
    sectors: [],
    priority: 'P0',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://siis.ia.supersociedades.gov.co/',
    automationLevel: 'high',
    recommendedUse:
      'Snapshot de Supersociedades (SIIS 2024, 10.000 empresas) cargado en SellUp. En cada corrida del Agente 1 (Apollo, Lusha e importación) es la primera fuente para completar el NIT por nombre de empresa; si no da un NIT seguro, el Agente 1 consulta en vivo el registro de las Cámaras de Comercio (Personas Jurídicas Cámaras de Comercio). También alimenta la capa gratuita colombiana por industria (co_siis_discovery): la industria sale del código CIIU con la tabla aprobada por la dueña (06-10-2026: la misma por división que Argentina, Chile y Ecuador, más mayoristas de medicamentos y cosméticos y farmacias en Salud, y mayoristas y tiendas de informática y telecomunicaciones en Tecnología), propone primero las que más facturan y nunca repite lo que SellUp ya tiene. Con la web cargada, también da el NIT por la web de la candidata. Aporta además señales financieras (ingresos, utilidades, activos, patrimonio) para priorizar empresas medianas y grandes.',
    limitations: [
      'Cobertura limitada a empresas reportadas o supervisadas por Supersociedades — no representa todo el universo empresarial colombiano',
      'No cubre microempresas ni empresas no vigiladas',
      'Datos con rezago de 1-2 años respecto al ejercicio fiscal',
      'No incluye datos de contacto (emails, teléfonos)',
      'La capa gratuita por CIIU sólo propone empresas que están en SIIS: no reemplaza la búsqueda con proveedores',
      'Se lee de la carga controlada en SellUp, nunca del Excel de SIIS en cada búsqueda',
      'Requiere recarga anual o manual cuando SIIS publique nuevo Excel',
    ],
    riskNotes: [
      'Que una empresa no esté en SIIS no significa que no exista — por eso, sin NIT seguro, el Agente 1 recurre a las Cámaras de Comercio',
      'Un nombre repetido o genérico no da un NIT seguro',
      'Snapshot 2024 cargado exitosamente (10.000 registros) — monitorear actualización anual',
    ],
  },
  {
    key: 'co_public_entities',
    name: 'Entidades públicas (CHIP + SIGEP II) — NIT por web y tamaño',
    sellupUse: 'enrichment',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      'Conectada en el código: en cada corrida del Agente 1 da el NIT de alcaldías, gobernaciones, ministerios, E.S.E. y demás entidades públicas por la WEB de la candidata, con sus servidores públicos como tamaño oficial. La carga (≈4.900 entidades, 3.551 con web; descargas públicas de datos.gov.co) espera la autorización de la dueña.',
    countryCodes: ['CO'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'pending_validation',
    type: 'official_registry',
    url: 'https://www.datos.gov.co/Hacienda-y-Cr-dito-P-blico/ENTIDADES-P-BLICAS-REGISTRADAS-EN-EL-SISTEMA-CHIP/5c7g-ptic',
    automationLevel: 'high',
    recommendedUse:
      'Directorio de entidades públicas de Colombia armado con dos fuentes gratuitas de datos.gov.co: el CHIP de la Contaduría General (NIT, nombre, municipio y página web publicada por la propia entidad) y la Caracterización del Empleo Público del SIGEP II (servidores públicos por entidad, junio 2026). Medido el 06-10-2026: 89 de 275 empresas colombianas sin NIT eran entidades públicas, que no están en las cámaras de comercio y cuya razón social no se parece a su nombre de uso («Alcaldía de Ipiales» es «Ipiales»). En cada corrida (Apollo, Lusha, Tavily, Claude, banco, rescate, capa gratuita e importación), si el SIIS no dio un NIT seguro, el Agente 1 busca la web de la candidata en este directorio: host exacto primero, luego el dominio registrable; si varias entidades comparten la web, gana la que lleva el mismo nombre o la cabeza de la entidad (alcaldía, gobernación, ministerio). Los servidores públicos llegan al filtro ICP de tamaño por el mismo camino que el SII de Chile.',
    limitations: [
      'Sólo entidades que reportan al CHIP o al SIGEP II; las que no publican web sólo se encuentran por nombre.',
      'El SIGEP cuenta servidores de planta, no contratistas: el tamaño real puede ser mayor.',
      'Personería y concejo comparten el NIT del municipio: sus servidores se suman al municipio.',
      'Snapshot estático — se rearma desde las descargas públicas cuando se recargue.',
    ],
    riskNotes: [
      'Un dominio del Estado (.gov.co, .mil.co) nunca identifica a una empresa privada.',
      'Si varias entidades comparten la web y ninguna coincide por nombre ni es la cabeza, queda sólo como pista.',
      'No se guardan correos ni personas: sólo el dominio y el número de servidores.',
    ],
  },
  {
    key: 'co_public_entities_discovery',
    name: 'Entidades públicas — capa gratuita de Gobierno (200+ servidores)',
    sellupUse: 'enrichment',
    aiFlowStatus: 'connected_free_discovery',
    connectionMode: 'read_only_snapshot',
    nextAction:
      'Conectada en el código como capa gratuita de Gobierno para Colombia. Depende de la carga de co_public_entities (≈150 entidades de Gobierno con 200 o más servidores y con web), que espera la autorización de la dueña.',
    countryCodes: ['CO'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'pending_validation',
    type: 'official_registry',
    url: 'https://www.datos.gov.co/Funci-n-p-blica/Caracterizaci-n-del-Empleo-P-blico/h8rs-jxum',
    automationLevel: 'high',
    recommendedUse:
      'Capa gratuita colombiana para la industria Gobierno (decisión de la dueña, 06-10-2026): antes de pagar a Apollo o Lusha, el Agente 1 propone entidades públicas de administración (alcaldías, gobernaciones, ministerios, departamentos administrativos, superintendencias, agencias, institutos y órganos autónomos) con 200 o más servidores públicos según el SIGEP II, de mayor a menor, con su NIT y su web. Las E.S.E. (hospitales públicos) y las empresas de servicios públicos quedan clasificadas en Salud y Energía pero no se ofrecen. El SIIS no sirve para Gobierno: sólo tiene 5 filas de administración pública, todas empresas privadas mal clasificadas.',
    limitations: [
      'Sólo entidades con 200 o más servidores de planta en el SIGEP II: los municipios pequeños no se ofrecen.',
      'Universidades públicas, empresas industriales y comerciales del Estado y sociedades de economía mixta no tienen industria y no se ofrecen.',
      'Nunca repite lo que SellUp ya tiene (candidatas o descartes por NIT).',
    ],
    riskNotes: [
      'Las entidades que propone pasan a revisión humana; no se crean cuentas automáticamente.',
    ],
  },
  {
    key: 'co_datos_gov',
    name: 'datos.gov.co',
    sellupUse: 'technical_container',
    aiFlowStatus: 'not_applicable',
    connectionMode: 'not_applicable',
    nextAction: 'No mostrar como fuente directa del wizard',
    countryCodes: ['CO'],
    sectors: [],
    priority: 'P2',
    operationalStatus: 'manual_signal_only',
    type: 'public_dataset',
    url: 'https://www.datos.gov.co/',
    automationLevel: 'low',
    recommendedUse:
      'Proveedor técnico de datasets públicos de Colombia sobre Socrata/SODA. No debe usarse como fuente monolítica de discovery; las capacidades operativas deben implementarse mediante datasets específicos validados.',
    limitations: [
      'Portal heterogéneo con miles de datasets; la calidad depende de cada dataset.',
      'No usar como fuente genérica de prospectos.',
      'Cada dataset requiere validación individual de cobertura, columnas, actualización y filtros.',
      'Algunos datasets son regionales, desactualizados o no empresariales.',
      'Usar subfuentes específicas para discovery, enriquecimiento, validación o señales.',
    ],
    riskNotes: [
      'Riesgo crítico: tratar datos.gov.co como fuente única puede producir resultados caóticos.',
      'Se deben separar datasets operativos con source_key propio.',
      'Validar estado, cobertura y fecha de actualización por dataset.',
      'En datasets de empresas, filtrar registros activos cuando aplique.',
    ],
  },
  {
    key: 'co_personas_juridicas_cc',
    name: 'Personas Jurídicas Cámaras de Comercio',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected',
    connectionMode: 'automatic_enrichment',
    nextAction:
      'Conectada a enrichment por NIT y a la búsqueda en vivo del NIT por nombre dentro de cada corrida, cuando Supersociedades (SIIS) no da un NIT seguro.',
    countryCodes: ['CO'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://www.datos.gov.co/resource/c82u-588k.json',
    automationLevel: 'high',
    recommendedUse:
      'Registro de personas jurídicas de las Cámaras de Comercio (datos del RUES) publicado en datos.gov.co (dataset c82u-588k). Dos usos en el Agente 1: (1) validación y enriquecimiento por NIT — razón social, estado de matrícula, CIIU y renovación; (2) búsqueda en vivo del NIT por nombre dentro de cada corrida cuando Supersociedades (SIIS) no da un NIT seguro: busca por el comienzo del nombre, sólo empresas con NIT y matrícula no cancelada, y exige que el núcleo del nombre coincida exactamente. Medido sobre 206 empresas colombianas reales sin NIT: 14 NIT seguros y 7 señales.',
    limitations: [
      'Cobertura parcial: solo cámaras que publican en datos.gov.co.',
      'No reemplaza RUES como fuente principal nacional.',
      'Mezcla registros activos y cancelados; la búsqueda por nombre descarta las matrículas canceladas.',
      'No debe usarse como discovery universal de Colombia.',
      'Búsqueda por nombre con límites: 4 segundos por consulta y máximo 60 consultas por corrida.',
      'Un nombre de una sola palabra sin forma societaria (por ejemplo, sólo la marca) cuenta solo como señal, nunca como NIT seguro.',
    ],
    riskNotes: [
      'Si datos.gov.co falla 3 veces seguidas, la búsqueda por nombre se apaga para el resto de la corrida; la corrida sigue sin ese NIT.',
      'Varias empresas con el mismo núcleo de nombre dan solo una señal, no un NIT seguro.',
      'Requiere normalización de NIT, razón social y estado de matrícula.',
      'Endpoint Socrata validado: https://www.datos.gov.co/resource/c82u-588k.json',
    ],
  },
  {
    key: 'co_secop2_proveedores',
    name: 'SECOP II Proveedores Registrados',
    sellupUse: 'commercial_signal',
    aiFlowStatus: 'connected',
    connectionMode: 'automatic_enrichment',
    nextAction: 'Conectada a enrichment B2G por NIT',
    countryCodes: ['CO'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'procurement',
    url: 'https://www.datos.gov.co/resource/qmzu-gj57.json',
    automationLevel: 'high',
    recommendedUse:
      'Señal comercial B2G y enriquecimiento de empresas registradas como proveedoras del Estado. Útil para identificar empresas activas en contratación pública, datos de contacto, categoría principal, tipo de empresa y representante legal.',
    limitations: [
      'No es fuente de discovery universal.',
      'Solo cubre empresas registradas como proveedoras del Estado.',
      'Debe filtrarse esta_activa cuando aplique.',
      'Puede solaparse con co_secop2, que representa compras públicas/contratos.',
    ],
    riskNotes: [
      'Usar como señal comercial post-discovery, no como única fuente de prospección.',
      'Complementa co_secop2: proveedores registrados vs procesos/contratos.',
      'Endpoint Socrata validado: https://www.datos.gov.co/resource/qmzu-gj57.json',
    ],
  },
  {
    key: 'co_rues',
    name: 'RUES (Registro Único Empresarial)',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected',
    connectionMode: 'wizard_discovery',
    nextAction:
      'Son los mismos datos de las Cámaras de Comercio: la conexión técnica es la fuente «Personas Jurídicas Cámaras de Comercio» (co_personas_juridicas_cc).',
    countryCodes: ['CO'],
    sectors: [],
    priority: 'P0',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://www.rues.org.co/',
    automationLevel: 'high',
    recommendedUse:
      'Fuente oficial de referencia para validación legal en Colombia. En SellUp los datos del RUES llegan por el dataset c82u-588k de las Cámaras de Comercio en datos.gov.co, que es la fuente técnica conectada «Personas Jurídicas Cámaras de Comercio»: el Agente 1 la usa para validar por NIT (matrícula, estado, cámara, CIIU, renovación) y para buscar el NIT por nombre en cada corrida cuando Supersociedades no lo da.',
    limitations: [
      'El canal automático actual no representa el RUES nacional completo.',
      'El dataset Socrata c82u-588k tiene cobertura parcial según las cámaras que publican datos.',
      'No reemplaza una consulta nacional completa o convenio oficial con RUES/Confecámaras.',
      'No incluye datos comerciales completos como teléfono, email, sitio web o decisores.',
      'La consulta directa a rues.org.co puede requerir interacción de navegador/captcha y no debe automatizarse mediante scraping.',
    ],
    riskNotes: [
      'Riesgo principal: asumir cobertura nacional completa cuando el canal automático actual es parcial.',
      'Usar como validación parcial, no como única prueba legal definitiva.',
      'Mantener rues.org.co como referencia manual/oficial, no como canal de scraping.',
      'Endpoint automático actual: https://www.datos.gov.co/resource/c82u-588k.json (el mismo de co_personas_juridicas_cc).',
    ],
  },
  {
    key: 'co_secop2',
    name: 'SECOP II (Compras Públicas)',
    sellupUse: 'not_for_ai_flow',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Usar solo como referencia contextual. Para enrichment automático usar co_secop2_proveedores.',
    countryCodes: ['CO'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'manual_signal_only',
    type: 'procurement',
    url: 'https://www.secop.gov.co/',
    automationLevel: 'low',
    recommendedUse: 'Señal contextual de contratación pública / mercado B2G. No usar como adapter automático. Para proveedor registrado usar co_secop2_proveedores. No duplicar lógica.',
    limitations: [
      'No tiene adapter propio.',
      'Puede confundirse con co_secop2_proveedores.',
      'No debe entrar al flujo automático del Agente 1.',
      'Solo empresas que venden al Estado colombiano.',
    ],
    riskNotes: [
      'No usar como fuente automática de discovery ni enrichment.',
      'Para proveedor registrado y datos estructurados de contratación, usar co_secop2_proveedores.',
      'Mantener co_secop2 como señal contextual, no como adapter operativo.',
    ],
  },
  {
    key: 'co_minsalud_reps',
    name: 'MinSalud REPS',
    sellupUse: 'enrichment',
    aiFlowStatus: 'connected',
    connectionMode: 'automatic_enrichment',
    nextAction: 'Conectada a enrichment salud por NIT',
    countryCodes: ['CO'],
    sectors: ['salud', 'health', 'farmaceutico', 'pharmaceutical', 'clinica', 'hospital', 'ips', 'eps', 'laboratorio'],
    priority: 'P0',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://www.reps.gov.co/',
    automationLevel: 'high',
    recommendedUse:
      'Fuente P0 para sector salud: discovery sectorial y validación/enriquecimiento de prestadores habilitados. Dataset Socrata REPS validado (c36g-9fc2) con NIT, razón social, naturaleza jurídica, clase prestador, departamento, municipio, dirección, teléfono, email, sede, código habilitación.',
    limitations: ['Solo sector salud — no multisectorial.'],
    riskNotes: [
      'Endpoint Socrata validado: https://www.datos.gov.co/resource/c36g-9fc2.json',
      'Validar cobertura y actualización antes de uso en producción.',
    ],
  },
  {
    key: 'co_superfinanciera',
    name: 'Superfinanciera Colombia',
    sellupUse: 'enrichment',
    aiFlowStatus: 'connected',
    connectionMode: 'automatic_enrichment',
    nextAction: 'Conectada a enrichment financiero por NIT',
    countryCodes: ['CO'],
    sectors: ['financiero', 'fintech', 'banca', 'banco', 'seguros', 'financial', 'banking', 'insurance', 'aseguradora'],
    priority: 'P0',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://www.superfinanciera.gov.co/',
    automationLevel: 'high',
    recommendedUse:
      'Fuente P0 para sector financiero supervisado: bancos, aseguradoras, fiduciarias, fondos. Dataset Socrata validado (sr9n-792w) para entidades vigiladas con NIT, razón social, tipo entidad, ciudad, dirección, email, web, representante legal.',
    limitations: ['Solo sector financiero regulado — no multisectorial.'],
    riskNotes: [
      'Endpoint Socrata validado: https://www.datos.gov.co/resource/sr9n-792w.json',
      'Validar cobertura y actualización antes de uso en producción.',
    ],
  },

  // ── Colombia — Innovación / Emprendimiento ──────────────────────────────────
  {
    key: 'co_innpulsa',
    name: 'iNNpulsa Colombia (MinComercio)',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Sin acción: señal manual innovación',
    countryCodes: ['CO'],
    sectors: ['tecnologia', 'innovacion', 'startups', 'emprendimiento', 'technology', 'innovation', 'startup_ecosystem'],
    priority: 'P2',
    operationalStatus: 'manual_signal_only',
    type: 'other',
    url: 'https://www.innpulsacolombia.com/',
    automationLevel: 'manual',
    recommendedUse:
      'Señal comercial cualitativa para identificar empresas innovadoras, startups, emprendimientos o beneficiarias de programas públicos de innovación/emprendimiento. Útil como contexto comercial y priorización manual, no como fuente automática de discovery o validación legal.',
    limitations: [
      'No tiene API pública de empresas.',
      'No existe dataset público estructurado en datos.gov.co validado para beneficiarios iNNpulsa.',
      'No tiene directorio público estable de empresas beneficiarias.',
      'No sirve para discovery principal ni validación legal/NIT.',
      'La información pública está dispersa en convocatorias, PDFs, noticias o páginas institucionales.',
      'La cobertura es acotada a programas específicos y puede estar desactualizada.',
    ],
    riskNotes: [
      'No automatizar extracción desde el sitio institucional ni paneles internos.',
      'Mantener como señal manual hasta contar con API, dataset público o acceso formal autorizado.',
      'Los datos de beneficiarios pueden estar incompletos, no estandarizados o sin clasificación sectorial.',
      'No usar como fuente de creación masiva de prospectos.',
      'Reevaluar si iNNpulsa publica datasets estructurados o acceso oficial.',
    ],
  },

  // ── Colombia — Tecnología (Hito 16Y.1) ─────────────────────────────────────
  {
    key: 'co_fedesoft',
    name: 'Fedesoft (Federación Colombiana de Software y TI)',
    sellupUse: 'commercial_signal',
    aiFlowStatus: 'paused',
    connectionMode: 'not_connected',
    nextAction: 'Pausada por bloqueo upstream (captcha/protección SiteGround). No debe correr automáticamente hasta tener snapshot cargado o ruta estable.',
    countryCodes: ['CO'],
    sectors: ['tecnologia', 'software', 'tic', 'servicios_ti', 'technology', 'software_development', 'it_services'],
    priority: 'P1',
    operationalStatus: 'manual_signal_only',
    type: 'industry_association',
    url: 'https://www.fedesoft.org/',
    automationLevel: 'low',
    recommendedUse: 'Señal sectorial tech / software Colombia. Útil como fuente futura o contextual. No usar automáticamente en wizard mientras upstream esté bloqueado. Requiere snapshot controlado o archivo manual verificable antes de reactivar.',
    limitations: [
      'Upstream bloquea carga automática desde Node por captcha/protección SiteGround.',
      'No depender de consulta live.',
      'No marcar como connected hasta tener snapshot cargado o alternativa estable.',
      'Cobertura acotada a empresas afiliadas a Fedesoft; no representa todo el universo de empresas TI en Colombia.',
      'No reemplaza RUES ni co_personas_juridicas_cc para validación legal/NIT.',
    ],
    riskNotes: [
      'No usar como live dependency del wizard — la carga se pausa si Fedesoft responde con captcha/protección SiteGround.',
      'Usar exclusivamente snapshot controlado si se reactiva; no consultar en vivo contra el upstream.',
      'Conector REST y ETL snapshot existen, pero el bloqueo actual es upstream (captcha), no falta de desarrollo.',
      'Puede usarse como señal contextual si se obtiene data manualmente.',
      'Reevaluar cuando SiteGround deje de bloquear o se tenga acceso alternativo autorizado.',
    ],
  },
  {
    key: 'co_colombia_fintech',
    name: 'Colombia Fintech (Asociación Fintech de Colombia)',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Sin acción: señal manual fintech',
    countryCodes: ['CO'],
    sectors: ['tecnologia', 'fintech', 'financiero', 'pagos', 'technology', 'payments', 'financial_technology'],
    priority: 'P2',
    operationalStatus: 'manual_signal_only',
    type: 'industry_association',
    url: 'https://www.colombiafintech.co/',
    automationLevel: 'low',
    recommendedUse:
      'Señal sectorial manual para identificar empresas vinculadas al ecosistema fintech colombiano. Útil como contexto comercial y priorización cualitativa cuando una empresa ya fue identificada por fuentes con NIT, como RUES, cámaras o Superfinanciera. No debe usarse como fuente automática de discovery ni como validación legal.',
    limitations: [
      'No expone NIT en el directorio público ni en la API REST disponible.',
      'No permite validación legal ni deduplicación fiscal confiable.',
      'La API REST WordPress es parcial y no expone todos los campos útiles como ciudad, website, vertical o contacto.',
      'Parte del contenido de perfiles puede estar protegido por login.',
      'No representa todo el universo fintech colombiano; cubre principalmente miembros afiliados.',
      'No debe usarse como fuente automática de creación masiva de prospectos.',
    ],
    riskNotes: [
      'Riesgo principal: sin NIT no hay anclaje confiable contra RUES, cámaras o Superfinanciera.',
      'No automatizar extracción por HTML mientras no exista dataset estructurado o API completa.',
      'Mantener como señal manual/gremial hasta contar con una fuente pública con NIT.',
      'Evitar tratar todos los miembros como fintechs puras; algunos pueden ser consultoras, aliados, universidades u otros actores de cadena de valor.',
      'Reevaluar si Colombia Fintech publica dataset abierto, descarga estructurada o API con NIT y verticales.',
      'Preservar gating fintech actual en query-builder si existe, pero no ampliar automatización.',
    ],
  },
  {
    key: 'co_colombia_digital',
    name: 'Colombia Digital',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Sin acción: referencia editorial TIC',
    countryCodes: ['CO'],
    sectors: ['tecnologia', 'transformacion_digital', 'tic', 'technology', 'digital_transformation', 'ict'],
    priority: 'P2',
    operationalStatus: 'manual_signal_only',
    type: 'industry_association',
    url: 'https://www.colombiadigital.net/',
    automationLevel: 'manual',
    recommendedUse: 'Referencia editorial/manual sobre transformación digital y ecosistema TIC colombiano. Puede servir como contexto sectorial cualitativo, pero no como fuente de discovery, validación legal, enriquecimiento automático o creación de prospectos.',
    limitations: [
      'No es un directorio de empresas.',
      'No expone NIT ni identificadores legales de terceros.',
      'No tiene API pública ni descarga estructurada para empresas.',
      'No sirve para discovery ni validación legal.',
      'Los casos públicos disponibles son pocos y principalmente de entidades públicas.',
      'El contenido es principalmente editorial, institucional o de casos de éxito.',
    ],
    riskNotes: [
      'Riesgo principal: confundir Colombia Digital con un directorio del ecosistema digital cuando en realidad no publica una base empresarial estructurada.',
      'No automatizar extracción desde contenido editorial.',
      'No usar como fuente de creación masiva de prospectos.',
      'Mantener solo como referencia manual de contexto TIC.',
      'El dominio colombiadigital.net debe seguir bloqueado como candidato empresarial en filtros pre-LLM.',
      'Reevaluar únicamente si se publica un dataset estructurado, API oficial o directorio con NIT.',
    ],
  },
  {
    key: 'co_andicom',
    name: 'ANDICOM (Congreso TIC Colombia / CINTEL)',
    sellupUse: 'contextual_signal',
    aiFlowStatus: 'source_guided',
    connectionMode: 'source_guided_query',
    nextAction: 'Mantener solo como señal contextual Tavily',
    countryCodes: ['CO'],
    sectors: ['tecnologia', 'telecomunicaciones', 'software', 'servicios_ti', 'technology', 'telecommunications', 'ict'],
    priority: 'P2',
    operationalStatus: 'manual_signal_only',
    type: 'industry_association',
    url: 'https://www.andicom.co/',
    automationLevel: 'low',
    recommendedUse: 'Señal contextual de búsqueda para identificar empresas visibles en el ecosistema TIC colombiano a través de sponsors, expositores o participación en ANDICOM/CINTEL. Útil para source-guided queries de tecnología en Colombia, pero no como fuente estructurada de discovery, validación legal, enrichment automático o creación de prospectos.',
    limitations: [
      'No expone NIT ni identificadores legales de empresas.',
      'No tiene API pública ni descarga estructurada de sponsors/expositores.',
      'La información disponible depende de la edición anual del evento y puede cambiar.',
      'Los listados públicos son principalmente logos, nombres comerciales y enlaces web.',
      'Puede incluir multinacionales, entidades públicas, gremios, speakers o aliados que no son prospectos colombianos directos.',
      'No debe usarse como fuente única de discovery ni como validación legal.',
    ],
    riskNotes: [
      'Riesgo principal: sin NIT no hay anclaje fiscal ni deduplicación confiable contra RUES, cámaras o SIIS.',
      'Mantener únicamente como señal contextual para búsquedas web guiadas.',
      'No desarrollar pipeline estructurado mientras no exista API, dataset o listado con NIT.',
      'Evitar scraping agresivo de HTML, imágenes o logos del evento.',
      'Preservar filtros para que andicom.co y CINTEL no aparezcan como empresas candidatas.',
      'Reevaluar solo si ANDICOM/CINTEL publica un listado estructurado con NIT, razón social y año de participación.',
    ],
  },
  {
    key: 'co_ruta_n',
    name: 'Ruta N (Ecosistema Innovación Medellín)',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Sin acción: señal manual Medellín/startups',
    countryCodes: ['CO'],
    sectors: ['tecnologia', 'innovacion', 'startups', 'software', 'technology', 'innovation', 'startup_ecosystem'],
    priority: 'P2',
    operationalStatus: 'manual_signal_only',
    type: 'other',
    url: 'https://www.rutanmedellin.org/',
    automationLevel: 'manual',
    recommendedUse: 'Señal manual cualitativa para identificar startups, empresas innovadoras o actores relacionados con el ecosistema Ruta N en Medellín/Antioquia. Puede servir como contexto comercial local, pero no como fuente automática de discovery, validación legal, enrichment o creación de prospectos.',
    limitations: [
      'No tiene API pública ni dataset estructurado de empresas.',
      'No expone NIT ni identificadores legales.',
      'No existe directorio público empresarial consumible automáticamente.',
      'La información útil suele estar en noticias, convocatorias, logos o contenido editorial no estructurado.',
      'StartIA requiere login y no ofrece API pública validada.',
      'Cobertura limitada a Medellín/Antioquia y a programas puntuales.',
    ],
    riskNotes: [
      'Riesgo principal: sin NIT no hay anclaje fiscal ni deduplicación confiable contra RUES, cámaras o SIIS.',
      'No automatizar scraping de noticias, logos o contenido editorial.',
      'No usar como fuente de creación masiva de prospectos.',
      'Mantener solo como señal manual/local de innovación.',
      'Preservar el bloqueo de rutanmedellin.org como candidato empresarial.',
      'Reevaluar únicamente si Ruta N, StartIA o Alcaldía de Medellín publican API pública, dataset estructurado o directorio con NIT.',
    ],
  },
  {
    key: 'co_microsoft_partners',
    name: 'Microsoft Partner Directory Colombia',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Post-MVP: posible enrichment manual cloud',
    countryCodes: ['CO'],
    sectors: ['tecnologia', 'cloud', 'software', 'integradores', 'technology', 'cloud_computing', 'it_services', 'enterprise_software'],
    priority: 'P2',
    operationalStatus: 'manual_signal_only',
    type: 'commercial_provider',
    url: 'https://www.microsoft.com/en-us/solution-providers/home',
    automationLevel: 'low',
    recommendedUse:
      'Señal sectorial/manual para identificar empresas tecnológicas o integradores relacionados con el ecosistema Microsoft en Colombia. Puede servir como enriquecimiento futuro post-discovery para candidatos ya identificados por fuentes con NIT, agregando contexto de partner Microsoft, soluciones cloud, designaciones o especializaciones. No debe usarse como fuente automática de discovery, validación legal ni creación de prospectos.',
    limitations: [
      'No expone NIT/RUT ni identificadores legales.',
      'No expone razón social legal.',
      'No tiene API pública estable ni descarga estructurada del directorio.',
      'La fuente pública funciona como React SPA y no debe consumirse mediante scraping frágil.',
      'Puede incluir partners multinacionales o empresas que atienden Colombia sin ser empresas colombianas.',
      'No permite deduplicación fiscal confiable contra RUES, cámaras, SIIS o SECOP.',
    ],
    riskNotes: [
      'Riesgo principal: sin NIT no hay anclaje fiscal ni deduplicación confiable.',
      'No usar como fuente de discovery automático ni como source-guided query independiente.',
      'No desarrollar conector mientras no exista API pública, dataset estructurado o acceso formal autorizado.',
      'Evitar scraping de la React SPA o endpoints internos no documentados.',
      'Usar solo como señal/enrichment futuro post-discovery por matching conservador nombre+ciudad.',
      'Patrón similar a AWS Partners: útil como señal cloud, débil como fuente de datos.',
    ],
  },
  {
    key: 'co_aws_partners',
    name: 'AWS Partner Network Colombia',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Post-MVP: posible enrichment manual cloud',
    countryCodes: ['CO'],
    sectors: ['tecnologia', 'cloud', 'infraestructura_ti', 'technology', 'cloud_computing', 'infrastructure', 'devops'],
    priority: 'P2',
    operationalStatus: 'manual_signal_only',
    type: 'commercial_provider',
    url: 'https://partners.amazonaws.com/',
    automationLevel: 'low',
    recommendedUse: 'Señal sectorial/manual para identificar empresas tecnológicas o integradores relacionados con el ecosistema AWS en Colombia. Puede servir como enriquecimiento futuro post-discovery para candidatos ya identificados por fuentes con NIT, agregando contexto de partner AWS, competencias, tier, certificaciones o especializaciones cloud. No debe usarse como fuente automática de discovery, validación legal ni creación de prospectos.',
    limitations: [
      'No expone NIT/RUT ni identificadores legales.',
      'No expone razón social legal.',
      'No tiene API pública oficial/documentada ni descarga estructurada para uso productivo.',
      'La fuente pública depende de una SPA y endpoints internos no garantizados.',
      'Puede incluir multinacionales o partners que atienden Colombia sin ser empresas colombianas.',
      'No permite deduplicación fiscal confiable contra RUES, cámaras, SIIS o SECOP.',
    ],
    riskNotes: [
      'Riesgo principal: sin NIT no hay anclaje fiscal ni deduplicación confiable.',
      'No usar como fuente de discovery automático ni como source-guided query independiente.',
      'No desarrollar conector mientras no exista API pública, dataset estructurado o acceso formal autorizado.',
      'Evitar scraping o dependencia productiva de endpoints internos no documentados de AWS.',
      'Usar solo como señal/enrichment futuro post-discovery mediante matching conservador por nombre, website o ciudad.',
      'Patrón similar a Microsoft Partners: útil como señal cloud, débil como fuente de datos.',
    ],
  },
  {
    key: 'co_getonboard',
    name: 'GetOnBoard Colombia',
    sellupUse: 'commercial_signal',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Sin acción: señal manual hiring tech',
    countryCodes: ['CO'],
    sectors: ['tecnologia', 'software', 'startups', 'talento_tech', 'technology', 'software_development', 'tech_talent'],
    priority: 'P2',
    operationalStatus: 'manual_signal_only',
    type: 'other',
    url: 'https://www.getonbrd.com/',
    automationLevel: 'low',
    recommendedUse: 'Identificar empleadores tech activos en Colombia a través de vacantes publicadas. Señal indirecta de empresa tech con capacidad de contratación.',
    limitations: ['Señal de actividad laboral, no directorio formal de empresas', 'Cobertura limitada a empresas que publican en la plataforma'],
  },

  // ── México ─────────────────────────────────────────────────────────────────
  {
    key: 'mx_denue',
    name: 'DENUE / INEGI API',
    sellupUse: 'enrichment',
    aiFlowStatus: 'connected',
    connectionMode: 'wizard_discovery',
    nextAction:
      'Conectada como capa gratuita mexicana por industria antes de pagar a proveedores: consulta en vivo la API de DENUE (gratuita, con el token de INEGI guardado en la bóveda) usando la tabla SCIAN v2 aprobada por la dueña. DENUE nunca publica RFC: desde el 05-10 cada empresa que esta capa propone busca su RFC por nombre en «CompraNet — RFC por nombre» (mx_compranet_rfc_registry) y, si no, en las listas del SAT y Nuevo León (mx_rfc_public_lists_registry), antes de revisar duplicados, y lo trae sólo con coincidencia segura (como el nombre de DENUE es oficial, un nombre de una sola palabra como «AXTEL» vale si hay UN solo RFC con ese nombre; decisión de la dueña 06-10). Los organismos públicos genéricos se completan con su estado o municipio («GOBIERNO DEL ESTADO», «SECRETARIA DE SALUD», «H. AYUNTAMIENTO»…) y las sucursales del IMSS y del ISSSTE cuentan como la institución. Desde el 06-10 no vuelve a proponer lo que SellUp ya tiene en revisión o en Descartadas (igual en todos los países con buscador gratuito).',
    countryCodes: ['MX'],
    sectors: [],
    priority: 'P0',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://www.inegi.org.mx/servicios/api_denue.html',
    automationLevel: 'high',
    recommendedUse:
      'Directorio oficial de INEGI con más de 5 millones de establecimientos. En el Agente 1 es la capa gratuita mexicana por industria: antes de pagar a Apollo o Lusha consulta en vivo la API de DENUE con la tabla SCIAN v2 aprobada por la dueña (por ejemplo, bibliotecas públicas → Gobierno), sólo establecimientos de 51 o más personas, alternando actividades, y deja una fila por empresa (razón social y nombre comercial). Guarda el sitio web o dominio cuando DENUE lo publica. DENUE nunca publica RFC: el RFC lo pone CompraNet por nombre cuando la empresa le vendió al Estado.',
    limitations: [
      'DENUE nunca publica RFC: sólo lo tienen las empresas que también aparecen en CompraNet o en las listas del SAT y Nuevo León con el mismo nombre.',
      'Es registro de establecimiento físico, no necesariamente la razón social fiscal.',
      'Puede devolver múltiples establecimientos para una misma marca o grupo empresarial; SellUp deja una fila por empresa.',
      'Sólo propone establecimientos de 51 o más personas: empresas más pequeñas no entran por esta vía.',
      'El sitio web sólo aparece cuando DENUE lo publica.',
      'Datos con actualización cada 1-2 años — puede incluir establecimientos ya cerrados.',
      'Requiere token de acceso INEGI con rate limit por consulta.',
    ],
    riskNotes: [
      'No usar como fuente fiscal — no escribe tax_identifier.',
      'No enviar a HubSpot como RFC validado bajo ninguna circunstancia.',
      'Las empresas que propone pasan a revisión humana.',
      'Mantener tax_identifier_resolution.status = not_resolvable_automatically para México.',
    ],
  },
  {
    key: 'mx_datos_gob',
    name: 'datos.gob.mx (Portal Datos Abiertos México)',
    sellupUse: 'technical_container',
    aiFlowStatus: 'not_applicable',
    connectionMode: 'not_applicable',
    nextAction: 'No mostrar como fuente directa del wizard. Si aparece un dataset útil, crear subfuente específica con su propia key.',
    countryCodes: ['MX'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'manual_signal_only',
    type: 'public_dataset',
    url: 'https://datos.gob.mx/',
    automationLevel: 'low',
    recommendedUse:
      'Portal agregador de datasets públicos mexicanos. No usar como fuente directa del wizard — es un contenedor técnico. Si se identifica un dataset útil (DENUE histórico, SIEM, sectorial), crear una subfuente específica con su propia key y validación individual.',
    limitations: [
      'No es un dataset único — agrega miles de datasets con calidad variable.',
      'No hay dataset RFC empresarial útil para MVP.',
      'Cada dataset requiere validación individual de cobertura, columnas, fecha de actualización y filtros.',
      'Algunos datasets son regionales, desactualizados o no empresariales.',
    ],
    riskNotes: [
      'No tratar como fuente directa de discovery — puede producir resultados caóticos si se usa sin validación.',
      'Validar estado, cobertura y fecha de actualización por dataset antes de crear subfuente.',
    ],
  },
  {
    key: 'mx_siem',
    name: 'SIEM (Sistema de Información Empresarial Mexicano)',
    sellupUse: 'not_for_ai_flow',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Solo referencia manual. No automatizar en MVP. Sin API pública usable.',
    countryCodes: ['MX'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'manual_signal_only',
    type: 'official_registry',
    url: 'http://www.siem.gob.mx/',
    automationLevel: 'manual',
    recommendedUse:
      'Solo referencia manual si el equipo comercial necesita consultarlo. No automatizar en MVP. Registro con Cámara de Comercio para PYMES.',
    limitations: [
      'Sin API pública usable para automatización.',
      'Registro pagado o vía cámaras — no acceso libre masivo.',
      'Puede tener datos con 1-2 años de antigüedad para PYMES.',
      'No apto para resolución automática de RFC.',
      'Cobertura menor que DENUE.',
    ],
    riskNotes: [
      'No conectar al flujo automático del Agente 1 en MVP.',
      'No usar para resolución de RFC.',
    ],
  },
  {
    key: 'mx_canaive',
    name: 'CANAIVE (Cámara Nacional de la Industria del Vestido)',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Sin acción: señal manual sector textil/moda.',
    countryCodes: ['MX'],
    sectors: ['textil', 'manufactura textil', 'moda', 'clothing', 'garment', 'apparel', 'textile', 'vestido', 'confeccion'],
    priority: 'P1',
    operationalStatus: 'manual_signal_only',
    type: 'industry_association',
    url: 'https://www.canaive.org.mx/',
    automationLevel: 'manual',
    recommendedUse:
      'Señal manual sector textil/moda mexicano. Directorio de empresas afiliadas. No usar para discovery automático ni para resolución de RFC.',
    limitations: [
      'Solo afiliados a la cámara — no representa todo el sector.',
      'Sin API — consulta manual.',
      'No entrega RFC.',
    ],
    riskNotes: [
      'No automatizar discovery desde esta fuente.',
      'No usar para resolución de RFC.',
    ],
  },
  {
    key: 'mx_amia',
    name: 'AMIA (Asociación Mexicana de la Industria Automotriz)',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Sin acción: señal manual sector automotriz.',
    countryCodes: ['MX'],
    sectors: ['automotriz', 'automotive', 'autopartes', 'auto parts', 'vehiculo', 'vehicle', 'manufactura automotriz'],
    priority: 'P1',
    operationalStatus: 'manual_signal_only',
    type: 'industry_association',
    url: 'https://www.amia.com.mx/',
    automationLevel: 'manual',
    recommendedUse:
      'Señal manual sector automotriz mexicano. OEMs y Tier-1. No usar para discovery automático ni para resolución de RFC.',
    limitations: [
      'Solo miembros asociados.',
      'Sin API — consulta directa.',
      'No entrega RFC.',
    ],
    riskNotes: [
      'No automatizar discovery desde esta fuente.',
      'No usar para resolución de RFC.',
    ],
  },

  // ── México — Compras Públicas y Asociaciones Sectoriales ───────────────────
  {
    key: 'mx_compranet_rfc_registry',
    name: 'CompraNet — RFC por nombre (personas morales con contratos del Estado)',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '26.393 personas morales cargadas (contratos CompraNet 2023-2025, carga autorizada el 05-10). El Agente 1 completa el RFC por nombre en cada corrida de México: Apollo, Tavily, Claude y, desde el 05-10, también la capa gratuita de DENUE. Si aquí no hay RFC seguro, se intenta «SAT y Nuevo León — RFC por nombre» (mx_rfc_public_lists_registry).',
    countryCodes: ['MX'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'procurement',
    url: 'https://upcp-compranet.buengobierno.gob.mx/cnetassets/datos_abiertos_contratos_expedientes/',
    automationLevel: 'high',
    recommendedUse:
      'México no publica un padrón de RFC y DENUE no lo trae. Los contratos anuales de CompraNet (datos abiertos, CSV) sí traen el RFC y la razón social de cada proveedor. Se carga una fila por RFC de PERSONA MORAL (12 caracteres) de los contratos 2023-2025: 26.393 empresas, el 100 % con nombre único, 1.873 con estratificación GRANDE o NO MIPYME. RFC seguro sólo cuando exactamente un RFC tiene ese mismo núcleo de nombre; un nombre de una sola palabra sin forma societaria queda como pista.',
    limitations: [
      'Sólo empresas que le vendieron al Gobierno federal entre 2023 y 2025: una empresa que no aparece no significa que no exista.',
      'Nunca personas físicas (RFC de 13 caracteres) ni extranjeros (EXT…).',
      'La forma societaria se quita también escrita sin puntos («SA DE CV», «SAB DE CV», «S DE RL DE CV»…); «A.C.» con puntos cuenta igual que «AC» desde el 05-10; desde el 06-10 también se quitan IAP / IBP / ABP (asistencia y beneficencia privada), SPR (producción rural) y la forma escrita de cualquier manera («SA CV», «S A P I DE CV», «S DE P.R. DE R.L.», «SAPI DE CV SOFOM ENR»…).',
      'La estratificación es la que declaró el proveedor en su contrato más reciente (MICRO, PEQUEÑA, MEDIANA, GRANDE, NO MIPYME…): sirve de pista de tamaño, no es un dato confirmado. Desde el 06-10 llega al gate ICP de tamaño junto con el RFC: MICRO (0–10) y PEQUEÑA (11–50) descartan por pequeña; MEDIANA y GRANDE no deciden solas.',
    ],
    riskNotes: [
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
    ],
  },
  {
    key: 'mx_rfc_public_lists_registry',
    name: 'SAT, Nuevo León y CDMX — RFC por nombre (importadores, donatarias, proveedores)',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      'Respaldo de CompraNet en el RFC por nombre de cada corrida de México (Apollo, Tavily, Claude y la capa gratuita de DENUE). 82.504 personas morales cargadas el 06-10 (autorizada); con los padrones de proveedores de la Ciudad de México (SAF 2021–2026 y datos abiertos) pasan a 90.954, 8.203 con estratificación (Nuevo León y CDMX). La estratificación llega al gate ICP de tamaño.',
    countryCodes: ['MX'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://www.sat.gob.mx/minisitio/PadronImportadoresExportadores/',
    automationLevel: 'medium',
    recommendedUse:
      'Listas oficiales públicas con RFC y razón social: SAT Padrón de Importadores y sus sectoriales (~70.000 empresas privadas medianas y grandes), SAT Directorio de Donatarias Autorizadas sólo activas (~9.900: universidades privadas, colegios, ONG) padrón de proveedores de Nuevo León (~2.900) y padrones de proveedores de la Ciudad de México (SAF art. 121 fr. XXXIV 2021–2026 y datos abiertos, ~8.400 RFC más), los dos con estratificación MICRO/PEQUEÑA/MEDIANA/GRANDE. Jalisco y Estado de México no se pudieron descargar (captcha / sin respuesta); Veracruz 2019 y Chihuahua 2017 descartados por viejos. Se usa sólo cuando CompraNet no da un RFC seguro, con la misma regla: RFC seguro sólo si exactamente un RFC tiene ese núcleo de nombre. Medido con 177 nombres reales de México: CompraNet sola 11 RFC seguros, con estas listas 26.',
    limitations: [
      'Sólo empresas que importan/exportan, donatarias autorizadas o proveedoras de Nuevo León: una empresa que no aparece no significa que no exista.',
      'El padrón de importadores se publica en PDF (2.130 páginas): la carga lo extrae con scripts/source-catalog/extract-mx-rfc-public-lists.py.',
      'Nunca personas físicas (RFC de 13 caracteres). No se guardan teléfonos, correos, domicilios ni representantes.',
      'La estratificación sólo existe para proveedores de Nuevo León y de la Ciudad de México y es la que declaró la empresa: pista de tamaño, no dato confirmado. Desde el 06-10 llega al gate ICP de tamaño junto con el RFC (MICRO y PEQUEÑA descartan por pequeña).',
    ],
    riskNotes: [
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
      'CompraNet manda: si CompraNet ya da un RFC seguro, esta lista no se consulta.',
    ],
  },
  {
    key: 'mx_compranet',
    name: 'CompraNet (Compras Gubernamentales México)',
    sellupUse: 'commercial_signal',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Señal manual. Los contratos de CompraNet SÍ se usan para el RFC por nombre: ver «CompraNet — RFC por nombre» (mx_compranet_rfc_registry), carga de los CSV anuales de datos abiertos.',
    countryCodes: ['MX'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'manual_signal_only',
    type: 'procurement',
    url: 'https://compranet.hacienda.gob.mx/',
    automationLevel: 'low',
    recommendedUse:
      'Señal B2G potencial de proveedores del Estado mexicano. No activar automáticamente hasta reconfirmar endpoint nuevo de Compras MX / CompraNet 5.0.',
    limitations: [
      'Endpoint anterior caído o migrado — sin confirmación de acceso a datos estructurados.',
      'Cobertura limitada a proveedores con contratos con el gobierno federal mexicano.',
      'Requiere validación de datos abiertos post-migración a CompraNet 5.0.',
      'No entrega RFC de forma confiable.',
    ],
    riskNotes: [
      'No conectar al flujo automático hasta confirmar endpoint operativo.',
      'No usar para resolución de RFC.',
      'Fuente pública — sin costo ni ToS restrictivo conocido una vez validado el endpoint.',
    ],
  },
  {
    key: 'mx_amiti',
    name: 'AMITI (Asociación Mexicana de la Industria de Tecnologías de la Información)',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Sin acción: señal manual sector tecnología. Directorio pequeño.',
    countryCodes: ['MX'],
    sectors: ['tecnologia', 'software', 'tic', 'servicios_ti', 'technology', 'it_services', 'software_development'],
    priority: 'P2',
    operationalStatus: 'manual_signal_only',
    type: 'industry_association',
    url: 'https://www.amiti.org.mx/',
    automationLevel: 'manual',
    recommendedUse:
      'Señal manual sector tecnología mexicano. ~200 empresas afiliadas. No usar para discovery masivo ni para resolución de RFC.',
    limitations: [
      'Solo ~200 afiliados — directorio pequeño, no fuente masiva.',
      'Sin API — consulta manual del directorio web.',
      'RFC no disponible en directorio público.',
    ],
    riskNotes: [
      'No automatizar discovery desde esta fuente.',
      'No usar para resolución de RFC.',
    ],
  },
  {
    key: 'mx_fintech_mx',
    name: 'Fintech México (Asociación FinTech de México)',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Sin acción: señal manual sector fintech. Validar URL activa antes de reactivar.',
    countryCodes: ['MX'],
    sectors: ['tecnologia', 'fintech', 'financiero', 'pagos', 'technology', 'payments', 'financial_technology'],
    priority: 'P2',
    operationalStatus: 'manual_signal_only',
    type: 'industry_association',
    url: 'https://www.fintechmx.com/',
    automationLevel: 'manual',
    recommendedUse:
      'Señal manual sector fintech mexicano. Directorio de empresas miembro. No usar para discovery masivo ni para resolución de RFC.',
    limitations: [
      'Volumen reducido — directorio de miembros, no fuente masiva.',
      'Sin API pública — consulta manual del directorio.',
      'Pendiente validación de URL activa y cobertura del directorio.',
      'No entrega RFC.',
    ],
    riskNotes: [
      'Verificar URL y disponibilidad del directorio antes de cualquier uso.',
      'No automatizar discovery desde esta fuente.',
      'No usar para resolución de RFC.',
    ],
  },

  // ── Chile ───────────────────────────────────────────────────────────────────
  {
    key: 'cl_res',
    name: 'RES / datos.gob.cl',
    sellupUse: 'enrichment',
    aiFlowStatus: 'connected',
    connectionMode: 'wizard_discovery',
    nextAction:
      'Chile NO tiene capa gratuita por industria activa: el camino antiguo que leía esta fuente está apagado (0 empresas en Prod). El RUT por nombre en cada corrida usa otra carga del mismo registro: «Registro de Empresas y Sociedades — RUT por nombre» (cl_res_registry, 1.265.085 sociedades).',
    countryCodes: ['CL'],
    sectors: [],
    priority: 'P0',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://datos.gob.cl/',
    automationLevel: 'high',
    recommendedUse: 'Discovery principal en Chile. Portal de datos abiertos con datasets de empresas activas por sector.',
    limitations: [
      'No incluye sector, giro, CIIU ni actividad económica; requiere validación posterior de industria/fit.',
      'No incluye contactos comerciales, correos, teléfonos ni decisores.',
      'Puede incluir empresas recién constituidas, microempresas o sociedades con capital muy bajo.',
      'Puede incluir EIRL u otros tipos donde el RUT asociado requiera revisión para no confundir persona natural con empresa.',
      'No debe usarse como fuente única para priorización comercial sin señales adicionales.',
      'El RUT por nombre no sale de esta entrada: lo completa cl_res_registry, una carga aparte del Registro de Empresas y Sociedades.',
    ],
    riskNotes: [
      'Usar como discovery estructurado inicial de empresas chilenas, no como validación completa de ICP.',
      'No inferir sector ni tamaño comercial únicamente desde RES.',
      'Requiere revisión humana o señales complementarias para industria, fit y prioridad comercial.',
      'No usar como sustituto del SII para validación tributaria.',
      'El RUT sólo se escribe por la búsqueda por nombre de cl_res_registry, con reglas conservadoras (los homónimos quedan como señal).',
    ],
  },
  {
    key: 'cl_sii_registry',
    name: 'SII — Nómina de personas jurídicas (RUT por nombre + trabajadores)',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '1.699.728 personas jurídicas activas del SII cargadas (02-10-2026). Primera fuente de RUT de Chile en cada corrida del Agente 1; si no da RUT seguro, sigue cl_res_registry.',
    countryCodes: ['CL'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://www.sii.cl/sobre_el_sii/nominapersonasjuridicas.html',
    automationLevel: 'high',
    recommendedUse:
      'Nómina pública y gratuita del Servicio de Impuestos Internos: todas las personas jurídicas desde 1993 (RUT, razón social, subtipo, término de giro) y, por año comercial, tramo según ventas, trabajadores dependientes informados y actividad económica. Se cargan las 1.699.728 SIN término de giro (sin EIRL, sociedades de hecho, comunidades, sucesiones, juntas de vecinos, clubes ni sindicatos); 809.116 con trabajadores informados en 2024 y 5.695 con 200 o más. El 82,1 % de los nombres es único. Cubre las empresas anteriores a 2013 que el Registro de Empresas y Sociedades no tiene (149 de 150 RUT de una muestra de cl_res_registry están aquí).',
    limitations: [
      '«Trabajadores dependientes informados» no es el tamaño total de la empresa: es un estimado oficial con su año (2024), nunca un dato confirmado.',
      'El número de trabajadores sólo viaja con un RUT seguro (mismo RUT), nunca con homónimos.',
      'Organismos públicos con la forma común: «I/Ilustre Municipalidad de X» = «Municipalidad de X» y «Servicio … Salud … Hospital X» = «Hospital X» (corrida de Chile del 05-10).',
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
      'Actividad: texto del SII y código de 6 dígitos (el que coincide con la actividad del año; si no, el primero publicado).',
    ],
    riskNotes: [
      'Cerca de 1 de cada 5 nombres se repite: esos casos quedan como señal, no como RUT seguro.',
      'Universidades, organismos públicos, municipalidades y fundaciones SÍ se cargan: también son clientes de UBITS.',
    ],
  },
  {
    key: 'cl_sii_directory',
    name: 'SII — capa gratuita por industria (100+ trabajadores)',
    sellupUse: 'enrichment',
    aiFlowStatus: 'connected_free_discovery',
    connectionMode: 'read_only_snapshot',
    nextAction:
      'Conectada en el código como capa gratuita de Chile. La carga (≈11.000 personas jurídicas del SII con 100 o más trabajadores, armada desde cl_sii_registry sin descargar nada) espera la autorización de la dueña: hasta entonces Chile no tiene capa gratuita y va directo a proveedores.',
    countryCodes: ['CL'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'pending_validation',
    type: 'official_registry',
    url: 'https://www.sii.cl/sobre_el_sii/nominapersonasjuridicas.html',
    automationLevel: 'high',
    recommendedUse:
      'Capa gratuita chilena por industria: personas jurídicas del SII con 100 o más trabajadores dependientes informados (2024) cuyo código de actividad (6 dígitos) y texto de actividad coinciden. Antes de pagar a Apollo o Lusha, el Agente 1 propone empresas de esta carga, de más a menos trabajadores, según la tabla de actividades → industria aprobada por la dueña (05-10-2026): la misma por división que Argentina y Ecuador, más el cobre (división 04) en Energía y minería, mayoristas de medicamentos e instrumental médico, farmacias y ortopedias en Salud, mayoristas y tiendas de informática y telecomunicaciones en Tecnología, los «fondos y sociedades de inversión» sin industria salvo 25 holdings revisados a mano (Falabella y Cencosud en Comercio, Enel en Energía, Red Salud en Salud…), y Correos de Chile (registrada como telecomunicaciones) en Transporte. Cada empresa llega con su RUT; los trabajadores quedan en la fuente como estimado con su año.',
    limitations: [
      'Sólo empresas con 100 o más trabajadores dependientes informados al SII en 2024; las que no informaron trabajadores no aparecen.',
      '«Trabajadores dependientes informados» es un estimado oficial con su año, no el tamaño confirmado.',
      'La industria sale del código de actividad del SII: un holding puede estar registrado con el giro de inversión y no con el de su grupo.',
      'Actividades fuera de la tabla no se proponen: hoteles, restaurantes, medios, investigación, educación (el asistente no tiene industria «Educación»), cultura, deporte y asociaciones.',
      'El SII no publica sitio web ni dirección: las empresas llegan sin dominio.',
      'Empresas del mismo grupo con RUT distinto aparecen por separado (decisión de la dueña).',
      'Snapshot estático — se rearma desde cl_sii_registry cuando éste se recarga.',
    ],
    riskNotes: [
      'Las empresas que propone pasan a revisión humana; no se crean cuentas automáticamente.',
      'No se guardan representantes, teléfonos ni direcciones.',
    ],
  },
  {
    key: 'cl_res_registry',
    name: 'Registro de Empresas y Sociedades — RUT por nombre',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '1.265.085 sociedades cargadas (Ley 20.659, datos.gob.cl). El Agente 1 completa el RUT por nombre en cada corrida.',
    countryCodes: ['CL'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://datos.gob.cl/',
    automationLevel: 'high',
    recommendedUse:
      'Carga del Registro de Empresas y Sociedades de Chile (Ley 20.659, datos.gob.cl): 1.265.085 sociedades constituidas desde 2013, sin EIRL. En cada corrida del Agente 1 completa el RUT por nombre de empresa. El 83,4 % de los nombres es único. RUT seguro sólo cuando exactamente un RUT tiene ese mismo núcleo de nombre; los homónimos quedan como señal y los nombres genéricos nunca se buscan.',
    limitations: [
      'Sólo sociedades constituidas desde 2013 por la Ley 20.659: no incluye grandes empresas antiguas.',
      'No indica si la sociedad sigue activa.',
      'No incluye EIRL.',
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
    ],
    riskNotes: [
      'Cerca de 1 de cada 6 nombres se repite: esos casos quedan como señal, no como RUT seguro.',
      'Que una empresa no aparezca no significa que no exista (puede ser anterior a 2013).',
    ],
  },
  {
    key: 'cl_chilecompra_ocds',
    name: 'ChileCompra / Mercado Público OCDS',
    sellupUse: 'commercial_signal',
    aiFlowStatus: 'connected_post_approval',
    connectionMode: 'offline_signal',
    nextAction:
      'Conectada como señal comercial post-approval. No requiere credenciales. Enriquece metadata.source_enrichment.cl_chilecompra_ocds en candidatos CL con RUT tras aprobación.',
    countryCodes: ['CL'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'procurement',
    url: 'https://datos-abiertos.chilecompra.cl/',
    automationLevel: 'high',
    recommendedUse:
      'Inteligencia comercial B2G en Chile a partir de datos abiertos OCDS de Mercado Público. Permite observar la demanda pública chilena: organismos compradores, montos licitados, rubros por clasificación UNSPSC y proveedores adjudicados cuando la licitación tiene adjudicación. Es una señal de mercado, no un generador de prospectos: no crea cuentas ni candidatos automáticamente y no reemplaza a Tavily, Apollo ni Lusha. Los compradores son entidades públicas; los proveedores privados solo aparecen en adjudicaciones.',
    limitations: [
      'Patrón N+1: el detalle requiere una llamada por proceso.',
      'El listado solo trae ocid y urlTender; los datos ricos viven únicamente en el detalle.',
      'Los compradores públicos no son prospectos privados B2B.',
      'Los proveedores privados solo aparecen en awards de licitaciones adjudicadas.',
      'No incluye website ni contacto comercial confiable del proveedor.',
      'Las clasificaciones UNSPSC requieren mapping sectorial para ser útiles en SellUp.',
      'Volumen alto: miles de procesos por mes.',
      'Rate limits del API OCDS desconocidos.',
    ],
    riskNotes: [
      'No crear cuentas automáticamente desde esta fuente.',
      'No crear candidatos automáticamente desde esta fuente.',
      'Deduplicar por ocid y por RUT, nunca solo por nombre.',
      'Usar exclusivamente como señal B2G de inteligencia de demanda.',
      'Diferenciar del connector ChileCompra legacy con ticket/Clave Única.',
    ],
  },

  // ── República Dominicana ────────────────────────────────────────────────────
  {
    key: 'rd_dgii_bulk',
    name: 'DGII Padrón RNC (República Dominicana)',
    sellupUse: 'enrichment',
    aiFlowStatus: 'connected_post_approval',
    connectionMode: 'offline_signal',
    nextAction:
      'Padrón DGII cargado (493.548 RNC de empresas). En cada corrida del Agente 1 completa el RNC por nombre y es la base de la capa gratuita dominicana por industria, antes de pagar a proveedores. No requiere credenciales.',
    countryCodes: ['DO'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://dgii.gov.do/',
    automationLevel: 'high',
    recommendedUse:
      'Padrón de contribuyentes jurídicos (RNC) de la DGII: 493.548 empresas con razón social, estado tributario y actividad económica (texto libre). Dos usos en el Agente 1: (1) número fiscal por nombre en cada corrida (RNC); (2) base de la capa gratuita dominicana por industria (do_dgii_discovery), que desde el 05-10 lee la carga derivada do_dgii_size_registry: empresas activas en la DGII, con actividad incluida en la tabla actividad → industria aprobada por la dueña y con señal de tamaño (Grandes Contribuyentes de la DGII o proveedoras del Estado que no son micro ni pequeñas). Su nombre comercial alimenta además do_dgii_trade_name_registry (RNC por nombre comercial, sólo pista). También valida y enriquece cuentas RD tras la aprobación. No cubre personas físicas (cédula).',
    limitations: [
      'Solo RNC jurídicos (9 dígitos) — cédulas/personas físicas (11 dígitos) fuera de scope',
      'Actividad económica en texto libre DGII — no hay CIIU oficial; la capa gratuita sólo usa las actividades de la tabla aprobada por la dueña',
      'La capa gratuita sólo propone empresas activas con señal de tamaño (listas de la DGII de 2024 o proveedoras del Estado no micro ni pequeñas): no cubre todo el mercado',
      'Snapshot estático — requiere re-carga manual para actualizar',
    ],
    riskNotes: [
      'Las empresas que propone la capa gratuita pasan a revisión humana; no se crean cuentas automáticamente',
      'No usar cédulas/identificadores de 11 dígitos — fuera de scope',
      'Un nombre repetido o genérico no da un RNC seguro; queda como señal',
      'No hay CIIU oficial — no inferir sector únicamente desde actividad económica texto libre',
    ],
  },
  {
    key: 'do_camaratic',
    name: 'Cámara de Comercio y Producción (CAMARATIC)',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_applicable',
    nextAction: 'Directorio web CAMARATIC para consulta manual. Sin API pública. No automatizable en MVP.',
    countryCodes: ['DO'],
    sectors: [],
    priority: 'P2',
    operationalStatus: 'manual_signal_only',
    type: 'industry_association',
    url: 'https://camaratic.do/',
    automationLevel: 'manual',
    recommendedUse: 'Directorio de empresas afiliadas a la principal cámara de comercio dominicana. Fuente de empresas activas en RD.',
    limitations: ['Solo miembros afiliados a CAMARATIC', 'Sin API pública'],
  },
  {
    key: 'do_camara_sto_domingo',
    name: 'Cámara de Comercio de Santo Domingo',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_applicable',
    nextAction: 'Directorio web CCSD para consulta manual. Cobertura regional Santo Domingo. Sin API pública confirmada.',
    countryCodes: ['DO'],
    sectors: [],
    priority: 'P2',
    operationalStatus: 'manual_signal_only',
    type: 'industry_association',
    url: 'https://www.ccsd.com.do/',
    automationLevel: 'manual',
    recommendedUse: 'Cámara de comercio regional para zona metropolitana. Directorio de empresas afiliadas en Santo Domingo.',
    limitations: ['Solo afiliados CCSD', 'Sin API — consulta manual'],
  },

  {
    key: 'do_dgcp',
    name: 'DGCP (Dirección General de Contrataciones Públicas RD)',
    sellupUse: 'commercial_signal',
    aiFlowStatus: 'connected_post_approval',
    connectionMode: 'offline_signal',
    nextAction:
      'Snapshot parcial 2020–2026 con 53.974 proveedores cargados. Su clasificación MIPYME y su monto adjudicado alimentan la capa gratuita dominicana (do_dgii_size_registry): descarta proveedoras micro y pequeñas y ordena por monto dentro de cada nivel de tamaño. Su archivo público de proveedores (datos abiertos, con correos) da además el dominio corporativo de esas empresas. El post-approval puede usar match local por RNC. No es fuente legal ni tributaria; no reemplaza DGII.',
    countryCodes: ['DO'],
    sectors: [],
    priority: 'P2',
    operationalStatus: 'operational_verified',
    type: 'procurement',
    url: 'https://datosabiertos.dgcp.gob.do/datos-abiertos/tablas',
    automationLevel: 'medium',
    recommendedUse: 'Proveedores del Estado dominicano con RNC. Datos desde 2005. Señal de empresa activa con historial contractual B2G en República Dominicana. Portal de datos abiertos OCDS. En la capa gratuita dominicana por industria, aporta la señal de tamaño de las proveedoras que la DGII no lista como grandes o medianas (las micro y pequeñas quedan fuera) y el monto adjudicado para ordenar.',
    limitations: [
      'Solo empresas proveedoras del Estado dominicano — no representa el universo empresarial completo de RD',
      'Cobertura parcial: snapshot 2020–2026 con 53.974 proveedores (partial_snapshot, no complete_snapshot)',
      'No es fuente legal ni tributaria — no valida RNC, no reemplaza DGII',
    ],
    riskNotes: [
      'Miembro Open Contracting Partnership (OCDS) — datos bajo estándares abiertos, riesgo legal bajo',
    ],
  },

  {
    key: 'do_dgii_size_registry',
    name: 'DGII Grandes Contribuyentes + DGCP — capa gratuita por industria con tamaño',
    sellupUse: 'enrichment',
    aiFlowStatus: 'connected_free_discovery',
    connectionMode: 'read_only_snapshot',
    // SOURCES-DO-SIZE-SIGNAL-1 (05-10): construida; la carga en Producción espera
    // la autorización de la dueña. Hasta entonces la capa gratuita de RD no propone nada.
    nextAction:
      '12.931 empresas cargadas (06-10, autorizada; 1.529 con sitio web desde el correo corporativo declarado a la DGCP). Verificada de punta a punta el 06-10: corrida RD × Tecnología (lote cf765b47) cerró la meta sólo con esta fuente, 9 empresas grandes y medianas a revisión con sitio web y RNC, US$0. Las que no tienen web van a Descartadas y las rescata Claude.',
    countryCodes: ['DO'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://dgii.gov.do/app/WebApps/Misc/VerLista?doc=GCL-240110',
    automationLevel: 'high',
    recommendedUse:
      'Capa gratuita dominicana por industria. Une el padrón DGII (empresas ACTIVAS, actividad según la tabla aprobada por la dueña) con dos señales de tamaño gratuitas: las listas públicas de Grandes Contribuyentes de la DGII (632 grandes nacionales, 7.941 grandes locales y 3.688 medianas, publicadas en 2024) y la clasificación MIPYME de los proveedores del Estado en la DGCP. Ordena: grandes nacionales, grandes locales, medianas y, por último, proveedoras del Estado sin clasificar; dentro de cada nivel, por monto adjudicado. Cada empresa llega con su RNC. Deja fuera a las proveedoras que la DGCP marca como micro o pequeñas (hasta 50 empleados) salvo que la DGII las liste como medianas o grandes.',
    limitations: [
      'Las listas de la DGII son de 2024 y no publican a pequeños ni micro: una empresa nueva o que no está en la lista sólo entra si es proveedora del Estado.',
      'Estar en la lista prueba «mediana o grande», pero no da el número de empleados: el tamaño del candidato queda por validar.',
      'La clasificación de la DGCP es la que declara el proveedor; muchas grandes figuran como «No clasificada».',
      'La industria sale del texto de actividad de la DGII (cortado a 30 caracteres): actividades fuera de la tabla (hoteles, educación, medios, asociaciones) o ambiguas no se proponen.',
      'La DGII no publica sitio web. El dominio sale del correo corporativo declarado a la DGCP y sólo si se parece a la razón social: las empresas que no venden al Estado, o con correo gratuito o de una marca distinta («claro.com.do» para Codetel), llegan sin dominio.',
      'Snapshot estático — requiere recarga para reflejar altas, bajas y nuevas listas.',
    ],
    riskNotes: [
      'Las empresas que propone pasan a revisión humana; no se crean cuentas automáticamente.',
      'Sólo RNC de empresa (9 dígitos): las cédulas de personas físicas de la lista de la DGII nunca se cargan.',
      'Del archivo de proveedores de la DGCP sólo se guarda el dominio: nunca correos, nombres de contacto ni teléfonos.',
    ],
  },
  {
    key: 'do_dgii_trade_name_registry',
    name: 'DGII — RNC por nombre comercial (sólo pista)',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      'Carga pendiente de autorización. Cuando la razón social no da un RNC seguro, el Agente 1 busca el nombre de la empresa entre los nombres comerciales del padrón DGII y deja el RNC como pista para revisión.',
    countryCodes: ['DO'],
    sectors: [],
    priority: 'P2',
    operationalStatus: 'pending_validation',
    type: 'official_registry',
    url: 'https://dgii.gov.do/',
    automationLevel: 'high',
    recommendedUse:
      'Nombres comerciales de las empresas activas del padrón DGII cuyo nombre comercial es distinto de su razón social («CODETEL» → Compañía Dominicana de Teléfonos). Respaldo del RNC por razón social en cada corrida: si el nombre comercial coincide con una sola empresa, su RNC queda como pista (nunca como RNC seguro); si coincide con varias, como pista ambigua.',
    limitations: [
      'Nunca da un RNC seguro: varias empresas pueden operar con el mismo nombre comercial.',
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
      'Snapshot estático — se deriva del padrón DGII cargado; requiere recarga para reflejar cambios.',
    ],
    riskNotes: ['La pista requiere revisión humana antes de usar el RNC.'],
  },

  {
    key: 'pe_sunat_bulk',
    name: 'SUNAT Padrón RUC Bulk (Descarga masiva)',
    sellupUse: 'enrichment',
    aiFlowStatus: 'connected_post_approval',
    connectionMode: 'offline_signal',
    // SOURCES-CATALOG-COUNTRY-AUDIT-1 (02-10): el snapshot post-approval
    // (peru_sunat_ruc_snapshot) está VACÍO en Producción.
    nextAction:
      'Enrichment legal post-approval conectado. Su snapshot propio está vacío en Producción (peru_sunat_ruc_snapshot = 0 filas, verificado el 02-10), así que desde el 02-10 la confirmación lee también el mismo padrón cargado aparte (pe_sunat_registry, 867.359 sociedades activas y habidas): encontrar el RUC ahí lo confirma sin llamar a Migo.',
    countryCodes: ['PE'],
    sectors: [],
    priority: 'P0',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'http://www2.sunat.gob.pe/padron_reducido_ruc.zip',
    automationLevel: 'high',
    recommendedUse: 'Descarga masiva del Padrón Reducido RUC. 11–14M registros: RUC, razón social, estado contribuyente, condición domicilio, UBIGEO. Sin auth. Complementar con pe_sunat para enriquecimiento CIIU individual. El RUC por nombre dentro de cada corrida no usa esta carga sino pe_sunat_registry (sociedades activas y habidas).',
    limitations: [
      'Padrón reducido no incluye actividad CIIU — usar consulta SOL individual para obtener sector',
      'Incluye personas naturales con RUC; filtrar por tipo de contribuyente para empresas jurídicas',
      'ZIP ~387 MB; actualización variable — verificar fecha del archivo antes de procesar',
    ],
    riskNotes: [
      'Filtrar estado: ACTIVO antes de prospectar',
      'Amparado por Resolución de Superintendencia N° 304-2024/SUNAT — uso público permitido',
    ],
  },
  {
    key: 'pe_sunat_registry',
    name: 'SUNAT — RUC por nombre (sociedades activas y habidas)',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '867.359 sociedades (RUC 20) activas y habidas del padrón reducido de SUNAT cargadas. El Agente 1 completa el RUC por nombre en cada corrida.',
    countryCodes: ['PE'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'http://www2.sunat.gob.pe/padron_reducido_ruc.zip',
    automationLevel: 'high',
    recommendedUse:
      'Carga separada del padrón reducido de SUNAT con 867.359 sociedades (RUC 20) activas y habidas. En cada corrida del Agente 1 completa el RUC por nombre de empresa. RUC seguro sólo cuando exactamente un RUC tiene ese mismo núcleo de nombre; los homónimos quedan como señal y los nombres genéricos nunca se buscan.',
    limitations: [
      'Sólo sociedades (RUC 20) activas y habidas: no incluye personas naturales con negocio (RUC 10).',
      'El padrón reducido no trae actividad CIIU ni tamaño.',
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
      'Snapshot estático — requiere recarga para reflejar altas y bajas.',
    ],
    riskNotes: [
      'Un nombre repetido o genérico no da un RUC seguro; queda como señal.',
    ],
  },
  {
    key: 'pe_sunat',
    name: 'SUNAT Padrón RUC',
    sellupUse: 'validation_only',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Consulta web individual RUC para verificación tributaria, no discovery masivo',
    countryCodes: ['PE'],
    sectors: [],
    priority: 'P0',
    operationalStatus: 'validation_only',
    type: 'official_registry',
    url: 'https://e-consultaruc.sunat.gob.pe/',
    automationLevel: 'medium',
    recommendedUse: 'Fuente principal en Perú. Padrón RUC con razón social, estado activo, actividad CIIU.',
    limitations: ['Sin API oficial para consulta masiva', 'Solo datos tributarios básicos'],
    riskNotes: ['Verificar estado: Activo antes de prospectar'],
  },
  {
    key: 'pe_seace',
    name: 'OSCE / SEACE (Contrataciones del Estado)',
    sellupUse: 'commercial_signal',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Señal B2G futura — requiere validación de acceso a datos abiertos OSCE/SEACE',
    countryCodes: ['PE'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'procurement',
    url: 'https://www.seace.gob.pe/',
    automationLevel: 'high',
    recommendedUse: 'Discovery de proveedores del Estado peruano. Señal de empresa activa con historial B2G.',
    limitations: ['Solo empresas que contratan con el Estado'],
  },
  {
    key: 'pe_produce',
    name: 'PRODUCE Manufactura',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
    nextAction: 'Pendiente validación — fuente sectorial manufactura peruana sin API confirmada',
    countryCodes: ['PE'],
    sectors: ['manufactura', 'manufacturing', 'industria', 'industrial', 'produccion', 'production', 'planta'],
    priority: 'P1',
    operationalStatus: 'pending_validation',
    type: 'public_dataset',
    url: 'https://www.gob.pe/produce',
    automationLevel: 'medium',
    recommendedUse: 'Discovery en sector manufactura peruano. Padrones y estadísticas de empresas manufactureras.',
    limitations: ['Solo sector manufactura'],
  },

  {
    key: 'pe_migo_api',
    name: 'Migo API Perú RUC Lookup',
    sellupUse: 'validation_only',
    aiFlowStatus: 'eligible_not_connected',
    connectionMode: 'not_connected',
    nextAction:
      'Clave guardada y probada el 01-07 (el panel la muestra conectada). Respaldo DE PAGO del enriquecimiento posterior a la aprobación: sólo se consulta cuando SUNAT no confirma el RUC (no está en el padrón de sociedades activas y habidas).',
    countryCodes: ['PE'],
    sectors: [],
    priority: 'P2',
    operationalStatus: 'connection_required',
    type: 'commercial_provider',
    url: 'https://docs.migo.pe',
    automationLevel: 'high',
    recommendedUse:
      'Consulta privada bajo demanda para validar RUC peruano, razón social, estado del contribuyente, condición de domicilio y dirección. No devuelve CIIU ni actividad económica en el endpoint validado (spike real Perú.3N-R). No usar como fuente sectorial ni para discovery. Puede ser redundante frente a SUNAT Padrón Reducido para estado/condición.',
    limitations: [
      'No útil para CIIU/actividad económica según spike real Perú.3N-R (MIGO_NOT_USEFUL_FOR_CIIU)',
      'No usar como fuente sectorial ni como discovery',
      'Puede ser redundante frente a SUNAT Padrón Reducido para estado/condición',
      'API privada de tercero — requiere plan de pago',
      'Depende de disponibilidad y ToS de Migo API',
    ],
    riskNotes: [
      'Evaluar ToS y costos antes de usar en producción',
      'No exponer API key en frontend ni logs',
      'Validar rate limits del plan contratado',
      'No almacenar datos de representantes legales ni domicilio fiscal',
    ],
  },

  // ── Ecuador ─────────────────────────────────────────────────────────────────
  {
    key: 'ec_scvs',
    name: 'SCVS / Supercias Ecuador',
    // Estado operativo real (EC-SCVS): snapshot productivo cargado + adapter de
    // enrichment conectado. Existe política oficial de expansión limitada
    // manual-controlada (EC-SCVS-18, docs/source-catalog/ec-scvs-limited-expansion-policy.md):
    // un operador humano puede ejecutar lotes limitados bajo esa política. NO
    // implica generación live automática NI expansión completa. Enrichment
    // post-discovery vía el adapter `ln`.
    sellupUse: 'enrichment',
    aiFlowStatus: 'limited_manual_expansion',
    connectionMode: 'backend_connected',
    nextAction:
      'Ejecutar lote limitado bajo política oficial de expansión limitada manual (docs/source-catalog/ec-scvs-limited-expansion-policy.md). El RUC por nombre en cada corrida ya usa el snapshot cargado de 339.960 compañías, sin consultar SCVS en cada búsqueda.',
    countryCodes: ['EC'],
    sectors: [],
    priority: 'P0',
    operationalStatus: 'validated',
    type: 'official_registry',
    url: 'https://www.supercias.gob.ec/',
    automationLevel: 'medium',
    recommendedUse:
      'Registro de compañías ecuatorianas de la Superintendencia de Compañías: 339.960 compañías cargadas en SellUp (razón social, objeto social, representante legal). En cada corrida del Agente 1 completa el RUC por nombre de empresa sobre ese snapshot ya cargado; no consulta SCVS en cada búsqueda. Los homónimos quedan como señal y los nombres genéricos nunca se buscan. Ampliar la carga sigue la política de lotes limitados.',
    limitations: [
      'Solo empresas obligadas a reportar a Supercias',
      'Excluye microempresas',
      'El RUC por nombre sólo encuentra compañías que ya están en el snapshot cargado',
    ],
  },
  {
    key: 'ec_scvs_directory',
    name: 'Directorio × Ranking SCVS — capa gratuita por industria',
    sellupUse: 'enrichment',
    aiFlowStatus: 'connected_free_discovery',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '1.082 compañías activas con 200 o más empleados cargadas (directorio de compañías × ranking empresarial de la Superintendencia de Compañías, archivos del 05-10, carga autorizada). Capa gratuita de Ecuador: el Agente 1 propone de aquí antes de pagar a proveedores.',
    countryCodes: ['EC'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://www.supercias.gob.ec/',
    automationLevel: 'high',
    recommendedUse:
      'Capa gratuita ecuatoriana por industria: compañías ACTIVAS del directorio de la Superintendencia de Compañías que en su último año del ranking empresarial declaran 200 o más empleados. Antes de pagar a Apollo o Lusha, el Agente 1 propone empresas de esta carga según la tabla CIIU → industria (la misma por división que Argentina, más farmacias y distribuidoras de medicamentos y equipo médico en Salud). Cada empresa llega con su RUC; los empleados declarados quedan en la fuente como estimado con su año y sólo sirven para no proponer compañías de menos de 200.',
    limitations: [
      'Sólo compañías que reportan a la Superintendencia de Compañías: no incluye bancos, aseguradoras supervisadas por otra entidad, entidades públicas ni personas naturales.',
      'Sólo compañías con 200 o más empleados declarados en su último estado financiero: las que no presentaron balance no aparecen.',
      'Los empleados son los declarados por la compañía en su estado financiero; son un estimado con su año, no el tamaño confirmado.',
      'La industria sale de la tabla CIIU: actividades fuera de la tabla (hoteles, restaurantes, medios, educación, asociaciones) no se proponen.',
      'El directorio no publica sitio web: las empresas llegan sin dominio.',
      'Snapshot estático — requiere recarga para reflejar altas, bajas y nuevos balances.',
    ],
    riskNotes: [
      'Las empresas que propone pasan a revisión humana; no se crean cuentas automáticamente.',
      'No se guardan representante legal, teléfono ni dirección del directorio.',
    ],
  },
  {
    key: 'ec_sercop',
    name: 'SERCOP (Compras Públicas Ecuador)',
    // Clasificación (EC-SOURCES-21): SERCOP (Servicio Nacional de Contratación
    // Pública) es la autoridad nacional de compras públicas del Ecuador. Sus
    // registros son específicos de proveedores del Estado — NO es un registro
    // societario/registral base del mercado general (ese rol lo cubre ec_scvs,
    // única fuente operativa de enrichment de Ecuador bajo expansión limitada
    // manual). Su rol natural en SellUp sería señal comercial complementaria de
    // contratación pública, aún NO conectada y sin diseño de integración.
    sellupUse: 'commercial_signal',
    aiFlowStatus: 'pending_integration_design',
    connectionMode: 'not_connected',
    nextAction:
      'Diseñar integración como señal complementaria de contratación pública. No es fuente registral base — ec_scvs (SCVS/Supercias) es la única fuente operativa de enrichment de Ecuador.',
    countryCodes: ['EC'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'procurement',
    url: 'https://www.sercop.gob.ec/',
    automationLevel: 'high',
    recommendedUse:
      'Señal comercial complementaria B2G: identificar empresas ecuatorianas que participan/contratan con el Estado a través del Sistema Oficial de Contratación Pública (SOCE). No es fuente registral base ni de validación societaria — complementa, no reemplaza, a SCVS/Supercias. No conectada.',
    limitations: [
      'Cubre solo proveedores/contratistas del Estado ecuatoriano — no el mercado general.',
      'No es registro societario ni fuente registral base (ese rol lo cubre SCVS/Supercias).',
      'No conectada — requiere diseño de integración antes de cualquier uso automático.',
    ],
  },
  {
    key: 'ec_ekos',
    name: 'EKOS Ecuador',
    // Clasificación (EC-SOURCES-21): EKOS (Ekos Negocios) es un medio/editorial
    // privado de negocios (noticias, rankings, contenido comercial), NO un
    // registro oficial. Su rol potencial sería señal editorial/directorio, pero
    // requiere validación de uso, cobertura, términos y legalidad antes de
    // considerar cualquier diseño de integración. NO es fuente operativa.
    sellupUse: 'contextual_signal',
    aiFlowStatus: 'requires_validation',
    connectionMode: 'not_connected',
    nextAction:
      'Validar uso, cobertura, términos y legalidad antes de diseñar integración. Fuente editorial/directorio privada — no oficial y no operativa.',
    countryCodes: ['EC'],
    sectors: ['manufactura', 'tecnologia', 'agronegocio', 'servicios'],
    priority: 'P1',
    operationalStatus: 'pending_validation',
    type: 'commercial_provider',
    url: 'https://www.ekosnegocios.com/',
    automationLevel: 'medium',
    recommendedUse:
      'Fuente privada editorial/directorio de negocios (rankings, contenido comercial). Señal futura potencial — no oficial. Requiere validación de uso, cobertura, términos y legalidad antes de cualquier integración. No conectada, no operativa.',
    limitations: [
      'Fuente comercial/editorial de tercero — no es registro oficial.',
      'Cobertura parcial del mercado ecuatoriano.',
      'Requiere validación de uso, cobertura, términos y legalidad antes de integrar.',
      'No conectada — no operativa.',
    ],
  },

  // ── Guatemala ───────────────────────────────────────────────────────────────
  {
    key: 'gt_camara_comercio',
    name: 'Cámara de Comercio de Guatemala',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_applicable',
    nextAction: 'Usar como referencia manual para investigación de empresas y contexto local. Sin conexión automática disponible.',
    countryCodes: ['GT'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'manual_signal_only',
    type: 'industry_association',
    url: 'https://www.camaracomercio.com.gt/',
    automationLevel: 'manual',
    recommendedUse: 'Directorio de empresas afiliadas a la Cámara. Identificar empresas activas en Guatemala.',
    limitations: ['Solo empresas afiliadas', 'Sin API — consulta manual o directorio web'],
  },
  {
    key: 'gt_rgae_proveedores',
    name: 'RGAE Guatemala — Registro de Proveedores del Estado (MINFIN)',
    sellupUse: 'commercial_signal',
    // Desde SOURCES-GT-HN-BY-NAME-1 (autorizado por la dueña el 30-09) el
    // Agente 1 usa este snapshot para el NIT por nombre en cada corrida.
    // sellupUse se mantiene en commercial_signal: el rol que deriva el
    // search-strategy-builder no cambia (cero cambio de comportamiento).
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '6.245 Sociedades con NIT cargadas en el snapshot 2025, 0 duplicados. El Agente 1 completa el NIT por nombre en cada corrida con este snapshot; los nombres repetidos quedan como señal para revisión humana.',
    countryCodes: ['GT'],
    sectors: [],
    priority: 'P2',
    operationalStatus: 'partial_snapshot',
    type: 'procurement',
    url: 'https://www.minfin.gob.gt/',
    automationLevel: 'low',
    recommendedUse:
      'Registro de proveedores del Estado de Guatemala (RGAE, Registro General de Adquisiciones del Estado, MINFIN): snapshot 2025 con 6.245 Sociedades y NIT normalizado. En cada corrida del Agente 1 completa el NIT por nombre de empresa. Reglas conservadoras: NIT seguro sólo cuando exactamente un NIT tiene ese mismo núcleo de nombre; si varios NIT comparten el nombre queda como señal; los nombres genéricos nunca se buscan. Sólo cubre sociedades proveedoras del Estado.',
    limitations: [
      'Sólo cubre sociedades inscritas como proveedoras del Estado (B2G): una empresa que nunca vendió al Estado no aparece.',
      'No valida identidad fiscal ante la SAT (Superintendencia de Administración Tributaria) — el NIT es el que publica el RGAE.',
      'No reemplaza el Registro Mercantil de Guatemala.',
      'Filtro deliberado a TIPO_PROVEEDOR = Sociedades — no incluye personas individuales ni otros tipos de proveedor.',
      'Snapshot de un solo año (2025) — no refleja altas/bajas posteriores del registro.',
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
      'No crea cuentas ni candidatos por sí sola: sólo completa el NIT de empresas que el Agente 1 ya encontró.',
      'Ingesta manual desde XLSX local — sin API ni recarga automática.',
    ],
    riskNotes: [
      'Nombres repetidos (homónimos) quedan como señal, nunca como NIT seguro.',
      'Los nombres genéricos nunca se buscan.',
      'Revisión humana requerida en todos los registros del snapshot.',
      'Snapshot de fuente oficial pública (MINFIN) — riesgo legal bajo.',
      'Recarga requiere descarga manual del XLSX y --confirm-gt-rgae-snapshot-write.',
    ],
  },

  // ── Honduras ────────────────────────────────────────────────────────────────
  {
    key: 'hn_ccic',
    name: 'Cámara de Comercio e Industrias de Cortés',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_applicable',
    nextAction: 'Usar como referencia manual para investigación de empresas y contexto local. Sin conexión automática disponible.',
    countryCodes: ['HN'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'manual_signal_only',
    type: 'industry_association',
    url: 'https://www.ccic.hn/',
    automationLevel: 'manual',
    recommendedUse: 'Cámara de comercio regional. Directorio de empresas en zona industrial de Cortés.',
    limitations: ['Solo empresas afiliadas CCIC', 'Zona geográfica limitada (Cortés)', 'Cobertura fragmentada — no equivale a registro fiscal RTN', 'Sin API pública ni bulk estructurado confirmado'],
  },
  {
    key: 'hn_ccit',
    name: 'Cámara de Comercio e Industrias de Tegucigalpa',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_applicable',
    nextAction: 'Usar como referencia manual para investigación de empresas y contexto local. Sin conexión automática disponible.',
    countryCodes: ['HN'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'manual_signal_only',
    type: 'industry_association',
    url: 'https://www.ccit.hn/',
    automationLevel: 'manual',
    recommendedUse: 'Cámara de comercio regional. Directorio de empresas en capital hondureña.',
    limitations: ['Solo empresas afiliadas CCIT', 'Zona geográfica limitada (Tegucigalpa)', 'Cobertura fragmentada — no equivale a registro fiscal RTN', 'Sin API pública ni bulk estructurado confirmado'],
  },
  {
    key: 'hn_ocds_rtn_registry',
    name: 'ONCAE + SEFIN (OCDS) — RTN por nombre (personas jurídicas proveedoras del Estado)',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '6.195 personas jurídicas cargadas (ONCAE + SEFIN 2018-2026, carga autorizada el 05-10). Primera fuente de RTN de Honduras en cada corrida; si no da RTN seguro, sigue el snapshot piloto hn_contrataciones_abiertas (72 filas).',
    countryCodes: ['HN'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'procurement',
    url: 'https://data.open-contracting.org/en/publication/122',
    automationLevel: 'high',
    recommendedUse:
      'Publicaciones OCDS de Honduras en el registro de Open Contracting (CC BY 4.0): ONCAE / HonduCompras y SEFIN. Cada versión nombra a sus proveedores con RTN. Se carga una fila por RTN de PERSONA JURÍDICA (2018-2026): 6.195 empresas, el 98,3 % con nombre único. RTN seguro sólo cuando exactamente un RTN tiene ese mismo núcleo de nombre.',
    limitations: [
      'Sólo quienes han participado en compras públicas: una empresa que no aparece no significa que no exista.',
      'Persona jurídica = 14 dígitos con un 9 en la quinta posición; el RTN de una persona natural lleva ahí su año de nacimiento y nunca se guarda (tampoco cédulas ni pasaportes).',
      'Se quitan las colas que HonduCompras pega al nombre («*MIPYME*», «* Compra Menor», «*CM»).',
    ],
    riskNotes: [
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
    ],
  },
  {
    key: 'hn_contrataciones_abiertas',
    name: 'Portal de Contrataciones Abiertas Honduras',
    sellupUse: 'commercial_signal',
    // Desde SOURCES-GT-HN-BY-NAME-1 (autorizado por la dueña el 30-09) el
    // Agente 1 usa este snapshot para el RTN por nombre en cada corrida.
    // sellupUse se mantiene en commercial_signal: el rol que deriva el
    // search-strategy-builder no cambia (cero cambio de comportamiento).
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '72 proveedores con RTN cargados en el snapshot piloto 2024. Ahora es el respaldo: el RTN por nombre en cada corrida usa primero «ONCAE + SEFIN (OCDS) — RTN por nombre» (hn_ocds_rtn_registry); los nombres repetidos quedan como señal para revisión humana.',
    countryCodes: ['HN'],
    sectors: [],
    priority: 'P2',
    operationalStatus: 'partial_snapshot',
    type: 'procurement',
    url: 'https://oncae.gob.hn/',
    automationLevel: 'low',
    recommendedUse:
      'Proveedores adjudicados del Estado de Honduras publicados por ONCAE (OCDS) vía OCP Data Registry: snapshot piloto 2024 con 72 proveedores con RTN válido. En cada corrida del Agente 1 completa el RTN por nombre de empresa. Reglas conservadoras: RTN seguro sólo cuando exactamente un RTN tiene ese mismo núcleo de nombre; si varios RTN comparten el nombre queda como señal; los nombres genéricos nunca se buscan. Cobertura muy baja: sólo proveedores del piloto.',
    limitations: [
      'Cobertura muy baja: sólo 72 proveedores del piloto 2024, no todo el universo anual.',
      'Sólo proveedores adjudicados del Estado (B2G): una empresa que nunca vendió al Estado no aparece.',
      'No valida identidad fiscal ante el SAR Honduras — el RTN es el que publica la fuente.',
      'No reemplaza el Registro Mercantil de Honduras.',
      'Puede mezclar personas naturales y jurídicas.',
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
      'No crea cuentas ni candidatos por sí sola: sólo completa el RTN de empresas que el Agente 1 ya encontró.',
    ],
    riskNotes: [
      'RTN de personas naturales pueden aparecer mezclados con personas jurídicas.',
      'Nombres repetidos (homónimos) quedan como señal, nunca como RTN seguro.',
      'Los nombres genéricos nunca se buscan.',
      'Fuente pública vía OCP Data Registry — verificar disponibilidad antes de recargar.',
    ],
  },

  // ── Argentina ───────────────────────────────────────────────────────────────
  {
    key: 'ar_rns',
    name: 'RNS × COMPR.AR — capa gratuita por industria',
    sellupUse: 'enrichment',
    aiFlowStatus: 'connected_free_discovery',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '6.350 sociedades del Registro Nacional de Sociedades que además son proveedoras del Estado (COMPR.AR) cargadas. El Agente 1 las propone por industria, con la tabla aprobada por la dueña, antes de pagar a proveedores.',
    countryCodes: ['AR'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://datos.jus.gob.ar/',
    automationLevel: 'high',
    recommendedUse:
      'Capa gratuita argentina por industria: 6.350 sociedades del Registro Nacional de Sociedades cruzadas con los proveedores del Estado de COMPR.AR, ordenadas por importe adjudicado. Antes de pagar a Apollo o Lusha, el Agente 1 propone empresas de esta carga según la tabla actividad → industria aprobada por la dueña (v2: mayoristas de informática en Tecnología y de equipo médico en Salud), intercaladas una a una con los empleadores ATP (`ar_atp_employers`).',
    limitations: [
      'Sólo sociedades que además son proveedoras del Estado (COMPR.AR): no representa todo el mercado argentino.',
      'El RNS no publica tamaño: más allá de las primeras 50-100 por industria (por importe adjudicado) puede proponer empresas chicas.',
      'No se recicla: una CUIT que ya es candidata en SellUp, cuyo descarte quedó cerrado (otra industria, otro tamaño, duplicada) o que fue descartada y sigue sin web no se vuelve a proponer; se lee el triple para llenar el tope con empresas nuevas.',
      'El RNS no publica sitio web: el dominio sale del correo que la sociedad declaró en el SIPRO histórico (anterior a 2016), sólo si se parece a su razón social de entonces y a la de hoy (1.657 de 6.350 en la prueba en seco del 06-10). Sin dominio, la empresa va a Descartadas y el buscador de sitio de Claude intenta rescatarla.',
      'La industria sale de la tabla aprobada por la dueña: actividades fuera de la tabla no se proponen.',
      'Snapshot estático — requiere recarga para reflejar altas y bajas.',
    ],
    riskNotes: [
      'Las empresas que propone pasan a revisión humana; no se crean cuentas automáticamente.',
    ],
  },
  {
    key: 'ar_atp_employers',
    name: 'Empleadores ATP 2020 × RNS — capa gratuita por industria con tamaño',
    sellupUse: 'enrichment',
    aiFlowStatus: 'connected_free_discovery',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '2.851 sociedades activas con 100 o más trabajadores en ATP 2020 cargadas (06-10, autorizada; verificada por lectura: Swiss Medical, Hospital Italiano, Galeno, Farmacity, Falabella). El Agente 1 las propone intercaladas con las proveedoras del Estado. Sin sitio web: van a Descartadas y el buscador de sitio de Claude intenta rescatarlas; al pasar a revisión conservan su CUIT.',
    countryCodes: ['AR'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://datos.gob.ar/',
    automationLevel: 'high',
    recommendedUse:
      'Capa gratuita argentina por industria con señal de tamaño: sociedades que en 2020 declararon 100 o más trabajadores en el programa ATP (datos.gob.ar, CC-BY 4.0), con razón social y actividad del Registro Nacional de Sociedades ya cargado. Es el único padrón público con CUIT y trabajadores por empresa. El Agente 1 las propone intercaladas con las proveedoras del Estado (`ar_rns`), de más a menos trabajadores, según la misma tabla actividad → industria.',
    limitations: [
      'Foto de 2020: empresas creadas después no aparecen.',
      'Los trabajadores son los que cobraron ATP en ese mes: un piso, no la plantilla total.',
      'Sólo sociedades todavía activas en el Registro Nacional de Sociedades y con actividad dentro de la tabla aprobada.',
      'Tecnología casi no aparece (59 empresas): para esa industria la capa gratuita sigue dependiendo de las proveedoras del Estado.',
      'ATP no publica sitio web: el dominio sale del correo del SIPRO histórico cuando la empresa fue proveedora del Estado (348 de 2.851 en la prueba en seco del 06-10); el resto va a Descartadas y depende del rescate con Claude.',
      'Snapshot estático — no se actualiza.',
    ],
    riskNotes: [
      'Las empresas que propone pasan a revisión humana; no se crean cuentas automáticamente.',
      'Los trabajadores se usan sólo para ordenar y filtrar; no llegan al candidato como tamaño confirmado.',
    ],
  },
  {
    key: 'ar_rns_registry',
    name: 'Registro Nacional de Sociedades — CUIT por nombre',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '1.194.956 sociedades activas del Registro Nacional de Sociedades (datos.jus.gob.ar) cargadas. El Agente 1 completa el CUIT por nombre en cada corrida.',
    countryCodes: ['AR'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://datos.jus.gob.ar/',
    automationLevel: 'high',
    recommendedUse:
      'Carga del Registro Nacional de Sociedades (datos.jus.gob.ar) con 1.194.956 sociedades activas. En cada corrida del Agente 1 completa el CUIT por nombre de empresa. CUIT seguro sólo cuando exactamente un CUIT tiene ese mismo núcleo de nombre; los homónimos quedan como señal y los nombres genéricos nunca se buscan. Si el núcleo exacto no aparece, prueba en orden (siempre nombres exactos): con forma societaria compuesta («ARCOR» → «ARCOR S A I C», asociaciones civiles), con o sin «Argentina» al final y con las palabras juntas («MERCADO LIBRE» → «MERCADOLIBRE»). Medido 05-10 sobre 79 marcas argentinas: 38 con CUIT seguro (antes 30).',
    limitations: [
      'Sólo sociedades activas del registro: no incluye personas humanas con actividad comercial.',
      'No trae sector ni tamaño de la empresa.',
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
      'Las marcas con otra razón social (Coto, La Anónima, Edenor, Naranja X) y las cooperativas no se encuentran por nombre.',
      'Snapshot estático — requiere recarga para reflejar altas y bajas.',
    ],
    riskNotes: [
      'Un nombre repetido o genérico no da un CUIT seguro; queda como señal.',
    ],
  },

  // ── Bolivia ─────────────────────────────────────────────────────────────────
  {
    key: 'bo_seprec_live',
    name: 'SEPREC — Registro de Comercio de Bolivia (NIT por nombre, en vivo)',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'backend_connected',
    nextAction:
      'Consulta en vivo y gratuita en cada corrida: el Agente 1 busca la empresa por nombre en el SEPREC y lee su NIT. Peticiones espaciadas 2,5 s (el SEPREC frena las ráfagas) y como mucho 45 s por corrida: unas 8-10 empresas.',
    countryCodes: ['BO'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://miempresa.seprec.gob.bo/',
    automationLevel: 'medium',
    recommendedUse:
      'Bolivia no publica un padrón descargable de empresas. En cada corrida del Agente 1 se consulta en vivo la búsqueda por nombre del Servicio Plurinacional de Registro de Comercio (SEPREC) y, para las empresas activas cuyo nombre coincide exactamente, su ficha básica para leer el NIT (nunca los contactos). Probado el 02-10: Cervecería Boliviana Nacional y Banco Mercantil Santa Cruz devuelven su NIT. NIT seguro sólo cuando exactamente un NIT tiene ese mismo núcleo de nombre; los homónimos y los nombres de una sola palabra sin forma societaria quedan como señal.',
    limitations: [
      'Es la búsqueda que usa el portal público del SEPREC, no un servicio documentado para terceros: puede cambiar sin aviso.',
      'Lenta y con límite de ritmo: el SEPREC responde 429 a 4-5 peticiones seguidas, así que se espacian 2,5 s (ante un 429 se espera 5 s y se reintenta una vez). Con 45 s por corrida alcanza para unas 8-10 empresas; tras 3 fallos seguidos se apaga en esa corrida.',
      'Excluye empresas unipersonales (personas) y matrículas no activas.',
      'NIT seguro sólo con el núcleo del nombre exacto. Si la marca aparece dentro de la razón social de UNA sola sociedad activa (búsqueda con 5 resultados o menos: Logibol → OPERADOR LOGISTICO DE CARGAS LOGIBOL S.R.L.), su NIT queda como PISTA para revisar, nunca en el campo fiscal.',
      'Aseguradoras y administradoras de fondos usan un nombre corto («Credifondo SAFI», «Alianza Seguros») que el SEPREC escribe largo (SOCIEDAD ADMINISTRADORA DE FONDOS DE INVERSION, COMPAÑIA DE SEGUROS): si el nombre corto da 0 resultados se hace UNA búsqueda más con la forma larga, y lo que salga también queda sólo como PISTA.',
      'Sin NIT para las empresas con la matrícula NO renovada: el SEPREC las lista como activas pero no muestra su ficha (medido el 02-10 con Solucredit S.R.L.).',
      'Si la marca llega con el país o el dominio pegados («Get Server Bolivia», «Cognos.com.bo») y no hay resultados, la búsqueda extra se hace sin esa cola (antes que la del sector); lo que salga también es sólo PISTA.',
    ],
    riskNotes: [
      'Si el SEPREC cambia o cae, las empresas bolivianas simplemente quedan sin NIT; la corrida sigue.',
      'Uso autorizado por la dueña el 02-10 sabiendo que no es un servicio público documentado.',
    ],
  },

  // ── Brasil ──────────────────────────────────────────────────────────────────
  {
    key: 'br_receita_dados_abertos',
    name: 'Receita Federal CNPJ Dados Abertos (Bulk)',
    // ── Estado operativo real — BR-PRODUCTION-RELEASE ────────────────────────
    //
    // Historia: BR-SOURCE-8B-UI-STANDARDIZE clasificó esta fuente como
    // `discovery` + `pending_integration_design` + `not_connected` cuando lo único
    // listo era la preparación LOCAL (GO Legal/Privacy BR-LEGAL-2, parser de
    // muestra BR-SOURCE-2, validador de manifiesto BR-SOURCE-6, dry-run local
    // BR-SOURCE-7) y no existía diseño de integración.
    //
    // Qué cambió: los cortes funcionales A→E1 construyeron la integración
    // completa — snapshot mensual con identidad y `snapshot_run_id` (CUT A,
    // migración 127), ejecutor + gateway SQL + adapter BR consumidos por Agent 1
    // (CUT B), periodo congelado y publicación fijada (CUT B1/B2), resolución de
    // la candidata al establecimiento por nombre canónico exacto dentro de la
    // publicación fijada (CUT C), promoción VALLADA de la identidad fiscal
    // resuelta (CUT D, migración 133) y sanitización a nivel de fila (CUT E1).
    // Por eso los tres valores anteriores dejaron de ser ciertos:
    //
    //   · `discovery` era incorrecto: Brasil NO descubre empresas. Receita entra
    //     DESPUÉS del descubrimiento, a enriquecer e identificar fiscalmente a una
    //     candidata que ya existe → `enrichment`.
    //   · `pending_integration_design` era incorrecto: el diseño de integración ya
    //     no está pendiente, está construido y verde en local. Lo que sigue
    //     pendiente son los DATOS: la migración 133 no está aplicada en Producción
    //     y el snapshot nacional de Receita no está cargado → `partial_pending_data`.
    //   · `not_connected` describía mal el CONTRATO de acceso: no hay API live ni
    //     credenciales; se lee un snapshot mensual publicado, offline y de sólo
    //     lectura → `read_only_snapshot`.
    //
    // Qué NO cambia, deliberadamente:
    //
    //   · `operationalStatus` sigue en `validation_only` ("Solo validación").
    //     Mientras la 133 no esté aplicada y el snapshot nacional no esté cargado,
    //     esta fuente produce CERO salida automática en Producción, y el estado
    //     operativo no debe afirmar operatividad que el producto todavía no tiene.
    //     La operación de Producción que aplique la 133 y cargue el snapshot es la
    //     que puede llevarlo a `operational_verified` + `connected_post_approval`,
    //     igual que `pe_sunat_bulk`. NO antes.
    //   · `read_only_snapshot` mantiene la acción en "Ver detalle" —nunca
    //     "Conectar"— por el `default` de action-presentation.ts, y mantiene la
    //     ficha de detalle SIN paneles genéricos de conexión, porque
    //     shouldSkipGenericConnectionPanels ya cubre ese connection mode.
    //     Presentacional: ningún valor de aquí habilita import, runtime, Agent 1
    //     live ni HubSpot.
    sellupUse: 'enrichment',
    aiFlowStatus: 'partial_pending_data',
    connectionMode: 'read_only_snapshot',
    // Reconciliación de clave (BR-SOURCE-8-UI-FIX1): la UI/registry conserva la
    // clave existente `br_receita_dados_abertos` para no duplicar la fuente de
    // Brasil. Los contratos técnicos (parser, staging, dry-run) usan la clave
    // canónica `br_receita_cnpj_dados_abertos`. No se renombra `key` porque ya
    // está en uso por la UI y las rutas del catálogo.
    canonicalTechnicalSourceKey: 'br_receita_cnpj_dados_abertos',
    sourceKeyReconciliation: {
      registrySourceKey: 'br_receita_dados_abertos',
      canonicalTechnicalSourceKey: 'br_receita_cnpj_dados_abertos',
      reason:
        'La clave existente del catálogo/UI se conserva para evitar duplicar la fuente de Brasil; los contratos técnicos de parser, staging y dry-run usan la clave canónica br_receita_cnpj_dados_abertos.',
    },
    nextAction:
      'Integración construida y verde en local (snapshot mensual, publicación fijada, resolución por nombre, promoción vallada de identidad fiscal). Pendiente en Producción: aplicar la migración 133 y cargar el snapshot nacional de Receita. Import, runtime, HubSpot y generación live permanecen bloqueados hasta esa operación de Producción con aprobación explícita.',
    countryCodes: ['BR'],
    sectors: [],
    priority: 'P0',
    operationalStatus: 'validation_only',
    type: 'official_registry',
    url: 'https://dadosabertos.rfb.gov.br/CNPJ/',
    automationLevel: 'high',
    recommendedUse: 'Registro empresarial oficial de Brasil, usado para ENRIQUECER después del descubrimiento: nunca descubre empresas. Dataset más completo de LATAM — ~60M CNPJs (~22M activos). Archivos ZIP: CNPJ, razão social, CNAE, município, situação cadastral, capital social, porte. Lectura de snapshot mensual publicado (offline, sólo lectura, sin credenciales). La ingesta nacional permanece BLOQUEADA hasta una operación de Producción con aprobación explícita.',
    limitations: [
      'Descarga ~4.7 GB comprimido / ~17 GB descomprimido — procesamiento batch offline obligatorio',
      'Acceso desde fuera de Brasil puede dar timeout; usar mirror: dados.gov.br o arquivos.receitafederal.gov.br',
      'No incluye datos de contacto (teléfono/email) en la mayoría de registros',
      'Licencia CC BY-ND 3.0 — no permite derivados; verificar uso comercial con legal antes de producción',
    ],
    riskNotes: [
      'Import, runtime enrichment, Agent 1 live y sincronización HubSpot BLOQUEADOS hasta hito separado con aprobación explícita',
      'Filtrar por situação cadastral: Ativa',
      'Verificar disponibilidad de mirror antes de procesar en producción',
    ],
  },
  {
    key: 'br_receita_cnpj',
    name: 'Receita Federal CNPJ (Referencia institucional)',
    // Clasificación (BR-SOURCE-8B-UI-STANDARDIZE): referencia institucional
    // complementaria, NO una segunda fuente operativa de Brasil. Se clasifica
    // explícitamente (mismo patrón que ec_sercop) para que salga del tab
    // "Operativas IA", no muestre CTA "Conectar" y abra el detalle de solo
    // lectura. La ingesta bulk la cubre br_receita_dados_abertos.
    sellupUse: 'manual_reference',
    aiFlowStatus: 'pending_integration_design',
    connectionMode: 'not_connected',
    nextAction:
      'Referencia institucional para validación puntual de CNPJ. No conectada y sin diseño de integración — la ingesta bulk la cubre br_receita_dados_abertos. Sin importación ni runtime.',
    countryCodes: ['BR'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'validation_only',
    type: 'official_registry',
    url: 'https://www.gov.br/receitafederal/',
    automationLevel: 'low',
    recommendedUse: 'Referencia institucional y validación puntual de CNPJ. No duplicar ingesta bulk si br_receita_dados_abertos está activa — esta fuente es complementaria para consultas individuales o verificación de registros específicos.',
    limitations: ['Sin descarga masiva directa desde el portal web', 'Datos de contacto mínimos en la fuente oficial'],
    riskNotes: ['No usar como pipeline de discovery masivo; usar br_receita_dados_abertos para ingesta bulk'],
  },
  {
    key: 'br_cnpj_ws',
    name: 'cnpj.ws (API tercero)',
    // Clasificación (BR-SOURCE-8B-UI-STANDARDIZE): candidato / API de tercero no
    // oficial, NO fuente activa. Se clasifica como requiere-validación (mismo
    // patrón que ec_ekos) para que salga del tab "Operativas IA", no muestre CTA
    // "Conectar" y abra el detalle de solo lectura. Requiere validación de TOS,
    // SLA y legalidad antes de considerar cualquier diseño de integración.
    sellupUse: 'pending_classification',
    aiFlowStatus: 'requires_validation',
    connectionMode: 'not_connected',
    nextAction:
      'Tercero no oficial sobre datos de Receita Federal. Requiere validación de TOS, SLA y legalidad antes de considerar cualquier integración. No conectada, no operativa.',
    countryCodes: ['BR'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'pending_validation',
    type: 'commercial_provider',
    url: 'https://www.cnpj.ws/',
    automationLevel: 'high',
    recommendedUse: 'API REST sobre datos CNPJ. Más conveniente que Receita Federal directa para integraciones.',
    limitations: ['Tercero no oficial sobre datos de Receita Federal'],
    riskNotes: ['Validar TOS y SLA antes de usar en producción'],
  },

  // ── Costa Rica ──────────────────────────────────────────────────────────────
  {
    key: 'cr_company_registry',
    name: 'PYMES activas MEIC + proveedores SICOP — cédula jurídica por nombre',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '18.216 sociedades con cédula jurídica cargadas (16.491 PYMES activas del MEIC + 1.725 proveedores de SICOP con nombre). El Agente 1 completa la cédula jurídica por nombre en cada corrida.',
    countryCodes: ['CR'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://datos.go.cr/',
    automationLevel: 'high',
    recommendedUse:
      'Combinación de tres archivos oficiales y gratuitos de datos.go.cr (CC-BY): la lista de PYMES activas del MEIC (enero de 2025) y los archivos de recursos y aclaraciones de SICOP 2022-2024 (Hacienda), que sí traen el nombre del proveedor. 18.216 sociedades (cédula 3…). En cada corrida del Agente 1 completa la cédula jurídica por nombre de empresa. El 99,8 % de los nombres es único. Cédula segura sólo cuando exactamente una cédula tiene ese mismo núcleo de nombre; los homónimos quedan como señal y los nombres genéricos nunca se buscan.',
    limitations: [
      'Sólo PYMES activas (micro, pequeñas y medianas) y proveedores del Estado: las empresas grandes casi no aparecen.',
      'La lista del MEIC es de enero de 2025; requiere recarga para reflejar altas y bajas.',
      'Sólo cédulas jurídicas de sociedades (3…): no incluye personas físicas, DIMEX ni entes estatales.',
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
    ],
    riskNotes: [
      'La cédula jurídica no tiene dígito verificador documentado: sólo se valida la forma (10 dígitos).',
      'El snapshot cr_sicop anterior se cargó sin nombres y no sirve para buscar por nombre; ésta es la fuente que se usa.',
    ],
  },
  {
    key: 'cr_sicop',
    name: 'SICOP Costa Rica (datos.go.cr)',
    sellupUse: 'commercial_signal',
    aiFlowStatus: 'connected_post_approval',
    connectionMode: 'offline_signal',
    nextAction:
      'Conectada como señal procurement B2G local. Snapshot parcial Ofertas 2024 con 4.998 proveedores cargados. El post-approval puede usar match local por cédula jurídica. No es fuente legal ni tributaria; no reemplaza Hacienda Costa Rica.',
    countryCodes: ['CR'],
    sectors: [],
    priority: 'P2',
    operationalStatus: 'operational_verified',
    type: 'procurement',
    url: 'https://www.datos.go.cr',
    automationLevel: 'medium',
    recommendedUse:
      'Señal procurement B2G para identificar empresas proveedoras/participantes en compras públicas de Costa Rica. Datasets XLSX publicados en datos.go.cr (portal CKAN oficial). Identifica empresas por cédula jurídica y nombre. Señal comercial de actividad con el Estado costarricense.',
    limitations: [
      'No es fuente legal ni tributaria — no valida cédula jurídica',
      'No reemplaza Hacienda CR (cr_hacienda_contribuyentes)',
      'Solo empresas que han participado como proveedoras/participantes en compras del Estado costarricense',
      'Datos vienen de datasets XLSX publicados en datos.go.cr — no API de consulta individual',
      'No incluye datos de contacto (emails, teléfonos)',
      'Fuente B2G procurement signal — human_review_required=true antes de prospección',
    ],
    riskNotes: [
      'Datos abiertos oficiales bajo portal datos.go.cr — riesgo legal bajo',
      'No usable como fuente fiscal — cr_hacienda_contribuyentes queda para P2 posterior',
    ],
  },

  // ── Panamá ──────────────────────────────────────────────────────────────────
  {
    key: 'pa_panamacompra_ruc_registry',
    name: 'PanamaCompraEnCifras — RUC por nombre (personas jurídicas proveedoras del Estado)',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '6.700 personas jurídicas cargadas (PanamaCompraEnCifras, carga autorizada el 05-10). El Agente 1 completa el RUC por nombre en cada corrida de Panamá.',
    countryCodes: ['PA'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'procurement',
    url: 'https://v2.panamacompraencifras.gob.pa/',
    automationLevel: 'high',
    recommendedUse:
      'Panamá no publica un padrón de RUC abierto (el Registro Público pide usuario). El buscador público de proveedores de PanamaCompraEnCifras (Dirección General de Contrataciones Públicas) trae RUC y razón social de quienes participan en compras públicas. Se carga una fila por RUC de PERSONA JURÍDICA (tomo-folio-asiento): 6.700 empresas, el 98,1 % con nombre único. RUC seguro sólo cuando exactamente un RUC tiene ese mismo núcleo de nombre; un nombre de una sola palabra sin forma societaria queda como pista.',
    limitations: [
      'Sólo quienes han participado en compras públicas: una empresa que no aparece no significa que no exista.',
      'Nunca cédulas de personas naturales (E-…, N-…, PE-…, «8-123-456»).',
      'El buscador devuelve como mucho 10.000 resultados por consulta: se completa con consultas por forma societaria (S.A, INC, CORP, CONSORCIO, LTD, S. DE R).',
      'El servidor no envía su certificado intermedio: la carga le pasa a Node el oficial de DigiCert (nunca se desactiva la verificación).',
      'Se guarda el RUC sin el DV; el DV, cuando viene, queda aparte.',
    ],
    riskNotes: [
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
    ],
  },
  {
    key: 'pa_panamacompra_convenio',
    name: 'PanamaCompra Convenio Marco',
    sellupUse: 'commercial_signal',
    aiFlowStatus: 'connected_post_approval',
    connectionMode: 'offline_signal',
    nextAction:
      'Conectada como señal procurement B2G local. Snapshot parcial de proveedores de Convenio Marco con 447 proveedores cargados. El post-approval puede usar match local por RUC. No es fuente legal ni tributaria; no valida RUC ni reemplaza DGI Panamá ni Registro Público. El RUC por nombre en cada corrida usa otra carga más amplia: «PanamaCompraEnCifras — RUC por nombre» (pa_panamacompra_ruc_registry).',
    countryCodes: ['PA'],
    sectors: [],
    priority: 'P2',
    operationalStatus: 'operational_verified',
    type: 'procurement',
    url: 'https://www.panamacompra.gob.pa/Inicio/',
    automationLevel: 'medium',
    recommendedUse:
      'Señal procurement B2G para identificar proveedores registrados en convenios marco del Estado panameño. API ASMX pública. Entrega RUC, nombre, contacto, representante y convenios asociados. Cobertura limitada a Convenio Marco.',
    limitations: [
      'No es fuente legal — no valida RUC como fuente fiscal oficial',
      'No es fuente tributaria — no reemplaza DGI Panamá',
      'No reemplaza Registro Público de Panamá',
      'Cobertura limitada a proveedores de Convenio Marco — no cubre toda la contratación pública',
      'No entrega adjudicaciones generales en bulk',
      'No entrega montos históricos en bulk',
      'API ASMX con formato form-urlencoded — puede cambiar sin aviso',
      'Fuente B2G procurement signal — human_review_required=true antes de prospección',
    ],
    riskNotes: [
      'API pública sin credenciales — riesgo de rate limiting o cambio de API sin aviso',
      'No usar como fuente legal, fiscal ni de validación de identidad',
      'No usar searchOrderList ni ListarActosParametros (requieren sesión)',
    ],
  },

  // ── El Salvador ──────────────────────────────────────────────────────────────
  {
    key: 'sv_comprasal',
    name: 'COMPRASAL El Salvador',
    sellupUse: 'commercial_signal',
    aiFlowStatus: 'signal_connected_read_only',
    connectionMode: 'read_only_signal',
    nextAction:
      '19 señales disponibles. Requiere revisión humana antes de asociar a cuentas.',
    countryCodes: ['SV'],
    sectors: [],
    priority: 'P2',
    operationalStatus: 'manual_signal_only',
    type: 'procurement',
    url: 'https://www.comprasal.gob.sv',
    automationLevel: 'medium',
    recommendedUse:
      'Señal procurement B2G para identificar proveedores adjudicados en compras públicas de El Salvador. API REST pública de COMPRASAL. Entrega proveedor, nombre comercial, institución, monto, fecha y código de proceso. No valida identidad fiscal; usar como señal débil con revisión humana antes de asociar a una cuenta.',
    limitations: [
      'No es fuente legal — no valida identidad fiscal',
      'No es fuente tributaria — no reemplaza Ministerio de Hacienda El Salvador',
      'No reemplaza CNR / Registro de Comercio de El Salvador',
      'No expone NIT ni NRC del proveedor en endpoints públicos',
      'No permite post-approval automático por identificador fiscal',
      'Solo señal débil por nombre — matching_mode = name_only_review_required',
      'Cubre adjudicaciones públicas disponibles en COMPRASAL, no el universo privado',
      'Fuente B2G procurement signal — human_review_required=true antes de prospección',
    ],
    riskNotes: [
      'API pública sin credenciales — riesgo de rate limiting o cambio de API sin aviso',
      'No usar como fuente legal, fiscal ni de validación de identidad',
      'No usar para post-approval automático — sin NIT/NRC públicos',
      'No llamar /api/v1/procesos ni endpoints autenticados de personas',
    ],
  },

  // ── Paraguay ────────────────────────────────────────────────────────────────
  {
    key: 'py_set_registry',
    name: 'Padrón de RUC SET/DNIT — RUC por nombre',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '97.727 sociedades activas (RUC 80…) del padrón público de RUC de la SET/DNIT cargadas. El Agente 1 completa el RUC por nombre en cada corrida.',
    countryCodes: ['PY'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://www.dnit.gov.py/',
    automationLevel: 'high',
    recommendedUse:
      'Padrón público de RUC de la SET/DNIT de Paraguay: 97.727 sociedades activas (RUC 80…). En cada corrida del Agente 1 completa el RUC por nombre de empresa. El RUC se guarda con su dígito verificador (por ejemplo 80002201-7). El 97,8 % de los nombres es único. RUC seguro sólo cuando exactamente un RUC tiene ese mismo núcleo de nombre; los homónimos quedan como señal y los nombres genéricos nunca se buscan.',
    limitations: [
      'Sólo sociedades activas con RUC 80…: no incluye personas físicas.',
      'El padrón no trae sector, actividad ni tamaño.',
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
      'Snapshot estático — requiere recarga para reflejar altas y bajas.',
    ],
    riskNotes: [
      'Un nombre repetido o genérico no da un RUC seguro; queda como señal.',
    ],
  },

  // ── Uruguay ─────────────────────────────────────────────────────────────────
  {
    key: 'uy_rupe_registry',
    name: 'RUPE (Registro Único de Proveedores del Estado) — RUT por nombre',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '17.785 empresas activas con forma societaria del RUPE (ARCE, catalogodatos.gub.uy) cargadas. El Agente 1 completa el RUT por nombre en cada corrida.',
    countryCodes: ['UY'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'procurement',
    url: 'https://catalogodatos.gub.uy/',
    automationLevel: 'high',
    recommendedUse:
      'Registro Único de Proveedores del Estado de Uruguay (RUPE, de ARCE, publicado en catalogodatos.gub.uy): 17.785 empresas activas con forma societaria. En cada corrida del Agente 1 completa el RUT por nombre de empresa. RUT seguro sólo cuando exactamente un RUT tiene ese mismo núcleo de nombre; los homónimos quedan como señal y los nombres genéricos nunca se buscan.',
    limitations: [
      'Sólo empresas que alguna vez fueron proveedoras del Estado: las demás no aparecen.',
      'Sólo empresas con forma societaria; no se guardan personas ni domicilios.',
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
      'Snapshot estático — requiere recarga para reflejar altas y bajas.',
    ],
    riskNotes: [
      'Un nombre repetido o genérico no da un RUT seguro; queda como señal.',
    ],
  },

  // ── Estados Unidos ──────────────────────────────────────────────────────────
  {
    key: 'us_sec_edgar_registry',
    name: 'SEC EDGAR — EIN por nombre',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      'Unas 6.124 empresas operativas con EIN, código SIC y presentación ante la SEC en los dos últimos años cargadas. Es la primera fuente de EIN por nombre en cada corrida del Agente 1.',
    countryCodes: ['US'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://www.sec.gov/edgar',
    automationLevel: 'high',
    recommendedUse:
      'Empresas operativas registradas en SEC EDGAR con EIN, código SIC y alguna presentación en los dos últimos años (unas 6.124). Es la primera fuente de Estados Unidos para completar el EIN por nombre en cada corrida del Agente 1; si no da un EIN seguro, sigue la carga del IRS (organizaciones sin ánimo de lucro). EIN seguro sólo cuando exactamente un EIN tiene ese mismo núcleo de nombre; los homónimos quedan como señal y los nombres genéricos nunca se buscan.',
    limitations: [
      'Sólo empresas que presentan ante la SEC: la mayoría de las empresas privadas no aparece.',
      'El EIN no tiene dígito verificador: un error de transcripción no se detecta.',
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
      'Snapshot estático — requiere recarga para reflejar nuevas presentaciones.',
    ],
    riskNotes: [
      'Un nombre repetido o genérico no da un EIN seguro; queda como señal.',
    ],
  },
  {
    key: 'us_irs_eo_registry',
    name: 'IRS Exempt Organizations (BMF) — EIN por nombre',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '65.044 organizaciones sin ánimo de lucro con ingresos o recaudación de US$5 millones o más cargadas. Segunda fuente de EIN por nombre en cada corrida, después de la SEC.',
    countryCodes: ['US'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'official_registry',
    url: 'https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf',
    automationLevel: 'high',
    recommendedUse:
      'Archivo maestro de organizaciones exentas del IRS (Exempt Organizations BMF): 65.044 organizaciones sin ánimo de lucro —universidades, hospitales, fundaciones— con ingresos o recaudación de US$5 millones o más. Es la segunda fuente de Estados Unidos para completar el EIN por nombre en cada corrida del Agente 1, después de la SEC. EIN seguro sólo cuando exactamente un EIN tiene ese mismo núcleo de nombre; los homónimos quedan como señal y los nombres genéricos nunca se buscan.',
    limitations: [
      'Sólo organizaciones sin ánimo de lucro grandes (US$5 millones o más): no cubre empresas con fines de lucro.',
      'El EIN no tiene dígito verificador: un error de transcripción no se detecta.',
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
      'Snapshot estático — requiere recarga para reflejar altas y bajas.',
    ],
    riskNotes: [
      'Un nombre repetido o genérico no da un EIN seguro; queda como señal.',
    ],
  },

  // ── España ──────────────────────────────────────────────────────────────────
  {
    key: 'es_placsp_registry',
    name: 'Plataforma de Contratación del Sector Público — NIF por nombre',
    sellupUse: 'legal_validation',
    aiFlowStatus: 'connected_identity_in_run',
    connectionMode: 'read_only_snapshot',
    nextAction:
      '22.705 sociedades adjudicatarias con NIF de sociedad válido cargadas (contratos de junio a septiembre de 2026). El Agente 1 completa el NIF por nombre en cada corrida.',
    countryCodes: ['ES'],
    sectors: [],
    priority: 'P1',
    operationalStatus: 'operational_verified',
    type: 'procurement',
    url: 'https://contrataciondelestado.es/',
    automationLevel: 'high',
    recommendedUse:
      'Sociedades adjudicatarias de la Plataforma de Contratación del Sector Público con NIF de sociedad válido: 22.705 cargadas (contratos de junio a septiembre de 2026). España no publica el NIF de las empresas en ningún registro abierto, así que esta es la vía disponible. En cada corrida del Agente 1 completa el NIF por nombre de empresa. NIF seguro sólo cuando exactamente un NIF tiene ese mismo núcleo de nombre; los homónimos quedan como señal y los nombres genéricos nunca se buscan.',
    limitations: [
      'Sólo cubre empresas que ganaron contratos públicos: las demás no aparecen.',
      'Carga de un periodo corto (junio–septiembre de 2026).',
      'España no publica el NIF de las empresas en ningún registro abierto.',
      'Sin coincidencias aproximadas: el núcleo del nombre debe coincidir exactamente.',
    ],
    riskNotes: [
      'Un nombre repetido o genérico no da un NIF seguro; queda como señal.',
    ],
  },

  // ── Globales / Fallback ─────────────────────────────────────────────────────
  {
    key: 'global_opencorporates',
    name: 'OpenCorporates',
    // SOURCES-CATALOG-COUNTRY-AUDIT-1 (02-10): descartada. Su API para uso
    // comercial es de pago y cada país ya tiene su registro oficial gratuito.
    // Clave y prioridad no cambian: el respaldo global la pide por su clave.
    sellupUse: 'not_for_ai_flow',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_applicable',
    nextAction:
      'Descartada: la API para uso comercial es de pago, y cada país ya tiene su registro oficial gratuito conectado (número fiscal por nombre). No se conecta.',
    countryCodes: [],
    sectors: [],
    priority: 'P2',
    operationalStatus: 'discarded_paid_or_tos',
    type: 'public_dataset',
    url: 'https://opencorporates.com/',
    automationLevel: 'medium',
    recommendedUse: 'Fallback global para países sin fuente P0. Cubre 130+ jurisdicciones con datos básicos de registro.',
    limitations: ['Cobertura desigual en LatAm', 'API requiere plan de pago para volumen', 'Datos pueden estar desactualizados'],
    riskNotes: [
      'Requiere plan/API de pago para volumen; no usar como fuente automática de discovery sin validación comercial y legal previa.',
    ],
  },
  {
    key: 'global_apollo',
    name: 'Apollo.io',
    // SOURCES-CATALOG-COUNTRY-AUDIT-1 (02-10): Apollo es el proveedor pagado
    // principal del Agente 1. Estado presentacional: clave y prioridad no cambian.
    sellupUse: 'discovery',
    aiFlowStatus: 'connected_paid_provider',
    connectionMode: 'backend_connected',
    nextAction:
      'Conectado: proveedor pagado principal del Agente 1. Entra después del banco de empresas, de la capa gratuita del país (CO, DO, AR, MX) y de Tavily cuando está primero. Su clave vive en las variables de Vercel.',
    countryCodes: [],
    sectors: [],
    priority: 'P2',
    operationalStatus: 'operational_verified',
    type: 'commercial_provider',
    url: 'https://www.apollo.io/',
    automationLevel: 'high',
    recommendedUse:
      'Búsqueda pagada de empresas por país, industria y tamaño, y datos de la empresa (dominio, LinkedIn, empleados). El número fiscal no sale de Apollo: lo completa la fuente oficial de cada país.',
    limitations: [
      'Cobertura débil en algunos países (medido el 02-10: Bolivia × Tecnología trajo 6 empresas, 5 públicas o educativas).',
      'Cada búsqueda y cada empresa completada gastan créditos.',
      'Orden de resultados no estable entre búsquedas (soporte Apollo, 29-09).',
    ],
    riskNotes: ['Gasta créditos: respeta el presupuesto mensual del asistente.'],
  },
  {
    key: 'global_lusha',
    name: 'Lusha',
    // SOURCES-CATALOG-COUNTRY-AUDIT-1 (02-10): Lusha es el respaldo pagado del
    // Agente 1 cuando Apollo no llega al objetivo. Estado presentacional: sigue
    // fuera de recommendedSources (se excluye por su clave).
    sellupUse: 'discovery',
    aiFlowStatus: 'connected_paid_provider',
    connectionMode: 'backend_connected',
    nextAction:
      'Conectado: respaldo pagado del Agente 1 cuando Apollo no llega al objetivo («Busca primero con Apollo; si no alcanza, completa con Lusha»). Su clave vive en las variables de Vercel.',
    countryCodes: [],
    sectors: [],
    priority: 'P2',
    operationalStatus: 'operational_verified',
    type: 'commercial_provider',
    url: 'https://www.lusha.com/',
    automationLevel: 'high',
    recommendedUse:
      'Búsqueda pagada de empresas como respaldo de Apollo. El número fiscal no sale de Lusha: lo completa la fuente oficial de cada país.',
    limitations: [
      'Sin exclusión por API: puede devolver empresas ya vistas (soporte Lusha, 29-09).',
      '1 crédito = 25 resultados.',
      'Los teléfonos y contactos NO se piden desde el Agente 1.',
    ],
    riskNotes: ['Gasta créditos: respeta el presupuesto mensual del asistente.', 'Excluida de recommendedSources.'],
  },
];
