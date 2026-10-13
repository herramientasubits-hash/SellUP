/**
 * ve-listed-company-macro-table.ts — macro industria de cada empresa que cotiza o
 * emite valores en Venezuela (emisoras de la Bolsa de Caracas y emisores del registro
 * de la SUNAVAL), por RIF.
 *
 * SOURCES-VE-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * El «sector» de la Bolsa es demasiado amplio («Industria Manufacturera y
 * Construcción», «Agricultura y Alimentos Procesados», «Otros Establecimientos
 * Financieros»): una fila por empresa, leída de su objeto social en la propia ficha
 * de la Bolsa. Las que no se dejan clasificar con seguridad no están (sin macro).
 *
 * PENDIENTE DE REVISIÓN DE LA DUEÑA: hasta su aprobación, la carga de la capa
 * gratuita se niega (`VE_FREE_DIRECTORY_MACRO_TABLES_APPROVED`).
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';

export const VE_LISTED_COMPANY_MACRO_TABLE_VERSION = 've-listed-v1' as const;

const FIN: MacroIndustryKey = 'insurance_financial_services';
const MANU: MacroIndustryKey = 'industry_manufacturing_chemicals_automotive';
const CONS: MacroIndustryKey = 'consumer_goods';
const AGRO: MacroIndustryKey = 'agroindustry';
const RETAIL: MacroIndustryKey = 'retail';
const TECH: MacroIndustryKey = 'technology';
const HEALTH: MacroIndustryKey = 'health_pharma';
const PROP: MacroIndustryKey = 'property_construction';
const ENERGY: MacroIndustryKey = 'energy_mining_environment';
const TRANSP: MacroIndustryKey = 'transport_logistics';
const SERV: MacroIndustryKey = 'services_company';

/** RIF → macro. Cada línea dice qué hace la empresa según su objeto social. */
export const VE_LISTED_COMPANY_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  // ── Bolsa de Caracas: emisoras ──
  'J-40727580-1': HEALTH, // Abril Medical Salud 2015 — fabrica y reconstruye equipos médico-quirúrgicos
  'J-40465902-1': RETAIL, // Acqua Fontana — representación e importación de marcas
  'J-07020126-6': AGRO, // Agropecuaria San Carlos — explotación agrícola y pecuaria
  'J-31648003-8': AGRO, // Agropecuaria San Marino — comercialización de productos agrícolas
  'J-50205641-6': FIN, // Alalza Inversiones — capta recursos para invertir en pymes
  'J-00014678-0': MANU, // Alice Neumáticos de Venezuela — caucho y plásticos
  'J-30794810-8': CONS, // Alimentos Botalón — procesamiento de café
  'J-31721968-6': CONS, // Alimentos FM — producción y distribución de alimentos
  'J-40219889-2': SERV, // Alma Global — holding de servicios jurídicos y profesionales
  'J-50319319-0': PROP, // Arca Inmuebles y Valores — actividad inmobiliaria
  'J-50561988-8': FIN, // Arca Sociedad Titularizadora
  'J-30904657-8': RETAIL, // Auto Partes Lara — venta de vehículos y repuestos
  'J-31628759-9': FIN, // Bancamiga Banco Universal
  'G-20009997-6': FIN, // Banco de Venezuela
  'J-00002949-0': FIN, // Banco del Caribe (Bancaribe)
  'J-30984132-7': FIN, // Banco Nacional de Crédito
  'J-00002967-9': FIN, // Banco Provincial
  'J-00004114-8': FIN, // Bolsa de Valores de Caracas
  'J-00013663-7': MANU, // Fábrica Nacional de Vidrio
  'J-00124134-5': TECH, // CANTV — telecomunicaciones
  'J-00032569-3': CONS, // Ron Santa Teresa — bebidas alcohólicas
  'J-00038883-0': MANU, // Venezolana de Pulpa y Papel
  'J-00036157-6': MANU, // Telares de Palo Grande — textil
  'J-00021467-0': HEALTH, // Calox International — farmacéutica
  'J-31438468-6': HEALTH, // Capsuven Pharma Labs — importa y distribuye productos farmacéuticos
  'J-00282860-9': MANU, // Cemex Venezuela — cemento
  'J-00006343-5': MANU, // Cerámica Carabobo — revestimientos cerámicos
  'J-50743786-8': FIN, // Clabe Capital — inversión en empresas
  'J-07000397-9': HEALTH, // Comercial Belloso (Cobeca) — distribución de medicinas
  'J-00007610-3': MANU, // Venceramica — piezas sanitarias
  'J-00025641-1': MANU, // Corimon — pinturas, químicos y envases
  'J-30558757-4': ENERGY, // Corporación Industrial de Energía — generación eléctrica
  'J-07508027-0': MANU, // Corporación Grupo Químico — industria química
  'J-29712776-3': PROP, // Corporación Serca — proyectos de construcción
  'J-30240664-1': TECH, // Corporación Telemic (Inter) — telecomunicaciones
  'J-40922549-6': ENERGY, // Corporación Berakah — exploración y manejo de sustancias peligrosas
  'J-41145408-7': RETAIL, // Corporación Damasco — venta de electrónica
  'J-30818251-6': TECH, // Corporación Fibex Telecom
  'J-29705917-2': TECH, // Corporación Vnet — telecomunicaciones
  'J-30502749-8': TECH, // Dayco Telecom
  'J-00203212-0': CONS, // Dernier Cosmetics — cosméticos y hogar
  'J-50096921-0': TECH, // Desarrollos Tecnológicos Ridery — plataforma tecnológica
  'J-40105179-0': CONS, // Dismarket Express — alimentos envasados
  'J-31349265-5': AGRO, // Distribuidora Agrícola Do-Gil
  'J-00116938-5': MANU, // Domínguez & Cía — envases metálicos
  'J-50632179-3': FIN, // Eleva Valor — inversión
  'J-30898736-0': MANU, // Empire Keeway — motocicletas
  'J-00012768-9': MANU, // Envases Venezolanos
  'J-50477976-8': FIN, // Evidencias-Inversiones
  'J-00013655-6': MANU, // Fábrica Nacional de Cementos
  'J-41129901-4': CONS, // Falcon Trade Group — alimentos
  'J-40258841-0': RETAIL, // Ferreléctricas La Trinidad — materiales eléctricos
  'J-50091084-3': FIN, // Fivenca Fondo de Capital Privado
  'J-50237306-3': FIN, // Fivenca Sociedad Titularizadora
  'J-50747172-1': FIN, // Fondo Petrolia — financia actividades del sector hidrocarburos
  'J-50019975-9': RETAIL, // Forum Super Mayorista
  'J-00374108-6': PROP, // FVI Fondo de Valores Inmobiliarios
  'J-30071709-7': CONS, // General de Alimentos Nisa (Genica)
  'J-00068171-6': CONS, // Genia Care — cuidado personal
  'J-41092639-2': AGRO, // Grupo Apradoc — granos
  'J-50596588-3': CONS, // Grupo Mantra Corp
  'J-40404720-4': HEALTH, // Grupo Nueve Once — materiales y equipos médicos
  'J-07007530-9': MANU, // Grupo Zuliano — petroquímica
  'J-50088704-3': FIN, // Impulsa Venture Capital
  'J-00019582-0': CONS, // Industrias Iberia — alimentos y condimentos
  'J-00019931-0': PROP, // Invaca Investment Company — bienes inmuebles
  'J-41002396-1': CONS, // Inversiones CDE — alimentos
  'J-29803170-0': FIN, // Inversiones Crece Pymes
  'J-00020196-0': FIN, // Inversiones Diversas (Inverdica)
  'J-30981454-0': AGRO, // Inversiones El Palmeral — siembra y cosecha
  'J-30756709-0': CONS, // Inversiones Mida — procesamiento de frutas y hortalizas
  'J-40845693-1': RETAIL, // Inversiones R&M 27 — distribución al mayor y detal
  'J-00047350-1': MANU, // Inversiones Selva — plásticos desechables
  'J-40939283-0': RETAIL, // Inversiones Top Suministros
  'J-40032352-5': CONS, // Inversiones Torrefacción del Café
  'J-31110397-0': HEALTH, // Laboratorios Chemycal's Soma — productos para la salud
  'J-00021540-5': HEALTH, // Laboratorios Vincenti — farmacéutica
  'J-30116319-2': CONS, // Lucky Trade — materia prima para alimentos
  'J-00023530-9': MANU, // Manufacturas de Papel (Manpa)
  'J-50026947-1': RETAIL, // Menssajero — comercio electrónico
  'J-30438135-2': FIN, // Mercantil Servicios Financieros
  'J-00025642-0': MANU, // Montana Gráfica — pinturas y empaques
  'J-50230255-7': FIN, // Montesco Capital Global
  'J-50183570-5': FIN, // Multiplicas Casa de Bolsa
  'J-50293907-5': FIN, // Multiplicas Promotora de Inversiones y Valores
  'J-50171488-6': SERV, // Multiservicios Noreverford — taller mecánico
  'J-30236437-0': FIN, // Organización Italcambio — casa de cambio
  'J-31253836-8': FIN, // Oriente Entidad de Inversión Colectiva Inmobiliaria
  'J-07001473-3': CONS, // Pasteurizadora Táchira — lácteos
  'J-40442530-6': TECH, // Patriacell — telecomunicaciones
  'J-50086347-0': FIN, // PC-IBC Fondo Mutual
  'J-50095823-4': FIN, // PIVCA Promotora de Inversiones y Valores
  'J-00103686-5': AGRO, // Proagro — alimentos balanceados para animales
  'J-30807974-0': CONS, // Procafé Lara
  'J-40602491-0': CONS, // Procesadora de Alimentos Occidente
  'J-30139592-1': AGRO, // Procesadora Marsoca — arroz
  'J-00030125-5': CONS, // Productos EFE — helados
  'J-00201356-7': MANU, // Productos Químicos L.M.V. — lubricantes
  'J-00030240-5': AGRO, // Protinal — alimentos balanceados para animales
  'J-30810301-2': AGRO, // Purolomo — cría de cerdos, pollos y ganado
  'J-40732273-7': MANU, // Quimipro Venezuela — productos químicos
  'J-50491456-8': TECH, // Quoota Capital — comercio electrónico de bienes intangibles
  'J-50411615-7': FIN, // Rendivalores Fondo Mutual
  'J-30682282-8': HEALTH, // Sermelab Servicios Médicos
  'J-00034672-0': MANU, // Siderúrgica Venezolana (Sivensa)
  'J-31695677-6': AGRO, // Silos, Mantenimiento y Almacenamiento de Cereales (Silmaca)
  'J-00035225-9': HEALTH, // Steritex — derivados del algodón medicinal
  'J-40279618-8': MANU, // Suministros Sematech — insumos y repuestos industriales
  'J-50320633-0': FIN, // Venealternative
  'J-00077859-0': SERV, // Vepica — proyectos de ingeniería
  'J-40916323-7': TECH, // Wifi Solution 7-8 — internet inalámbrico
  'J-40559145-5': CONS, // Zoah Inversiones — cosmética
  // ── SUNAVAL (2022): emisores que no están en la Bolsa ──
  'J-31658582-4': TRANSP, // 3PL Panamericana — logística
  'J-00030395-9': AGRO, // Agribrands Purina — alimentos para animales
  'J-40701502-8': AGRO, // Agropecuaria La Unión
  'J-00324454-6': AGRO, // Alimentación Balanceada Alibal
  'G-20008429-4': TRANSP, // Almacenadora Caracas — almacenaje
  'G-20005187-6': FIN, // Banco del Tesoro
  'J-30061946-0': FIN, // Banco Occidental de Descuento
  'J-00010798-0': CONS, // Destilería Yaracuy
  'J-00006277-3': AGRO, // Central La Pastora — azúcar
  'G-20009570-9': MANU, // Fábrica Nacional de Cementos (empresa del Estado)
  'J-30318305-0': FIN, // Caja Caracas Casa de Bolsa
  'J-07032176-8': AGRO, // Cargill de Venezuela
  'J-31314718-4': TRANSP, // Cargoport Logistics
  'J-00038839-3': MANU, // Cemex Venezuela
  'J-00006273-0': AGRO, // Central El Palmar — azúcar
  'J-00047357-9': CONS, // Charcutería Venezolana (Charvenca)
  'J-30300753-8': RETAIL, // Comercializadora El Conde de Catia
  'J-00010791-2': CONS, // Destilería Carúpano
  'J-00230964-4': HEALTH, // Galaxia Médica
  'J-50152573-0': FIN, // Interaval Sociedad de Inversión y Desarrollo
  'J-50098163-5': FIN, // Inversora Finagro
  'J-41298052-1': FIN, // Invierte en Venezuela.com
  'J-40215069-5': MANU, // Maqveca — maquinaria
  'J-08508666-8': CONS, // Moliendas Papelón
  'J-30108335-0': TECH, // Netuno — telecomunicaciones
  'J-00026840-1': FIN, // Seguros Nuevo Mundo
  'J-00035914-8': TRANSP, // Taurel & Cía — agentes aduanales y logística
});

/** Macro de una empresa que cotiza, por su RIF, o `null`. */
export function resolveVeListedCompanyMacro(rif: string | null | undefined): MacroIndustryKey | null {
  return typeof rif === 'string' ? (VE_LISTED_COMPANY_MACRO[rif] ?? null) : null;
}
