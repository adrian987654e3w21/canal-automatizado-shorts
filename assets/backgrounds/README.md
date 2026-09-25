# Fondos

El sistema rota entre los clips de esta carpeta. `backgrounds.js` acepta
`.mp4`, `.mov`, `.mkv`, `.webm` y `.m4v`.

Los seis que hay son **abstractos y originales**, generados con las fuentes
sintéticas de FFmpeg:

```bash
npm run backgrounds:generate              # regenera los seis
npm run backgrounds:generate grafito      # regenera solo uno
```

No son material de archivo, pero tienen movimiento, pesan poco y no arrastran
ningún problema de derechos, que es el riesgo real de un canal faceless. Son
suficientes para publicar desde el primer día.

## Cómo sustituirlos por material real

Cuando tengas b-roll vertical con licencia (Pexels, Pixabay, Envato, tus
propias grabaciones), **bórralos y pon los tuyos aquí**. El sistema no cambia:
escanea la carpeta y los va alternando, dando prioridad a los que no ha usado
últimamente.

Recomendaciones para el formato:

- **9:16 vertical, 1080×1920.** Cualquier otra relación se recorta al centrear.
- **Sin audio.** El audio real es la voz en off de ElevenLabs.
- **Movimiento lento y sin cortes bruscos.** Los fondos animados competes con
  el subtítulo; si hay mucho happening, el ojo no lee.
- **Tonos oscuros o poco saturados** en la zona donde va el subtítulo
  (tercio inferior). El texto es blanco con contorno negro y necesita contraste.
- **Sin texto, logotipos ni caras reconocibles** en cuadro: es material de
  archivo reutilizable y por eso está sujeto a copyright.
- Entre 30 y 60 segundos. El pipeline usa `-stream_loop -1`, así que un clip
  corto se repite, pero el salto de empalme se nota.

## Nota sobre el modo local

Si activas `USE_LOCAL_AI=true`, la ruta de esta carpeta cambia a
`/data/backgrounds` dentro del contenedor, mapeada desde aquí por
`docker-compose.yml`.
