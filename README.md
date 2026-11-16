# Monitor de alteraciones de la nieve, Andes centrales (maqueta)

Maqueta de la plataforma de evaluación de eventos y alteraciones de la nieve. El escenario de riesgo es simulado y la temporada 2022 se muestra con datos preliminares afectados por nubes.

## Publicar en GitHub Pages

1. Crea un repositorio y sube `index.html` a la raíz.
2. En el repositorio, entra a Settings > Pages.
3. En "Build and deployment", elige "Deploy from a branch", la rama `main` y la carpeta `/ (root)`.
4. Guarda. En uno o dos minutos la página queda en `https://<usuario>.github.io/<repositorio>/`.

## Contenido

- Mapa con las cuatro subcuencas, los sitios del catastro y las fuentes de partículas.
- Perfil altitudinal por subcuenca, con un control para simular la isoterma de una tormenta.
- Temporada 2022: albedo por banda de altitud, precipitación diaria y eventos.
- Catastro de 109 eventos de prensa con filtros y ficha por evento.
- Fuentes potenciales de partículas y estado de calidad de los datos.

El archivo es autocontenido: los datos van dentro de `index.html`. Solo carga desde internet el mapa base (Leaflet y relieve de Esri) y las tipografías.
