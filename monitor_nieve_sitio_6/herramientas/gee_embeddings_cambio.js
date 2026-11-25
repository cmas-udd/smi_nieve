/**********************************************************************
 * Embeddings satelitales y lugares de cambio
 * Andes centrales: Aconcagua, Mapocho, Maipo y Cachapoal
 *
 * Qué hace este script (Code Editor de Google Earth Engine):
 *  1. Lee los embeddings anuales de AlphaEarth (64 bandas, 10 m, desde 2017).
 *  2. Calcula el cambio de cada píxel entre años consecutivos (1 menos el
 *     producto punto de los embeddings). Lo entrega de dos formas:
 *     a) por año: un mapa y un conjunto de puntos GPS para cada par de años
 *        (2017 a 2018, 2018 a 2019, ...);
 *     b) resumen: el mayor cambio de todo el período y el año en que ocurrió.
 *  3. Exporta los embeddings y el terreno en dos tablas para entrenar la IA
 *     fuera de GEE (notebook):
 *     a) en cada lugar de cambio, el embedding del año anterior y del año
 *        del cambio;
 *     b) en una muestra pareja de la zona nival, el embedding de cada año.
 *
 * Todo se limita a la zona nival: píxeles sobre ALTURA_MIN_CAMBIO, fuera de
 * zonas construidas, con nieve al menos FREC_NIEVE_MIN de los días (MODIS)
 * en alguno de los dos años de cada par.
 *
 * Este script no usa el catastro de eventos de prensa: es una fuente
 * independiente. El cruce con los eventos y con las otras fuentes se hace
 * en el notebook de entrenamiento.
 *
 * Exportaciones (pestaña Tasks, carpeta de Drive CARPETA):
 *  - lugares_cambio_por_anio.geojson -> copiar a datos/ del sitio
 *  - lugares_cambio.geojson          -> copiar a datos/ del sitio (resumen)
 *  - cambio_resumen_por_anio.csv     -> umbral, área y focos de cada año
 *  - embeddings_lugares_cambio.csv   -> tabla para el notebook
 *  - embeddings_muestra_nival.csv -> tabla para el notebook
 *  - cambio_maximo_30m.tif, anio_cambio_30m.tif
 *  - cambio_por_anio_30m.tif (una banda por año: cambio_2018, cambio_2019, ...)
 **********************************************************************/

// ===================== Configuración =====================
var AOI = ee.Geometry.Rectangle([-70.88, -34.43, -69.074, -32.665]);
var CARPETA = 'nieve_embeddings';
var PERCENTIL_CAMBIO = 99;                     // umbral de los lugares de cambio (percentil de cada año)
var UMBRAL_CAMBIO_FIJO = null;                 // número (ej. 0.35) para usar el mismo umbral en todos los años
var MAX_PUNTOS_POR_ANIO = 300;                 // lugares de cambio por año
var MAX_PUNTOS = 500;                          // lugares de cambio del resumen
var ALTURA_MIN_CAMBIO = 1500;                  // solo cordillera (m)
var FREC_NIEVE_MIN = 0.10;                     // fracción mínima de días con nieve (MODIS) para entrar al análisis
var NIEVE_POR_ANIO = true;                     // true: la nieve se mide en los dos años de cada par; false: en todo el período
var EXCLUIR_URBANO = true;                     // quita lo construido según ESA WorldCover
var N_MUESTRA = 4000;                          // puntos de la muestra pareja de la zona nival
var SEMILLA = 42;

// ===================== Embeddings disponibles =====================
var EMB = ee.ImageCollection('GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL').filterBounds(AOI);
var ANIOS = EMB.aggregate_array('system:time_start')
  .map(function (t) { return ee.Date(t).get('year'); }).distinct().sort().getInfo();
print('Años con embeddings:', ANIOS);
var ANIO_MIN = ANIOS[0], ANIO_MAX = ANIOS[ANIOS.length - 1];
var BANDAS_EMB = [];
for (var i = 0; i < 64; i++) BANDAS_EMB.push('A' + (i < 10 ? '0' : '') + i);

function embedding(anio) {
  return EMB.filterDate(anio + '-01-01', (anio + 1) + '-01-01').mosaic().select(BANDAS_EMB).clip(AOI);
}

// ===================== Variables estáticas =====================
var dem = ee.Image('USGS/SRTMGL1_003').clip(AOI);
var terreno = ee.Terrain.products(dem);
var aspecto = terreno.select('aspect').multiply(Math.PI / 180);
var relieve = dem.reduceNeighborhood(ee.Reducer.max(), ee.Kernel.circle(500, 'meters'))
  .subtract(dem.reduceNeighborhood(ee.Reducer.min(), ee.Kernel.circle(500, 'meters')));
