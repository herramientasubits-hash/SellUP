/**
 * sv-large-taxpayer-macro-table.ts — macro industria (y web) de los Grandes
 * Contribuyentes de El Salvador que NO venden al Estado, por NIT.
 *
 * SOURCES-SV-LARGE-TAXPAYERS-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * La lista de Grandes Contribuyentes de la DGII (15-01-2019) trae NIT y razón
 * social, sin actividad. Sólo 87 de sus 947 sociedades venden al Estado (COMPRASAL)
 * y por eso tienen industria; las otras 860 no se ofrecían en la capa gratuita.
 * Esta tabla, una fila por NIT, la armó Claude el 08-10-2026 con la razón social, lo
 * que se sabe de cada empresa y, cuando su web sale de su nombre (88 de 860, la
 * página la nombra), lo que dice su portada. Igual que la de Panamá: APROBADA por la
 * dueña el 08-10-2026 («apruebo la tabla»). Cambiarla es una decisión de producto.
 *
 * Sin macro, a propósito, los que no se pueden clasificar con seguridad (holdings,
 * «Inversiones X», siglas opacas) y los que no tienen macro en el catálogo
 * (hoteles, restaurantes, medios, universidades, iglesias, fundaciones). Son 279:
 *
 *   06140506011033 A L S
 *   12171509881019 ABDALA MILIAN
 *   06142211901048 AGENTES DE EL SALVADOR
 *   06140110660010 AGEPYM
 *   06142206041022 ALIMENTOS LISTOS
 *   06140705011069 ALIMENTOS MOVILES
 *   06141503001033 ALIMENTOS PRACTICOS
 *   06142704850023 ALIMENTOS Y TURISMO
 *   06142910081021 ALMAPA
 *   06140311051065 ASOC COMUNITARIA UNIDA POR EL AGUA Y LA AGRICULTURA
 *   06141703860034 ASOC TELETON PRO REHABILITACION
 *   02103101031013 ASOCIACION ECOLOGICA DE LOS MUNICIPIOS DE SANTA ANA
 *   06142008971073 ASOCIACION H P H EL SALVADOR
 *   06140907740020 ASOCIACION NACIONAL DE EL SALVADOR DE LA ORDEN DE MALTA
 *   06142008031062 ASOCIACION SALVADORENA DE ADMINISTRADORAS DE FONDO DE PENSIONES
 *   06142506700010 ASOCIACION SALVADORENA EMPRESAS DE SEGUROS
 *   06141002640017 AVINSA
 *   06141401061015 AVIOTRADE
 *   06142709650012 B E M I S A L
 *   02102006790012 BAN BAN
 *   06141811941055 BIANCHI Y ASOCIADOS
 *   12172007951010 BIENES Y CAPITAL
 *   06141703710012 BORGONOVO POHL
 *   94502402991015 C G
 *   06140712780016 CAMA
 *   06141803650013 CANAL DOS
 *   06142904710014 CANAL SEIS
 *   06110311041012 CARIBE HOSPITALITY EL SALVADOR
 *   06140204131013 CARIBE TERRANUM EL SALVADOR
 *   06142302780014 CEMENTERIO JARDIN DIEGO DE HOLGUIN
 *   06141310870010 CENDUL
 *   06140310061075 CENTRAL AMERICANA DE DISTRIBUCION
 *   06142307091063 CENTROAMERICA COMERCIAL
 *   06141811710088 CETYA
 *   06142810911035 CHERRY
 *   06141909550014 CIA HOTELERA SALVADORENA
 *   06141107971020 CINEMARK EL SALVADOR
 *   06141208051061 CINEPOLIS EL SALVADOR
 *   06143008730014 CLUB SALINITAS
 *   06143103810029 CO AEAS
 *   06141405971083 COATS EL SALVADOR
 *   06142804881043 COCINA DE VUELOS
 *   05112103131015 COMCYR
 *   06140605111023 COMERCIA INTERNACIONAL EL SALVADOR
 *   06142008011037 COMERCIALIZADORA INTERAMERICANA
 *   12171412051020 COMERCIALIZADORA VASQUEZ PORTILLO
 *   06140807041019 COMIDAS ORIENTALES
 *   94501306971015 COMPASSION INTERNATIONAL
 *   06140411881014 CONDUSAL
 *   06141411500030 CONFERENCIA EVANGELICA DE LAS ASAMBLEAS DE DIOS
 *   06141702161074 CORFRUT
 *   06141211041042 CORPAN
 *   06142809981046 CORPORACION CME
 *   06141106580025 CORPORACION COLEGIO EL ESPIRITU SANTO
 *   06142306031016 CORPORACION G E B
 *   96420209991017 CORPORACION HOTELERA INTERNACIONAL
 *   06140104051063 CORPORACION INTERNACIONAL DE RESTAURANTES Y BARES
 *   06142508071028 CORPORACION JUAREZ
 *   06141205111012 CORPORACION LEMUS
 *   06140903820021 CORPORACION MERCANTIL SALVADORENA
 *   12172409981012 CORPORACION PRIMAVERA
 *   06141801171090 CORPORACION TAMARINDO
 *   06142201981035 CORTEN
 *   94500202901019 CREATIVE ASSOCIATES INTERNATIONAL
 *   06143007091033 CRECE CENTROAMERICA
 *   06141709640019 CUMBRES DE CUSCATLAN
 *   06140911931018 DATUM
 *   06142911071011 DB&GB DE EL SALVADOR
 *   06142904600026 DCASA
 *   06141612061020 DE LA PENA
 *   06140409951030 DE LA ROCA
 *   06140402051084 DESARROLLO UNIVERSAL
 *   06140511101075 DESARROLLOS CULTURALES SALVADORENOS
 *   06141308081030 DIALCA
 *   02101809921016 DICOBRA
 *   04071607051010 DIHARE
 *   06142808151031 DISMA
 *   06141507881062 DISTRIBUCIONES DIVERSAS
 *   06141911031048 DISTRIBUIDORA AGELSA
 *   06142401131010 DISTRIBUIDORA APS EL SALVADOR
 *   05112410740017 DISTRIBUIDORA CUSCATLAN
 *   06143009971057 DISTRIBUIDORA DEL CARIBE
 *   06142908640018 DISTRIBUIDORA DLF ESQUIVEL
 *   06143011931011 DISTRIBUIDORA GRANADA
 *   06140607921022 DISTRIBUIDORA JAR
 *   94502408810019 DISTRIBUIDORA NACIONAL
 *   06141409840027 DISTRIBUIDORA PRIETO
 *   06142501071049 DISTRIBUIDORA SALVADORENA
 *   06141603991065 DISTRIBUIDORA SUADISA
 *   06140304971027 DISTRIBUIDORA SULA
 *   12171512111011 DISTRIBUIDORA UMANZOR
 *   06141406790025 DISTRIBUIDORA UNIDA INDUSTRIAL
 *   06140611750031 DIZAC
 *   06140909111054 DON POLLO
 *   06140108131037 DRIFAM
 *   06141007011053 DUENAS HERMANOS
 *   06140310350015 DUTRIZ HERMANOS
 *   06141206680017 E ALLWOOD
 *   06141904051041 E INVERSIONES
 *   96422208881016 EAGLE RIVER ENTERPRISES
 *   06141709041031 ECONORED EL SALVADOR
 *   06141403161033 ECSA OPERADORA EL SALVADOR
 *   06142311570010 EDITORIAL ALTAMIRANO MADRIZ
 *   06142803961035 EDITORIAL SANTILLANA
 *   06141909911065 EDT EL SALVADOR
 *   06140408850014 EL BORBOLLON
 *   06141002041060 EL IMPERIO USA
 *   05112308101011 EL NUEVO MILAGRO
 *   06141903021033 ELECTRO GLOBAL
 *   06140901670019 EMPRESAS PALOMO
 *   06142708620024 ESTABLECIMIENTOS ANCALMO
 *   06142411971024 EXCELENTES SERVICIOS A LOS TRANSPORTISTAS
 *   06142306121015 EXPECOVE
 *   06142101051057 FAM
 *   06142811021041 FRANESIS
 *   06143005071035 FRANQUICIAS INTERNACIONALES
 *   06141807051010 FRIOAIRE
 *   06140312921063 FRUTERIA VIDAURRI
 *   11210410951017 FUNDACION CAMPO
 *   06140204031060 FUNDACION CEA
 *   94501810850017 FUNDACION DUENAS HERRERA
 *   06142310700012 FUNDACION ESCOLAR BRITANICO SALVADORENA
 *   06142212041034 FUNDACION GLORIA DE KRIETE
 *   06142209891060 FUNDACION PARA EL DESARROLLO DE LA MUJER SALVADORENA
 *   06142208081056 FUNDACION PARA LA EDUCACION SOCIAL ECONOMICO Y CULTURAL
 *   06142603841019 FUNDACION POMA
 *   06140904991056 FUNDACION PROMOTORA DE LA COMPETITIVIDAD DE LA MICRO Y PEQUENA EMPRESA
 *   06142009670026 GASTEAZORO HERMANOS
 *   06142001540014 GIBSON Y CIA SUCESORES
 *   06142904520018 GMG SERVICIOS EL SALVADOR
 *   06141108891011 GONRI
 *   06141708071034 GRUPO ENTU SIASMO
 *   06142409151044 GRUPO ESCOBAR DUARTE EMANUEL
 *   94502204081011 GRUPO GATUN INTERNACIONAL
 *   06141911921060 GRUPO MALLO
 *   06142708101053 GRUPO NSV
 *   06140804161013 GRUPO ROMEN
 *   06141608111039 GRUPO SANTA SOFIA
 *   06142806830013 HASGAL
 *   06141106660010 HENRIQUEZ
 *   06142604931011 HERMEL
 *   06081712710012 HERNANDEZ HERMANOS
 *   06142301690017 HOTELES
 *   06141701951012 HOTELES E INVERSIONES
 *   06142704921030 HOTELES Y DESARROLLOS
 *   94501111031034 IBT
 *   06141501760028 IGLESIA DEL DIOS VIVO COLUMNA Y APOYO DE LA VERDAD LA LUZ DEL MUNDO
 *   06143006630016 INDUSTRIAS CONSOLIDADAS
 *   06140403891027 INDUSTRIAS KAWAKI
 *   06140307981104 INDUSTRIAS SAN CHIA
 *   06141503560018 INDUSTRIAS TOPAZ
 *   06141912971087 INSTITUTO TECNOLOGICO ESCUELA TECNICA PARA LA SALUD
 *   06141006021012 INTER TRADE
 *   05111005031014 INVERSIONES BACHI
 *   06141406600017 INVERSIONES BOLIVAR
 *   06142908021011 INVERSIONES BONILLA RIVERA
 *   06141705790011 INVERSIONES CALMA
 *   12173101051010 INVERSIONES CARDUMEN
 *   06140102021043 INVERSIONES GIBRALTAR
 *   06141407001014 INVERSIONES LEMUS
 *   06142303011057 INVERSIONES M J
 *   06140304981049 INVERSIONES MASDEL
 *   06140801011010 INVERSIONES MENDEZ RUGAMAS
 *   06142810740023 INVERSIONES MONTECARLO
 *   06142604071063 INVERSIONES RAMIREZ QUINTANILLA
 *   12172004931018 INVERSIONES RIO GRANDE
 *   06141512710017 INVERSIONES ROBLE
 *   03010205021015 INVERSIONES SERVYGRAN
 *   12171109921011 INVERSIONES SINAI
 *   06141411161050 INVERSIONES TRES CINCO Y SIETE
 *   06141412921024 INVERSIONES VIDA
 *   06140507061018 INVERSIONES Y PROYECTOS CUSCATLAN
 *   06141912670011 INVERSIONES Y SERVICIOS
 *   06141710570017 J HILL
 *   06142504941010 JOMIGA
 *   06011411901010 KOORMAOS
 *   06141310141024 LA CHIRIMIA
 *   06142311770034 LA PIRAMIDE
 *   06142710600010 LA SULTANA
 *   06142407001010 LABOR
 *   06140708021014 LAS CASCADAS MULTISERVICIOS
 *   06140806041031 LEMPA SERVICES
 *   06142402971011 LINARES HERMANOS
 *   06140101810017 LIVSMART AMERICAS
 *   06140705640014 LIZA
 *   06140610860023 LOS TEQUES
 *   05011401161015 LOYALTY CO
 *   06142209901014 LTJ EL SALVADOR
 *   06142708921115 M I C O M I
 *   06143004091016 MANUFACTURA SUMINISTRO Y DISTRIBUCION
 *   06141603041032 MARE
 *   06142407961014 MEDINA
 *   06142309921020 MEDRANO FLORES
 *   06141106921010 MERCANTIL DE COMERCIO DE EL SALVADOR
 *   06142110941022 MONTEALBAN
 *   06142709121066 MORALES MORALES
 *   06142707061023 MOVIKAL
 *   06142502911024 MULTIMERCANTIL
 *   06142105991062 NEGOCIOS ASOCIADOS
 *   06142208131045 NEW COM LIVE EL SALVADOR
 *   06141311141036 OBSIDIANA
 *   06140410021038 ORIGEM
 *   06140903770017 ORION
 *   06140501350010 OVIDIO J VIDES
 *   06141206021050 P C SERVICIOS
 *   06142411001068 PILOTOS DE TACA
 *   06142703780037 PINTURA Y ENDEREZADO
 *   06140412951091 POLLO CAMPESTRE
 *   06140605971014 PRO DEPT EL SAL
 *   06142301780018 PRODMIN
 *   06142209580021 PRODUCTOS ATLAS
 *   06141504911068 PROYECTOS E INVERSIONES
 *   06140409001015 PUNTUAL
 *   06141206091015 QUEDAN EXPRESS
 *   06141203041017 R&M
 *   06141909001034 RAMIREZ VENTURA
 *   06141204840017 RECINOS SCHONBORN
 *   06140207870010 REFLEX
 *   06141605750027 REGPA
 *   06142312860043 REKNIR
 *   06142808810017 RIMAR
 *   02100409220017 RIO ZARCO
 *   94831009011010 ROBERTO DUENAS
 *   06142806001040 ROBKELL
 *   06142610770019 ROMALAR
 *   06141606840012 RUA
 *   06141601870014 S CLEANS
 *   06141106921053 SAN CRESPIN
 *   06141510860012 SAN ESTEBAN
 *   06142910640026 SARAM
 *   12171908991014 SARAVIA BONILLA
 *   06142105670017 SAVONA
 *   06140703780015 SEIS
 *   06140203981013 SERTRACEN
 *   06142605971068 SERVAMATIC
 *   06140802740020 SERVICIOS DE ALIMENTOS
 *   06140604951036 SERVICIOS EMPRESARIALES
 *   06142405911010 SERVICIOS SANTA ELENA
 *   12172012041013 SERVIPA
 *   06141703690013 SIGMA
 *   05111108001016 SINGUIL
 *   06140802740032 SISTEMAS COMESTIBLES
 *   06142709061020 SOLUCIONES Y HERRAMIENTAS
 *   96422011061033 STAR LAND GROUP COMMERCE
 *   06140409670019 STEINER
 *   94982006131013 SUBWAY INTERNATIONAL
 *   06140701690011 SUCESORES LUIS TORRES
 *   05112105901012 SUMER
 *   06141206021041 SUMINISTROS DE RESTAURANTES
 *   06143011881138 SUPER PROMOTORA
 *   06141309101051 SW INVERSIONES INTERNACIONALES DE ALIMENTOS
 *   06142403870021 TA TUNG
 *   05010512081014 TECHNICAL AND TRAINING SERVICES
 *   06140212810019 TECNICOS ASOCIADOS
 *   06140207991021 TELECOMODA
 *   06142607991058 TERMOS DEL RIO
 *   06141601031021 TOBAR
 *   06142405850025 TOTO
 *   06142807810010 TRANVA
 *   06142509021024 TRES MONTANAS
 *   02102802001015 UNBOUND
 *   06141808001092 UNICOSERVI
 *   06141606921025 UNION DE EXPORTADORES
 *   06142711901010 UNION DISTRIBUIDORA INTERNACIONAL
 *   06142508991046 UNISERFA
 *   06141509650017 UNIVERSIDAD CENTROAMERICANA JOSE SIMEON CANAS
 *   12173110810022 UNIVERSIDAD DE ORIENTE
 *   06142012901055 UNIVERSIDAD DOCTOR ANDRES BELLO
 *   06141509770011 UNIVERSIDAD DR JOSE MATIAS DELGADO
 *   06141701810015 UNIVERSIDAD EVANGELICA DE EL SALVADOR
 *   06140703810032 UNIVERSIDAD FRANCISCO GAVIDIA
 *   06142607820032 UNIVERSIDAD MODULAR ABIERTA
 *   06141706800012 UNIVERSIDAD SALVADORENA ALBERTO MASFERRER
 *   06142005810012 UNIVERSIDAD TECNOLOGICA DE EL SALVADOR
 *   06142903081016 VARIEDADES GENESIS
 *   01011405061010 VIDALES LARRANAGA
 *   06142403071030 VISOR
 *   06143003041015 YLUFA
 *   06140506720010 YSU TV CANAL 4
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';

export const SV_LARGE_TAXPAYER_MACRO_TABLE_VERSION = 'sv-dgii-large-taxpayer-macro-v1' as const;

/** ¿Aprobó la dueña la tabla? Si no, la carga de la capa gratuita se niega. */
export const SV_LARGE_TAXPAYER_MACRO_TABLE_APPROVED: boolean = true;

