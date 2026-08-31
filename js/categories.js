const CATEGORIES = {
    expense: {
        alquiler:       { label: 'Alquiler',           color: '#e02d51', cssClass: 'cat-alquiler' },
        comida:         { label: 'Comida/Supermercado', color: '#0e9f6e', cssClass: 'cat-comida' },
        restaurantes:   { label: 'Restaurantes/Ocio',  color: '#ea700b', cssClass: 'cat-restaurantes' },
        gasolina:       { label: 'Gasolina',            color: '#7c3aed', cssClass: 'cat-gasolina' },
        transporte:     { label: 'Transporte público',  color: '#2563eb', cssClass: 'cat-transporte' },
        trenes:         { label: 'Billetes de tren',    color: '#0d9488', cssClass: 'cat-trenes' },
        suscripciones:  { label: 'Suscripciones',       color: '#db2777', cssClass: 'cat-suscripciones' },
        compras_online: { label: 'Compras online',      color: '#d9a406', cssClass: 'cat-compras-online' },
        electronica:    { label: 'Electrónica',         color: '#0284c7', cssClass: 'cat-electronica' },
        salud:          { label: 'Salud/Farmacia',      color: '#65a30d', cssClass: 'cat-salud' },
        ocio:           { label: 'Ocio/Social',         color: '#9333ea', cssClass: 'cat-ocio' },
        bizum:          { label: 'Bizum',               color: '#0a9e83', cssClass: 'cat-bizum' },
        viajes:         { label: 'Viajes',              color: '#c27803', cssClass: 'cat-viajes' },
        hogar:          { label: 'Hogar',               color: '#0e7490', cssClass: 'cat-hogar' },
        telefonia:      { label: 'Telefonía/Internet',  color: '#0369a1', cssClass: 'cat-telefonia' },
        seguros:        { label: 'Seguros',             color: '#be123c', cssClass: 'cat-seguros' },
        belleza:        { label: 'Belleza/Cuidado',     color: '#e0447f', cssClass: 'cat-belleza' },
        ropa:           { label: 'Ropa/Moda',           color: '#6d5ae0', cssClass: 'cat-ropa' },
        educacion:      { label: 'Educación',           color: '#0891b2', cssClass: 'cat-educacion' },
        cancelado:      { label: 'Cancelado/Devuelto',  color: '#8792a8', cssClass: 'cat-cancelado' },
        traspaso:       { label: 'Traspaso entre cuentas', color: '#8792a8', cssClass: 'cat-cancelado' },
        efectivo:       { label: 'Efectivo (cajero)',    color: '#57606f', cssClass: 'cat-efectivo' },
        otros:          { label: 'Otros gastos',        color: '#64748b', cssClass: 'cat-otros' },
    },
    income: {
        nomina:          { label: 'Nómina',           color: '#0e9f6e', cssClass: 'cat-nomina' },
        ayuda:           { label: 'Ayuda familiar',   color: '#2563eb', cssClass: 'cat-ayuda' },
        otros_ingresos:  { label: 'Otros ingresos',   color: '#7c3aed', cssClass: 'cat-otros-ingresos' },
    }
};

// Patrones de transferencias internas (dinero entre cuentas propias).
// Los patrones con datos personales se añaden desde js/private.rules.js,
// que no se publica en GitHub.
const INTERNAL_PATTERNS = [
    /PARA AHORRO SABADELL/i,
    /TRANSFERENCIA A.*MI MISMO|A MI MISMO/i,
    // Cuentas de inversión propias (mover dinero ahí no es ingreso ni gasto)
    /MYINVESTOR/i,
    /eToro/i,
];

// Conceptos que representan una devolución/cancelación de una compra anterior.
function isRefundConcept(concept) {
    return /ANUL(\.|ACI[OÓ]N)?\s*COMPRA|ANUL COMPRA|DEVOLUCI[OÓ]N|ABONO POR DEVOL|REINTEGRO COMPRA|RETROCESI[OÓ]N/i.test(concept || '');
}