// Frecuencia de días con nieve (MODIS, NDSI_Snow_Cover > 40) en el período de los embeddings.
var nieveFrec = ee.ImageCollection('MODIS/061/MOD10A1')
  .filterDate(ANIO_MIN + '-01-01', (ANIO_MAX + 1) + '-01-01').filterBounds(AOI)
  .select('NDSI_Snow_Cover')
  .map(function (im) { return im.gt(40).rename('nieve').updateMask(im.lte(100)); })
  .mean().rename('frec_nieve').clip(AOI);
var ESTATICAS = dem.rename('altura')
  .addBands(terreno.select('slope').rename('pendiente'))
  .addBands(aspecto.cos().rename('norte'))
  .addBands(aspecto.sin().rename('este'))
  .addBands(relieve.rename('relieve_500m'))
  .addBands(nieveFrec.unmask(0));
var BANDAS_EST = ['altura', 'pendiente', 'norte', 'este', 'relieve_500m', 'frec_nieve'];


// ===================== Zona nival =====================
// Solo se analizan píxeles con nieve: así no aparecen ciudades, caminos ni cultivos,
// que cambian mucho de un año a otro pero no tienen que ver con la nieve.
function frecNieve(desde, hasta) {
  return ee.ImageCollection('MODIS/061/MOD10A1')
    .filterDate(desde, hasta).filterBounds(AOI)
    .select('NDSI_Snow_Cover')
    .map(function (im) { return im.gt(40).rename('nieve').updateMask(im.lte(100)); })
    .mean().unmask(0).clip(AOI);
}
function frecNieveAnio(a) { return frecNieve(a + '-01-01', (a + 1) + '-01-01'); }
var noUrbano = EXCLUIR_URBANO
  ? ee.ImageCollection('ESA/WorldCover/v200').first().select('Map').neq(50).unmask(1)
  : ee.Image.constant(1);
var cordillera = dem.gte(ALTURA_MIN_CAMBIO).and(noUrbano);
var zonaNivalTotal = cordillera.and(nieveFrec.unmask(0).gte(FREC_NIEVE_MIN));
// Zona nival de un par de años: con nieve en al menos uno de los dos años.
function zonaNival(par) {
  if (!NIEVE_POR_ANIO) return zonaNivalTotal;
  return cordillera.and(frecNieveAnio(par[0]).max(frecNieveAnio(par[1])).gte(FREC_NIEVE_MIN));
}
Map.addLayer(zonaNivalTotal.selfMask(), {palette: ['5fc0f0']}, 'Zona nival (todo el período)', false);
var areaNival = zonaNivalTotal.selfMask().multiply(ee.Image.pixelArea()).reduceRegion({
  reducer: ee.Reducer.sum(), geometry: AOI, scale: 100, maxPixels: 1e10, bestEffort: true}).values().get(0);
print('Zona nival analizada (km²):', ee.Number(areaNival).divide(1e6));

// ===================== 1. Cambio entre años =====================
// Cada par de años consecutivos (año anterior -> año) se analiza por separado.
// Cambio = 1 menos el producto punto de los dos embeddings (0 = igual, 2 = opuesto).
// El cambio queda enmascarado fuera de la zona nival de ese par de años.
var PAREJAS = [];
for (var k = 1; k < ANIOS.length; k++) PAREJAS.push([ANIOS[k - 1], ANIOS[k]]);

function cambioAnual(par) {
  var sim = embedding(par[1]).multiply(embedding(par[0])).reduce(ee.Reducer.sum());
  return ee.Image.constant(1).subtract(sim).rename('cambio')
    .addBands(ee.Image.constant(par[1]).toInt16().rename('anio'))
    .updateMask(zonaNival(par))
    .set('anio', par[1]).set('anio_previo', par[0]);
}
var colCambio = ee.ImageCollection(PAREJAS.map(cambioAnual));

// Umbral de cada año: percentil PERCENTIL_CAMBIO de la zona nival en ese año, o un
// valor fijo común (UMBRAL_CAMBIO_FIJO) para comparar años entre sí.
function umbralDe(img) {
  if (UMBRAL_CAMBIO_FIJO !== null) return ee.Number(UMBRAL_CAMBIO_FIJO);
  return ee.Number(img.select('cambio').updateMask(cordillera).reduceRegion({
    reducer: ee.Reducer.percentile([PERCENTIL_CAMBIO]), geometry: AOI, scale: 100, maxPixels: 1e10, bestEffort: true
  }).values().get(0));
}

