# Menu Digital

Menu digital responsivo para restaurantes. Un solo archivo HTML, sin dependencias externas.

## Caracteristicas

- **Sin dependencias** — todo en un solo `index.html`
- **Mobile-first** — disenado para escanear desde el celular
- **Navegacion por categorias** — chips sticky que siguen el scroll
- **Zoom con lightbox** — toca cualquier imagen para verla en grande
- **Swipe** — navega entre fotos con gestos táctiles
- **Scroll activo** — el chip de la categoria visible se resalta automaticamente
- **Tema oscuro** — colores negros y naranjas, estilo parrilla

## Uso

Abre `index.html` en cualquier navegador. No necesita servidor ni build.

## Estructura

El menu se define en el array `DATA` dentro del `<script>`:

```js
const DATA = [
  {
    id: "verdugo",
    label: "Verdugo · Entradas & Bebidas",
    images: [{ b64: "...", src: "" }]
  }
];
```

Cada grupo tiene un `id`, un `label` y un array de `images` con la imagen en base64.

## Personalizar

1. Edita el array `DATA` en `index.html`
2. Reemplaza las imagenes base64 con las tuyas
3. Cambia los colores en las variables CSS (`:root`)
4. Deploya en GitHub Pages, Netlify, Vercel o cualquier hosting estatico