const CATEGORY_RULES = [
    // Comida/Supermercado
    { pattern: /MERCADONA/i, category: 'comida', subcategory: 'Mercadona' },
    { pattern: /ALDI/i, category: 'comida', subcategory: 'Aldi' },
    { pattern: /LIDL/i, category: 'comida', subcategory: 'Lidl' },
    { pattern: /\bDIA\b|DÍA/i, category: 'comida', subcategory: 'Dia' },
    { pattern: /SUPECO/i, category: 'comida', subcategory: 'Supeco' },
    { pattern: /CARREFOUR/i, category: 'comida', subcategory: 'Carrefour' },
    { pattern: /EXPRESS JOAQUIN TURINA/i, category: 'comida', subcategory: 'Supermercado' },
    { pattern: /HOME ASIA/i, category: 'comida', subcategory: 'Home Asia' },
    { pattern: /ARLA GOURMET/i, category: 'comida', subcategory: 'Arla Gourmet' },
    { pattern: /MADYTEN FOODS/i, category: 'comida', subcategory: 'Madyten Foods' },

    // Restaurantes
    { pattern: /BAR\s/i, category: 'restaurantes', subcategory: 'Bar' },
    { pattern: /OYS BAR/i, category: 'restaurantes', subcategory: 'Oys Bar' },
    { pattern: /ALTA HABANA/i, category: 'restaurantes', subcategory: 'Alta Habana' },
    { pattern: /MONAGHANS PUB/i, category: 'restaurantes', subcategory: 'The Monaghans Pub' },
    { pattern: /L\sB\sK/i, category: 'restaurantes', subcategory: 'L B K' },
    { pattern: /URBAN POKE/i, category: 'restaurantes', subcategory: 'Urban Poke' },
    { pattern: /Lateral/i, category: 'restaurantes', subcategory: 'Lateral' },
    { pattern: /MILD AND LEMON/i, category: 'restaurantes', subcategory: 'Mild and Lemon' },
    { pattern: /CARACORTADA/i, category: 'restaurantes', subcategory: 'Caracortada' },
    { pattern: /Illycaffe/i, category: 'restaurantes', subcategory: 'Illy Caffè' },

    // Delivery
    { pattern: /JUST\s?EAT/i, category: 'restaurantes', subcategory: 'Just Eat' },
    { pattern: /Glovo/i, category: 'restaurantes', subcategory: 'Glovo' },

    // Gasolina
    { pattern: /REPSOL/i, category: 'gasolina', subcategory: 'Repsol' },
    { pattern: /CEDIPSA/i, category: 'gasolina', subcategory: 'Cedipsa' },
    { pattern: /E\.S\.\s/i, category: 'gasolina', subcategory: 'Gasolinera' },
    { pattern: /E\.S\s+TRUCK/i, category: 'gasolina', subcategory: 'Gasolinera' },
    { pattern: /WAYLET/i, category: 'gasolina', subcategory: 'Repsol Waylet' },

    // Transporte público
    { pattern: /APP CRTM/i, category: 'transporte', subcategory: 'Abono transporte' },
    { pattern: /UBER/i, category: 'transporte', subcategory: 'Uber' },
    { pattern: /Cabify/i, category: 'transporte', subcategory: 'Cabify' },

    // Billetes de tren
    { pattern: /RENFE/i, category: 'trenes', subcategory: 'Renfe' },
    { pattern: /IRYO/i, category: 'trenes', subcategory: 'Iryo' },

    // Suscripciones
    { pattern: /CLAUDE\.AI SUBSCRIPTION/i, category: 'suscripciones', subcategory: 'Claude Pro' },
    { pattern: /NETFLIX/i, category: 'suscripciones', subcategory: 'Netflix' },
    { pattern: /SPOTIFY/i, category: 'suscripciones', subcategory: 'Spotify' },
    { pattern: /YOUTUBE SUPER/i, category: 'suscripciones', subcategory: 'YouTube Premium' },
    { pattern: /Google Play Apps/i, category: 'suscripciones', subcategory: 'Google Play' },
    { pattern: /STEAMGAMES/i, category: 'suscripciones', subcategory: 'Steam' },
    { pattern: /VivaGym|Vivagym/i, category: 'suscripciones', subcategory: 'Gimnasio VivaGym' },
    { pattern: /ENTIDAD RECREATIVA.*[Gg]ym/i, category: 'suscripciones', subcategory: 'Gimnasio VivaGym' },
    { pattern: /EDX\.ORG/i, category: 'suscripciones', subcategory: 'edX' },
    { pattern: /MUSICNOTES/i, category: 'suscripciones', subcategory: 'Musicnotes' },

    // Compras online (Amazon Prime va antes: es suscripción, no compra)
    { pattern: /AMAZON PRIME|PRIME VIDEO/i, category: 'suscripciones', subcategory: 'Amazon Prime' },
    { pattern: /AMAZON/i, category: 'compras_online', subcategory: 'Amazon' },
    { pattern: /ALIEXPRESS/i, category: 'compras_online', subcategory: 'AliExpress' },
    { pattern: /PAYPAL/i, category: 'compras_online', subcategory: 'PayPal' },
    { pattern: /INDIGO MENA/i, category: 'compras_online', subcategory: 'Indigo Mena' },
    { pattern: /WomenSecret/i, category: 'compras_online', subcategory: 'Women\'Secret' },
    { pattern: /PANDORA JEWELLERY/i, category: 'compras_online', subcategory: 'Pandora' },
    { pattern: /LACASADELASCARCASAS/i, category: 'compras_online', subcategory: 'La Casa de las Carcasas' },
    { pattern: /HSNSTORE/i, category: 'compras_online', subcategory: 'HSN Store' },
    { pattern: /NORAUTO/i, category: 'compras_online', subcategory: 'Norauto' },

    // Electrónica
    { pattern: /PcComponentes/i, category: 'electronica', subcategory: 'PcComponentes' },
    { pattern: /MEDIA MARKT/i, category: 'electronica', subcategory: 'Media Markt' },
    { pattern: /LOGITECH/i, category: 'electronica', subcategory: 'Logitech' },

    // Salud/Farmacia
    { pattern: /FARMACIA/i, category: 'salud', subcategory: 'Farmacia' },

    // Ocio/Social (Bizum a amigos)
    { pattern: /PAGO BIZUM/i, category: 'bizum', subcategory: 'Bizum enviado' },
    { pattern: /SPECKA CLUB/i, category: 'ocio', subcategory: 'Discoteca/Club' },
    { pattern: /Resident Advisor/i, category: 'ocio', subcategory: 'Entradas eventos' },
    { pattern: /SACATUENTRADA/i, category: 'ocio', subcategory: 'Entradas eventos' },
    { pattern: /JETTY COS/i, category: 'ocio', subcategory: 'Máquinas recreativas' },

    // Viajes
    { pattern: /CLICK RENT/i, category: 'viajes', subcategory: 'Alquiler de coche' },
    { pattern: /IBIS BUDGET|HOTEL|HOSTAL|BOOKING/i, category: 'viajes', subcategory: 'Alojamiento' },

    // Hogar
    { pattern: /IKEA/i, category: 'hogar', subcategory: 'IKEA' },

    // Anthropic API (not subscription)
    { pattern: /ANTHROPIC(?!.*SUBSCRIPTION)/i, category: 'suscripciones', subcategory: 'Anthropic API' },

    // ---- Comida rápida / Fast food (Restaurantes) ----
    { pattern: /MC\s?DONALD|MCDONALD|MACDONALD|\bMCD\b/i, category: 'restaurantes', subcategory: "McDonald's" },
    { pattern: /BURGER KING|\bBK\b|\bBK\d{3,}/i, category: 'restaurantes', subcategory: 'Burger King' },
    { pattern: /\bKFC\b/i, category: 'restaurantes', subcategory: 'KFC' },
    { pattern: /TELEPIZZA/i, category: 'restaurantes', subcategory: 'Telepizza' },
    { pattern: /DOMINO/i, category: 'restaurantes', subcategory: "Domino's Pizza" },
    { pattern: /PIZZA HUT/i, category: 'restaurantes', subcategory: 'Pizza Hut' },
    { pattern: /GOIKO/i, category: 'restaurantes', subcategory: 'Goiko' },
    { pattern: /FIVE GUYS/i, category: 'restaurantes', subcategory: 'Five Guys' },
    { pattern: /TACO BELL/i, category: 'restaurantes', subcategory: 'Taco Bell' },
    { pattern: /POPEYES/i, category: 'restaurantes', subcategory: 'Popeyes' },
    { pattern: /SUBWAY/i, category: 'restaurantes', subcategory: 'Subway' },
    { pattern: /FOSTER.?S HOLLYWOOD/i, category: 'restaurantes', subcategory: "Foster's Hollywood" },
    { pattern: /\bVIPS\b/i, category: 'restaurantes', subcategory: 'VIPS' },
    { pattern: /100 MONTADITOS|CIEN MONTADITOS/i, category: 'restaurantes', subcategory: '100 Montaditos' },
    { pattern: /PANS\s?&\s?COMPANY|PANS AND COMPANY/i, category: 'restaurantes', subcategory: 'Pans & Company' },
    { pattern: /TIM HORTONS/i, category: 'restaurantes', subcategory: 'Tim Hortons' },
    { pattern: /STARBUCKS/i, category: 'restaurantes', subcategory: 'Starbucks' },
    { pattern: /COSTA COFFEE/i, category: 'restaurantes', subcategory: 'Costa Coffee' },
    { pattern: /RODILLA/i, category: 'restaurantes', subcategory: 'Rodilla' },
    { pattern: /\bTGB\b|THE GOOD BURGER/i, category: 'restaurantes', subcategory: 'The Good Burger' },
    { pattern: /CERVECERIA|CERVECERÍA/i, category: 'restaurantes', subcategory: 'Cervecería' },
    { pattern: /RESTAURANTE|RESTAURANT\b/i, category: 'restaurantes', subcategory: 'Restaurante' },
    { pattern: /CAFETERIA|CAFETERÍA|\bCAFE\b|CAFÉ/i, category: 'restaurantes', subcategory: 'Cafetería' },
    { pattern: /TABERNA|MESON|MESÓN|GASTROBAR|TAPAS/i, category: 'restaurantes', subcategory: 'Bar/Tapas' },
    { pattern: /PANADERIA|PANADERÍA|PASTELERIA|PASTELERÍA|HORNO\b/i, category: 'restaurantes', subcategory: 'Panadería' },
    { pattern: /UBER\s?EATS/i, category: 'restaurantes', subcategory: 'Uber Eats' },
    { pattern: /DELIVEROO/i, category: 'restaurantes', subcategory: 'Deliveroo' },

    // ---- Traspasos entre cuentas propias ----
    { pattern: /^TRASPASO SIN CONCEPTO$/i, category: 'traspaso', subcategory: 'Entre cuentas propias' },
    // Abanca manda a su cuenta de ahorro con el concepto "AHORROS"
    { pattern: /^AHORROS$/i, category: 'traspaso', subcategory: 'A cuenta de ahorro' },
    // Bonificación por domiciliar la nómina: es un ingreso real
    { pattern: /BONIFICACION CAMPA|BONIFICACIÓN CAMPA|FIDELIZACION|FIDELIZACIÓN/i, category: 'otros_ingresos', subcategory: 'Bonificación banco' },

    // ---- Efectivo ----
    { pattern: /REINTEGRO CAJERO|DISPOSICION CAJERO|RETIRADA EFECTIVO|CAJERO AUTOMATICO/i, category: 'efectivo', subcategory: 'Cajero' },

    // ---- Comercios vistos en mis extractos ----
    { pattern: /MACLARENS|LABERINTO|COCINA FUSION|KATOYAKI|SAN MIGUEL-|LIMON Y MEN/i, category: 'restaurantes', subcategory: 'Bar/Restaurante' },
    { pattern: /OPENMARKET|ALIMENTACIO/i, category: 'comida', subcategory: 'Supermercado' },
    { pattern: /ALCAZAR|CATEDRAL|MONUMENTO|ACUEDUCTO/i, category: 'ocio', subcategory: 'Turismo/Monumentos' },
    { pattern: /YELMOFILMS|\bYC\s/i, category: 'ocio', subcategory: 'Cine' },
    { pattern: /AVANZA/i, category: 'transporte', subcategory: 'Autobús' },
    { pattern: /CARREF/i, category: 'comida', subcategory: 'Carrefour' },
    { pattern: /VUELING|RYANAIR|IBERIA|AIR EUROPA|EASYJET|AIRLINES|\bATPI\b|AEROLIN/i, category: 'viajes', subcategory: 'Vuelos' },
    { pattern: /\bEXE\s|CONVENTO CAPUCHINOS|PARADOR|APARTAMENTOS|ALBERGUE/i, category: 'viajes', subcategory: 'Alojamiento' },
    { pattern: /TELEFERICO|MIRADOR|PARQUE NACIONAL|TENO ACTIVO|EXCURSION|GUIA TURIS/i, category: 'ocio', subcategory: 'Excursiones' },
    { pattern: /ENGLISH|IDIOMAS|EXAM CENT|CAMBRIDGE|ACADEMIA/i, category: 'educacion', subcategory: 'Inglés/Academia' },
    { pattern: /TALLER|NEUMATIC|TURBO DIESEL|AUTOMOCION|\bITV\b|MECANIC/i, category: 'transporte', subcategory: 'Coche (taller)' },
    { pattern: /LOTERIA|ADMON LOTERIA|APUESTAS/i, category: 'ocio', subcategory: 'Lotería' },
    { pattern: /GROSSO|CAFECENTRA|BUHOS|MASSART/i, category: 'restaurantes', subcategory: 'Bar/Restaurante' },

    // ---- Supermercados (Comida) ----
    { pattern: /EROSKI/i, category: 'comida', subcategory: 'Eroski' },
    { pattern: /ALCAMPO/i, category: 'comida', subcategory: 'Alcampo' },
    { pattern: /\bCONSUM\b/i, category: 'comida', subcategory: 'Consum' },
    { pattern: /HIPERCOR/i, category: 'comida', subcategory: 'Hipercor' },
    { pattern: /AHORRAMAS|AHORRA MAS/i, category: 'comida', subcategory: 'Ahorramas' },
    { pattern: /\bGADIS\b/i, category: 'comida', subcategory: 'Gadis' },
    { pattern: /\bFROIZ\b/i, category: 'comida', subcategory: 'Froiz' },
    { pattern: /BONPREU|BON PREU/i, category: 'comida', subcategory: 'Bonpreu' },
    { pattern: /\bCONDIS\b/i, category: 'comida', subcategory: 'Condis' },
    { pattern: /CAPRABO/i, category: 'comida', subcategory: 'Caprabo' },
    { pattern: /COVIRAN/i, category: 'comida', subcategory: 'Coviran' },
    { pattern: /\bSPAR\b/i, category: 'comida', subcategory: 'Spar' },
    { pattern: /\bMASYMAS|MAS Y MAS/i, category: 'comida', subcategory: 'Masymas' },
    { pattern: /FRUTERIA|FRUTERÍA|VERDULERIA|VERDULERÍA/i, category: 'comida', subcategory: 'Frutería' },
    { pattern: /CARNICERIA|CARNICERÍA|PESCADERIA|PESCADERÍA/i, category: 'comida', subcategory: 'Carnicería/Pescadería' },
    { pattern: /SUPERMERCADO|SUPERMERCAT|ALIMENTACION|ALIMENTACIÓN/i, category: 'comida', subcategory: 'Supermercado' },

    // ---- Gasolineras ----
    { pattern: /CEPSA/i, category: 'gasolina', subcategory: 'Cepsa' },
    { pattern: /\bBP\b|BRITISH PETROLEUM/i, category: 'gasolina', subcategory: 'BP' },
    { pattern: /\bGALP\b/i, category: 'gasolina', subcategory: 'Galp' },
    { pattern: /SHELL/i, category: 'gasolina', subcategory: 'Shell' },
    { pattern: /PETRONOR/i, category: 'gasolina', subcategory: 'Petronor' },
    { pattern: /PLENOIL/i, category: 'gasolina', subcategory: 'Plenoil' },
    { pattern: /BALLENOIL/i, category: 'gasolina', subcategory: 'Ballenoil' },
    { pattern: /GASOLINERA|ESTACION DE SERVICIO|ESTACIÓN DE SERVICIO|CARBURANTE/i, category: 'gasolina', subcategory: 'Gasolinera' },

    // ---- Transporte ----
    { pattern: /\bMETRO\b/i, category: 'transporte', subcategory: 'Metro' },
    { pattern: /\bEMT\b/i, category: 'transporte', subcategory: 'Autobús EMT' },
    { pattern: /\bBOLT\b/i, category: 'transporte', subcategory: 'Bolt' },
    { pattern: /FREE\s?NOW|MYTAXI/i, category: 'transporte', subcategory: 'Free Now' },
    { pattern: /\bTAXI\b/i, category: 'transporte', subcategory: 'Taxi' },
    { pattern: /BLABLACAR/i, category: 'transporte', subcategory: 'BlaBlaCar' },
    { pattern: /\bALSA\b/i, category: 'transporte', subcategory: 'ALSA' },
    { pattern: /FLIXBUS/i, category: 'transporte', subcategory: 'Flixbus' },
    { pattern: /\bEASYPARK|PARKING|APARCAMIENTO|EYSA|SABA\b|TELPARK/i, category: 'transporte', subcategory: 'Parking' },
    { pattern: /\bPEAJE|AUTOPISTA|ABERTIS/i, category: 'transporte', subcategory: 'Peaje' },

    // ---- Trenes ----
    { pattern: /OUIGO/i, category: 'trenes', subcategory: 'Ouigo' },
    { pattern: /AVLO/i, category: 'trenes', subcategory: 'Avlo' },

    // ---- Suscripciones / Servicios digitales ----
    { pattern: /HBO|\bMAX\b(?!.*MARKT)/i, category: 'suscripciones', subcategory: 'HBO Max' },
    { pattern: /DISNEY/i, category: 'suscripciones', subcategory: 'Disney+' },
    { pattern: /AMAZON PRIME|PRIME VIDEO/i, category: 'suscripciones', subcategory: 'Amazon Prime' },
    { pattern: /APPLE\.COM|APPLE MEDIA|ITUNES|APPLE\s?TV/i, category: 'suscripciones', subcategory: 'Apple' },
    { pattern: /\bICLOUD\b/i, category: 'suscripciones', subcategory: 'iCloud' },
    { pattern: /GOOGLE ONE|GOOGLE STORAGE/i, category: 'suscripciones', subcategory: 'Google One' },
    { pattern: /MICROSOFT|OFFICE 365|XBOX/i, category: 'suscripciones', subcategory: 'Microsoft' },
    { pattern: /OPENAI|CHATGPT/i, category: 'suscripciones', subcategory: 'ChatGPT' },
    { pattern: /TWITCH/i, category: 'suscripciones', subcategory: 'Twitch' },
    { pattern: /PATREON/i, category: 'suscripciones', subcategory: 'Patreon' },
    { pattern: /AUDIBLE/i, category: 'suscripciones', subcategory: 'Audible' },
    { pattern: /\bKINDLE\b/i, category: 'suscripciones', subcategory: 'Kindle' },
    { pattern: /LINKEDIN/i, category: 'suscripciones', subcategory: 'LinkedIn' },
    { pattern: /DUOLINGO/i, category: 'suscripciones', subcategory: 'Duolingo' },
    { pattern: /DROPBOX/i, category: 'suscripciones', subcategory: 'Dropbox' },
    { pattern: /NOTION/i, category: 'suscripciones', subcategory: 'Notion' },
    { pattern: /ADOBE/i, category: 'suscripciones', subcategory: 'Adobe' },
    { pattern: /CANVA/i, category: 'suscripciones', subcategory: 'Canva' },
    { pattern: /CRUNCHYROLL/i, category: 'suscripciones', subcategory: 'Crunchyroll' },
    { pattern: /PRIME GAMING|PLAYSTATION|PSN|NINTENDO/i, category: 'suscripciones', subcategory: 'Gaming' },

    // ---- Telefonía / Internet ----
    { pattern: /MOVISTAR/i, category: 'telefonia', subcategory: 'Movistar' },
    { pattern: /VODAFONE/i, category: 'telefonia', subcategory: 'Vodafone' },
    { pattern: /ORANGE/i, category: 'telefonia', subcategory: 'Orange' },
    { pattern: /\bYOIGO\b/i, category: 'telefonia', subcategory: 'Yoigo' },
    { pattern: /MASMOVIL|MAS MOVIL/i, category: 'telefonia', subcategory: 'MásMóvil' },
    { pattern: /\bDIGI\b/i, category: 'telefonia', subcategory: 'Digi' },
    { pattern: /PEPEPHONE/i, category: 'telefonia', subcategory: 'Pepephone' },
    { pattern: /\bO2\b/i, category: 'telefonia', subcategory: 'O2' },
    { pattern: /SIMYO/i, category: 'telefonia', subcategory: 'Simyo' },
    { pattern: /JAZZTEL/i, category: 'telefonia', subcategory: 'Jazztel' },
    { pattern: /LOWI/i, category: 'telefonia', subcategory: 'Lowi' },

    // ---- Seguros ----
    { pattern: /MAPFRE/i, category: 'seguros', subcategory: 'Mapfre' },
    { pattern: /\bMUTUA\b|MUTUA MADRILE/i, category: 'seguros', subcategory: 'Mutua Madrileña' },
    { pattern: /LINEA DIRECTA|LÍNEA DIRECTA/i, category: 'seguros', subcategory: 'Línea Directa' },
    { pattern: /\bAXA\b/i, category: 'seguros', subcategory: 'AXA' },
    { pattern: /ALLIANZ/i, category: 'seguros', subcategory: 'Allianz' },
    { pattern: /GENERALI/i, category: 'seguros', subcategory: 'Generali' },
    { pattern: /\bSEGURO|SEGUROS\b|ZURICH|REALE\b/i, category: 'seguros', subcategory: 'Seguro' },

    // ---- Salud ----
    { pattern: /SANITAS/i, category: 'salud', subcategory: 'Sanitas' },
    { pattern: /ADESLAS/i, category: 'salud', subcategory: 'Adeslas' },
    { pattern: /\bDKV\b/i, category: 'salud', subcategory: 'DKV' },
    { pattern: /CLINICA|CLÍNICA|HOSPITAL|CENTRO MEDICO|CENTRO MÉDICO/i, category: 'salud', subcategory: 'Clínica' },
    { pattern: /DENTAL|DENTISTA|VITALDENT|DENTIX/i, category: 'salud', subcategory: 'Dentista' },
    { pattern: /OPTICA|ÓPTICA|MULTIOPTICAS|GENERAL OPTICA/i, category: 'salud', subcategory: 'Óptica' },
    { pattern: /FISIOTERAPIA|FISIO\b/i, category: 'salud', subcategory: 'Fisioterapia' },

    // ---- Belleza / Cuidado personal ----
    { pattern: /PELUQUERIA|PELUQUERÍA|BARBERIA|BARBERÍA|BARBER/i, category: 'belleza', subcategory: 'Peluquería' },
    { pattern: /\bDRUNI\b/i, category: 'belleza', subcategory: 'Druni' },
    { pattern: /PRIMOR/i, category: 'belleza', subcategory: 'Primor' },
    { pattern: /SEPHORA/i, category: 'belleza', subcategory: 'Sephora' },
    { pattern: /\bRITUALS\b/i, category: 'belleza', subcategory: 'Rituals' },
    { pattern: /PERFUMERIA|PERFUMERÍA/i, category: 'belleza', subcategory: 'Perfumería' },
    { pattern: /ESTETICA|ESTÉTICA|MANICURA|SPA\b/i, category: 'belleza', subcategory: 'Estética' },

    // ---- Ropa / Moda ----
    { pattern: /\bZARA\b/i, category: 'ropa', subcategory: 'Zara' },
    { pattern: /BERSHKA/i, category: 'ropa', subcategory: 'Bershka' },
    { pattern: /PULL\s?&\s?BEAR|PULL AND BEAR|PULL&BEAR/i, category: 'ropa', subcategory: 'Pull&Bear' },
    { pattern: /STRADIVARIUS/i, category: 'ropa', subcategory: 'Stradivarius' },
    { pattern: /MASSIMO DUTTI/i, category: 'ropa', subcategory: 'Massimo Dutti' },
    { pattern: /\bOYSHO\b/i, category: 'ropa', subcategory: 'Oysho' },
    { pattern: /\bMANGO\b/i, category: 'ropa', subcategory: 'Mango' },
    { pattern: /\bH&M\b|H Y M\b|HENNES/i, category: 'ropa', subcategory: 'H&M' },
    { pattern: /PRIMARK/i, category: 'ropa', subcategory: 'Primark' },
    { pattern: /\bSHEIN\b/i, category: 'ropa', subcategory: 'Shein' },
    { pattern: /DECATHLON/i, category: 'ropa', subcategory: 'Decathlon' },
    { pattern: /\bNIKE\b/i, category: 'ropa', subcategory: 'Nike' },
    { pattern: /ADIDAS/i, category: 'ropa', subcategory: 'Adidas' },
    { pattern: /JD SPORTS|FOOT LOCKER|SNIPES/i, category: 'ropa', subcategory: 'Tienda deporte' },
    { pattern: /SPRINGFIELD|CORTEFIEL|\bC&A\b|LEFTIES|TENDAM/i, category: 'ropa', subcategory: 'Ropa' },

    // ---- Compras online / tiendas ----
    { pattern: /\bFNAC\b/i, category: 'compras_online', subcategory: 'Fnac' },
    { pattern: /EL CORTE INGLES|EL CORTE INGLÉS|\bECI\b/i, category: 'compras_online', subcategory: 'El Corte Inglés' },
    { pattern: /\bTEMU\b/i, category: 'compras_online', subcategory: 'Temu' },
    { pattern: /\bWALLAPOP\b/i, category: 'compras_online', subcategory: 'Wallapop' },
    { pattern: /\bVINTED\b/i, category: 'compras_online', subcategory: 'Vinted' },
    { pattern: /\bETSY\b/i, category: 'compras_online', subcategory: 'Etsy' },

    // ---- Electrónica ----
    { pattern: /WORTEN/i, category: 'electronica', subcategory: 'Worten' },
    { pattern: /\bAPPLE STORE\b/i, category: 'electronica', subcategory: 'Apple Store' },
    { pattern: /SAMSUNG/i, category: 'electronica', subcategory: 'Samsung' },
    { pattern: /XIAOMI/i, category: 'electronica', subcategory: 'Xiaomi' },

    // ---- Hogar / Bricolaje ----
    { pattern: /LEROY MERLIN/i, category: 'hogar', subcategory: 'Leroy Merlin' },
    { pattern: /BRICOMART|BRICODEPOT|BRICO DEPOT/i, category: 'hogar', subcategory: 'Bricomart' },
    { pattern: /CONFORAMA/i, category: 'hogar', subcategory: 'Conforama' },
    { pattern: /MAISONS DU MONDE/i, category: 'hogar', subcategory: 'Maisons du Monde' },
    { pattern: /\bACTION\b/i, category: 'hogar', subcategory: 'Action' },
    { pattern: /\bFLYING TIGER|TIGER\b/i, category: 'hogar', subcategory: 'Flying Tiger' },
    { pattern: /\bZARA HOME\b/i, category: 'hogar', subcategory: 'Zara Home' },
    { pattern: /BAZAR|TODO A 100|CHINO\b/i, category: 'hogar', subcategory: 'Bazar' },
    { pattern: /FERRETERIA|FERRETERÍA/i, category: 'hogar', subcategory: 'Ferretería' },

    // ---- Suministros del hogar ----
    { pattern: /IBERDROLA|ENDESA|NATURGY|REPSOL LUZ|HOLALUZ|TOTALENERGIES|ENERGIA|ENERGÍA|ELECTRICIDAD|\bLUZ\b/i, category: 'hogar', subcategory: 'Luz/Energía' },
    { pattern: /CANAL DE ISABEL|AGUAS DE|EMASESA|CANAL\b|\bAGUA\b/i, category: 'hogar', subcategory: 'Agua' },
    { pattern: /\bGAS NATURAL|GAS\b/i, category: 'hogar', subcategory: 'Gas' },

    // ---- Educación ----
    { pattern: /UDEMY/i, category: 'educacion', subcategory: 'Udemy' },
    { pattern: /COURSERA/i, category: 'educacion', subcategory: 'Coursera' },
    { pattern: /PLATZI|DOMESTIKA|MASTERCLASS/i, category: 'educacion', subcategory: 'Cursos online' },
    { pattern: /UNIVERSIDAD|MATRICULA|MATRÍCULA|ACADEMIA/i, category: 'educacion', subcategory: 'Formación' },
    { pattern: /LIBRERIA|LIBRERÍA|CASA DEL LIBRO/i, category: 'educacion', subcategory: 'Librería' },

    // ---- Ocio ----
    { pattern: /CINESA|YELMO|CINE\b|CINES\b|OCINE|KINEPOLIS/i, category: 'ocio', subcategory: 'Cine' },
    { pattern: /\bTEATRO\b/i, category: 'ocio', subcategory: 'Teatro' },
    { pattern: /MUSEO|EXPOSICION|EXPOSICIÓN/i, category: 'ocio', subcategory: 'Museo' },
    { pattern: /TICKETMASTER|ENTRADAS\.COM|EVENTBRITE|FEVER\b/i, category: 'ocio', subcategory: 'Entradas eventos' },

    // Impuestos
    { pattern: /IMPUESTOS.*TASAS/i, category: 'otros', subcategory: 'Impuestos/Tasas' },
    { pattern: /COMISI[OÓ]N DIVISA/i, category: 'otros', subcategory: 'Comisión divisa' },
    { pattern: /DHV TECNOLOGIA/i, category: 'otros', subcategory: 'Congreso' },

    // Ingresos (nómina/ayuda personales van en js/private.rules.js)
    { pattern: /\bNOMINA\b/i, category: 'nomina', subcategory: 'Nómina' },
    { pattern: /REMUN.*CTA.*SABADELL/i, category: 'otros_ingresos', subcategory: 'Remuneración cuenta' },
    { pattern: /ABON?\.?\s*PROM.*SABADELL/i, category: 'otros_ingresos', subcategory: 'Promoción cuenta' },
    { pattern: /PROMOCION AMIGO|PROMOCIÓN AMIGO/i, category: 'otros_ingresos', subcategory: 'Promoción' },
    { pattern: /Mangopay/i, category: 'otros_ingresos', subcategory: 'Venta online' },
    { pattern: /^PERIODO \d{2}\/\d{2}\/\d{4}/i, category: 'otros_ingresos', subcategory: 'Remuneración cuenta' },
    { pattern: /DEVOLUCIONES TRIBUTARIAS|AGENCIA TRIBUTARIA/i, category: 'otros_ingresos', subcategory: 'Hacienda' },
    { pattern: /ABONO BIZUM/i, category: 'bizum', subcategory: 'Bizum recibido' },
    { pattern: /DEVOLUCION/i, category: 'otros_ingresos', subcategory: 'Devolución' },
    { pattern: /ANUL COMPRA/i, category: 'otros_ingresos', subcategory: 'Anulación compra' },
];

