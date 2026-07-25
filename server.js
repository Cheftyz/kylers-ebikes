/**
 * VOLTA — Electric Bike Dealership
 * A small, dependency-light full-stack app.
 *
 *   - Public storefront: anyone can browse the inventory.
 *   - Admin backend: sign in to add / edit / delete listings.
 *
 * Storage is a plain JSON file (data/listings.json) so there are no native
 * build steps or external database to provision. Passwords are hashed with the
 * built-in crypto module (scrypt) — no bcrypt native dependency.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Paths & data directories
// ---------------------------------------------------------------------------
// DATA_DIR / UPLOAD_DIR default to local folders but can be pointed at a
// persistent disk (e.g. on Render) via env vars so listings & photos survive
// restarts and redeploys.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, 'public', 'uploads');
const LISTINGS_FILE = path.join(DATA_DIR, 'listings.json');
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Tiny JSON store helpers
// ---------------------------------------------------------------------------
function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // near-atomic replace
}

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

// ---------------------------------------------------------------------------
// First-run seeding: admin account, session secret, sample listings
// ---------------------------------------------------------------------------
function seedAdmins() {
  if (fs.existsSync(ADMINS_FILE)) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  writeJSON(ADMINS_FILE, [{ username, password: hashPassword(password) }]);
  console.log(
    `\n  Seeded admin account -> username: "${username}"  password: "${password}"` +
      `\n  (Change these via the ADMIN_USERNAME / ADMIN_PASSWORD env vars, or edit data/admins.json.)\n`
  );
}

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8');
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret);
  return secret;
}

function seedListings() {
  if (fs.existsSync(LISTINGS_FILE)) return;
  const now = Date.now();
  const samples = [
    {
      id: crypto.randomUUID(),
      title: 'Trailblazer X1',
      brand: "Kyler's",
      price: 2199,
      range: '55 mi',
      motor: '750W',
      topSpeed: '28 mph',
      description:
        'A rugged all-terrain e-bike built for weekend trails and daily commutes alike. Hydraulic disc brakes, front suspension, and a removable 720Wh battery.',
      contactEmail: 'sales@kylersebikes.com',
      contactPhone: '(555) 210-3344',
      image: '',
      createdAt: now
    },
    {
      id: crypto.randomUUID(),
      title: 'City Glide C3',
      brand: "Kyler's",
      price: 1499,
      range: '40 mi',
      motor: '500W',
      topSpeed: '20 mph',
      description:
        'A lightweight step-through cruiser designed for the city. Integrated lights, fenders, and a rear rack come standard.',
      contactEmail: 'sales@kylersebikes.com',
      contactPhone: '(555) 210-3344',
      image: '',
      createdAt: now - 1000
    },
    {
      id: crypto.randomUUID(),
      title: 'Cargo Hauler CH7',
      brand: "Kyler's",
      price: 2899,
      range: '60 mi',
      motor: '1000W',
      topSpeed: '25 mph',
      description:
        'A long-tail cargo e-bike that carries up to 400 lbs. Perfect for family rides, grocery runs, or last-mile delivery.',
      contactEmail: 'sales@kylersebikes.com',
      contactPhone: '(555) 210-3344',
      image: '',
      createdAt: now - 2000
    }
  ];
  writeJSON(LISTINGS_FILE, samples);
}

seedAdmins();
seedListings();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    name: 'kylers.sid',
    secret: getSessionSecret(),
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

if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

// Image uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  }
});

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Not authenticated.' });
}

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  const admins = readJSON(ADMINS_FILE, []);
  const admin = admins.find((a) => a.username === username);
  if (!admin || !verifyPassword(password, admin.password)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  req.session.user = { username: admin.username };
  res.json({ ok: true, username: admin.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ authenticated: true, username: req.session.user.username });
  }
  res.json({ authenticated: false });
});

// ---------------------------------------------------------------------------
// Listings API
// ---------------------------------------------------------------------------
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

// Public: list everything (newest first)
app.get('/api/listings', (_req, res) => {
  const listings = readJSON(LISTINGS_FILE, []);
  listings.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json(listings);
});

// Public: single listing
app.get('/api/listings/:id', (req, res) => {
  const listings = readJSON(LISTINGS_FILE, []);
  const item = listings.find((l) => l.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Listing not found.' });
  res.json(item);
});

// Admin: create
app.post('/api/listings', requireAuth, upload.single('image'), (req, res) => {
  const data = sanitizeListing(req.body);
  if (!data.title) return res.status(400).json({ error: 'A product name is required.' });
  if (!data.contactEmail && !data.contactPhone) {
    return res.status(400).json({ error: 'Add at least one contact method (email or phone).' });
  }
  const listings = readJSON(LISTINGS_FILE, []);
  const listing = {
    id: crypto.randomUUID(),
    ...data,
    image: req.file ? `/uploads/${req.file.filename}` : '',
    createdAt: Date.now()
  };
  listings.push(listing);
  writeJSON(LISTINGS_FILE, listings);
  res.status(201).json(listing);
});

// Admin: update
app.put('/api/listings/:id', requireAuth, upload.single('image'), (req, res) => {
  const listings = readJSON(LISTINGS_FILE, []);
  const idx = listings.findIndex((l) => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Listing not found.' });

  const data = sanitizeListing(req.body);
  if (!data.title) return res.status(400).json({ error: 'A product name is required.' });
  if (!data.contactEmail && !data.contactPhone) {
    return res.status(400).json({ error: 'Add at least one contact method (email or phone).' });
  }

  const existing = listings[idx];
  let image = existing.image;
  if (req.file) {
    image = `/uploads/${req.file.filename}`;
    removeUpload(existing.image);
  } else if (req.body.removeImage === '1') {
    removeUpload(existing.image);
    image = '';
  }

  listings[idx] = { ...existing, ...data, image };
  writeJSON(LISTINGS_FILE, listings);
  res.json(listings[idx]);
});

// Admin: delete
app.delete('/api/listings/:id', requireAuth, (req, res) => {
  const listings = readJSON(LISTINGS_FILE, []);
  const idx = listings.findIndex((l) => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Listing not found.' });
  removeUpload(listings[idx].image);
  listings.splice(idx, 1);
  writeJSON(LISTINGS_FILE, listings);
  res.json({ ok: true });
});

function removeUpload(imagePath) {
  if (!imagePath || !imagePath.startsWith('/uploads/')) return;
  const full = path.join(UPLOAD_DIR, path.basename(imagePath));
  fs.promises.unlink(full).catch(() => {});
}

// ---------------------------------------------------------------------------
// Static files & pages
// ---------------------------------------------------------------------------
// Uploaded photos — served from UPLOAD_DIR wherever it lives (local or disk).
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
);
app.get('/login', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'login.html'))
);

// Multer / generic error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.message && /image|file/i.test(err.message) ? 400 : 500;
  res.status(status).json({ error: err.message || 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`\n  Kyler's E-Bikes running at http://localhost:${PORT}`);
  console.log(`  Storefront:  http://localhost:${PORT}/`);
  console.log(`  Admin:       http://localhost:${PORT}/admin\n`);
});
