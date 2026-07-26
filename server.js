/**
 * Kyler's E-Bikes — Electric Bike Dealership
 *
 *   - Public storefront: anyone can browse the inventory.
 *   - Admin backend: sign in to add / edit / delete listings.
 *
 * Storage is pluggable (see store.js):
 *   - Set MONGODB_URI  -> everything lives in MongoDB (free, no disk needed).
 *   - Leave it unset   -> JSON files + local uploads (zero-setup local dev).
 *
 * Passwords are hashed with the built-in crypto module (scrypt).
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const createStore = require('./store');

const PORT = process.env.PORT || 3000;

// DATA_DIR / UPLOAD_DIR are only used by the local file store; MongoDB mode
// ignores them. They can also be pointed at a persistent disk if desired.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, 'public', 'uploads');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');

// ---------------------------------------------------------------------------
// Password hashing (scrypt) — format:  salt:hash  (both hex)
// ---------------------------------------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const hash = Buffer.from(hashHex, 'hex');
  const test = crypto.scryptSync(password, salt, 64);
  return hash.length === test.length && crypto.timingSafeEqual(hash, test);
}

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8');
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret);
  return secret;
}

// ---------------------------------------------------------------------------
// Uploads (held in memory; the store driver persists them)
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  }
});

function sanitizeListing(body) {
  const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);
  const priceNum = parseFloat(body.price);
  return {
    title: clean(body.title, 120),
    brand: clean(body.brand, 80),
    price: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null,
    range: clean(body.range, 40),
    motor: clean(body.motor, 40),
    topSpeed: clean(body.topSpeed, 40),
    description: clean(body.description, 4000),
    contactEmail: clean(body.contactEmail, 160),
    contactPhone: clean(body.contactPhone, 60)
  };
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Not authenticated.' });
}

// Wrap async route handlers so rejections reach the error middleware.
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const store = await createStore({ dataDir: DATA_DIR, uploadDir: UPLOAD_DIR });
  console.log(`  Storage driver: ${store.driver}`);

  // First-run seeding
  if ((await store.countAdmins()) === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    await store.insertAdmin({ username, password: hashPassword(password) });
    console.log(
      `\n  Seeded admin account -> username: "${username}"  password: "${password}"` +
        `\n  (Set ADMIN_USERNAME / ADMIN_PASSWORD to change these.)\n`
    );
  }
  await store.seedIfEmpty();

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  app.use(
    session({
      name: 'kylers.sid',
      secret: getSessionSecret(),
      store: store.sessionStore, // undefined -> in-memory (local dev)
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        secure: process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY === '1'
      }
    })
  );

  // ---- Auth API -----------------------------------------------------------
  app.post(
    '/api/login',
    asyncH(async (req, res) => {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
      }
      const admin = await store.findAdmin(username);
      if (!admin || !verifyPassword(password, admin.password)) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }
      req.session.user = { username: admin.username };
      res.json({ ok: true, username: admin.username });
    })
  );

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get('/api/me', (req, res) => {
    if (req.session && req.session.user) {
      return res.json({ authenticated: true, username: req.session.user.username });
    }
    res.json({ authenticated: false });
  });

  // ---- Listings API -------------------------------------------------------
  app.get('/api/listings', asyncH(async (_req, res) => {
    res.json(await store.getListings());
  }));

  app.get('/api/listings/:id', asyncH(async (req, res) => {
    const item = await store.getListing(req.params.id);
    if (!item) return res.status(404).json({ error: 'Listing not found.' });
    res.json(item);
  }));

  app.post(
    '/api/listings',
    requireAuth,
    upload.single('image'),
    asyncH(async (req, res) => {
      const data = sanitizeListing(req.body);
      if (!data.title) return res.status(400).json({ error: 'A product name is required.' });
      if (!data.contactEmail && !data.contactPhone) {
        return res.status(400).json({ error: 'Add at least one contact method (email or phone).' });
      }
      const image = req.file ? await store.saveImage(req.file.buffer, req.file.mimetype) : '';
      const listing = await store.createListing({ ...data, image });
      res.status(201).json(listing);
    })
  );

  app.put(
    '/api/listings/:id',
    requireAuth,
    upload.single('image'),
    asyncH(async (req, res) => {
      const existing = await store.getListing(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Listing not found.' });

      const data = sanitizeListing(req.body);
      if (!data.title) return res.status(400).json({ error: 'A product name is required.' });
      if (!data.contactEmail && !data.contactPhone) {
        return res.status(400).json({ error: 'Add at least one contact method (email or phone).' });
      }

      let image = existing.image;
      if (req.file) {
        image = await store.saveImage(req.file.buffer, req.file.mimetype);
        await store.deleteImage(existing.image);
      } else if (req.body.removeImage === '1') {
        await store.deleteImage(existing.image);
        image = '';
      }

      const updated = await store.updateListing(req.params.id, { ...data, image });
      res.json(updated);
    })
  );

  app.delete(
    '/api/listings/:id',
    requireAuth,
    asyncH(async (req, res) => {
      const existing = await store.getListing(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Listing not found.' });
      await store.deleteImage(existing.image);
      await store.deleteListing(req.params.id);
      res.json({ ok: true });
    })
  );

  // Images stored in the database (MongoDB mode) are served here.
  app.get('/media/:id', asyncH(async (req, res) => {
    const img = await store.getImage(req.params.id);
    if (!img) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=86400');
    res.type(img.contentType).send(img.data);
  }));

  // ---- Static files & pages ----------------------------------------------
  app.use('/uploads', express.static(UPLOAD_DIR)); // local file-store uploads
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/admin', (_req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'admin.html'))
  );
  app.get('/login', (_req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'login.html'))
  );

  // ---- Error handler ------------------------------------------------------
  app.use((err, _req, res, _next) => {
    console.error(err);
    const status = err.message && /image|file|Only image/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message || 'Something went wrong.' });
  });

  app.listen(PORT, () => {
    console.log(`\n  Kyler's E-Bikes running at http://localhost:${PORT}`);
    console.log(`  Storefront:  http://localhost:${PORT}/`);
    console.log(`  Admin:       http://localhost:${PORT}/admin\n`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
