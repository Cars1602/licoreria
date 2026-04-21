import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import QRCode from 'qrcode';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(publicDir, 'uploads');
const settingsUploadDir = path.join(uploadsDir, 'settings');
const productsUploadDir = path.join(uploadsDir, 'products');
const schemaFile = path.join(__dirname, 'config', 'schema.sql');

fs.mkdirSync(settingsUploadDir, { recursive: true });
fs.mkdirSync(productsUploadDir, { recursive: true });

function readJsonConfig(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

const appEnvConfig = {
  ...readJsonConfig(path.join(__dirname, 'config', 'app_env.json')),
  ...readJsonConfig(path.join(__dirname, 'config', 'app_env.local.json')),
};

const DATABASE_URL = process.env.DATABASE_URL || appEnvConfig.DATABASE_URL || '';
if (!DATABASE_URL) {
  throw new Error('Configura DATABASE_URL para iniciar el backend Node.js');
}

const configuredBaseUrl = process.env.APP_BASE_URL || appEnvConfig.APP_BASE_URL || '';
const normalizedBaseUrl = configuredBaseUrl.replace(/^\/+|\/+$/g, '');
const APP_BASE_URL = normalizedBaseUrl;
const basePrefix = APP_BASE_URL ? `/${APP_BASE_URL}` : '';
const databaseUrlObject = new URL(DATABASE_URL);
const requiresSsl = databaseUrlObject.searchParams.get('sslmode') === 'require';
databaseUrlObject.searchParams.delete('sslmode');
databaseUrlObject.searchParams.delete('channel_binding');

const pool = new Pool({
  connectionString: databaseUrlObject.toString(),
  ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
});

const settingsFile = path.join(__dirname, 'config', 'app_settings.json');
const mobileTokenSecret = process.env.MOBILE_POS_SECRET || process.env.SESSION_SECRET || 'licoreria-mobile-pos-secret';
const defaultSettings = {
  business_name: 'Licoreria',
  currency_symbol: 'Bs',
  low_stock_alert_days: 7,
  default_payment_method: 'CASH',
  support_phone: '',
  store_message: 'Gracias por tu compra.',
  qr_payment_image: '',
  qr_payment_label: 'Escanea este QR para realizar el pago.',
};

function readLegacySettingsFile() {
  if (!fs.existsSync(settingsFile)) return { ...defaultSettings };
  try {
    const raw = fs.readFileSync(settingsFile, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaultSettings, ...parsed };
  } catch {
    return { ...defaultSettings };
  }
}

async function readSettings() {
  const result = await pool.query(
    'SELECT settings FROM app_settings WHERE id = 1 LIMIT 1'
  );

  if (!result.rows.length) {
    return { ...defaultSettings };
  }

  return { ...defaultSettings, ...(result.rows[0].settings || {}) };
}

async function writeSettings(settings) {
  const normalized = { ...defaultSettings, ...(settings || {}) };
  await pool.query(`
    INSERT INTO app_settings (id, settings, updated_at)
    VALUES (1, $1::jsonb, now())
    ON CONFLICT (id)
    DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()
  `, [JSON.stringify(normalized)]);
}

function appUrl(relativePath = '') {
  if (!relativePath) return basePrefix || '/';
  return `${basePrefix}/${relativePath.replace(/^\/+/, '')}`;
}

function normalizeBoolean(value) {
  return value === true || value === 't' || value === 'true' || value === '1' || value === 1;
}

function normalizeNullableText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeNullableNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeNullableDate(value) {
  const text = String(value || '').trim();
  return text || null;
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function defaultProductQrPayload(barcode) {
  return `PROD:${barcode}`;
}

function normalizeScannedBarcode(qrText) {
  const raw = String(qrText || '').trim();
  if (!raw) return '';

  if (raw.startsWith('PROD:')) {
    return raw.slice(5).trim();
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.barcode) return String(parsed.barcode).trim();
    if (parsed?.product_barcode) return String(parsed.product_barcode).trim();
  } catch {
    // ignore parse errors
  }

  try {
    const url = new URL(raw);
    const barcode = url.searchParams.get('barcode') || url.searchParams.get('product');
    if (barcode) return barcode.trim();
  } catch {
    // ignore parse errors
  }

  return raw;
}

function getLanIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }
  return 'localhost';
}

function getExternalBaseUrl(req) {
  const configured = process.env.PUBLIC_BASE_URL || appEnvConfig.PUBLIC_BASE_URL || '';
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  // En producción (Render), usar la URL de Render desde el host
  if (process.env.NODE_ENV === 'production' || req.get('host')?.includes('onrender.com')) {
    const host = req.get('host');
    return `https://${host}${basePrefix}`;
  }
  // En desarrollo, usar IP local
  const host = req.get('host') || `localhost:${PORT}`;
  const port = host.includes(':') ? host.split(':').pop() : String(PORT);
  return `http://${getLanIpAddress()}:${port}${basePrefix}`;
}

