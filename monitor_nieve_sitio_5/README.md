# Monitor de nieve, Andes centrales

Plataforma web estática (GitHub Pages) con dos partes:

| Página | Para qué sirve |
|---|---|
| `index.html`, Predicción | Probabilidad de lluvia sobre nieve y de polvo sobre nieve en los próximos 3 días para cada lugar de estudio, con sus consecuencias esperadas. Al elegir un lugar, el mapa marca con borde negro la subcuenca DGA donde se calcula su riesgo (la que contiene el punto de pronóstico de su cuenca de origen), el punto de pronóstico y la línea que lo une con el lugar; bajo el resumen se indica la subcuenca, el punto y las celdas de la grilla que caen dentro. Combina la susceptibilidad del lugar (catastro y fuentes de polvo) con la condición meteorológica pronosticada (Open-Meteo u OpenWeatherMap). |
| `fechas.html`, Datos por fecha | Todos los datos del proyecto alineados por fecha para compararlos, solo dentro del período de estudio (junio a octubre de cada año): se elige un año y se avanza día por día. Las fechas y los eventos fuera de esos meses no se muestran; si un enlace apunta a uno, la página avisa y abre el 1 de junio. Muestra el mapa del día (nieve MODIS, eventos del catastro, cuencas y capas de referencia), un resumen de lo que dice cada fuente ese día y una línea de tiempo comparada con el catastro, la precipitación y la isoterma de ERA5 por cuenca, la nieve y las nubes de MODIS, el albedo Sentinel-2, las detecciones V5 y columnas de un CSV propio (por ejemplo, resultados del notebook). Al elegir un evento se abre su ficha con lo que dicen las otras fuentes. Se puede descargar la tabla diaria del año en CSV. |

`estudios.html` queda como página de referencia (enlace al pie de las dos páginas). `explorar.html` y `revisar.html` ahora redirigen a `fechas.html`, así que los enlaces antiguos (por ejemplo `revisar.html?evento=81`) siguen funcionando.

La vista por fecha acepta `fechas.html?evento=ID` y `fechas.html?fecha=AAAA-MM-DD`. El período de estudio se cambia en `fechas.html` con `MES_INI` y `MES_FIN`.

## Publicar en GitHub Pages

1. Sube todo el contenido de esta carpeta a la raíz de un repositorio.
2. En el repositorio: Settings > Pages > Deploy from a branch, rama `main`, carpeta `/ (root)`.
3. La página queda en `https://<usuario>.github.io/<repositorio>/`.

## Capas de cuencas, ríos y caminos

| Capa | Fuente principal | Respaldo |
|---|---|---|
| Subcuencas y cuencas | División de cuencas DGA, servicio ArcGIS del MMA (`SIMBIO_DIVISION_CUENCA`) | ninguno |
| Ríos | Red hidrográfica MOP 1:250.000 (`MAPA_BASE/RED_HIDROGRAFICA`) | OpenStreetMap |
| Caminos | Red vial MOP, Dirección de Vialidad | Red vial estructurante MOP, luego OpenStreetMap |
| Estaciones fluviométricas | DGA, servicio de alertas de crecida | ninguno |
| Faenas mineras | Capa "Faenas mineras" de la IDE de la Superintendencia del Medio Ambiente (empresa, faena, tipo, mineral, situación) | ninguno |
| Depósitos de relaves | Catastro de relaves de SERNAGEOMIN, publicado por la SMA (apagada por defecto) | ninguno |
| Volcanes activos | Ranking de riesgo de volcanes activos de SERNAGEOMIN | lista fija: Tupungato, Tupungatito, San José y Maipo |

Las páginas buscan primero los archivos en `datos/`. Si no están, consultan los servicios en vivo desde el navegador, lo que es más lento y puede fallar si un servicio no permite consultas desde otro sitio. Por eso conviene descargarlas una vez:

```
python herramientas/descargar_capas.py
```

El script usa solo la biblioteca estándar de Python, guarda en `datos/` las subcuencas, cuencas, ríos, caminos, faenas, relaves y volcanes, y luego hay que subir esa carpeta al repositorio. El panel "Capas" de cada mapa indica de qué fuente se cargó cada capa.

## Grilla sobre toda el área de estudio

Además de un punto por cuenca alta, la página de predicción pide a Open-Meteo una grilla de 144 puntos cada 0,15° (unos 15 km) que cubre todo el cuadro de estudio. En cada punto se evalúa, con su propia altura, si llovería sobre nieve (el punto está sobre la nieve previa y bajo la línea de nieve en tormenta) o si llegaría polvo desde las fuentes cercanas. Las celdas se pintan según la probabilidad y cada subcuenca toma el valor de su celda más alta. La grilla pide solo 6 variables y se guarda una hora en el navegador para no superar el límite gratuito de Open-Meteo (10.000 consultas diarias). La lista de puntos está en `datos/grilla_open_meteo.txt`.

