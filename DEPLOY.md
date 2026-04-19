# Despliegue Node.js

## Requisitos

- Node.js 20 o superior
- PostgreSQL accesible desde el servidor

## Configuracion

Puedes usar uno de estos archivos:

- `.env`
- `config/app_env.json`

### `.env`

```env
DATABASE_URL=postgresql://USUARIO:CLAVE@HOST/neondb?sslmode=require
APP_BASE_URL=
SESSION_SECRET=cambia-esta-clave
PORT=3000
```

### `config/app_env.json`

```json
{
  "DATABASE_URL": "postgresql://USUARIO:CLAVE@HOST/neondb?sslmode=require",
  "APP_BASE_URL": ""
}
```

## Ejecucion

Instala dependencias:

```bash
npm install
```

Inicia el servidor:

```bash
npm start
```

En desarrollo:

```bash
npm run dev
```

## Rutas principales

- `/`
- `/admin`
- `/employee`
- `/pos?pos_id=...`
- `/ticket?sale_id=...`

## Subida a la nube

1. Sube el proyecto completo.
2. Configura `DATABASE_URL`.
3. Configura `SESSION_SECRET`.
4. Asegura permisos de escritura para:
   - `public/uploads/settings`
   - `public/uploads/products`
5. Ejecuta `npm install`.
6. Inicia `node server.js`.

## Notas para Netlify

- Este repositorio contiene una aplicación Node.js con backend Express y PostgreSQL.
- Netlify puede alojar la parte estática del frontend (HTML/CSS/JS), pero no puede ejecutar el servidor Node.js ni la API de PostgreSQL.
- Para usar el sistema completo, el backend debe correr en un servicio separado y las llamadas a `/api/*` deben apuntar a esa API.
- Se agregó `netlify.toml` para publicar el sitio estático desde la raíz y mapear algunas rutas amigables.
- El deploy está ahora configurado con `index.html` en la raíz y todas las páginas secundarias dentro de la carpeta `licoreria/`.