function signMobilePosToken(posId) {
  const payload = {
    posId,
    exp: Date.now() + (1000 * 60 * 60 * 12),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', mobileTokenSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyMobilePosToken(token) {
  if (!token || !token.includes('.')) {
    throw new Error('Token invalido');
  }

  const [encoded, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', mobileTokenSecret).update(encoded).digest('base64url');
  if (signature !== expected) {
    throw new Error('Firma invalida');
  }

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (!payload.posId || !payload.exp || payload.exp < Date.now()) {
    throw new Error('Token expirado');
  }

  return payload;
}

async function getPosSessionForUser(posId, user) {
  const sessionResult = await pool.query(
    'SELECT id, employee_id, active, created_at FROM pos_sessions WHERE id = $1 LIMIT 1',
    [posId]
  );

  if (!sessionResult.rows.length || !normalizeBoolean(sessionResult.rows[0].active)) {
    throw new Error('Sesion POS invalida');
  }

  if (user.role !== 'admin' && sessionResult.rows[0].employee_id !== user.id) {
    throw new Error('Acceso denegado');
  }

  return sessionResult.rows[0];
}

async function getPosCartSnapshot(posId) {
  const cart = await pool.query(`
    SELECT c.product_id, c.qty, p.name, p.barcode, p.price, p.stock, p.qr_payload, (p.price * c.qty) AS subtotal
    FROM cart_items c
    INNER JOIN products p ON p.id = c.product_id
    WHERE c.pos_id = $1
    ORDER BY p.name ASC
  `, [posId]);

  return cart.rows;
}

async function addProductToCartByBarcode(posId, barcode) {
  const normalizedBarcode = normalizeScannedBarcode(barcode);
  const productResult = await pool.query(
    `SELECT id, name, stock
     FROM products
     WHERE active = TRUE
       AND (barcode = $1 OR qr_payload = $2)
     LIMIT 1`,
    [normalizedBarcode, String(barcode || '').trim()]
  );

  if (!productResult.rows.length) {
    throw new Error('Producto no encontrado');
  }

  const product = productResult.rows[0];
  const existing = await pool.query(
    'SELECT qty FROM cart_items WHERE pos_id = $1 AND product_id = $2',
    [posId, product.id]
  );
  const currentQty = existing.rows[0]?.qty || 0;

  if (Number(product.stock) < Number(currentQty) + 1) {
    throw new Error('No hay stock suficiente');
  }

  if (existing.rows.length) {
    await pool.query(
      'UPDATE cart_items SET qty = qty + 1 WHERE pos_id = $1 AND product_id = $2',
      [posId, product.id]
    );
  } else {
    await pool.query(
      'INSERT INTO cart_items (pos_id, product_id, qty) VALUES ($1, $2, 1)',
      [posId, product.id]
    );
  }

  return product;
}

async function initializeDatabase() {
  const schemaSql = fs.readFileSync(schemaFile, 'utf8');
  await pool.query(schemaSql);
  await pool.query(`
    ALTER TABLE suppliers
      ADD COLUMN IF NOT EXISTS contact_name TEXT NULL,
      ADD COLUMN IF NOT EXISTS email TEXT NULL,
      ADD COLUMN IF NOT EXISTS address TEXT NULL,
      ADD COLUMN IF NOT EXISTS notes TEXT NULL
  `);
  await pool.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS supplier_id UUID NULL REFERENCES suppliers(id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INT PRIMARY KEY,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (id = 1)
    )
  `);

  const existingSettings = await pool.query('SELECT id FROM app_settings WHERE id = 1 LIMIT 1');
  if (!existingSettings.rows.length) {
    const legacySettings = readLegacySettingsFile();
    await writeSettings(legacySettings);
  }
}

async function generateInvoiceNo(client) {
  const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const result = await client.query("SELECT COUNT(*)::int AS total FROM sales WHERE created_at::date = CURRENT_DATE");
  const count = result.rows[0]?.total || 0;
  return `V-${datePrefix}-${String(count + 1).padStart(4, '0')}`;
}

function getAllowedOrigins() {
  const configuredOrigins = String(process.env.ALLOWED_ORIGINS || appEnvConfig.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([
    'https://licoreia-chaquenaso-edu-bo-m1.netlify.app',
    'https://magical-bonbon-e7e0ce.netlify.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    ...configuredOrigins,
  ]);
}

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'licoreria-node-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'none',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12,
  },
}));

app.use((req, res, next) => {
  const allowedOrigins = getAllowedOrigins();
  const origin = req.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(basePrefix, express.static(publicDir, { index: false }));
app.use('/assets', express.static(path.join(__dirname, 'assets'), { index: false }));
app.use('/licoreria/assets', express.static(path.join(__dirname, 'licoreria', 'assets'), { index: false }));

// Handle favicon.ico requests
app.get('/favicon.ico', (req, res) => res.status(204).end());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
}

function requireEmployeeOrAdmin(req, res, next) {
  if (!req.session.user || !['admin', 'empleado'].includes(req.session.user.role)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
}

function redirectByRole(req, res) {
  const user = req.session.user;
  if (!user) {
    return res.redirect(appUrl());
  }
  return res.redirect(user.role === 'admin' ? appUrl('admin') : appUrl('employee'));
}

async function getCatalogOptions() {
  const [categories, brands, suppliers] = await Promise.all([
    pool.query('SELECT id, name, active FROM categories ORDER BY name ASC'),
    pool.query('SELECT id, name, active FROM brands ORDER BY name ASC'),
    pool.query(`
      SELECT id, name, phone, contact_name, email, address, notes, active
      FROM suppliers
      ORDER BY name ASC
    `),
  ]);

  return {
    categories: categories.rows,
    brands: brands.rows,
    suppliers: suppliers.rows,
  };
}

app.get(appUrl(), (req, res) => {
  if (req.session.user) {
    return redirectByRole(req, res);
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get(appUrl('admin'), (req, res) => {
  if (!req.session.user) {
    return res.redirect(appUrl());
  }
  if (req.session.user.role !== 'admin') {
    return res.redirect(appUrl('employee'));
  }
  res.redirect(appUrl('dashboard.html'));
});

[
  'admin.html',
  'dashboard.html',
  'productos.html',
  'marcas-categorias.html',
  'movimientos.html',
  'proveedores.html',
  'ventas.html',
  'usuarios.html',
  'reportes.html',
  'configuracion.html',
].forEach((fileName) => {
  app.get(appUrl(fileName), (req, res) => {
    if (!req.session.user) {
      return res.redirect(appUrl());
    }
    if (req.session.user.role !== 'admin') {
      return res.redirect(appUrl('employee'));
    }
    return res.sendFile(path.join(__dirname, fileName));
  });
});

app.get(appUrl('employee'), (req, res) => {
  if (!req.session.user) {
    return res.redirect(appUrl());
  }
  res.sendFile(path.join(__dirname, 'employee.html'));
});

app.get(appUrl('pos'), (req, res) => {
  if (!req.session.user) {
    return res.redirect(appUrl());
  }
  res.sendFile(path.join(__dirname, 'pos.html'));
});

app.get(appUrl('ticket'), (req, res) => {
  if (!req.session.user) {
    return res.redirect(appUrl());
  }
  res.sendFile(path.join(__dirname, 'ticket.html'));
});

app.get(appUrl('mobile-pos.html'), (_, res) => {
  res.sendFile(path.join(__dirname, 'mobile-pos.html'));
});

app.get(appUrl('mobile-pos'), (_, res) => {
  res.sendFile(path.join(__dirname, 'mobile-pos.html'));
});

app.get(appUrl('api/config'), async (_, res) => {
  try {
    res.json({
      appBaseUrl: basePrefix,
      settings: await readSettings(),
    });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo cargar la configuracion', detail: error.message });
  }
});

app.post(appUrl('api/auth/login'), async (req, res) => {
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '').trim();

  if (!email || !password) {
    return res.status(400).json({ error: 'Completa los campos' });
  }

  try {
    const result = await pool.query(
      `SELECT id, display_name, email, role, active
       FROM users
       WHERE email = $1
         AND password_hash = crypt($2, password_hash)
       LIMIT 1`,
      [email, password]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    const user = result.rows[0];
    const isActive = normalizeBoolean(user.active);

    if (!isActive) {
      return res.status(403).json({ error: 'Usuario inactivo' });
    }

    req.session.user = {
      id: user.id,
      display_name: user.display_name,
      email: user.email,
      role: user.role,
    };

    res.json({ ok: true, user: req.session.user });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo iniciar sesion', detail: error.message });
  }
});

app.post(appUrl('api/auth/logout'), (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get(appUrl('api/auth/me'), (req, res) => {
  res.json({ user: req.session.user || null });
});

app.get(appUrl('api/admin/dashboard'), requireAdmin, async (_, res) => {
  try {
    const [products, lowStock, expiring, salesToday, users, topProducts, settings] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS total FROM products WHERE active = TRUE"),
      pool.query("SELECT COUNT(*)::int AS total FROM products WHERE active = TRUE AND stock <= stock_min"),
      pool.query("SELECT COUNT(*)::int AS total FROM products WHERE active = TRUE AND expires_at IS NOT NULL AND expires_at <= CURRENT_DATE + INTERVAL '7 days'"),
      pool.query("SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE status = 'PAID' AND created_at::date = CURRENT_DATE"),
      pool.query('SELECT COUNT(*)::int AS total FROM users WHERE active = TRUE'),
      pool.query(`
        SELECT si.name_snap, si.barcode_snap, COALESCE(SUM(si.qty), 0) AS qty_sold
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
        WHERE s.status = 'PAID'
        GROUP BY si.name_snap, si.barcode_snap
        ORDER BY qty_sold DESC, si.name_snap ASC
        LIMIT 5
      `),
      readSettings(),
    ]);

    res.json({
      cards: {
        products: products.rows[0].total,
        lowStock: lowStock.rows[0].total,
        expiring: expiring.rows[0].total,
        salesToday: salesToday.rows[0].total,
        users: users.rows[0].total,
      },
      topProducts: topProducts.rows,
      settings,
    });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo cargar el dashboard', detail: error.message });
  }
});

app.get(appUrl('api/admin/catalogs'), requireAdmin, async (_, res) => {
  try {
    res.json(await getCatalogOptions());
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron cargar los catalogos', detail: error.message });
  }
});

app.post(appUrl('api/admin/catalogs/:type'), requireAdmin, async (req, res) => {
  const catalogMap = {
    categories: 'categories',
    brands: 'brands',
    suppliers: 'suppliers',
  };
  const tableName = catalogMap[req.params.type];
  if (!tableName) {
    return res.status(400).json({ error: 'Catalogo invalido' });
  }

  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }

  try {
    let result;
    if (tableName === 'suppliers') {
      const phone = normalizeNullableText(req.body.phone);
      const contactName = normalizeNullableText(req.body.contact_name);
      const email = normalizeNullableText(req.body.email);
      const address = normalizeNullableText(req.body.address);
      const notes = normalizeNullableText(req.body.notes);
      result = await pool.query(
        `INSERT INTO suppliers (name, phone, contact_name, email, address, notes, active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         ON CONFLICT (name) DO UPDATE
         SET phone = COALESCE(EXCLUDED.phone, suppliers.phone),
             contact_name = COALESCE(EXCLUDED.contact_name, suppliers.contact_name),
             email = COALESCE(EXCLUDED.email, suppliers.email),
             address = COALESCE(EXCLUDED.address, suppliers.address),
             notes = COALESCE(EXCLUDED.notes, suppliers.notes)
         RETURNING id, name, phone, contact_name, email, address, notes, active`,
        [name, phone, contactName, email, address, notes]
      );
    } else {
      result = await pool.query(
        `INSERT INTO ${tableName} (name, active)
         VALUES ($1, TRUE)
         ON CONFLICT (name) DO UPDATE SET active = TRUE
         RETURNING id, name, active`,
        [name]
      );
    }

    res.json({ ok: true, item: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo guardar el catalogo', detail: error.message });
  }
});

app.delete(appUrl('api/admin/catalogs/:type/:id'), requireAdmin, async (req, res) => {
  const catalogMap = {
    categories: 'categories',
    brands: 'brands',
    suppliers: 'suppliers',
  };
  const tableName = catalogMap[req.params.type];
  if (!tableName) {
    return res.status(400).json({ error: 'Catalogo invalido' });
  }

  try {
    await pool.query(`DELETE FROM ${tableName} WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({
      error: 'No se pudo eliminar el catalogo',
      detail: error.message,
    });
  }
});

app.get(appUrl('api/admin/products'), requireAdmin, async (_, res) => {
  try {
    const [products, catalogs] = await Promise.all([
      pool.query(`
        SELECT p.id, p.barcode, p.name, p.cost, p.price, p.stock, p.stock_min, p.unit, p.image_url,
               p.qr_payload, p.expires_at, p.category_id, p.brand_id, p.supplier_id, p.active, p.created_at, p.updated_at,
               c.name AS category_name, b.name AS brand_name, s.name AS supplier_name
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        ORDER BY p.created_at DESC, p.name ASC
      `),
      getCatalogOptions(),
    ]);

    res.json({
      items: products.rows,
      ...catalogs,
    });
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron cargar los productos', detail: error.message });
  }
});

app.get(appUrl('api/admin/products/:id/qr'), requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, barcode, qr_payload FROM products WHERE id = $1 LIMIT 1',
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const product = result.rows[0];
    const payload = product.qr_payload || defaultProductQrPayload(product.barcode);
    const qrDataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
    });

    res.json({
      product,
      payload,
      qrDataUrl,
    });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo generar el QR del producto', detail: error.message });
  }
});

