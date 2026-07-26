/**
 * Storage abstraction for Kyler's E-Bikes.
 *
 * Two interchangeable drivers behind one async interface:
 *
 *   - "mongo": used when MONGODB_URI is set (production on Render's free tier).
 *     Listings, admins, uploaded images, and sessions all live in MongoDB, so
 *     nothing depends on a persistent local disk.
 *
 *   - "file":  used when MONGODB_URI is absent (local development). Listings and
 *     admins are JSON files; images are written to the uploads folder. This is
 *     the original zero-dependency behaviour.
 *
 * Both expose the same methods, so the server code is identical either way.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Shared: sample inventory seeded on first run
// ---------------------------------------------------------------------------
function sampleListings() {
  const now = Date.now();
  const base = {
    contactEmail: 'sales@kylersebikes.com',
    contactPhone: '(555) 210-3344',
    image: ''
  };
  return [
    {
      id: crypto.randomUUID(), title: 'Trailblazer X1', brand: "Kyler's",
      price: 2199, range: '55 mi', motor: '750W', topSpeed: '28 mph',
      description:
        'A rugged all-terrain e-bike built for weekend trails and daily commutes alike. Hydraulic disc brakes, front suspension, and a removable 720Wh battery.',
      ...base, createdAt: now
    },
    {
      id: crypto.randomUUID(), title: 'City Glide C3', brand: "Kyler's",
      price: 1499, range: '40 mi', motor: '500W', topSpeed: '20 mph',
      description:
        'A lightweight step-through cruiser designed for the city. Integrated lights, fenders, and a rear rack come standard.',
      ...base, createdAt: now - 1000
    },
    {
      id: crypto.randomUUID(), title: 'Cargo Hauler CH7', brand: "Kyler's",
      price: 2899, range: '60 mi', motor: '1000W', topSpeed: '25 mph',
      description:
        'A long-tail cargo e-bike that carries up to 400 lbs. Perfect for family rides, grocery runs, or last-mile delivery.',
      ...base, createdAt: now - 2000
    }
  ];
}

// ===========================================================================
// File driver
// ===========================================================================
function createFileStore({ dataDir, uploadDir }) {
  const LISTINGS_FILE = path.join(dataDir, 'listings.json');
  const ADMINS_FILE = path.join(dataDir, 'admins.json');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  const read = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  };
  const write = (file, data) => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  };

  return {
    driver: 'file',
    sessionStore: undefined, // express-session default MemoryStore

    async getListings() {
      const list = read(LISTINGS_FILE, []);
      return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
    async getListing(id) {
      return read(LISTINGS_FILE, []).find((l) => l.id === id) || null;
    },
    async createListing(data) {
      const list = read(LISTINGS_FILE, []);
      const listing = {
        id: data.id || crypto.randomUUID(),
        ...data,
        createdAt: data.createdAt || Date.now()
      };
      list.push(listing);
      write(LISTINGS_FILE, list);
      return listing;
    },
    async updateListing(id, patch) {
      const list = read(LISTINGS_FILE, []);
      const idx = list.findIndex((l) => l.id === id);
      if (idx === -1) return null;
      list[idx] = { ...list[idx], ...patch };
      write(LISTINGS_FILE, list);
      return list[idx];
    },
    async deleteListing(id) {
      const list = read(LISTINGS_FILE, []);
      const idx = list.findIndex((l) => l.id === id);
      if (idx === -1) return false;
      list.splice(idx, 1);
      write(LISTINGS_FILE, list);
      return true;
    },

    async saveImage(buffer, contentType) {
      const ext = (contentType && contentType.split('/')[1]) || 'jpg';
      const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext.replace(/[^a-z0-9]/gi, '')}`;
      fs.writeFileSync(path.join(uploadDir, name), buffer);
      return `/uploads/${name}`;
    },
    async getImage() {
      return null; // uploads are served as static files in file mode
    },
    async deleteImage(urlPath) {
      if (!urlPath || !urlPath.startsWith('/uploads/')) return;
      const full = path.join(uploadDir, path.basename(urlPath));
      fs.promises.unlink(full).catch(() => {});
    },

    async countAdmins() {
      return read(ADMINS_FILE, []).length;
    },
    async findAdmin(username) {
      return read(ADMINS_FILE, []).find((a) => a.username === username) || null;
    },
    async insertAdmin(admin) {
      const admins = read(ADMINS_FILE, []);
      admins.push(admin);
      write(ADMINS_FILE, admins);
    },

    async seedIfEmpty() {
      if (read(LISTINGS_FILE, null) === null) write(LISTINGS_FILE, sampleListings());
    },
    async close() {}
  };
}

// ===========================================================================
// Mongo driver
// ===========================================================================
async function createMongoStore(uri) {
  const { MongoClient, Binary } = require('mongodb');
  const MongoStore = require('connect-mongo');

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(); // database name comes from the connection string
  const Listings = db.collection('listings');
  const Admins = db.collection('admins');
  const Images = db.collection('images');
  await Listings.createIndex({ createdAt: -1 });
  await Admins.createIndex({ username: 1 }, { unique: true });

  const strip = (doc) => {
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest;
  };

  return {
    driver: 'mongo',
    sessionStore: MongoStore.create({ client, collectionName: 'sessions', ttl: 60 * 60 * 24 * 7 }),

    async getListings() {
      const docs = await Listings.find({}).sort({ createdAt: -1 }).toArray();
      return docs.map(strip);
    },
    async getListing(id) {
      return strip(await Listings.findOne({ id }));
    },
    async createListing(data) {
      const listing = {
        id: data.id || crypto.randomUUID(),
        ...data,
        createdAt: data.createdAt || Date.now()
      };
      await Listings.insertOne({ ...listing });
      return listing;
    },
    async updateListing(id, patch) {
      const res = await Listings.findOneAndUpdate(
        { id },
        { $set: patch },
        { returnDocument: 'after' }
      );
      const doc = res && res.value ? res.value : res; // driver version compat
      return strip(doc && doc._id ? doc : await Listings.findOne({ id }));
    },
    async deleteListing(id) {
      const res = await Listings.deleteOne({ id });
      return res.deletedCount > 0;
    },

    async saveImage(buffer, contentType) {
      const id = crypto.randomBytes(12).toString('hex');
      await Images.insertOne({ id, contentType: contentType || 'image/jpeg', data: new Binary(buffer) });
      return `/media/${id}`;
    },
    async getImage(id) {
      const doc = await Images.findOne({ id });
      if (!doc) return null;
      const data = doc.data && doc.data.buffer ? Buffer.from(doc.data.buffer) : doc.data;
      return { contentType: doc.contentType, data };
    },
    async deleteImage(urlPath) {
      if (!urlPath || !urlPath.startsWith('/media/')) return;
      await Images.deleteOne({ id: urlPath.split('/').pop() });
    },

    async countAdmins() {
      return Admins.countDocuments();
    },
    async findAdmin(username) {
      return strip(await Admins.findOne({ username }));
    },
    async insertAdmin(admin) {
      await Admins.insertOne({ ...admin });
    },

    async seedIfEmpty() {
      if ((await Listings.countDocuments()) === 0) {
        await Listings.insertMany(sampleListings());
      }
    },
    async close() { await client.close(); }
  };
}

// ===========================================================================
// Factory
// ===========================================================================

// Tolerantly clean a connection string pasted into a host's env settings:
// trims whitespace, removes an accidental `MONGODB_URI=` prefix, and strips
// wrapping single/double quotes — the common copy-paste slips.
function sanitizeMongoUri(raw) {
  let s = String(raw).trim();
  s = s.replace(/^MONGODB_URI\s*=\s*/i, ''); // "MONGODB_URI=mongodb+srv://..."
  s = s.replace(/^['"]+/, '').replace(/['"]+$/, ''); // "mongodb+srv://..."
  return s.trim();
}

module.exports = async function createStore({ dataDir, uploadDir }) {
  const raw = process.env.MONGODB_URI;
  if (raw && raw.trim()) {
    const uri = sanitizeMongoUri(raw);
    if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
      // Show the offending start without leaking a password.
      const preview = uri.slice(0, 20).replace(/(mongodb(?:\+srv)?:\/\/[^:@/]*:)[^@/]*/i, '$1****');
      throw new Error(
        'MONGODB_URI is set but is not a valid connection string — it must start with ' +
          '"mongodb+srv://" or "mongodb://".\n' +
          `  What was provided starts with: "${preview}..."\n` +
          '  Fix the value in your host\'s environment settings: no quotes, no "MONGODB_URI=" ' +
          'prefix, no leading space, and it must begin with mongodb+srv://'
      );
    }
    return createMongoStore(uri);
  }
  return createFileStore({ dataDir, uploadDir });
};