## Variables de Open-Meteo

Consulta por cuenca con 3 días pasados y 4 de pronóstico, viento en m/s y hora de Chile.

- Por hora: temperatura, humedad relativa, probabilidad de precipitación, precipitación, lluvia, chubascos, nieve, espesor de nieve, nubosidad, viento y ráfagas a 10 m, humedad del suelo (0-1 y 9-27 cm), isoterma 0 °C, vapor de agua total, temperatura de bulbo húmedo, CAPE, altura de la capa límite, horas de sol y radiación solar; en altura, temperatura a 850, 700, 600 y 500 hPa, humedad a 700 hPa, viento a 700 y 500 hPa y altura geopotencial a 700 y 500 hPa.
- Actuales: temperatura, precipitación, lluvia, nieve, viento, nubosidad e isoterma.
- Diarias: precipitación, lluvia y nieve del día, horas con precipitación, temperatura máxima y mínima, ráfaga máxima, dirección dominante y radiación del día.

Cómo se usan: si el modelo no entrega la isoterma, se calcula desde el perfil de temperatura en altura; la nieve previa baja a la cota de la nevada de los últimos 3 días; el polvo pesa menos con aire húmedo; el vapor de agua y el CAPE se informan como señales de río atmosférico y de tormentas convectivas. Si la consulta completa falla, se usa una reducida. El pronóstico de las 4 cuencas se puede descargar en CSV desde "Datos meteorológicos de entrada".

## Comentarios con IA

Al elegir un lugar, el botón del recuadro "Comentario" interpreta la predicción en un párrafo.

- Sin clave: comentario automático armado con las variables (qué la empuja, qué la limita, consecuencias más frecuentes). No usa servicios externos.
- Con clave de Anthropic: el comentario lo escribe un modelo de IA (`claude-haiku-5-5`, configurable en `assets/comun.js`, `IA_MODELO`). La clave se ingresa en "Datos meteorológicos de entrada" y queda guardada solo en ese navegador; nunca se escribe en el código, porque el sitio es público. Solo se envían los datos de la predicción. Cada comentario usa créditos de la cuenta de esa clave.

## Clave de OpenWeatherMap

La clave gratuita (plan Free, pronóstico de 5 días cada 3 horas) se puede ingresar en la página, donde queda guardada solo en ese navegador, o escribirla en `assets/comun.js` (`OWM_API_KEY`). Si se escribe en el archivo, queda visible para cualquiera que vea el código del sitio. Una clave nueva puede tardar hasta 2 horas en activarse.

## Método de la predicción (modelo inicial por reglas)

Probabilidad = condición meteorológica x (0,35 + 0,65 x susceptibilidad).

- Lluvia sobre nieve. Susceptibilidad: tasa anual de eventos del catastro en el lugar (lluvia sobre nieve 1, tormenta cálida 0,6, avalancha 0,3). Condición: precipitación que cae sobre nieve existente según la isoterma 0 °C menos 280 m, ponderada por el espesor de la franja.
- Polvo sobre nieve. Susceptibilidad: faenas mineras activas y fuentes documentadas a menos de 35 km, ponderadas por distancia. Condición: horas secas con viento de 6 m/s o más soplando desde una fuente hacia la cuenca, con nieve presente.
- Consecuencias: frecuencia con que cada consecuencia (aluvión, crecida, corte de agua, cierre de ruta, aislados, avalancha, cortes de luz) aparece en los eventos pasados del lugar, multiplicada por la probabilidad.
- Línea de nieve previa: valor de referencia mensual corregible en la página; debe reemplazarse por la línea de nieve observada.
- Siguiente paso: reemplazar las reglas por un modelo entrenado con el catastro, las escenas satelitales y ERA5, validado con años no usados para entrenar.

## Ubicación de los eventos

Cada evento del catastro se ubicó en el lugar más preciso que menciona la noticia (localidad, tramo de ruta, quebrada), con un nivel de precisión y un radio de incertidumbre: punto exacto (500 m), localidad (2 km), sector (6 km), comuna o cuenca (15 km). Las coordenadas vienen de GeoNames, Wikipedia u otras fuentes citadas; las estimadas quedan marcadas "por verificar". La tabla completa está en `datos/eventos_geolocalizados_v2.csv`.

