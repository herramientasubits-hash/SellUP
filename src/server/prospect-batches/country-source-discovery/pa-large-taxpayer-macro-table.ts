/**
 * pa-large-taxpayer-macro-table.ts — macro industria de los Grandes Contribuyentes
 * de la DGI de Panamá, por RUC.
 *
 * SOURCES-PA-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * La lista de Grandes Contribuyentes (Resolución 201-3486 de 17-04-2025, Gaceta
 * Oficial 30271-A; ingresos ≥ B/.20 millones Y activos ≥ B/.60 millones en 2023)
 * trae RUC y razón social, sin actividad. Muchas no venden al Estado (bancos,
 * cerveceras, supermercados), así que no tienen código UNSPSC. Esta tabla, una
 * fila por RUC, la armó Claude por la razón social y la REVISÓ la dueña (decisión
 * 4 del informe del 07-10-2026). Un RUC que no está aquí no entra a la capa
 * gratuita por esta vía (puede entrar como proveedora con su UNSPSC).
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';

export const PA_LARGE_TAXPAYER_MACRO_TABLE_VERSION = 'pa-dgi-large-taxpayer-macro-v1' as const;

/**
 * RUC canónico (sin DV) → macro. 41 de los 297 ya se clasifican por lo que venden
 * al Estado (UNSPSC) y no están aquí. Quedan SIN macro, a propósito, los que no se
 * pueden clasificar con seguridad por el nombre: holdings y fondos, hoteles y
 * casinos, universidades (sin macro, como en la tabla aprobada de República
 * Dominicana) y nombres que no identifican el negocio:
 *
 *   1147366-1-571050 AGRO PLAYA BLANCA
 *   155659265-2-2017 AMRESORTS MARKETING PANAMA
 *   16132-151-153946 ARGELIA INTERNACIONAL
 *   155643240-2-2017 CFG INVESTMENTS PANAMA
 *   155715839-2-2021 CFG INVESTMENTS PANAMA II
 *   155727745-2-2022 CIRCLE CAPITAL HOLDING
 *   1905171-1-723456 COMPAÑIA INSULAR AMERICANA
 *   196-8-47222 CORPORACION IMPA DOEL
 *   469303-1-434018 DAILY LATINOAMERICA
 *   155646417-2-2017 DARNEL
 *   12453-217-123692 ELECTRON INVESTMENT
 *   1080323-1-554308 EMPRESAS CARBONE
 *   1571707-1-660849 EUROMASTER
 *   32423-34-247629 GAMING & SERVICES DE PANAMA
 *   1753532-1-696837 GRUPO KAYVESA
 *   2357-1-364165 GRUPO PRIMAVERA HOLDING
 *   1980171-1-736896 GRUPO VISION DE PANAMA
 *   1313639-1-608866 HOTELERA RH
 *   1111368-1-723 HOTELES DECAMERON
 *   1722702-1-1624 IBT LLC
 *   1155955-1-572787 IDEAL LIVING CORP
 *   965423-1-528813 IDEAL PANAMA
 *   843221-1-503875 IGP TRADING CORP
 *   13416-237-132168 INDUSTRIA CORREAGUA
 *   227-216-53765 J. CAIN Y CIA
 *   5837-93-70420 KADIMA
 *   10987-11-111433 KENNEDY CENTER CORPORATION
 *   402962-1-249644 LATIN TRADING CO
 *   155675684-2-2019 LEEWRANGLER WH SOURCING
 *   9743-53-99729 NEMO TRADERS
 *   9655-104-98851 NORTHBAY INTERNATIONAL
 *   155726490-2-2022 PACIFICA SUPPLY AND LOGISTICS
 *   155727618-2-2022 REPUBLICA HOLDING
 *   1358519-1-619162 ROYAL CANADIAN
 *   2639916-1-839327 SANTA MARIA HOTEL & GOLF
 *   1486616-1-1504 SUEZ INTERNATIONAL
 *   902679-1-515225 TAMEK
 *   62137-36-351360 TARGET
 *   2153933-1-765856 TOLEDOT INVESTMENTS
 *   65219-68-360495 TOVA
 *   155639920-2-2016 TRADING BUSINESS MANAGEMENT
 *   155697070-2-2020 UAM LOGISTICS & TRADING
 *   155670967-2-2018 ULTIMATE LEISURE CLUB
 *   31751-28-244663 UNIVERSIDAD LATINA DE PANAMA
 *   155659308-2-2017 UVC GLOBAL PANAMA
 *   155664739-2-2018 VF PANAMA SOURCING SERVICES
 */