// Convierte una imagen de cambio en puntos GPS (centroides de los focos).
function focosAPuntos(img, umbral, extra, limite) {
  var focos = img.select('cambio').gt(umbral).and(cordillera).selfMask().rename('foco');
  var poligonos = focos.reduceToVectors({geometry: AOI, scale: 60, geometryType: 'polygon', eightConnected: true, maxPixels: 1e10, bestEffort: true});
  return img.addBands(ESTATICAS).addBands(extra).reduceRegions({collection: poligonos, reducer: ee.Reducer.mean(), scale: 30})
    .map(function (f) {
      return ee.Feature(f.geometry().centroid(10), f.toDictionary())
        .set('area_ha', f.geometry().area(10).divide(1e4))
        .set('anio', ee.Number(f.get('anio')).round());
    })
    .filter(ee.Filter.gte('area_ha', 1))
    .sort('cambio', false).limit(limite);
}

// 1a. Lugares de cambio por año: un conjunto de puntos para cada par de años.
var porAnio = PAREJAS.map(function (par) {
  var img = cambioAnual(par);
  var u = umbralDe(img);
  return focosAPuntos(img, u, ee.Image.constant(par[0]).toInt16().rename('anio_previo'), MAX_PUNTOS_POR_ANIO)
    .map(function (f) {
      return f.set('anio_previo', par[0]).set('umbral', u).set('tipo', 'anual');
    });
});
var lugaresCambioPorAnio = ee.FeatureCollection(porAnio).flatten();

// Resumen por año: umbral, área sobre el umbral y número de focos.
var resumenAnios = ee.FeatureCollection(PAREJAS.map(function (par, i) {
  var img = cambioAnual(par), u = umbralDe(img);
  var area = img.select('cambio').gt(u).and(cordillera).selfMask().multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: AOI, scale: 100, maxPixels: 1e10, bestEffort: true}).values().get(0);
  var media = img.select('cambio').updateMask(cordillera).reduceRegion({
    reducer: ee.Reducer.mean(), geometry: AOI, scale: 100, maxPixels: 1e10, bestEffort: true}).values().get(0);
  return ee.Feature(null, {anio_previo: par[0], anio: par[1], umbral: u, cambio_medio_zona_nival: media,
    area_sobre_umbral_km2: ee.Number(area).divide(1e6), focos_exportados: ee.FeatureCollection(porAnio[i]).size()});
}));
print('Pares de años analizados:', PAREJAS);
print('Umbral de cambio por año:', ee.List(PAREJAS.map(function (par) { return ee.List([par[1], umbralDe(cambioAnual(par))]); })));
// La tabla completa (área sobre el umbral y focos) sale en cambio_resumen_por_anio.csv.

// 1b. Resumen de todos los años: el mayor cambio de cada píxel y el año en que ocurrió.
var cambioMax = colCambio.qualityMosaic('cambio');
var cambioMedio = colCambio.select('cambio').mean().rename('cambio_medio');
var lugaresCambio = focosAPuntos(cambioMax, umbralDe(cambioMax), cambioMedio, MAX_PUNTOS)
  .map(function (f) { return f.set('tipo', 'resumen'); });

// Pila con una banda por año (cambio_2018, cambio_2019, ...).
var pilaCambio = ee.ImageCollection(PAREJAS.map(function (par) {
  return cambioAnual(par).select('cambio').rename('cambio_' + par[1]);
})).toBands().rename(PAREJAS.map(function (par) { return 'cambio_' + par[1]; }));

Map.centerObject(AOI, 9);
Map.addLayer(embedding(ANIO_MAX), {min: -0.3, max: 0.3, bands: ['A01', 'A16', 'A09']}, 'Embedding ' + ANIO_MAX, false);
var VIS_CAMBIO = {min: 0, max: 0.6, palette: ['000000', '3f6e93', 'f1ddae', 'b4232c']};
PAREJAS.forEach(function (par, i) {
  Map.addLayer(cambioAnual(par).select('cambio').updateMask(cordillera), VIS_CAMBIO, 'Cambio ' + par[0] + ' a ' + par[1], false);
  Map.addLayer(porAnio[i], {color: 'ffd84d'}, 'Lugares de cambio ' + par[1], false);
});
Map.addLayer(cambioMax.select('cambio'), VIS_CAMBIO, 'Cambio máximo (resumen)');
Map.addLayer(lugaresCambio, {color: 'ffd84d'}, 'Lugares de cambio (resumen)');