/** NIT → [macro, web comprobada o null]. */
export const SV_LARGE_TAXPAYER_TABLE: Readonly<Record<string, readonly [MacroIndustryKey, string | null]>> = Object.freeze({
  '05010709151014': ['agroindustry', null], // ADM EL SALVADOR
  '06142507530019': ['agroindustry', null], // AGRICOLA INDUSTRIAL SALVADORENA
  '06142909161020': ['agroindustry', null], // AGROINDUSTRIALES SAN JOSE
  '06141501850042': ['agroindustry', null], // AGROINDUSTRIAS SAN JULIAN
  '06140311991017': ['agroindustry', null], // AGROQUIMICA INTERNACIONAL
  '06142106041025': ['agroindustry', null], // AGROSALVA
  '06141710750019': ['agroindustry', null], // ARROCERA SAN FRANCISCO
  '08192503820019': ['agroindustry', null], // ASOC COOP DE PRODUCCION AGROPECUARIA SANTA RITA
  '12172705981028': ['agroindustry', null], // AVICOLA CAMPESTRE
  '06141305710012': ['agroindustry', null], // AVICOLA SALVADORENA
  '06141112750024': ['agroindustry', null], // AVICOLA SAN BENITO
  '06141403071042': ['agroindustry', null], // CAFETALERA DEL PACIFICO
  '06142609001047': ['agroindustry', null], // CALVOPESCA EL SALVADOR
  '06140910901034': ['agroindustry', null], // COAGRI
  '06142306750016': ['agroindustry', 'comercialexportadora.com.sv'], // COMERCIAL EXPORTADORA
  '06142202640012': ['agroindustry', null], // COMPANIA AZUCARERA SALVADORENA
  '06141605031093': ['agroindustry', null], // CORPORACION DE COMPANIAS AGROINDUSTRIALES DE EL SALVADOR
  '06141508750016': ['agroindustry', null], // CRIAVES
  '06141511901043': ['agroindustry', null], // DUWEST EL SALVADOR
  '06140101680020': ['agroindustry', null], // EL GRANJERO
  '06142110961015': ['agroindustry', null], // EXPORTADORA DE PLANTAS ORNAMENTALES
  '06142710921068': ['agroindustry', null], // EXPORTADORA RIO GRANDE
  '06140911610019': ['agroindustry', null], // FERTILIZANTES DE C A EL SALVADOR
  '06142812740014': ['agroindustry', null], // GRANJA CATALANA
  '02101203640012': ['agroindustry', null], // IMPLEMENTOS AGRICOLAS CENTROAMERICANOS
  '06140202051039': ['agroindustry', null], // IMPORTACIONES PECUARIAS R SACA
  '06141810951022': ['agroindustry', null], // INGENIO CENTRAL AZUCARERO JIBOA
  '06142303951041': ['agroindustry', null], // INGENIO CHAPARRASTIQUE
  '06140611710010': ['agroindustry', null], // INGENIO EL ANGEL
  '06142303951033': ['agroindustry', null], // INGENIO LA CABANA
  '06140711941019': ['agroindustry', null], // INGENIO LA MAGDALENA
  '06141309941025': ['agroindustry', null], // PLANTA DE TORREFACCION DE CAFE
  '06140505981012': ['agroindustry', null], // SERVICIOS TECNICOS AVICOLAS
  '02033110660019': ['agroindustry', null], // SOC COOP CHALCHUAPANECA DE PRODUCTORES DE CAFE CUZCACHAPA
  '06142307860012': ['agroindustry', null], // TECNICA EN NUTRICION ANIMAL
  '05110807031013': ['consumer_goods', 'alasdoradas.com'], // ALAS DORADAS
  '94833007031025': ['consumer_goods', null], // ALIMENTOS IMPORTADOS SUPERIORES DE EL SALVADOR
  '06142302770010': ['consumer_goods', null], // ALPINA
  '06140411941017': ['consumer_goods', 'amway.com.sv'], // AMWAY EL SALVADOR
  '06140602081093': ['consumer_goods', null], // ARABELA EL SALVADOR
  '06140602031045': ['consumer_goods', null], // BELCORP EL SALVADOR
  '06141610921080': ['consumer_goods', null], // BIMBO DE EL SALVADOR
  '06171306750017': ['consumer_goods', null], // BLANQUEADORES Y DESINFECTANTES
  '06140112031020': ['consumer_goods', null], // CALVO DISTRIBUCION EL SALVADOR
  '06143003011043': ['consumer_goods', null], // CALVOCONSERVAS EL SALVADOR
  '94832906630018': ['consumer_goods', null], // CENTRAL PRODUCTOS ALIMENTICIOS UNIVERSAL
  '94502809550010': ['consumer_goods', null], // COLGATE PALMOLIVE CENTRAL AMERICA
  '06142511041016': ['consumer_goods', null], // COMERCIAL POZUELO EL SALVADOR
  '06141403031016': ['consumer_goods', 'crio.com.sv'], // CRIO INVERSIONES
  '06140811061040': ['consumer_goods', 'dietco.com.sv'], // DIETCO
  '06140107041034': ['consumer_goods', 'dinant.com'], // DINANT DE EL SALVADOR
  '06141308021011': ['consumer_goods', null], // DISTRIBUIDORA DE ALIMENTOS SALUDABLES
  '06142111891010': ['consumer_goods', null], // DISTRIBUIDORA DE AZUCAR Y DERIVADOS
  '06140609840012': ['consumer_goods', 'distribuidoraeuropea.com'], // DISTRIBUIDORA EUROPEA
  '06142908941021': ['consumer_goods', null], // DISTRIBUIDORA INTERAMERICANA DE ALIMENTOS
  '06142710101036': ['consumer_goods', 'distribuidoramorazan.com'], // DISTRIBUIDORA MORAZAN
  '05111112690013': ['consumer_goods', null], // DISTRIBUIDORA ZABLAH
  '06140306640018': ['consumer_goods', null], // DISTRIBUIDORES RENA WARE
  '06140212051010': ['consumer_goods', null], // ECO FOODS
  '06142609470012': ['consumer_goods', null], // EMBOTELLADORA LA CASCADA
  '06142403810012': ['consumer_goods', null], // EMBUTIDOS DE EL SALVADOR
  '06142001880019': ['consumer_goods', null], // HARISA
  '94832404991012': ['consumer_goods', null], // HELADOS SARITA
  '06140702971037': ['consumer_goods', null], // IMPORTADORA DE FRUTAS
  '06142205981021': ['consumer_goods', null], // INDUSTRIAS ALIMENTICIAS KERNS DE EL SALVADOR
  '06141308041012': ['consumer_goods', null], // JUMEX CENTROAMERICANA
  '06142906001021': ['consumer_goods', null], // KELLOGG EL SALVADOR
  '05110307630018': ['consumer_goods', null], // KIMBERLY CLARK DE CENTROAMERICA
  '06142510021011': ['consumer_goods', 'laconstancia.com'], // LA CONSTANCIA
  '06142211470028': ['consumer_goods', null], // LA FABRIL DE ACEITES
  '06140902840024': ['consumer_goods', null], // LACTEOS DEL CORRAL
  '06141605530027': ['consumer_goods', null], // LIDO
  '94832506901018': ['consumer_goods', null], // LOREAL GUATEMALA
  '06143003011035': ['consumer_goods', null], // LUIS CALVO SANZ EL SALVADOR
  '06140212680010': ['consumer_goods', null], // MCCORMICK DE CENTROAMERICA
  '06142401830020': ['consumer_goods', 'melher.com'], // MELHER
  '06142104590014': ['consumer_goods', null], // MOLINOS DE EL SALVADOR
  '06140906941110': ['consumer_goods', null], // MONDELEZ EL SALVADOR
  '06143009041084': ['consumer_goods', null], // NATURACEITES
  '06142810540010': ['consumer_goods', null], // NESTLE EL SALVADOR
  '06140711001024': ['consumer_goods', 'portal.omnilife.com'], // OMNILIFE EL SALVADOR
  '06142308041043': ['consumer_goods', 'pangenesis.com.sv'], // PAN GENESIS
  '06140401001016': ['consumer_goods', null], // PANADERIA EL ROSARIO
  '05110902941019': ['consumer_goods', null], // PANADERIA TECLENA
  '06143105760017': ['consumer_goods', null], // PHILIP MORRIS EL SALVADOR
  '06142603011113': ['consumer_goods', 'pimi.com.sv'], // PIMI
  '06141606161047': ['consumer_goods', null], // PRODUCTOS AGROALIMENTICIOS
  '06142101931049': ['consumer_goods', null], // PRODUCTOS ALIMENTICIOS BOCADELI
  '06143112690013': ['consumer_goods', null], // PRODUCTOS ALIMENTICIOS DIANA
  '06142006670015': ['consumer_goods', null], // PRODUCTOS ALIMENTICIOS SELLO DE ORO
  '06141011780023': ['consumer_goods', null], // PRODUCTOS AVON
  '06141210830014': ['consumer_goods', null], // PRODUCTOS CARNICOS
  '06140803830016': ['consumer_goods', 'quimicasconsolidadas.com'], // QUIMICAS CONSOLIDADAS
  '96422506991010': ['consumer_goods', null], // RED RIBBON HOLDINGS
  '06140811730039': ['consumer_goods', 'robertoni.com.sv'], // ROBERTONI
  '06142409760031': ['consumer_goods', 'sabores.com.sv'], // SABORES COSCO DE CENTROAMERICA
  '06140906941056': ['consumer_goods', null], // SABRITAS
  '06140507161055': ['consumer_goods', null], // SALVADORENA DE ALIMENTOS
  '06143108901028': ['consumer_goods', null], // SPECIALTY FOODS
  '06141612620014': ['consumer_goods', null], // UNILEVER DE CENTROAMERICA
  '06142910131029': ['consumer_goods', null], // UNILEVER EL SALVADOR SCC
  '02101207920015': ['energy_mining_environment', null], // AES CLESA
  '06141002981046': ['energy_mining_environment', null], // AES DISTRIBUIDORES SALVADORENOS
  '06142607001066': ['energy_mining_environment', null], // AES EMPRESA ELECTRICA DE ELSALVADOR
  '06140504061033': ['energy_mining_environment', null], // ALBA PETROLEOS DE EL SALVADOR
  '06143006991022': ['energy_mining_environment', null], // AMERICAN PETROLEUM DE EL SALVADOR
  '06141605031034': ['energy_mining_environment', null], // AUTO GAS
  '06140103660011': ['energy_mining_environment', null], // CHEVRON LUBRICANT OILS
  '06141711900013': ['energy_mining_environment', null], // CIA DE ALUMBRADO ELECTRICO DE SAN SALVADOR
  '06142307071020': ['energy_mining_environment', null], // COMBUSTIBLES CUSCATLAN
  '06141609031012': ['energy_mining_environment', null], // COMBUSTIBLES LUBRICANTES Y ALIMENTOS DE EL SALVADOR
  '05112706911015': ['energy_mining_environment', null], // COMBUSTIBLES Y LUBRICANTES
  '06141611941034': ['energy_mining_environment', null], // COMPANIA DE ENERGIA DE CENTROAMERICA
  '06141411071035': ['energy_mining_environment', null], // DISTRIBUCION DE COMBUSTIBLES Y LUBRICANTES Y OTROS SERVICIOS
  '06141611951013': ['energy_mining_environment', null], // DISTRIBUIDORA DE ELECTRICIDAD DEL SUR
  '06142001101022': ['energy_mining_environment', null], // DISTRIBUIDORA DE PRODUCTOS DE PETROLEOS DE EL SALVADOR
  '11232607570010': ['energy_mining_environment', null], // DISTRIBUIDORA ELECTRICA DE USULUTAN
  '02103101971016': ['energy_mining_environment', null], // DISTRIBUIDORA SALVADORENA DE COMBUSTIBLES
  '06140711031055': ['energy_mining_environment', null], // DISTRIBUIDORA SALVADORENA DE PETROLEO
  '06142601061016': ['energy_mining_environment', null], // EMPRESA DISTRIBUIDORA ELECTRICA SALVADORENA
  '06141611951030': ['energy_mining_environment', null], // EMPRESA ELECTRICA DE ORIENTE
  '96421610981012': ['energy_mining_environment', null], // EMPRESA PROPIETARIA DE LA RED
  '06143010021046': ['energy_mining_environment', null], // ENERGIA BOREALIS
  '06140911121032': ['energy_mining_environment', null], // ENERGIA DESARROLLO Y CONSULTORIA
  '06140612081075': ['energy_mining_environment', null], // ENERGIA ORGANICA
  '06142402991047': ['energy_mining_environment', null], // ETESAL
  '06140803011034': ['energy_mining_environment', 'excelergy.com.sv'], // EXCELERGY
  '06142701001010': ['energy_mining_environment', null], // GASOLINAS Y LUBRICANTES
  '94500107600014': ['energy_mining_environment', null], // GULFSTREAM PETROLEUM DOMINICANA
  '06141505081018': ['energy_mining_environment', null], // HIDRO OIL
  '06141711011018': ['energy_mining_environment', null], // IMPORTADORA Y DISTRIB DE PRODUCTOS DERIVADOS DEL PETROLEO
  '06142407091028': ['energy_mining_environment', null], // INGENIERIA DE HIDROCARBUROS
  '06141910901049': ['energy_mining_environment', null], // INVERSIONES CHEVRON
  '06143001041018': ['energy_mining_environment', null], // INVERSIONES ENERGETICAS
  '06143107981028': ['energy_mining_environment', null], // LAGEO
  '06140212971020': ['energy_mining_environment', null], // MANEJO INTEGRAL DE DESECHOS SOLIDOS
  '06140106011034': ['energy_mining_environment', null], // MERCADOS ELECTRICOS DE CENTROAMERICA
  '06142904921034': ['energy_mining_environment', null], // METROGAS
  '94501711941018': ['energy_mining_environment', null], // NEJAPA POWER COMPANY
  '06141212021010': ['energy_mining_environment', null], // ORAZUL ENERGY COMERCIALIZADORA DE EL SALVADOR
  '06142506991065': ['energy_mining_environment', null], // ORAZUL ENERGY EL SALVADOR INVESTMENTS N 1
  '06143107981044': ['energy_mining_environment', null], // ORAZUL ENERGY EL SALVADOR SOCIEDAD EN COMANDITA POR ACCIONES
  '06141807121035': ['energy_mining_environment', null], // PETROSERCHS
  '94832909941010': ['energy_mining_environment', null], // POLIWATT
  '06140907141029': ['energy_mining_environment', null], // PROVIDENCIA SOLAR
  '94502707600011': ['energy_mining_environment', null], // PUMA ENERGY BAHAMAS
  '06141912111037': ['energy_mining_environment', null], // RECICLEMOS
  '06142809600020': ['energy_mining_environment', null], // REFINERIA PETROLERA ACAJUTLA
  '06140307951051': ['energy_mining_environment', 'roceli.com'], // ROCELI CONSULTORES
  '06141603991057': ['energy_mining_environment', null], // SERVI ESTACION EL PILAR
  '06143105911022': ['energy_mining_environment', null], // SERVICENTRO RIVERA
  '06141603941017': ['energy_mining_environment', null], // SOCIEDAD HIDROELECTRICA PAPALOATE
  '06140611101021': ['energy_mining_environment', null], // SOCIETE DENERGIE DU SALVADOR
  '06140808630017': ['energy_mining_environment', null], // SOLAIRE
  '06141502961025': ['energy_mining_environment', null], // TERMINALES DE GAS DEL PACIFICO
  '06142210991027': ['energy_mining_environment', null], // TERMOPUERTO
  '02101904820018': ['energy_mining_environment', null], // TOMZA GAS DE EL SALVADOR
  '06142004981074': ['energy_mining_environment', null], // UNIDAD DE TRANSACCIONES
  '06141905991030': ['energy_mining_environment', 'unigas.com.sv'], // UNIGAS DE EL SALVADOR
  '06142110971070': ['energy_mining_environment', null], // ZETA GAS DE EL SALVADOR
  '06142311600013': ['health_pharma', null], // BAYER
  '06140808011024': ['health_pharma', null], // BIOGALENIC
  '06141111941020': ['health_pharma', null], // BIOKEMICAL
  '06140807600017': ['health_pharma', null], // CENTRO GINECOLOGICO
  '06142205101021': ['health_pharma', null], // CENTRO INTERNACIONAL DE CANCER
  '06140312700042': ['health_pharma', null], // COFARSAL
  '06142202630020': ['health_pharma', null], // CORPORACION BONIMA
  '06141007840010': ['health_pharma', null], // DROGUERIA COMERCIAL SALVADORENA
  '06141307921051': ['health_pharma', 'electrolabmedic.com'], // ELECTROLAB MEDIC
  '06141106071025': ['health_pharma', null], // FARMACIAS EUROPEAS
  '06141012470017': ['health_pharma', null], // GLAXOSMITHKLINE EL SALVADOR
  '06142802870016': ['health_pharma', null], // HOSPITAL DE LA MUJER
  '06141505911029': ['health_pharma', null], // INVERSIONES MEDICAS DE ORIENTE
  '06141907991010': ['health_pharma', null], // LABORATORIO DE DIAGNOSTICO ESCALON
  '06142808780037': ['health_pharma', null], // LABORATORIOS LOPEZ
  '06141105810047': ['health_pharma', null], // LABORATORIOS TERAMED
  '06142009850030': ['health_pharma', 'livisto.global'], // LIVISTO
  '06142608770012': ['health_pharma', null], // MEDIDENT
  '06140607941015': ['health_pharma', null], // PRODUCTOS MEDICO FARMACEUTICOS
  '06140903760036': ['health_pharma', null], // SERVICIOS DE SALUD
  '06142410901022': ['industry_manufacturing_chemicals_automotive', null], // 3M EL SALVADOR
  '06141206780012': ['industry_manufacturing_chemicals_automotive', null], // ACERO CENTRO AVILES
  '06141008041029': ['industry_manufacturing_chemicals_automotive', 'albacrome.com'], // ALBACROME
  '06140209630014': ['industry_manufacturing_chemicals_automotive', null], // ALUMINIO DE CENTROAMERICA
  '05012603121011': ['industry_manufacturing_chemicals_automotive', null], // ALUTECH EL SALVADOR
  '06140512101010': ['industry_manufacturing_chemicals_automotive', null], // AMCOR RIGID PLASTICS CENTROAMERICA
  '06141301041076': ['industry_manufacturing_chemicals_automotive', null], // AMCOR RIGID PLASTICS EL SALVADOR
  '06141910071011': ['industry_manufacturing_chemicals_automotive', null], // AMTEX DE EL SALVADOR
  '06141011961015': ['industry_manufacturing_chemicals_automotive', null], // APPLE TREE EL SALVADOR
  '06143108091026': ['industry_manufacturing_chemicals_automotive', null], // APS EL SALVADOR
  '06142002670010': ['industry_manufacturing_chemicals_automotive', null], // ARTES GRAFICAS PUBLICITARIAS
  '06141612051016': ['industry_manufacturing_chemicals_automotive', null], // ASHEBORO ELASTICS CENTRAL AMERICA
  '06143005131038': ['industry_manufacturing_chemicals_automotive', null], // AVERY DENNISON COMMERCIAL EL SALVADOR
  '94503110760017': ['industry_manufacturing_chemicals_automotive', null], // AVX INDUSTRIES PTE
  '06140806041040': ['industry_manufacturing_chemicals_automotive', null], // BALSAMAR MANUFACTURING
  '95042411991012': ['industry_manufacturing_chemicals_automotive', null], // BRAIFORM HK
  '06141502770029': ['industry_manufacturing_chemicals_automotive', 'brenntag.com'], // BRENNTAG EL SALVADOR
  '06141711051010': ['industry_manufacturing_chemicals_automotive', null], // BROOKLYN
  '06140806011035': ['industry_manufacturing_chemicals_automotive', null], // CAJAS INTERNATIONAL
  '06142808001021': ['industry_manufacturing_chemicals_automotive', null], // CAJAS PLEGADIZAS
  '06142708620012': ['industry_manufacturing_chemicals_automotive', null], // CAJAS Y BOLSAS
  '06140107941019': ['industry_manufacturing_chemicals_automotive', null], // CARTONERA CENTROAMERICANA
  '06140306991041': ['industry_manufacturing_chemicals_automotive', 'cartonesa.com.sv'], // CARTONESA
  '06143007911049': ['industry_manufacturing_chemicals_automotive', 'carvajal.com'], // CARVAJAL EMPAQUES
  '06171710720015': ['industry_manufacturing_chemicals_automotive', null], // CELPAC
  '06141104780023': ['industry_manufacturing_chemicals_automotive', null], // COMERCIAL DE PLASTICOS
  '06140102001050': ['industry_manufacturing_chemicals_automotive', null], // COMPRESORES REPUESTOS Y SERVICIOS
  '06140311891012': ['industry_manufacturing_chemicals_automotive', null], // CONDUCEN PHELPS DODGE CENTROAMERICA EL SALVADOR
  '06142112901010': ['industry_manufacturing_chemicals_automotive', null], // CONFECCIONES DEL VALLE
  '06140711921026': ['industry_manufacturing_chemicals_automotive', null], // CONFECCIONES EL PEDREGAL
  '06142311001010': ['industry_manufacturing_chemicals_automotive', null], // CONFECCIONES JIBOA
  '06142801660014': ['industry_manufacturing_chemicals_automotive', null], // CORPORACION INDUSTRIAL CENTROAMERICANA
  '06142006051031': ['industry_manufacturing_chemicals_automotive', null], // DECOTEX INTERNATIONAL
  '06141706091038': ['industry_manufacturing_chemicals_automotive', null], // DISTRIBUIDORA DE PINTURAS Y MATERIALES
  '06142904911012': ['industry_manufacturing_chemicals_automotive', null], // ECOLAB
  '06141606161020': ['industry_manufacturing_chemicals_automotive', null], // EMPAQUES SALVADORENOS
  '06143101041023': ['industry_manufacturing_chemicals_automotive', null], // EMPAQUES Y SABORES
  '06141708620013': ['industry_manufacturing_chemicals_automotive', null], // ENSAMBLADORA SALVADORENA
  '06141906971083': ['industry_manufacturing_chemicals_automotive', null], // EVERGREEN PACKAGING DE EL SALVADOR
  '06142102730015': ['industry_manufacturing_chemicals_automotive', null], // FEILO SYLVANIA EL SALVADOR
  '06141501850054': ['industry_manufacturing_chemicals_automotive', null], // GALVANIZADORA INDUSTRIAL SALVADORENA
  '06142711941011': ['industry_manufacturing_chemicals_automotive', null], // GARAN DE EL SALVADOR
  '06140410051042': ['industry_manufacturing_chemicals_automotive', 'georgecmoore.com'], // GEORGE C MOORE EL SALVADOR
  '06140202091014': ['industry_manufacturing_chemicals_automotive', null], // GILTON TEXTILES
  '06142102971109': ['industry_manufacturing_chemicals_automotive', null], // GTM EL SALVADOR
  '06141102041040': ['industry_manufacturing_chemicals_automotive', null], // H B TRIM EL SALVADOR
  '06141307041027': ['industry_manufacturing_chemicals_automotive', null], // HANDWORKS
  '06142004071043': ['industry_manufacturing_chemicals_automotive', null], // HANESBRANDS EL SALVADOR
  '06143107891037': ['industry_manufacturing_chemicals_automotive', null], // HIERROS Y BRONCES
  '06141512870045': ['industry_manufacturing_chemicals_automotive', null], // HILANDERIAS DE EXPORTACION
  '06140406141010': ['industry_manufacturing_chemicals_automotive', null], // HUSSMANN EL SALVADOR
  '06142808971047': ['industry_manufacturing_chemicals_automotive', 'iberplastic.com'], // IBERPLASTIC
  '06142608911015': ['industry_manufacturing_chemicals_automotive', 'icat.com.sv'], // ICAT
  '06140112921018': ['industry_manufacturing_chemicals_automotive', 'iguanastropicales.com'], // IGUANAS TROPICALES
  '06140903931068': ['industry_manufacturing_chemicals_automotive', 'imfica.com'], // IMFICA
  '06142208921011': ['industry_manufacturing_chemicals_automotive', null], // IMPORT CARS
  '06141012650020': ['industry_manufacturing_chemicals_automotive', 'imprentawilbot.com'], // IMPRENTA WILBOT
  '06142903620017': ['industry_manufacturing_chemicals_automotive', null], // IMPRESORA LA UNION
  '06142002911028': ['industry_manufacturing_chemicals_automotive', null], // INDUSTRIA DE HILOS DE EL SALVADOR
  '06140101840022': ['industry_manufacturing_chemicals_automotive', null], // INDUSTRIAL LA PALMA
  '06143107870069': ['industry_manufacturing_chemicals_automotive', null], // INDUSTRIAL QUIMICA SALVADORENA
  '06141805041026': ['industry_manufacturing_chemicals_automotive', null], // INDUSTRIAL QUIMICA STAR
  '06142510630017': ['industry_manufacturing_chemicals_automotive', 'industriascapri.com'], // INDUSTRIAS CAPRI
  '06141811820015': ['industry_manufacturing_chemicals_automotive', null], // INDUSTRIAS DE FOAM
  '06140702911018': ['industry_manufacturing_chemicals_automotive', null], // INDUSTRIAS FACELA
  '05111609141012': ['industry_manufacturing_chemicals_automotive', null], // INDUSTRIAS LA PALMA
  '06141108800016': ['industry_manufacturing_chemicals_automotive', null], // INDUSTRIAS MERLET
  '06141009650016': ['industry_manufacturing_chemicals_automotive', null], // INDUSTRIAS MIKE MIKE
  '06142504580012': ['industry_manufacturing_chemicals_automotive', null], // INDUSTRIAS PLASTICAS
  '06141409790012': ['industry_manufacturing_chemicals_automotive', null], // INDUSTRIAS ST JACKS
  '06142709550017': ['industry_manufacturing_chemicals_automotive', null], // INDUSTRIAS UNIDAS
  '06142202770023': ['industry_manufacturing_chemicals_automotive', null], // INFRA DE EL SALVADOR
  '06141411061030': ['industry_manufacturing_chemicals_automotive', null], // INTEGRA TEXTILES
  '06142305941019': ['industry_manufacturing_chemicals_automotive', null], // INTRADESA
  '06140703081027': ['industry_manufacturing_chemicals_automotive', null], // INTRADESA DE SAN BARTOLO
  '06142509031011': ['industry_manufacturing_chemicals_automotive', null], // INTRATEXT DE EL SALVADOR
  '06142405941040': ['industry_manufacturing_chemicals_automotive', null], // INVERSIONES TEXTILES MAS
  '06142508111062': ['industry_manufacturing_chemicals_automotive', null], // JMC CROWN EL SALVADOR
  '06141405031021': ['industry_manufacturing_chemicals_automotive', 'sv.kaeser.com'], // KAESER COMPRESORES DE EL SALVADOR
  '06142609021021': ['industry_manufacturing_chemicals_automotive', null], // LABELS
  '06140806041074': ['industry_manufacturing_chemicals_automotive', null], // LAMATEPEC MANUFACTURING
  '06140404790047': ['industry_manufacturing_chemicals_automotive', null], // LANCASCO SALVADORENA
  '06140602971021': ['industry_manufacturing_chemicals_automotive', null], // MABE DE EL SALVADOR
  '06142805011069': ['industry_manufacturing_chemicals_automotive', 'manuchar.com'], // MANUCHAR DE EL SALVADOR
  '06142711760019': ['industry_manufacturing_chemicals_automotive', null], // MATRICERIA INDUSTRIAL ROXY
  '06141005011030': ['industry_manufacturing_chemicals_automotive', null], // METALCO DE EL SALVADOR
  '06141612031082': ['industry_manufacturing_chemicals_automotive', null], // MEXICHEM EL SALVADOR
  '06141909001018': ['industry_manufacturing_chemicals_automotive', null], // OLOCUILTA APPAREL
  '06141903131017': ['industry_manufacturing_chemicals_automotive', null], // OPP FILM EL SALVADOR
  '06140210071081': ['industry_manufacturing_chemicals_automotive', null], // PAPELERA INTERNACIONAL EL SALVADOR
  '06140408101016': ['industry_manufacturing_chemicals_automotive', null], // PARKDALE MILLS EL SALVADOR
  '93630506071010': ['industry_manufacturing_chemicals_automotive', null], // PETTENATI CENTROAMERICA
  '06142203911042': ['industry_manufacturing_chemicals_automotive', null], // PICACHO
  '06142303951084': ['industry_manufacturing_chemicals_automotive', null], // PLASTICOS EL PANDA
  '06140909921072': ['industry_manufacturing_chemicals_automotive', 'polybag.com.sv'], // POLYBAG
  '06140609101022': ['industry_manufacturing_chemicals_automotive', null], // PRINTCRAFT CENTRAL AMERICA
  '06142108071037': ['industry_manufacturing_chemicals_automotive', 'procesadoradeacero.com'], // PROCESADORA DE ACERO DE EL SALVADOR
  '94832507991010': ['industry_manufacturing_chemicals_automotive', null], // QUIMICA REITZEL DE EL SALVADOR
  '06140506131047': ['industry_manufacturing_chemicals_automotive', null], // R PAC CENTRAL AMERICA
  '06140202620015': ['industry_manufacturing_chemicals_automotive', null], // R R DONNELLEY DE EL SALVADOR
  '06140707161050': ['industry_manufacturing_chemicals_automotive', null], // RAVICORP INDUSTRIA
  '06140402081021': ['industry_manufacturing_chemicals_automotive', null], // RED FOX LAS MERCEDES
  '06140904760032': ['industry_manufacturing_chemicals_automotive', null], // RESORTES Y ALAMBRES
  '06141306001021': ['industry_manufacturing_chemicals_automotive', null], // RHEASAL
  '06141101111053': ['industry_manufacturing_chemicals_automotive', null], // RV INDUSTRIAS
  '06142602750015': ['industry_manufacturing_chemicals_automotive', null], // SACOS SINTETICOS CENTROAMERICANOS
  '06141012640038': ['industry_manufacturing_chemicals_automotive', null], // SALVAPLASTIC
  '06141504051093': ['industry_manufacturing_chemicals_automotive', null], // SALVAPLASTIC INTERNACIONAL
  '06140212091020': ['industry_manufacturing_chemicals_automotive', null], // SAN MIGUEL PET EL SALVADOR
  '06140806041058': ['industry_manufacturing_chemicals_automotive', null], // SANTA ANA APPAREL
  '06141103590020': ['industry_manufacturing_chemicals_automotive', null], // SHERWIN WILLIAMS DE CENTROAMERICA
  '06140104670012': ['industry_manufacturing_chemicals_automotive', null], // SIEMENS
  '06141110911011': ['industry_manufacturing_chemicals_automotive', null], // SMI PET EL SALVADOR
  '96422405850010': ['industry_manufacturing_chemicals_automotive', null], // SPECIALTY PRODUCTS
  '06140504001014': ['industry_manufacturing_chemicals_automotive', null], // STAR MOTORS
  '05112807580014': ['industry_manufacturing_chemicals_automotive', null], // SUMMA INDUSTRIAL
  '06141107780022': ['industry_manufacturing_chemicals_automotive', null], // SUN CHEMICAL DE CENTROAMERICA
  '03060106121013': ['industry_manufacturing_chemicals_automotive', 'suntrader.net'], // SUN TRADER
  '06142509091081': ['industry_manufacturing_chemicals_automotive', null], // SUPERTEX EL SALVADOR
  '06140409141062': ['industry_manufacturing_chemicals_automotive', null], // SUPERTEX LOURDES
  '06142106051012': ['industry_manufacturing_chemicals_automotive', null], // SWISSTEX EL SALVADOR
  '06141104971037': ['industry_manufacturing_chemicals_automotive', null], // TECHNO SCREEN
  '06140402710012': ['industry_manufacturing_chemicals_automotive', null], // TERMOENCOGIBLES
  '06141410041027': ['industry_manufacturing_chemicals_automotive', null], // TERMOEXPORT
  '06140207870046': ['industry_manufacturing_chemicals_automotive', null], // TERNIUM INTERNACIONAL EL SALVADOR
  '06140802021079': ['industry_manufacturing_chemicals_automotive', null], // TEXLEE EL SALVADOR
  '94502302961011': ['industry_manufacturing_chemicals_automotive', null], // TEXTILES LA PAZ
  '05150207081019': ['industry_manufacturing_chemicals_automotive', null], // TEXTILES OPICO
  '06140802740019': ['industry_manufacturing_chemicals_automotive', null], // TEXTILES SAN ANDRES
  '06141811710039': ['industry_manufacturing_chemicals_automotive', null], // TEXTUFIL
  '94831902981010': ['industry_manufacturing_chemicals_automotive', null], // THYSSENKRUPP ELEVADORES
  '06142411151035': ['industry_manufacturing_chemicals_automotive', null], // TSK ELECTRONICA Y ELECTRICIDAD EL SALVADOR
  '06140101770019': ['industry_manufacturing_chemicals_automotive', null], // TUBOS Y PERFILES PLASTICOS
  '06143011091021': ['industry_manufacturing_chemicals_automotive', null], // UNIFI CENTRAL AMERICA
  '06140512071064': ['industry_manufacturing_chemicals_automotive', null], // VARSITY PRO
  '06141504700018': ['industry_manufacturing_chemicals_automotive', null], // YKK EL SALVADOR
  '06142706011049': ['industry_manufacturing_chemicals_automotive', null], // YOUNGONE EL SALVADOR
  '06142206710021': ['insurance_financial_services', 'acaces.com.sv'], // ACACES
  '02101107660020': ['insurance_financial_services', null], // ACACESPSA
  '06140102961046': ['insurance_financial_services', 'acacycpnc.com.sv'], // ACACYCPNC
  '04162504710018': ['insurance_financial_services', null], // ACACYPAC
  '06142209141036': ['insurance_financial_services', 'accesofinanciero.com'], // ACCESO FINANCIERO
  '02102002931014': ['insurance_financial_services', null], // ACODES
  '06141403861027': ['insurance_financial_services', 'acofinges.sv'], // ACOFINGES
  '02101303981010': ['insurance_financial_services', null], // ACOMTUS
  '06143107921068': ['insurance_financial_services', 'acotincafe.com.sv'], // ACOTINCAFE
  '06140403981050': ['insurance_financial_services', null], // ADMINISTRADORA DE FONDOS DE PENSIONES CONFIA
  '06140403981026': ['insurance_financial_services', null], // AFP CRECER
  '06141712931013': ['insurance_financial_services', null], // AIG SEGUROS EL SALVADOR
  '06141411690013': ['insurance_financial_services', null], // ASEGURADORA SUIZA SALVADORENA
  '06142212991016': ['insurance_financial_services', null], // ASEGURADORA VIVIR
  '02101911650019': ['insurance_financial_services', null], // ASOC COOP DE AH CRED Y SERV DE LOS MERCADOS DE OCC
  '06142105941014': ['insurance_financial_services', null], // ASOC COOP DE SERVICIOS DE SEGUROS FUTURO
  '12172905720010': ['insurance_financial_services', null], // ASOCIACION COOPERATIVA DE AHORRO Y CREDITO MIGUELENA
  '06142811081044': ['insurance_financial_services', null], // ASSA COMPANIA DE SEGUROS
  '06142811081036': ['insurance_financial_services', null], // ASSA COMPANIA DE SEGUROS DE VIDA
  '06141207971019': ['insurance_financial_services', null], // AUTOFACIL
  '06142406991033': ['insurance_financial_services', null], // AUTOLEASING
  '06143101550016': ['insurance_financial_services', null], // BANCO AGRICOLA
  '06141703951079': ['insurance_financial_services', 'bancoatlantida.com.sv'], // BANCO ATLANTIDA EL SALVADOR
  '06143107071013': ['insurance_financial_services', null], // BANCO AZTECA EL SALVADOR
  '06142309131046': ['insurance_financial_services', null], // BANCO AZUL DE EL SALVADOR
  '10101908720017': ['insurance_financial_services', null], // BANCO COOPERATIVO VISIONARIO
  '06140806720015': ['insurance_financial_services', null], // BANCO CUSCATLAN DE EL SALVADOR
  '06141709940015': ['insurance_financial_services', null], // BANCO DAVIVIENDA SALVADORENO
  '06140312931018': ['insurance_financial_services', null], // BANCO DE AMERICA CENTRAL
  '12171207911016': ['insurance_financial_services', null], // BANCO DE LOS TRABAJADORES DE SAN MIGUEL S C
  '06142505941013': ['insurance_financial_services', null], // BANCO G&T CONTINENTAL EL SALVADOR
  '06142901350011': ['insurance_financial_services', 'bancohipotecario.com.sv'], // BANCO HIPOTECARIO DE EL SALVADOR
  '06141201101020': ['insurance_financial_services', null], // BANCO INDUSTRIAL EL SALVADOR
  '03060806911015': ['insurance_financial_services', null], // BANCO IZALQUENO DE LOS TRABAJADORES SOCIEDAD COOPERATIVA
  '05110402951018': ['insurance_financial_services', null], // BANCO PROMERICA
  '06141901961039': ['insurance_financial_services', null], // BANCOFIT S C
  '06141301921017': ['insurance_financial_services', null], // BCO DE LOS TRABAJADORES SALVADORENOS S C COOP
  '06143009941026': ['insurance_financial_services', null], // BOLSA DE PRODUCTOS DE EL SALVADOR
  '06142810700049': ['insurance_financial_services', 'comedica.com.sv'], // C O M E D I C A
  '06012408860016': ['insurance_financial_services', null], // CAJA DE CREDITO DE AGUILARES S C
  '07021006440012': ['insurance_financial_services', null], // CAJA DE CREDITO DE COJUTEPEQUE SOC COOP
  '11040205431016': ['insurance_financial_services', null], // CAJA DE CREDITO DE CONCEPCION BATRES SOC COOP
  '09031601440013': ['insurance_financial_services', null], // CAJA DE CREDITO DE ILOBASCO SOC COOP
  '04160703860018': ['insurance_financial_services', null], // CAJA DE CREDITO DE NUEVA CONCEPCION S C
  '08051812861010': ['insurance_financial_services', null], // CAJA DE CREDITO DE OLOCUILTA SOC COOP
  '13191111531012': ['insurance_financial_services', null], // CAJA DE CREDITO DE SAN FCO GOTERA SOC COOP
  '06132202530012': ['insurance_financial_services', null], // CAJA DE CREDITO DE SAN MARTIN SOC COOP
  '12170610440041': ['insurance_financial_services', null], // CAJA DE CREDITO DE SAN MIGUEL SOC COOP
  '08162306431012': ['insurance_financial_services', null], // CAJA DE CREDITO DE SAN PEDRO NONUALCO S C
  '10091404430018': ['insurance_financial_services', null], // CAJA DE CREDITO DE SAN SEBASTIAN SOC COOP
  '10100703430043': ['insurance_financial_services', null], // CAJA DE CREDITO DE SAN VICENTE SOCIEDAD COOPERATIVA
  '11212301441010': ['insurance_financial_services', null], // CAJA DE CREDITO DE SANTIAGO DE MARIA SOC COOP
  '08192106421019': ['insurance_financial_services', null], // CAJA DE CREDITO DE SANTIAGO NONUALCO SOC COOP
  '03150609420028': ['insurance_financial_services', null], // CAJA DE CREDITO DE SONSONATE SOC COOPERATIVA
  '14161812650013': ['insurance_financial_services', null], // CAJA DE CREDITO DE STA ROSA DE LIMA SOC COOPERATIVA
  '06181805431012': ['insurance_financial_services', null], // CAJA DE CREDITO DE TONACATEPEQUE S C
  '11232506431018': ['insurance_financial_services', null], // CAJA DE CREDITO DE USULUTAN SOC COOP DE RESPONSABILIDAD
  '08210103421016': ['insurance_financial_services', null], // CAJA DE CREDITO DE ZACATECOLUCA SOC COOP
  '06140612911116': ['insurance_financial_services', null], // CAJA DE CREDITO METROPOLITANA SOC COOP
  '04071005610018': ['insurance_financial_services', null], // CAJA DE CREDITO RURAL DE CHALATENANGO SOCIEDAD COOP
  '06140702951036': ['insurance_financial_services', null], // CASA DE CAMBIO PUERTO BUS
  '94502105630013': ['insurance_financial_services', null], // CITIBANK N A
  '06142509700019': ['insurance_financial_services', 'coopas.com.sv'], // COOPAS
  '95010701151019': ['insurance_financial_services', null], // CORPORACION DE INVERSIONES ATLANTIDA
  '06140210131050': ['insurance_financial_services', null], // CREDI OPCIONES
  '06143005870020': ['insurance_financial_services', null], // CREDIBAC
  '12171805670010': ['insurance_financial_services', 'crediq.com'], // CREDIQ
  '06140809820010': ['insurance_financial_services', null], // CREDOMATIC DE EL SALVADOR
  '06140603580016': ['insurance_financial_services', null], // DAVIVIENDA SEGUROS COMERCIALES BOLIVAR
  '94831303071013': ['insurance_financial_services', null], // EMISOR DE TARJETAS BR
  '06141101961022': ['insurance_financial_services', null], // EQUIFAX CENTROAMERICA
  '06142504720016': ['insurance_financial_services', null], // F E D E C A C E
  '06141002430023': ['insurance_financial_services', null], // F E D E C R E D I T O
  '06140701161023': ['insurance_financial_services', null], // FIRST CASH SV
  '96421807011015': ['insurance_financial_services', null], // FITCH CENTROAMERICA
  '06142906951011': ['insurance_financial_services', null], // INTERNACIONAL DE PRODUCTOS
  '06142007011050': ['insurance_financial_services', null], // INVERSIONES FINANCIERAS BANCO AGRICOLA
  '06140812931049': ['insurance_financial_services', null], // INVERSIONES FINANCIERAS DAVIVIENDA
  '06140809151075': ['insurance_financial_services', null], // INVERSIONES FINANCIERAS GRUPO AZUL
  '06142005161020': ['insurance_financial_services', null], // INVERSIONES FINANCIERAS IMPERIA CUSCATLAN
  '06140406981019': ['insurance_financial_services', null], // INVERSIONES FINANCIERAS PROMERICA
  '05112602021018': ['insurance_financial_services', null], // INVERSIONES INTEGRALES IFC
  '06140306021042': ['insurance_financial_services', 'lahipotecaria.com'], // LA HIPOTECARIA
  '06143004921043': ['insurance_financial_services', null], // MULTI INVERSIONES BANCO COOPERATIVO DE LOS TRABAJADORES S C
  '06140112931013': ['insurance_financial_services', 'multiriesgos.com'], // MULTIRIESGOS
  '06143001091015': ['insurance_financial_services', null], // OPTIMA SERVICIOS FINANCIEROS
  '06141312280039': ['insurance_financial_services', null], // PAN AMERICAN LIFE INSURANCE COMPANY
  '06142907051022': ['insurance_financial_services', null], // PRENDA AVAL
  '05112605141022': ['insurance_financial_services', null], // PRESTAMOS DEL ATLANTICO NORTE
  '06143105911049': ['insurance_financial_services', null], // PRIMER BANCO DE LOS TRABAJ SOC COOP
  '06142810091011': ['insurance_financial_services', 'psa.com.sv'], // PSA
  '06141606091057': ['insurance_financial_services', null], // QUALITY ASSURANCE CORREDORES DE SEGUROS
  '05011510071018': ['insurance_financial_services', null], // RIA DE CENTROAMERICA
  '06140208550011': ['insurance_financial_services', null], // SCOTIA SEGUROS
  '06142511720014': ['insurance_financial_services', null], // SCOTIABANK EL SALVADOR
  '01011203141012': ['insurance_financial_services', null], // SEGUROS AZUL
  '06141711101041': ['insurance_financial_services', null], // SEGUROS AZUL VIDA
  '06142903850011': ['insurance_financial_services', null], // SEGUROS DEL PACIFICO
  '06140807051014': ['insurance_financial_services', null], // SERVICIOS BURSATILES SALVADORENOS
  '06142810921030': ['insurance_financial_services', null], // SERVICIOS FINANCIEROS
  '06140102021086': ['insurance_financial_services', null], // SERVICIOS FINANCIEROS ENLACE
  '06140402921038': ['insurance_financial_services', null], // SERVICIOS GENERALES BURSATILES
  '12171602131011': ['insurance_financial_services', null], // SOCIEDAD COOPERATIVA DE AHORRO Y CREDITO CREDICAMPO DE RESPONSABILIDAD
  '13191912001015': ['insurance_financial_services', null], // SOCIEDAD COOPERATIVA DE AHORRO Y MICROCREDITO DE RESPONSABILIDAD
  '13190712061017': ['insurance_financial_services', null], // SOCIEDAD COOPERATIVA PADECOMSM CREDITO DE RESPONSABILIDAD
  '02071203041014': ['insurance_financial_services', null], // SOCIEDAD COOPERATIVA SOLIDARISTA DE RESPONSABILIDAD
  '06141505021015': ['insurance_financial_services', null], // SOCIEDAD DE AHORRO Y CREDITO APOYO INTEGRAL
  '06141002071023': ['insurance_financial_services', null], // SOCIEDAD DE AHORRO Y CREDITO CREDICOMER
  '06142203131020': ['insurance_financial_services', null], // SOCIEDAD DE AHORRO Y CREDITO MULTIVALORES
  '06141212901029': ['insurance_financial_services', null], // TARJETAS CUSCATLAN DE EL SALVADOR
  '93843010951013': ['insurance_financial_services', null], // THE BANK OF NOVA SCOTIA
  '06142305670013': ['insurance_financial_services', null], // TITULOS BIENES Y VALORES
  '06142511941017': ['insurance_financial_services', null], // VALORES BANAGRICOLA
  '06141801921013': ['insurance_financial_services', null], // VALORES CUSCATLAN EL SALVADOR
  '06140212931045': ['insurance_financial_services', null], // VALORES DAVIVIENDA EL SALVADOR
  '06142007091010': ['insurance_financial_services', null], // VALORES Y SERVICIOS REGIONALES
  '06142606931019': ['property_construction', null], // AMERICAN INDUSTRIAL PARK
  '06143010901020': ['property_construction', null], // BASALTICA
  '06141602780010': ['property_construction', null], // BLOKITUBOS
  '06142603901011': ['property_construction', null], // CASTANEDA INGENIEROS
  '06142603981015': ['property_construction', null], // CEMEX EL SALVADOR
  '06143009971014': ['property_construction', null], // CONSTRUCCIONES NABLA
  '06141910840030': ['property_construction', null], // CONSTRUCTORA DISA
  '06140901021013': ['property_construction', null], // DESARROLLOS INMOBILIARIOS CASCADAS
  '06140809001065': ['property_construction', null], // DESARROLLOS INMOBILIARIOS COMERCIALES
  '06142809061036': ['property_construction', null], // DURECO DE EL SALVADOR
  '06141308921020': ['property_construction', 'exportsalva.com'], // EXPORTSALVA FREE ZONE
  '06141109021045': ['property_construction', null], // GALDAMEZ MARTINEZ CONSTRUCTORES SOCIEDAD ANOMIMA
  '06141509870029': ['property_construction', null], // GRUPO ECON
  '12171207051017': ['property_construction', 'grupoflores.com.sv'], // GRUPO FLORES
  '06143009931055': ['property_construction', null], // GUERRERO INGENIEROS ASOCIADOS
  '06140704081039': ['property_construction', null], // HOLCIM CONCRETOS
  '06140502041094': ['property_construction', null], // INMOBILIARI
  '06142808850015': ['property_construction', null], // INMOBILIARIA APOPA
  '06140209041012': ['property_construction', null], // INMOBILIARIA MAYA
  '06140907680011': ['property_construction', null], // INMUEBLES
  '06142103141029': ['property_construction', null], // INVERSIONES E INMOBILIARIA FENIX
  '06141310780021': ['property_construction', 'inversionesomni.com'], // INVERSIONES OMNI
  '05110810021010': ['property_construction', null], // INVERSIONES SALVADORENAS DE MATERIALES
  '06141306590014': ['property_construction', 'inversionessimco.com'], // INVERSIONES SIMCO
  '06142012770073': ['property_construction', null], // JARDINES INMUEBLES
  '93301107601010': ['property_construction', null], // JOSE CARTELLONE CONSTRUCCIONES CIVILES
  '06142904881016': ['property_construction', 'lacantera.com.sv'], // LA CANTERA
  '06142704091010': ['property_construction', 'megablock.com.sv'], // MEGABLOCK
  '06142903600018': ['property_construction', null], // METROCENTRO
  '06140611870024': ['property_construction', null], // MONOLIT DE EL SALVADOR
  '06142308901026': ['property_construction', null], // PARQUE INDUSTRIAL EL PROGRESO
  '06142910111028': ['property_construction', null], // PARQUE INDUSTRIAL SANTA ANA
  '06141310111028': ['property_construction', null], // PAVIMENTOS Y CONSTRUCCION
  '06140707041020': ['property_construction', null], // PLYCEM CONSTRUSISTEMAS EL SALVADOR
  '06142204941026': ['property_construction', 'salazarromero.com'], // SALAZAR ROMERO
  '06141806041038': ['property_construction', null], // SHOPPING CENTER
  '06140709760014': ['property_construction', null], // SOVIPE COMERCIAL
  '96000709161011': ['property_construction', null], // SUPRA CONSTRUCCIONES
  '06141601740015': ['property_construction', null], // ZONA FRANCA DE EXPORTACION EL PEDREGAL
  '02032808001019': ['property_construction', null], // ZONA FRANCA DUMA
  '06140307001029': ['property_construction', null], // ZONA FRANCA SANTA TECLA
  '06140806011027': ['property_construction', null], // ZONA FRANCA SANTO TOMAS
  '06141702660013': ['retail', null], // ALMACENES SIMAN
  '02101911710016': ['retail', null], // ALMACENES VIDRI
  '06141101690011': ['retail', null], // CALLEJA
  '06142012041013': ['retail', null], // CORPORACION DE TIENDAS INTERNACIONALES
  '06140405891016': ['retail', null], // COSMETICOS Y MODAS
  '06142003971040': ['retail', null], // DURACION EN ELECTRODOMESTICOS
  '06141103921052': ['retail', null], // ELECTRONICA 2001
  '06141312011020': ['retail', null], // EUROMODA
  '06142606071010': ['retail', null], // FERRETERIA AZ
  '12170411991014': ['retail', null], // FERRETERIA CABALLERO
  '12172305071014': ['retail', null], // FERRETERIA EL BARATILLO
  '06140210081052': ['retail', null], // FERRETERIA EPA
  '06141402560013': ['retail', 'ferreterialapalma.com'], // FERRETERIA LA PALMA
  '06140108580017': ['retail', null], // FREUND DE EL SALVADOR
  '02103003091024': ['retail', null], // GENERAL FERRETERA DE EL SALVADOR
  '06141008051067': ['retail', null], // GMG COMERCIAL EL SALVADOR
  '06142501891020': ['retail', null], // INVERSIONES FERRETERAS
  '06141612021044': ['retail', 'luigemi.com'], // LUIGEMI
  '06142103901031': ['retail', null], // MARIOS AUTO PARTS
  '06140711071030': ['retail', null], // OD EL SALVADOR
  '06142709760012': ['retail', 'omnisport.com'], // OMNISPORT
  '06143107971090': ['retail', null], // OPERADORA DEL SUR
  '06141004121079': ['retail', 'partsplus.com.sv'], // PARTS PLUS
  '06141801011025': ['retail', null], // PAYLESS SHOESOURCE OF EL SALVADOR
  '06141603991030': ['retail', 'pricesmart.com'], // PRICESMART EL SALVADOR
  '06140310061067': ['retail', null], // PROVEEDORA ELECTRICA EL SALVADOR
  '06143107620016': ['retail', null], // REPUESTOS DIDEA
  '06142805011034': ['retail', null], // REPUESTOS IZALCO
  '06142308031013': ['retail', null], // RETAIL SPORTS
  '06141511720027': ['retail', 'superrepuestos.com'], // SUPER REPUESTOS EL SALVADOR
  '02102701001014': ['retail', 'unillantas.com.sv'], // UNILLANTAS
  '06142501161056': ['retail', null], // UNION COMERCIAL CORPORATIVO
  '06141108001032': ['retail', null], // UNION COMERCIAL DE EL SALVADOR
  '06140806450012': ['retail', 'viduc.com.sv'], // VIDUC
  '06142803941018': ['services_company', null], // BUFETE DR F A ARIAS
  '06140701041010': ['services_company', null], // COMPANIA SALVADORENA DE TELESERVICES
  '06142407001029': ['services_company', null], // CONTRATACION DE SERVICIOS
  '06141206011020': ['services_company', null], // CONTRATACIONES ESTRATEGICAS
  '06141705041010': ['services_company', null], // CONVERGYS GLOBAL SERVICES EL SALVADOR
  '06142808121060': ['services_company', null], // COTECNA DE EL SALVADOR
  '06140505111026': ['services_company', null], // FOCUS EL SALVADOR
  '05010903151017': ['services_company', null], // FUSION BPO SERVICES
  '06143110121021': ['services_company', null], // GETCOM INTERNATIONAL
  '06140406081069': ['services_company', null], // INFO CENTROAMERICA
  '06140109991013': ['services_company', null], // MANPOWER EL SALVADOR
  '06141506941061': ['services_company', null], // O&M MANTENIMIENTO Y SERVICIOS
  '05012602981017': ['services_company', null], // OUTSOURCE
  '06140109590020': ['services_company', null], // PUBLICIDAD COMERCIAL
  '06142302931020': ['services_company', null], // SERVICIO SALVADORENO DE PROTECCION
  '06140904971039': ['services_company', 'serviciosdepersonal.com.sv'], // SERVICIOS DE PERSONAL
  '06141205870030': ['services_company', null], // SERVICIOS INTEGRALES SIC
  '06142311001044': ['services_company', null], // SERVICIOS LABORALES
  '06140909031018': ['services_company', null], // SYKES EL SALVADOR
  '06141109081013': ['services_company', 'theofficegurus.com'], // THE OFFICE GURUS
  '06143105061037': ['services_company', null], // TRANSACTEL EL SALVADOR
  '06142506121010': ['services_company', null], // UBIQUITY GLOBAL SERVICES EL SALVADOR
  '06142208660010': ['services_company', 'vivaoutdoor.com'], // VIVA OUTDOOR
  '06142701041055': ['technology', null], // COLUMBUS NETWORKS EL SALVADOR
  '06142102971044': ['technology', null], // COMPANIA DE TELECOMUNICACIONES DE EL SALVADOR
  '06142011071067': ['technology', null], // CONTINENTAL TOWERS EL SALVADOR
  '06141812981018': ['technology', null], // DIGICEL
  '06140805061012': ['technology', null], // ENTERPRISE DATABASE EL SALVADOR
  '06141202961040': ['technology', null], // ERICSSON EL SALVADOR
  '06140509081059': ['technology', null], // HUAWEI TELECOMMUNICATIONS EL SALVADOR
  '08130203001010': ['technology', null], // INTCOMEX
  '06142503061024': ['technology', null], // LGB EL SALVADOR
  '06140812051030': ['technology', null], // NEXSYS DE CENTROAMERICA
  '06142406870019': ['technology', null], // RICOH EL SALVADOR
  '06141606101044': ['technology', null], // SBA TORRES EL SALVADOR
  '06142305071030': ['technology', null], // SKY EL SALVADOR
  '06140311061010': ['technology', 'skysolutions.com.sv'], // SKY SOLUTIONS
  '06141604121021': ['technology', null], // SKYCOM LATINOAMERICA
  '06140901041111': ['technology', null], // SSA SISTEMAS EL SALVADOR
  '06140506891025': ['technology', 'tecnoavance.com'], // TECNO AVANCE
  '06141201041010': ['technology', null], // TELEFONIA DIGITAL MOVIL
  '06142102971036': ['technology', null], // TELEFONICA MOVILES EL SALVADOR
  '06141003091036': ['technology', null], // UFINET EL SALVADOR
  '96003112961016': ['transport_logistics', null], // AEROLITORAL
  '06143009830016': ['transport_logistics', null], // AEROMANTENIMIENTO
  '93931707091019': ['transport_logistics', null], // AEROVIAS DEL CONTINENTE AMERICANO
  '06142407620011': ['transport_logistics', null], // ALMACENADORA CENTROAMERICANA
  '06142312740013': ['transport_logistics', null], // ALMACENADORA DEL PACIFICO
  '94501104341010': ['transport_logistics', null], // AMERICAN AIRLINES
  '01013107961010': ['transport_logistics', null], // ASOCIACION DE TRANSPORTISTAS AHUACHAPANECOS
  '06143107981052': ['transport_logistics', null], // BRIDGE INTERMODAL TRANSPORT EL SALVADOR
  '06140106710049': ['transport_logistics', null], // COMPANIA PANAMENA DE AVIACION
  '94501007891013': ['transport_logistics', null], // DELTA AIR LINES
  '06140103951010': ['transport_logistics', 'dhl.com'], // DHL GLOBAL FORWARDING EL SALVADOR
  '06141410991033': ['transport_logistics', null], // EMPRESA DE TRANSPORTISTAS UNIONENSES
  '06140811001021': ['transport_logistics', null], // KUEHNE NAGEL
  '06141503540020': ['transport_logistics', null], // LINEAS AEREAS COSTARRICENSES
  '06140607041030': ['transport_logistics', null], // LOGISTIC SOLUTIONS
  '06140401071014': ['transport_logistics', null], // MEDITERRANEAN SHIPPING CO ELSALVADOR
  '06142406041060': ['transport_logistics', null], // OPERADORES LOGISTICOS RANSA
  '06142501101070': ['transport_logistics', null], // SERVICIOS Y LOGISTICA DE CARGA WALNYS
  '06142504021026': ['transport_logistics', null], // SOTRANSCO
  '06142911390029': ['transport_logistics', null], // TACA INTERNATIONAL AIRLINES
  '06142506941068': ['transport_logistics', null], // TANK LINE
  '96480512051011': ['transport_logistics', null], // TRANS AMERICAN AIRLINES
  '06140204921049': ['transport_logistics', 'transauto.com.sv'], // TRANS AUTO
  '12171211971015': ['transport_logistics', null], // TRANSPORTES CASTRO FUNES
  '06141008901028': ['transport_logistics', null], // TRANSPORTES PESADOS
  '06140205031020': ['transport_logistics', null], // TRANSPORTISTAS EXCELENTEMENTE SERVIDOS
  '94502404871017': ['transport_logistics', null], // UNITED AIRLINES
  '06141011961031': ['transport_logistics', null], // UNO RENT A CAR
  '05011103031010': ['transport_logistics', null], // YOBEL
});

/** Macro de un Gran Contribuyente por su NIT, o `null`. */
export function resolveSvLargeTaxpayerMacro(nit: string | null | undefined): MacroIndustryKey | null {
  return typeof nit === 'string' ? SV_LARGE_TAXPAYER_TABLE[nit.trim()]?.[0] ?? null : null;
}

/** Web comprobada de un Gran Contribuyente por su NIT, o `null`. */
export function resolveSvLargeTaxpayerWebsite(nit: string | null | undefined): string | null {
  return typeof nit === 'string' ? SV_LARGE_TAXPAYER_TABLE[nit.trim()]?.[1] ?? null : null;
}

/** ¿Tiene esta macro algún Gran Contribuyente clasificado? */
export function macroHasSvLargeTaxpayerCoverage(macroIndustryKey: string | null | undefined): boolean {
  return typeof macroIndustryKey === 'string' && Object.values(SV_LARGE_TAXPAYER_TABLE).some(([macro]) => macro === macroIndustryKey);
}