let learnedRules = {};

// ==================== CUSTOM (USER) CATEGORIES ====================
// Categorías creadas por el usuario. Se guardan en el setting 'custom_categories'
// y se fusionan en CATEGORIES para que funcionen igual que las predefinidas
// (aparecen en el selector, en getCategoryInfo, en el aprendizaje, etc.).
let customCategories = { expense: {}, income: {} };

const CUSTOM_COLORS = ['#d97706', '#dc2626', '#059669', '#2563eb', '#7c3aed', '#db2777', '#0d9488', '#ca8a04', '#ea580c', '#0891b2'];

function setCustomCategories(obj) {
    customCategories = { expense: {}, income: {} };
    if (obj && obj.expense) Object.assign(customCategories.expense, obj.expense);
    if (obj && obj.income) Object.assign(customCategories.income, obj.income);
    // Fusionar en el registro vivo para que se comporten como las predefinidas.
    Object.assign(CATEGORIES.expense, customCategories.expense);
    Object.assign(CATEGORIES.income, customCategories.income);
}

function getCustomCategories() {
    return customCategories;
}

function slugifyCategory(label) {
    return 'custom_' + (label || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 30);
}

// Crea (o reutiliza) una categoría propia. Devuelve su id, o null si el nombre no vale.
function addCustomCategory(label, type) {
    label = (label || '').trim();
    type = type === 'income' ? 'income' : 'expense';
    const id = slugifyCategory(label);
    if (!label || id === 'custom_') return null;
    // Si ya existe (predefinida o propia) con ese id, la reutilizamos.
    if (CATEGORIES[type][id]) return id;
    const count = Object.keys(customCategories[type]).length;
    const color = CUSTOM_COLORS[count % CUSTOM_COLORS.length];
    const info = { label, color, cssClass: 'cat-otros', custom: true };
    customCategories[type][id] = info;
    CATEGORIES[type][id] = info;
    return id;
}