// ===================== 2. Tablas de embeddings para el notebook =====================
var BANDAS = BANDAS_EMB.concat(BANDAS_EST);
var BANDAS_PREVIO = BANDAS_EMB.map(function (b) { return 'prev_' + b; });

// 2a. Lugares de cambio: embedding del año anterior (prev_A00...) y del año del cambio (A00...).
var embLugaresCambio = ee.FeatureCollection(PAREJAS.map(function (par, i) {
  var img = embedding(par[1]).addBands(embedding(par[0]).rename(BANDAS_PREVIO)).addBands(ESTATICAS);
  return img.sampleRegions({collection: porAnio[i], properties: ['anio_previo', 'anio', 'cambio', 'area_ha'], scale: 10, geometries: true});
})).flatten();

// 2b. Muestra pareja de la zona nival, la misma en todos los años.
var muestraPuntos = zonaNivalTotal.selfMask().rename('z')
  .sample({region: AOI, scale: 90, numPixels: N_MUESTRA * 4, seed: SEMILLA, geometries: true})
  .randomColumn('r', SEMILLA).sort('r').limit(N_MUESTRA)
  .map(function (p) { return ee.Feature(p.geometry(), {punto: p.id()}); });
var embMuestra = ee.FeatureCollection(ANIOS.map(function (a) {
  return embedding(a).addBands(ESTATICAS).sampleRegions({collection: muestraPuntos, properties: ['punto'], scale: 10, geometries: true})
    .map(function (f) { return f.set('anio', a); });
})).flatten();
Map.addLayer(muestraPuntos, {color: '5fc0f0'}, 'Muestra de zona nival', false);

// ===================== 3. Exportaciones =====================
Export.table.toDrive({collection: lugaresCambioPorAnio, description: 'lugares_cambio_por_anio', folder: CARPETA, fileFormat: 'GeoJSON'});
Export.table.toDrive({collection: lugaresCambio, description: 'lugares_cambio', folder: CARPETA, fileFormat: 'GeoJSON'});
Export.table.toDrive({collection: resumenAnios, description: 'cambio_resumen_por_anio', folder: CARPETA, fileFormat: 'CSV',
  selectors: ['anio_previo', 'anio', 'umbral', 'cambio_medio_zona_nival', 'area_sobre_umbral_km2', 'focos_exportados']});
Export.table.toDrive({collection: embLugaresCambio, description: 'embeddings_lugares_cambio', folder: CARPETA, fileFormat: 'CSV',
  selectors: ['anio_previo', 'anio', 'cambio', 'area_ha'].concat(BANDAS).concat(BANDAS_PREVIO).concat(['.geo'])});
Export.table.toDrive({collection: embMuestra, description: 'embeddings_muestra_nival', folder: CARPETA, fileFormat: 'CSV',
  selectors: ['punto', 'anio'].concat(BANDAS).concat(['.geo'])});
Export.image.toDrive({image: cambioMax.select('cambio').toFloat(), description: 'cambio_maximo_30m', folder: CARPETA, region: AOI, scale: 30, maxPixels: 1e10, crs: 'EPSG:4326'});
Export.image.toDrive({image: cambioMax.select('anio'), description: 'anio_cambio_30m', folder: CARPETA, region: AOI, scale: 30, maxPixels: 1e10, crs: 'EPSG:4326'});
Export.image.toDrive({image: pilaCambio.toFloat(), description: 'cambio_por_anio_30m', folder: CARPETA, region: AOI, scale: 30, maxPixels: 1e10, crs: 'EPSG:4326'});

/* Notas
 - El cambio mide cuánto se diferencia un píxel de un año al siguiente. Puede ser una
   remoción en masa, un aluvión, una faena minera, un glaciar que retrocede o un año
   con más o menos nieve persistente. Hay que revisarlo con imágenes.
 - Si la zona nival queda muy chica o muy grande, ajustar FREC_NIEVE_MIN (0,05 deja
   entrar la nieve estacional baja; 0,30 deja solo la nieve más persistente).
 - Con el umbral por percentil cada año entrega sus focos más fuertes aunque haya sido
   un año tranquilo. Para comparar años entre sí, usar UMBRAL_CAMBIO_FIJO.
 - El entrenamiento de la IA de puntos susceptibles se hace en el notebook, cruzando
   estas tablas con el catastro de prensa, las detecciones satelitales de la V5.2, las
   estaciones DGA y la meteorología ERA5.
*/