export const PA_LARGE_TAXPAYER_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '1648964-1-675232': 'agroindustry', // AGROSILOS
  '8837-98-91084': 'agroindustry', // AVICOLA GRECIA
  '194-127-47232': 'agroindustry', // AZUCARERA NACIONAL
  '59838-19-345377': 'agroindustry', // CENTRAL AZUCARERO DE ALANJE
  '59838-2-345376': 'agroindustry', // CENTRAL AZUCARERO LA VICTORIA (CALVISA)
  '56635-2-838': 'agroindustry', // CHIQUITA PANAMA
  '77098-1-374951': 'agroindustry', // CIA. ALIMENTOS DE ANIMALES
  '38-21-5026': 'agroindustry', // COMPAÑIA AZUCARERA LA ESTRELLA
  '650-529-126088': 'agroindustry', // EMPRESAS MELO
  '155682712-2-2019': 'agroindustry', // K+S MINERALS AND AGRICULTURE (PANAMA)
  '894-57-103790': 'agroindustry', // PRODUCTOS TOLEDANO
  '1040-235-114211': 'agroindustry', // SYNGENTA CROP PROTECTION
  '155721865-2-2022': 'agroindustry', // UCG MULTIFLOUR
  '155641197-2-2016': 'consumer_goods', // CERVECERIA NACIONAL
  '3-102-260': 'consumer_goods', // CERVECERIA NACIONAL HOLDING
  '555-328-101285': 'consumer_goods', // CERVECERIA PANAMA
  '44-242-5856': 'consumer_goods', // COCA COLA FEMSA DE PANAMA
  '53808-36-329105': 'consumer_goods', // KIMBERLY CLARK CENTRAL AMERICAN HOLDINGS
  '877409-1-510395': 'consumer_goods', // L'OREAL PANAMA
  '82-30-15216': 'consumer_goods', // NESTLE PANAMA
  '1231576-1-1397': 'consumer_goods', // PROCTER & GAMBLE INTERNATIONAL OPERATIONS
  '147-569-40208': 'consumer_goods', // PRODUCTOS ALIMENTICIOS PASCUAL
  '42928-69-289713': 'consumer_goods', // SOCIEDAD DE ALIMENTOS DE PRIMERA
  '203-438-49939': 'consumer_goods', // VARELA HERMANOS
  '292834-1-409023': 'energy_mining_environment', // AES CHANGUINOLA
  '155717217-2-2022': 'energy_mining_environment', // AES COLON HOLDING
  '57983-20-340437': 'energy_mining_environment', // AES PANAMA
  '155692836-2-2020': 'energy_mining_environment', // AES PANAMA GENERATION HOLDINGS
  '55285-61-333193': 'energy_mining_environment', // ALTA CORDILLERA (hidroeléctrica)
  '474598-1-434800': 'energy_mining_environment', // ALTERNEGY
  '1518632-1-1526': 'energy_mining_environment', // BOMINFLOT BUNKER OIL
  '1129184-1-566509': 'energy_mining_environment', // CELSIA CENTROAMERICA
  '3113-2-168': 'energy_mining_environment', // CHEVRON PANAMA FUELS
  '431-195-92319': 'energy_mining_environment', // COMPAÑIA CHEVRON DE PANAMA
  '155613062-2-2015': 'energy_mining_environment', // COSTA NORTE LNG TERMINAL
  '57983-110-340442': 'energy_mining_environment', // EDECHI
  '57983-2-340436': 'energy_mining_environment', // EDEMET
  '57983-56-340439': 'energy_mining_environment', // ELEKTRA NORESTE (ENSA)
  '57983-38-340438': 'energy_mining_environment', // ENEL FORTUNA
  '57983-128-340443': 'energy_mining_environment', // ETESA
  '1109747-1-561789': 'energy_mining_environment', // FOUNTAIN HYDRO POWER
  '155598964-2-2015': 'energy_mining_environment', // GAS NATURAL ATLANTICO
  '972951-1-530318': 'energy_mining_environment', // GENERADORA DEL ATLANTICO
  '44175-85-294448': 'energy_mining_environment', // HIDROECOLOGICA DEL TERIBE
  '239183-1-401257': 'energy_mining_environment', // HYDRO CAISAN
  '155647458-2-2017': 'energy_mining_environment', // MAERSK OIL TRADING PANAMA
  '61159-2-348585': 'energy_mining_environment', // MAXUM OIL SERVICE DE PANAMA
  '46505-96-303869': 'energy_mining_environment', // MINERA PANAMA
  '155633224-2-2016': 'energy_mining_environment', // MONJASA PTY (combustible marino)
  '155623389-2-2016': 'energy_mining_environment', // PACIFICA PETROLEUM
  '155693567-2-2020': 'energy_mining_environment', // PAN-AM GENERATING
  '43358-28-291351': 'energy_mining_environment', // PARQUE EOLICO TOABRE
  '2168639-1-768273': 'energy_mining_environment', // PENINSULA PETROLEUM PANAMA
  '44348-2-295287': 'energy_mining_environment', // PETROPORT
  '759-168-16667': 'energy_mining_environment', // PETROTERMINAL DE PANAMA
  '396-569-88934': 'energy_mining_environment', // PUMA ENERGY
  '297-154-64691': 'energy_mining_environment', // REFINERIA PANAMA
  '256682-1-403979': 'energy_mining_environment', // TRITON ENERGY OF PANAMA
  '2318210-1-792556': 'energy_mining_environment', // UEP PENONOME II (eólica)
  '1235440-1-589831': 'health_pharma', // ASTRAZENECA CAMCAR
  '126-347-3293': 'health_pharma', // BAYER
  '539-153-116071': 'health_pharma', // CLINICAS Y HOSPITALES
  '43274-151-280925': 'health_pharma', // DREXCO PANAMA
  '667-78-118405': 'health_pharma', // DROGUERIA RAMON GONZALEZ REVILLA
  '4307-162-58368': 'health_pharma', // ETHNOR DEL ISTMO
  '155661286-2-2018': 'health_pharma', // FARMACAM
  '193-426-48244': 'health_pharma', // HALEON PANAMA
  '2020573-1-1839': 'health_pharma', // MSD CENTRAL AMERICA SERVICES
  '2020579-1-1840': 'health_pharma', // MSD LATIN AMERICA SERVICES
  '31853-70-245139': 'health_pharma', // NOVARTIS PHARMA (LOGISTICS)
  '155691863-2-2020': 'health_pharma', // ORGANON LATIN AMERICA SERVICES
  '1931866-1-1761': 'health_pharma', // PFIZER FREE ZONE PANAMA
  '317413-1-412526': 'health_pharma', // PHARMA CONSULTING GROUP
  '31365-136-242910': 'health_pharma', // PRODUCTOS ROCHE PANAMA
  '644-570-114659': 'health_pharma', // PROMOCION MEDICA (PROMED)
  '43901-49-293356': 'health_pharma', // SANOFI AVENTIS DE PANAMA
  '1422698-1-1095': 'industry_manufacturing_chemicals_automotive', // 3M PANAMA PACIFICO
  '125-103-33907': 'industry_manufacturing_chemicals_automotive', // ARGOS PANAMA (cemento)
  '155586451-2-2014': 'industry_manufacturing_chemicals_automotive', // ENVASES UNIVERSALES BALL DE PANAMA
  '31794-16-244849': 'industry_manufacturing_chemicals_automotive', // JAPAN INTERNATIONAL PARTS
  '155648085-2-2017': 'industry_manufacturing_chemicals_automotive', // LIEBHERR PANAMA
  '33739-33-253068': 'industry_manufacturing_chemicals_automotive', // METALES PANAMERICANOS (METALPAN)
  '2688883-1-2401': 'industry_manufacturing_chemicals_automotive', // TRANE TECHNOLOGIES LATIN AMERICA
  '454805-1-432117': 'insurance_financial_services', // ASEGURADORA GLOBAL
  '1355718-1-618528': 'insurance_financial_services', // AV SECURITIES
  '47101-2-306017': 'insurance_financial_services', // BAC INTERNATIONAL BANK
  '35090-124-258812': 'insurance_financial_services', // BANCO ALIADO
  '1183-594-125546': 'insurance_financial_services', // BANCO DAVIVIENDA (PANAMA)
  '899-147-103018': 'insurance_financial_services', // BANCO DELTA
  '1911237-1-724518': 'insurance_financial_services', // BANCO FICOHSA (PANAMA)
  '280-134-61098': 'insurance_financial_services', // BANCO GENERAL
  '1247-207-120963': 'insurance_financial_services', // BANCO INTERNACIONAL DE COSTA RICA (BICSA)
  '52052-44-323244': 'insurance_financial_services', // BANCO LA HIPOTECARIA
  '985189-1-533017': 'insurance_financial_services', // BANCO LAFISE PANAMA
  '659063-1-460910': 'insurance_financial_services', // BANCO PICHINCHA PANAMA
  '2188209-1-2034': 'insurance_financial_services', // BANCOLOMBIA
  '928-149-105971': 'insurance_financial_services', // BANCOLOMBIA PANAMA
  '36633-66-264068': 'insurance_financial_services', // BANESCO (PANAMA)
  '1150858-1-571723': 'insurance_financial_services', // BANISI
  '633197-1-456744': 'insurance_financial_services', // BANISTMO
  '22848-247-447': 'insurance_financial_services', // BANK OF CHINA
  '1485831-1-644680': 'insurance_financial_services', // BBP BANK
  '407361-1-425412': 'insurance_financial_services', // BCT BANK INTERNATIONAL
  '22662-74-202470': 'insurance_financial_services', // BG VALORES
  '155607105-2-2015': 'insurance_financial_services', // BI BANK
  '37343-13-267054': 'insurance_financial_services', // BICSA FACTORING
  '2482442-1-816457': 'insurance_financial_services', // CANAL BANK
  '39-35-5021': 'insurance_financial_services', // CITIBANK N.A.
  '2-221-78': 'insurance_financial_services', // COMPAÑIA INTERNACIONAL DE SEGUROS
  '1069895-1-551842': 'insurance_financial_services', // CORPORACION DE FINANZAS DEL PAIS
  '37405-45-267330': 'insurance_financial_services', // CREDICORP BANK
  '15941-114-152468': 'insurance_financial_services', // FINANCIERA EL SOL
  '52280-112-324028': 'insurance_financial_services', // FONDO GENERAL DE INVERSIONES
  '8837-47-91080': 'insurance_financial_services', // GENERAL DE SEGUROS
  '40979-25-281810': 'insurance_financial_services', // GLOBAL BANK
  '822-415-143050': 'insurance_financial_services', // GRUPO ASSA
  '44055-45-293941': 'insurance_financial_services', // HIPOTECARIA METRO CREDIT
  '155693110-2-2020': 'insurance_financial_services', // INDUSTRIAL AND COMMERCIAL BANK OF CHINA
  '818-54-140438': 'insurance_financial_services', // KEB HANA BANK
  '155679802-2-2019': 'insurance_financial_services', // LIBERTY IBEROAMERICA (seguros)
  '967-422-107010': 'insurance_financial_services', // MEGA INTERNATIONAL COMMERCIAL BANK
  '785-502-17249': 'insurance_financial_services', // MERCANTIL BANCO
  '2492633-1-817803': 'insurance_financial_services', // MERCANTIL SEGUROS Y REASEGUROS
  '32330-72-247193': 'insurance_financial_services', // METROBANK
  '380693-1-421669': 'insurance_financial_services', // MMG BANK
  '1804451-1-705978': 'insurance_financial_services', // MULTIBANK SEGUROS
  '1410685-1-629823': 'insurance_financial_services', // PRIVAL BANK
  '276745-1-406809': 'insurance_financial_services', // ST GEORGES BANK
  '1031-503-116426': 'insurance_financial_services', // THE BANK OF NOVA SCOTIA
  '828-314-151242': 'insurance_financial_services', // TOWERBANK INTERNATIONAL
  '1808926-1-706842': 'insurance_financial_services', // UNIBANK
  '910364-1-516959': 'insurance_financial_services', // WORLDWIDE MEDICAL ASSURANCE
  '2289840-1-788330': 'property_construction', // AVANZALIA PANAMA
  '1513069-1-650069': 'property_construction', // CITY MALL
  '2486790-1-817030': 'property_construction', // COSTA DEL ESTE TOWN CENTER GROUP
  '273003-1-406331': 'property_construction', // DESARROLLO INMOBILIARIO DEL ESTE
  '1067-293-110051': 'property_construction', // INGENIERIA R M
  '541-81-118009': 'property_construction', // INMOBILIARIA DON ANTONIO
  '1058454-1-549254': 'property_construction', // LONDON & REGIONAL PANAMA
  '1004233-1-536712': 'property_construction', // PROMOTORA CASAS PACIFICAS
  '2327456-1-793996': 'property_construction', // PROMOTORA PANAMA ESTE
  '65488-83-361353': 'property_construction', // PUNTO EN EL PACIFICO DEVELOPMENT
  '2138695-1-763344': 'property_construction', // SHORELINE PROPERTIES
  '572-1-118040': 'property_construction', // SOCIEDAD URBANIZADORA DEL CARIBE
  '1281233-1-600583': 'property_construction', // URBALIA PANAMA
  '1188278-1-579588': 'property_construction', // URBAN DEVELOPMENTS PANAMA
  '15430-249-148718': 'retail', // ACE INTERNATIONAL HARDWARE
  '41883-11-285650': 'retail', // ADIDAS LATIN AMERICA
  '585-499-122386': 'retail', // AGENCIAS BENEDICTO WONG
  '2506356-1-819710': 'retail', // AMERICAN DESIGNER FASHION
  '21154-184-190522': 'retail', // AMERICAN SPORTSWEAR
  '49-572-8631': 'retail', // C.G. DE HASETH & CIA
  '25680-2-219880': 'retail', // CENTRO TEXTIL INTERNACIONAL ZL
  '521-136-113133': 'retail', // COCHEZ Y COMPAÑIA
  '256-148-57138': 'retail', // COMPAÑIA ASTOR
  '2403790-1-2258': 'retail', // COMPAÑIA UNIVERSAL DE PERFUMERIA FRANCESA (CUPFSA)
  '311-77-66961': 'retail', // DISTRIBUIDORA COMERCIAL GROUP
  '1799070-1-705065': 'retail', // DUTY FREE AMERICAS BUYING GROUP
  '36628-92-264200': 'retail', // DUTY FREE DE PANAMA
  '28624-58-232182': 'retail', // ELBROS INTERNACIONAL
  '346-266-76470': 'retail', // FARMACIA ARROCHA
  '441-74-94389': 'retail', // FELIPE MOTTA
  '241019-1-401594': 'retail', // FOREIGN IMPORTS
  '138-289-35920': 'retail', // GEO F NOVEY (ferreterías Novey)
  '533-555-116945': 'retail', // H TZANETATOS (distribuidor)
  '19846-158-180655': 'retail', // IMPORTADORA AMIGO
  '798-1-121512': 'retail', // IMPORTADORA EL TRIUNFO
  '4959-138-63553': 'retail', // INTRATEX
  '421300-1-427416': 'retail', // JEANCENTER CORPORATION
  '6490-23-74806': 'retail', // LG ELECTRONICS PANAMA
  '280-379-7165': 'retail', // MAY'S ZONA LIBRE
  '267-110-58681': 'retail', // MOTTA INTERNACIONAL
  '66159-91-363381': 'retail', // PANAFOTO
  '418051-1-426972': 'retail', // PANASONIC LATIN AMERICA FREE ZONE
  '898-241-102416': 'retail', // PRICESMART PANAMA
  '490-599-105160': 'retail', // REPRICO
  '342-240-75526': 'retail', // RIBA SMITH
  '22011-105-197271': 'retail', // SAMSUNG ELECTRONICS (Zona Libre)
  '557-538-101617': 'retail', // SISTEMAS MCOPCO (McDonald's Panamá)
  '155602452-2-2015': 'retail', // SKECHERS LATIN AMERICA
  '722-40-141442': 'retail', // SONY INTER AMERICAN
  '56325-2-335841': 'retail', // TOP BRANDS INTERNACIONAL
  '584318-1-448733': 'retail', // UETA LATINOAMERICA (duty free)
  '637705-1-457465': 'retail', // ULTRASPORTS INTERNACIONAL
  '674-77-109176': 'retail', // VENTAS Y MERCADEO
  '2679372-1-844914': 'technology', // DELIVERY HERO PANAMA (PedidosYa)
  '421583-1-294': 'technology', // DELL PANAMA
  '985987-1-533212': 'technology', // DIGICEL PANAMA
  '959966-1-527728': 'technology', // DISTRIBUIDORA TELEFONICA
  '47028-19-305805': 'technology', // GRUPO DE COMUNICACIONES DIGITALES
  '155668970-2-2018': 'technology', // HIKVISION PANAMA COMMERCIAL
  '2599632-1-2461': 'technology', // HP PANAMA SALES AND DISTRIBUTION
  '1346970-1-616307': 'technology', // SBA TORRES PANAMA
  '30387-20-238537': 'technology', // TELERED
  '153843-1-386483': 'technology', // UFINET PANAMA
  '456104-1-432290': 'transport_logistics', // AEROPUERTO INTERNACIONAL DE TOCUMEN
  '45829-2-301465': 'transport_logistics', // COLON CONTAINER TERMINAL
  '130-377-34706': 'transport_logistics', // COPA AIRLINES
  '21742-173-195073': 'transport_logistics', // DHL AERO EXPRESO
  '2162734-1-767262': 'transport_logistics', // ENA NORTE (autopista)
  '45408-55-299957': 'transport_logistics', // ENA SUR (autopista)
  '243736-1-402080': 'transport_logistics', // GLOBAL PRODUCTS AND LOGISTIC SERVICES
  '42169-52-286856': 'transport_logistics', // MANZANILLO INTERNATIONAL TERMINAL
  '155672233-2-2018': 'transport_logistics', // MAR DEL SUR LOGISTICA
  '54622-37-810': 'transport_logistics', // PANAMA CANAL RAILWAY COMPANY
  '50940-2-319669': 'transport_logistics', // PANAMA PORTS COMPANY
  '1156957-1-573025': 'transport_logistics', // PSA PANAMA INTERNATIONAL TERMINAL
  '53286-102-327332': 'transport_logistics', // SAAM TOWAGE PANAMA
  '1818454-1-708570': 'transport_logistics', // TRANSPORTE MASIVO DE PANAMA (MiBus)
  '1910501-1-724391': 'transport_logistics', // VOPAK PANAMA ATLANTIC (terminal)
});

/** Macro de un Gran Contribuyente por su RUC, o `null`. */
export function resolvePaLargeTaxpayerMacro(ruc: string | null | undefined): MacroIndustryKey | null {
  if (typeof ruc !== 'string') return null;
  return PA_LARGE_TAXPAYER_MACRO[ruc.trim()] ?? null;
}

/** ¿Tiene esta macro algún Gran Contribuyente clasificado? */
export function macroHasPaLargeTaxpayerCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return Object.values(PA_LARGE_TAXPAYER_MACRO).includes(macroIndustryKey as MacroIndustryKey);
}