function isCustomCategory(id) {
    return !!(customCategories.expense[id] || customCategories.income[id]);
}

function findCustomCategoryType(id) {
    if (customCategories.expense[id]) return 'expense';
    if (customCategories.income[id]) return 'income';
    return null;
}

function renameCustomCategory(id, newLabel) {
    newLabel = (newLabel || '').trim();
    if (!newLabel) return false;
    const type = findCustomCategoryType(id);
    if (!type) return false;
    customCategories[type][id].label = newLabel;
    CATEGORIES[type][id].label = newLabel;
    return true;
}

function deleteCustomCategory(id) {
    const type = findCustomCategoryType(id);
    if (!type) return false;
    delete customCategories[type][id];
    delete CATEGORIES[type][id];
    // Quitar las reglas aprendidas que apuntaban a esta categoría.
    for (const k of Object.keys(learnedRules)) {
        if (learnedRules[k] === id) delete learnedRules[k];
    }
    return true;
}

function isInternalTransfer(concept) {
    return INTERNAL_PATTERNS.some(p => p.test(concept));
}

function conceptKey(concept) {
    return concept.replace(/COMPRA TARJ\.\s*\d+X+\d+\s*/i, '')
                  .replace(/COMPRA BIZUM\s*/i, '')
                  .replace(/PAGO BIZUM\s*/i, '')
                  .replace(/ABONO BIZUM DE\s*/i, '')
                  .replace(/\d{2}[\.\/]\d{2}\s*/g, '')
                  .replace(/-[A-Z\s]+$/i, '')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .toUpperCase();
}