app.post(appUrl('api/admin/products'), requireAdmin, async (req, res) => {
  const barcode = String(req.body.barcode || '').trim();
  const name = String(req.body.name || '').trim();
  if (!barcode || !name) {
    return res.status(400).json({ error: 'Codigo y nombre son obligatorios' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO products (
        barcode, name, cost, price, stock, stock_min, unit, image_url, qr_payload, expires_at, category_id, brand_id, supplier_id, active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULLIF($11, '')::uuid, NULLIF($12, '')::uuid, NULLIF($13, '')::uuid, $14)
      RETURNING id
    `, [
      barcode,
      name,
      normalizeNullableNumber(req.body.cost, 0),
      normalizeNullableNumber(req.body.price, 0),
      normalizeNullableNumber(req.body.stock, 0),
      normalizeNullableNumber(req.body.stock_min, 0),
      String(req.body.unit || 'und').trim() || 'und',
      normalizeNullableText(req.body.image_url),
      normalizeNullableText(req.body.qr_payload) || defaultProductQrPayload(barcode),
      normalizeNullableDate(req.body.expires_at),
      String(req.body.category_id || '').trim(),
      String(req.body.brand_id || '').trim(),
      String(req.body.supplier_id || '').trim(),
      normalizeBoolean(req.body.active),
    ]);

    res.json({ ok: true, id: result.rows[0].id });
  } catch (error) {
    res.status(400).json({ error: 'No se pudo guardar el producto', detail: error.message });
  }
});

app.put(appUrl('api/admin/products/:id'), requireAdmin, async (req, res) => {
  const barcode = String(req.body.barcode || '').trim();
  const name = String(req.body.name || '').trim();
  if (!barcode || !name) {
    return res.status(400).json({ error: 'Codigo y nombre son obligatorios' });
  }

  try {
    await pool.query(`
      UPDATE products
      SET barcode = $2,
          name = $3,
          cost = $4,
          price = $5,
          stock = $6,
          stock_min = $7,
          unit = $8,
          image_url = $9,
          qr_payload = $10,
          expires_at = $11,
          category_id = NULLIF($12, '')::uuid,
          brand_id = NULLIF($13, '')::uuid,
          supplier_id = NULLIF($14, '')::uuid,
          active = $15
      WHERE id = $1
    `, [
      req.params.id,
      barcode,
      name,
      normalizeNullableNumber(req.body.cost, 0),
      normalizeNullableNumber(req.body.price, 0),
      normalizeNullableNumber(req.body.stock, 0),
      normalizeNullableNumber(req.body.stock_min, 0),
      String(req.body.unit || 'und').trim() || 'und',
      normalizeNullableText(req.body.image_url),
      normalizeNullableText(req.body.qr_payload) || defaultProductQrPayload(barcode),
      normalizeNullableDate(req.body.expires_at),
      String(req.body.category_id || '').trim(),
      String(req.body.brand_id || '').trim(),
      String(req.body.supplier_id || '').trim(),
      normalizeBoolean(req.body.active),
    ]);

    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: 'No se pudo actualizar el producto', detail: error.message });
  }
});

app.get(appUrl('api/admin/movements'), requireAdmin, async (_, res) => {
  try {
    const result = await pool.query(`
      SELECT m.id, m.type, m.note, m.ref_table, m.ref_id, m.created_at, u.display_name,
             COUNT(mi.id)::int AS items_count,
             COALESCE(SUM(mi.qty), 0) AS total_qty
      FROM movements m
      INNER JOIN users u ON u.id = m.created_by
      LEFT JOIN movement_items mi ON mi.movement_id = m.id
      GROUP BY m.id, u.display_name
      ORDER BY m.created_at DESC
      LIMIT 100
    `);

    res.json({ items: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron cargar los movimientos', detail: error.message });
  }
});

app.get(appUrl('api/admin/sales'), requireAdmin, async (_, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.invoice_no, s.created_at, s.status, s.payment_method, s.subtotal, s.discount, s.total,
             u.display_name,
             COUNT(si.id)::int AS items_count
      FROM sales s
      INNER JOIN users u ON u.id = s.created_by
      LEFT JOIN sale_items si ON si.sale_id = s.id
      GROUP BY s.id, u.display_name
      ORDER BY s.created_at DESC
      LIMIT 100
    `);

    res.json({ items: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron cargar las ventas', detail: error.message });
  }
});

app.get(appUrl('api/admin/reports'), requireAdmin, async (req, res) => {
  try {
    const monthParam = String(req.query.month || '').trim();
    const normalizedMonth = /^\d{4}-\d{2}$/.test(monthParam)
      ? `${monthParam}-01`
      : null;
    const dateFilterSql = normalizedMonth
      ? "AND s.created_at >= $1::date AND s.created_at < ($1::date + INTERVAL '1 month')"
      : '';
    const summaryParams = normalizedMonth ? [normalizedMonth] : [];

    const [summary, paymentMethods, topProducts] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS total_sales,
          COALESCE(SUM(total), 0) AS total_amount,
          COALESCE(AVG(total), 0) AS average_ticket,
          COALESCE(SUM(total - COALESCE(item_costs.cost_total, 0)), 0) AS gross_profit
        FROM sales s
        LEFT JOIN (
          SELECT sale_id, COALESCE(SUM(qty * cost_snap), 0) AS cost_total
          FROM sale_items
          GROUP BY sale_id
        ) item_costs ON item_costs.sale_id = s.id
        WHERE s.status = 'PAID'
        ${dateFilterSql}
      `, summaryParams),
      pool.query(`
        SELECT payment_method, COUNT(*)::int AS total, COALESCE(SUM(total), 0) AS amount
        FROM sales s
        WHERE s.status = 'PAID'
        ${dateFilterSql}
        GROUP BY payment_method
        ORDER BY amount DESC
      `, summaryParams),
      pool.query(`
        SELECT si.name_snap, si.barcode_snap, COALESCE(SUM(si.qty), 0) AS qty_sold,
               COALESCE(SUM(si.qty * si.price_snap), 0) AS amount,
               COALESCE(SUM(si.qty * (si.price_snap - si.cost_snap)), 0) AS profit
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
        WHERE s.status = 'PAID'
        ${dateFilterSql}
        GROUP BY si.name_snap, si.barcode_snap
        ORDER BY amount DESC
        LIMIT 10
      `, summaryParams),
    ]);

    res.json({
      month: normalizedMonth ? normalizedMonth.slice(0, 7) : null,
      summary: summary.rows[0],
      paymentMethods: paymentMethods.rows,
      topProducts: topProducts.rows,
    });
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron cargar los reportes', detail: error.message });
  }
});

app.get(appUrl('api/admin/users'), requireAdmin, async (_, res) => {
  try {
    const result = await pool.query(`
      SELECT id, display_name, email, role, active, created_at
      FROM users
      ORDER BY created_at DESC, display_name ASC
    `);
    res.json({ items: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron cargar los usuarios', detail: error.message });
  }
});

app.post(appUrl('api/admin/users'), requireAdmin, async (req, res) => {
  const displayName = String(req.body.display_name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '').trim();
  const role = String(req.body.role || '').trim();

  if (!displayName || !email || !password || !['admin', 'empleado'].includes(role)) {
    return res.status(400).json({ error: 'Completa nombre, correo, rol y contrasena' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO users (display_name, email, password_hash, role, active)
      VALUES ($1, $2, crypt($3, gen_salt('bf')), $4::user_role, $5)
      RETURNING id
    `, [displayName, email, password, role, normalizeBoolean(req.body.active)]);

    res.json({ ok: true, id: result.rows[0].id });
  } catch (error) {
    res.status(400).json({ error: 'No se pudo guardar el usuario', detail: error.message });
  }
});

app.put(appUrl('api/admin/users/:id'), requireAdmin, async (req, res) => {
  const displayName = String(req.body.display_name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = String(req.body.role || '').trim();
  const password = String(req.body.password || '').trim();

  if (!displayName || !email || !['admin', 'empleado'].includes(role)) {
    return res.status(400).json({ error: 'Completa nombre, correo y rol' });
  }

  try {
    if (password) {
      await pool.query(`
        UPDATE users
        SET display_name = $2,
            email = $3,
            role = $4::user_role,
            active = $5,
            password_hash = crypt($6, gen_salt('bf'))
        WHERE id = $1
      `, [req.params.id, displayName, email, role, normalizeBoolean(req.body.active), password]);
    } else {
      await pool.query(`
        UPDATE users
        SET display_name = $2,
            email = $3,
            role = $4::user_role,
            active = $5
        WHERE id = $1
      `, [req.params.id, displayName, email, role, normalizeBoolean(req.body.active)]);
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: 'No se pudo actualizar el usuario', detail: error.message });
  }
});

app.delete(appUrl('api/admin/movements'), requireAdmin, async (req, res) => {
  const month = String(req.query.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Debes indicar un mes valido en formato YYYY-MM' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deletedItems = await client.query(`
      DELETE FROM movement_items
      WHERE movement_id IN (
        SELECT id
        FROM movements
        WHERE created_at >= $1::date
          AND created_at < ($1::date + INTERVAL '1 month')
      )
    `, [`${month}-01`]);
    const deletedMovements = await client.query(`
      DELETE FROM movements
      WHERE created_at >= $1::date
        AND created_at < ($1::date + INTERVAL '1 month')
    `, [`${month}-01`]);
    await client.query('COMMIT');
    res.json({
      ok: true,
      deletedMovements: deletedMovements.rowCount,
      deletedItems: deletedItems.rowCount,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'No se pudieron eliminar los movimientos del mes', detail: error.message });
  } finally {
    client.release();
  }
});

app.delete(appUrl('api/admin/users/:id'), requireAdmin, async (req, res) => {
  try {
    if (req.session.user?.id === req.params.id) {
      return res.status(400).json({ error: 'No puedes eliminar tu propio usuario administrador' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: 'No se pudo eliminar el usuario', detail: error.message });
  }
});

app.get(appUrl('api/settings'), requireAdmin, async (_, res) => {
  try {
    res.json(await readSettings());
  } catch (error) {
    res.status(500).json({ error: 'No se pudo cargar la configuracion', detail: error.message });
  }
});

app.post(appUrl('api/settings'), requireAdmin, upload.single('qr_payment_image'), async (req, res) => {
  try {
    const settings = await readSettings();
    settings.business_name = String(req.body.business_name || settings.business_name).trim() || 'Licoreria';
    settings.currency_symbol = String(req.body.currency_symbol || settings.currency_symbol).trim() || 'Bs';
    settings.low_stock_alert_days = Math.max(1, Number(req.body.low_stock_alert_days || settings.low_stock_alert_days || 7));
    settings.default_payment_method = String(req.body.default_payment_method || settings.default_payment_method || 'CASH').trim();
    settings.support_phone = String(req.body.support_phone || '').trim();
    settings.store_message = String(req.body.store_message || '').trim();
    settings.qr_payment_label = String(req.body.qr_payment_label || settings.qr_payment_label || '').trim();

    if (req.body.remove_qr_payment_image === '1') {
      settings.qr_payment_image = '';
    } else if (req.file) {
      const mimeType = req.file.mimetype || 'image/png';
      settings.qr_payment_image = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
    }

    await writeSettings(settings);
    res.json({ ok: true, settings });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo guardar la configuracion', detail: error.message });
  }
});

app.post(appUrl('api/pos/session'), requireEmployeeOrAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE pos_sessions SET active = FALSE WHERE employee_id = $1 AND active = TRUE', [req.session.user.id]);
    const created = await pool.query(
      'INSERT INTO pos_sessions (employee_id, active) VALUES ($1, TRUE) RETURNING id, created_at',
      [req.session.user.id]
    );
    res.json({ ok: true, session: created.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo abrir el POS', detail: error.message });
  }
});

app.get(appUrl('api/pos/:posId/connect'), requireEmployeeOrAdmin, async (req, res) => {
  try {
    const pos = await getPosSessionForUser(req.params.posId, req.session.user);
    const token = signMobilePosToken(pos.id);
    const mobileUrl = `${getExternalBaseUrl(req)}${appUrl(`mobile-pos?token=${encodeURIComponent(token)}`)}`;
    const qrDataUrl = await QRCode.toDataURL(mobileUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
    });

    res.json({
      pos,
      token,
      mobileUrl,
      qrDataUrl,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get(appUrl('api/employee/dashboard'), requireEmployeeOrAdmin, async (req, res) => {
  try {
    const [activePos, salesToday, amountToday, recentSales, settings] = await Promise.all([
      pool.query('SELECT id, created_at FROM pos_sessions WHERE employee_id = $1 AND active = TRUE ORDER BY created_at DESC LIMIT 1', [req.session.user.id]),
      pool.query("SELECT COUNT(*)::int AS total FROM sales WHERE created_by = $1 AND status = 'PAID' AND created_at::date = CURRENT_DATE", [req.session.user.id]),
      pool.query("SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE created_by = $1 AND status = 'PAID' AND created_at::date = CURRENT_DATE", [req.session.user.id]),
      pool.query('SELECT id, invoice_no, total, payment_method, created_at FROM sales WHERE created_by = $1 ORDER BY created_at DESC LIMIT 10', [req.session.user.id]),
      readSettings(),
    ]);

    res.json({
      user: req.session.user,
      activePos: activePos.rows[0] || null,
      salesToday: salesToday.rows[0].total,
      amountToday: amountToday.rows[0].total,
      recentSales: recentSales.rows,
      settings,
    });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo cargar el panel de empleado', detail: error.message });
  }
});

app.get(appUrl('api/pos/:posId'), requireEmployeeOrAdmin, async (req, res) => {
  try {
    const [posRow, cartRows, settings] = await Promise.all([
      getPosSessionForUser(req.params.posId, req.session.user),
      getPosCartSnapshot(req.params.posId),
      readSettings(),
    ]);

    res.json({
      pos: posRow,
      items: cartRows,
      settings,
    });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo cargar el POS', detail: error.message });
  }
});

app.post(appUrl('api/pos/:posId/scan'), requireEmployeeOrAdmin, async (req, res) => {
  const qrText = String(req.body.qr_text || '').trim();
  const barcode = qrText.startsWith('PROD:') ? qrText.slice(5) : qrText;
  try {
    await getPosSessionForUser(req.params.posId, req.session.user);
    const product = await addProductToCartByBarcode(req.params.posId, barcode);

    res.json({ ok: true, message: `Producto agregado: ${product.name}` });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo agregar al carrito', detail: error.message });
  }
});

app.get(appUrl('api/mobile-pos/session'), async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    const payload = verifyMobilePosToken(token);
    const posResult = await pool.query(`
      SELECT p.id, p.employee_id, p.active, p.created_at, u.display_name, u.email
      FROM pos_sessions p
      INNER JOIN users u ON u.id = p.employee_id
      WHERE p.id = $1
      LIMIT 1
    `, [payload.posId]);

    if (!posResult.rows.length || !normalizeBoolean(posResult.rows[0].active)) {
      return res.status(404).json({ error: 'Sesion POS no disponible' });
    }

    const cart = await getPosCartSnapshot(payload.posId);

    res.json({
      pos: posResult.rows[0],
      items: cart,
      token,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post(appUrl('api/mobile-pos/scan'), async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();
    const qrText = String(req.body.qr_text || '').trim();
    const barcode = qrText.startsWith('PROD:') ? qrText.slice(5) : qrText;
    const payload = verifyMobilePosToken(token);

    const posResult = await pool.query('SELECT id, active FROM pos_sessions WHERE id = $1 LIMIT 1', [payload.posId]);
    if (!posResult.rows.length || !normalizeBoolean(posResult.rows[0].active)) {
      return res.status(404).json({ error: 'Sesion POS no disponible' });
    }

    const product = await addProductToCartByBarcode(payload.posId, barcode);
    const cart = await getPosCartSnapshot(payload.posId);

    res.json({
      ok: true,
      message: `Producto agregado: ${product.name}`,
      items: cart,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post(appUrl('api/pos/:posId/finalize'), requireEmployeeOrAdmin, async (req, res) => {
  const paymentMethod = String(req.body.payment_method || 'CASH').trim();
  const discount = Number(req.body.discount || 0);
  const cashReceived = Number(req.body.cash_received || 0);
  const qrConfirmed = String(req.body.qr_confirmed || '0') === '1';
  const client = await pool.connect();

  try {
    const settings = await readSettings();
    await client.query('BEGIN');

    const posResult = await client.query('SELECT id, employee_id, active FROM pos_sessions WHERE id = $1 LIMIT 1', [req.params.posId]);
    if (!posResult.rows.length || !normalizeBoolean(posResult.rows[0].active)) {
      throw new Error('POS invalido');
    }
    if (req.session.user.role !== 'admin' && posResult.rows[0].employee_id !== req.session.user.id) {
      throw new Error('Sin permisos');
    }

    const cartResult = await client.query(`
      SELECT c.product_id, c.qty, p.name, p.barcode, p.cost, p.price, p.stock
      FROM cart_items c
      INNER JOIN products p ON p.id = c.product_id
      WHERE c.pos_id = $1 AND p.active = TRUE
      ORDER BY p.name ASC
    `, [req.params.posId]);

    if (!cartResult.rows.length) {
      throw new Error('El carrito esta vacio');
    }

    let subtotal = 0;
    for (const item of cartResult.rows) {
      if (Number(item.stock) < Number(item.qty)) {
        throw new Error(`Sin stock suficiente para ${item.name}`);
      }
      subtotal += Number(item.price) * Number(item.qty);
    }

    const total = Math.max(0, subtotal - discount);
    if (paymentMethod === 'CASH' && cashReceived < total) {
      throw new Error('El efectivo es insuficiente');
    }
    if (paymentMethod === 'QR' && !settings.qr_payment_image) {
      throw new Error('No hay QR configurado');
    }
    if (paymentMethod === 'QR' && !qrConfirmed) {
      throw new Error('Debes confirmar el pago QR');
    }

    const changeDue = paymentMethod === 'CASH' ? Math.max(0, cashReceived - total) : 0;
    const paidAmount = paymentMethod === 'CASH' ? cashReceived : total;
    const invoiceNo = await generateInvoiceNo(client);

    const saleResult = await client.query(`
      INSERT INTO sales (invoice_no, created_by, status, payment_method, subtotal, discount, total, commission_total)
      VALUES ($1, $2, 'PAID', $3, $4, $5, $6, 0)
      RETURNING id
    `, [invoiceNo, req.session.user.id, paymentMethod, subtotal, discount, total]);

    const saleId = saleResult.rows[0].id;
    const movementResult = await client.query(`
      INSERT INTO movements (type, created_by, note, ref_table, ref_id)
      VALUES ('EGRESO', $1, $2, 'sales', $3)
      RETURNING id
    `, [req.session.user.id, `Venta POS ${invoiceNo}`, saleId]);
    const movementId = movementResult.rows[0].id;

    for (const item of cartResult.rows) {
      await client.query(`
        INSERT INTO sale_items (sale_id, product_id, qty, cost_snap, price_snap, name_snap, barcode_snap)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [saleId, item.product_id, item.qty, item.cost, item.price, item.name, item.barcode]);

      await client.query(`
        INSERT INTO movement_items (movement_id, product_id, qty, cost_snap, price_snap, name_snap, barcode_snap)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [movementId, item.product_id, item.qty, item.cost, item.price, item.name, item.barcode]);
    }

    await client.query(`
      INSERT INTO sale_payment_meta (sale_id, cash_received, change_due, paid_amount)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (sale_id) DO UPDATE
      SET cash_received = EXCLUDED.cash_received,
          change_due = EXCLUDED.change_due,
          paid_amount = EXCLUDED.paid_amount
    `, [saleId, paymentMethod === 'CASH' ? cashReceived : null, changeDue, paidAmount]);

    await client.query('DELETE FROM cart_items WHERE pos_id = $1', [req.params.posId]);
    await client.query('COMMIT');

    res.json({ ok: true, saleId, invoiceNo });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get(appUrl('api/tickets/:saleId'), requireEmployeeOrAdmin, async (req, res) => {
  try {
    const [saleResult, settings] = await Promise.all([
      pool.query(`
      SELECT s.id, s.invoice_no, s.created_at, s.payment_method, s.subtotal, s.discount, s.total, s.created_by, u.display_name,
             spm.cash_received, spm.change_due, spm.paid_amount
      FROM sales s
      INNER JOIN users u ON u.id = s.created_by
      LEFT JOIN sale_payment_meta spm ON spm.sale_id = s.id
      WHERE s.id = $1
      LIMIT 1
    `, [req.params.saleId]),
      readSettings(),
    ]);

    if (!saleResult.rows.length) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    if (req.session.user.role !== 'admin' && saleResult.rows[0].created_by !== req.session.user.id) {
      return res.status(403).json({ error: 'No puedes ver esta venta' });
    }

    const itemsResult = await pool.query(`
      SELECT name_snap, barcode_snap, qty, price_snap, (qty * price_snap) AS subtotal
      FROM sale_items
      WHERE sale_id = $1
      ORDER BY name_snap ASC
    `, [req.params.saleId]);

    res.json({
      sale: saleResult.rows[0],
      items: itemsResult.rows,
      settings,
    });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo cargar el ticket', detail: error.message });
  }
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor listo en http://localhost:${PORT}${basePrefix}`);
    });
  })
  .catch((error) => {
    console.error('No se pudo iniciar el servidor', error);
    process.exit(1);
  });
