/* Integration test: boot the REAL server.js in MongoDB mode (production path)
 * against an in-memory MongoDB, then exercise the HTTP endpoints. */
const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;

function request(method, urlPath, { cookie, form, json } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    let payload;
    if (json) { payload = JSON.stringify(json); headers['Content-Type'] = 'application/json'; }
    if (form) {
      // simple multipart
      const boundary = '----test' + Date.now();
      headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
      let body = '';
      for (const [k, v] of Object.entries(form)) {
        body += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
      }
      body += `--${boundary}--\r\n`;
      payload = Buffer.from(body);
    }
    if (cookie) headers['Cookie'] = cookie;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request(BASE + urlPath, { method, headers }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('kylers_srv');
  // Deliberately wrap in quotes + whitespace to prove the server auto-cleans
  // the common copy-paste mistakes before connecting.
  const messyUri = `  "${uri}"  `;
  const env = { ...process.env, MONGODB_URI: messyUri, SESSION_SECRET: 'testsecret', PORT: String(PORT), NODE_ENV: 'development', ADMIN_USERNAME: 'Kyler', ADMIN_PASSWORD: 'KBikes253' };
  const srv = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  srv.stdout.on('data', (d) => (out += d));
  srv.stderr.on('data', (d) => (out += d));

  // wait for boot (or crash)
  const start = Date.now();
  while (!out.includes('running at') && Date.now() - start < 20000) {
    if (srv.exitCode !== null) { console.error('SERVER CRASHED ON BOOT:\n' + out); process.exit(1); }
    await sleep(200);
  }
  if (!out.includes('running at')) { console.error('SERVER DID NOT START:\n' + out); srv.kill(); process.exit(1); }
  console.log(out.trim());
  const assert = (c, m) => { if (!c) { console.error('FAIL: ' + m + '\n--- server output ---\n' + out); srv.kill(); process.exit(1); } console.log('  ok:', m); };

  assert(/Storage driver: mongo/.test(out), 'server reports mongo driver');

  // public listing
  let r = await request('GET', '/api/listings');
  assert(r.status === 200 && JSON.parse(r.body).length === 3, 'GET /api/listings returns 3 seeded bikes');

  // unauthenticated create blocked
  r = await request('POST', '/api/listings', { form: { title: 'x', contactEmail: 'a@b.com' } });
  assert(r.status === 401, 'unauthenticated create blocked (401)');

  // default admin should NOT exist when custom creds are provided
  r = await request('POST', '/api/login', { json: { username: 'admin', password: 'admin123' } });
  assert(r.status === 401, 'default admin/admin123 NOT created when ADMIN_* set');

  // login with the env-provided admin (connect-mongo session)
  r = await request('POST', '/api/login', { json: { username: 'Kyler', password: 'KBikes253' } });
  assert(r.status === 200, 'login as Kyler / KBikes253 succeeds');
  const cookie = (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  assert(/kylers\.sid/.test(cookie), 'session cookie issued');

  // authenticated me
  r = await request('GET', '/api/me', { cookie });
  assert(r.status === 200 && JSON.parse(r.body).authenticated === true, '/api/me authenticated with cookie');

  // authenticated create
  r = await request('POST', '/api/listings', { cookie, form: { title: 'Server Test Bike', price: '1234', contactEmail: 'a@b.com' } });
  assert(r.status === 201, 'authenticated create succeeds');
  const created = JSON.parse(r.body);
  assert(created.id && created.title === 'Server Test Bike', 'created listing returned');

  // shows up in list
  r = await request('GET', '/api/listings');
  assert(JSON.parse(r.body).length === 4, 'listing count now 4');

  // delete
  r = await request('DELETE', '/api/listings/' + created.id, { cookie });
  assert(r.status === 200, 'authenticated delete succeeds');

  srv.kill();
  await mongod.stop();
  console.log('\nFULL SERVER (MongoDB mode) INTEGRATION TEST PASSED');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