function setLearnedRules(rules) {
    learnedRules = rules || {};
}

function getLearnedRules() {
    return learnedRules;
}

function learnCategory(concept, category) {
    const key = conceptKey(concept);
    if (key) {
        learnedRules[key] = category;
    }
}

function categorize(concept, amount) {
    const key = conceptKey(concept);
    if (key && learnedRules[key]) {
        const cat = learnedRules[key];
        const info = getCategoryInfo(cat);
        return { category: cat, subcategory: info.label };
    }

    for (const rule of CATEGORY_RULES) {
        if (rule.pattern.test(concept)) {
            return { category: rule.category, subcategory: rule.subcategory };
        }
    }
    if (amount > 0) {
        return { category: 'otros_ingresos', subcategory: 'Sin clasificar' };
    }
    return { category: 'otros', subcategory: 'Sin clasificar' };
}

function getCategoryInfo(categoryId) {
    return CATEGORIES.expense[categoryId] || CATEGORIES.income[categoryId] || { label: categoryId, color: '#94a3b8', cssClass: 'cat-otros' };
}

function getAllExpenseCategories() {
    return Object.entries(CATEGORIES.expense).map(([id, info]) => ({ id, ...info }));
}

function getAllIncomeCategories() {
    return Object.entries(CATEGORIES.income).map(([id, info]) => ({ id, ...info }));
}

function isIncomeCategory(categoryId) {
    return categoryId in CATEGORIES.income;
}

// Categorías que no entran en los totales grandes de Ingresos/Gastos:
// los Bizum se muestran aparte (en pequeño) y lo cancelado no cuenta.
const NEUTRAL_CATEGORIES = new Set(['bizum', 'cancelado', 'traspaso']);
function isNeutralCategory(categoryId) {
    return NEUTRAL_CATEGORIES.has(categoryId);
}
