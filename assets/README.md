# Assets

Los fondos del pipeline viven en `assets/backgrounds/`. Configura el archivo
con `BACKGROUND_FILE` en `.env`:

```env
BACKGROUND_FILE=assets/backgrounds/default.mp4
```

Recomendaciones:

- MP4 H.264 o WebM que FFmpeg pueda decodificar.
- También funciona un vídeo horizontal: se recorta automáticamente a 9:16.
- Idealmente evita textos, marcas de agua y audio con derechos restringidos.
- Si el vídeo es corto, el pipeline lo repite mediante `-stream_loop -1`.
- Ejecuta `npm run background:demo` para generar un fondo abstracto de prueba.