## Nieve diaria MODIS y línea de nieve por año

GEE exporta una carpeta con un GeoTIFF por día (`nieve_dia_AAAA_MM_DD.tif`, bandas `nieve` con las nubes rellenadas en GEE y `nieve_sin_relleno`; valores 0 nubes o sin dato, 1 sin nieve, 2 nieve) y el CSV `linea_nieve_AAAA_jun_oct.csv` con la línea de nieve diaria por zona y ladera. Para agregar un año al sitio:

```
pip install numpy rasterio
python herramientas/preparar_nieve.py nieve_linea_diaria/
```

El script reproyecta las imágenes a Web Mercator para que calcen con el mapa y guarda en `datos/` un archivo por año, `nieve_AAAA.js` (clases sin rellenar y con relleno de GEE, estadísticas diarias y línea de nieve), y la lista de años en `nieve_indice.js`. Son archivos .js para que la página funcione también abierta desde el computador con doble clic, donde el navegador no deja leer .json ni .bin. También acepta el formato anterior (un GeoTIFF con una banda por día). Ya viene incluido 2023 (junio a octubre).

La fecha se elige en un calendario que marca los días con noticia (con el color del tipo de evento) y lista las noticias del mes. En el mapa, los botones de abajo a la izquierda prenden y apagan la nieve del día, la línea de nieve por zona y los eventos. En el panel Capas se elige cómo mostrar las nubes: relleno de GEE, último día despejado de cada píxel (en tormentas largas muestra la nieve de antes de la tormenta) o sin rellenar.

Revisión de calidad de la línea de nieve que aplica el script (constantes al inicio de `preparar_nieve.py`):

- Si una zona tiene "ok" pero menos de 2 % de nieve visible, la línea queda en la cumbre de la zona y no significa nada: pasa a `sin_nieve`.
- Si el error de clasificación supera 15 %, la línea se marca `dudosa` y se dibuja con un círculo vacío.
- Las zonas de menos de 1.000 píxeles (unos 250 km²) no se muestran.

Las zonas se nombran con la subcuenca DGA que contiene su centro cuando `datos/subcuencas.geojson` está cargado; si el CSV trae una columna `nombre`, se usa esa.

La meteorología de la vista por fecha se pide al reanálisis ERA5 de Open-Meteo desde el navegador (precipitación y temperatura horarias en el punto alto de cada cuenca; la isoterma se estima con 6,5 °C por km) y se guarda en el navegador para no repetir la consulta.

## Embeddings y lugares de cambio

`herramientas/gee_embeddings_cambio.js` se pega en el Code Editor de Google Earth Engine. Usa los embeddings anuales de AlphaEarth (`GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL`, 64 bandas, 10 m) para:

1. Calcular el cambio de cada píxel entre años consecutivos, de dos formas:
   - por año: un mapa y puntos GPS para cada par de años (2017 a 2018, 2018 a 2019, ...), con el umbral de ese año (`lugares_cambio_por_anio.geojson`, `cambio_resumen_por_anio.csv`, `cambio_por_anio_30m.tif` con una banda por año);
   - resumen: el mayor cambio del período y el año en que ocurrió (`lugares_cambio.geojson`).
   Por defecto el umbral es el percentil 99 de cada año; con `UMBRAL_CAMBIO_FIJO` se usa el mismo valor en todos los años para compararlos.
2. Exportar los embeddings y el terreno para entrenar la IA en el notebook: en cada lugar de cambio (año anterior y año del cambio, `embeddings_lugares_cambio.csv`) y en una muestra pareja de la cordillera para cada año (`embeddings_muestra_cordillera.csv`).

El script no usa el catastro de eventos de prensa, que es una fuente independiente. El cruce con los eventos, las detecciones satelitales y las estaciones se hace en el notebook, que entregará `puntos_susceptibles.geojson`.

Los GeoJSON se copian a `datos/` y aparecen solos como capas en los mapas. La capa de lugares de cambio tiene un selector para ver un año, todos los años juntos o el resumen.

## Archivos

```
index.html            Predicción
fechas.html           Datos por fecha
estudios.html         Estudios de referencia
explorar.html, revisar.html   redirigen a fechas.html
assets/estilo.css     estilos comunes
assets/comun.js       configuración, carga de capas, mapa y gráficos
assets/datos.js       temporada 2022 (preliminar) y catastro de eventos
assets/estudios.js    estudios de referencia
datos/                capas GeoJSON, nieve MODIS por año y catastro en CSV
herramientas/descargar_capas.py
herramientas/preparar_nieve.py
herramientas/gee_embeddings_cambio.js
```
