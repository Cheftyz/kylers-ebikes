/* Smoke test for the MongoDB store driver against an in-memory MongoDB. */
const { MongoMemoryServer } = require('mongodb-memory-server');
const crypto = require('crypto');
const createStore = require('../store');

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('kylers_test');
  const store = await createStore({});
  const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ok:', msg); };

  console.log('driver =', store.driver);
  assert(store.driver === 'mongo', 'driver is mongo');
  assert(!!store.sessionStore, 'session store present (connect-mongo)');

  // Seeding
  await store.seedIfEmpty();
  let list = await store.getListings();
  assert(list.length === 3, 'seeded 3 sample listings');
  assert(list[0].createdAt >= list[1].createdAt, 'sorted newest first');
  assert(list[0]._id === undefined, 'internal _id stripped from output');

  // Admins
  assert((await store.countAdmins()) === 0, 'no admins yet');
  await store.insertAdmin({ username: 'admin', password: 'hashed:pw' });
  assert((await store.countAdmins()) === 1, 'admin inserted');
  const a = await store.findAdmin('admin');
  assert(a && a.password === 'hashed:pw', 'findAdmin returns admin');
  assert((await store.findAdmin('nope')) === null, 'findAdmin missing -> null');

  // Create
  const created = await store.createListing({ title: 'X', price: 10, contactEmail: 'a@b.com', image: '' });
  assert(created.id && created.createdAt, 'createListing sets id + createdAt');
  assert((await store.getListings()).length === 4, 'now 4 listings');
  const got = await store.getListing(created.id);
  assert(got && got.title === 'X', 'getListing by id');

  // Image round-trip (binary)
  const buf = crypto.randomBytes(256);
  const imgPath = await store.saveImage(buf, 'image/png');
  assert(imgPath.startsWith('/media/'), 'saveImage returns /media/ path');
  const id = imgPath.split('/').pop();
  const img = await store.getImage(id);
  assert(img && img.contentType === 'image/png', 'getImage returns contentType');
  assert(Buffer.isBuffer(img.data) && img.data.equals(buf), 'image bytes round-trip intact');

  // Update
  const updated = await store.updateListing(created.id, { title: 'Y', image: imgPath });
  assert(updated && updated.title === 'Y', 'updateListing returns updated doc');
  assert(updated.image === imgPath, 'update kept image path');
  assert((await store.getListing(created.id)).title === 'Y', 'update persisted');
  assert((await store.updateListing('missing', { title: 'Z' })) === null, 'update missing -> null');

  // Delete image + listing
  await store.deleteImage(imgPath);
  assert((await store.getImage(id)) === null, 'deleteImage removed the image');
  assert((await store.deleteListing(created.id)) === true, 'deleteListing true');
  assert((await store.deleteListing(created.id)) === false, 'deleteListing missing -> false');
  assert((await store.getListings()).length === 3, 'back to 3 listings');

  await store.close();
  await mongod.stop();
  console.log('\nALL MONGO DRIVER TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
