# Kyler's E-Bikes — Electric Bike Dealership

A clean, black-&-white dealership website for electric bikes.

- **Public storefront** (`/`) — anyone can browse the inventory. No account needed.
- **Admin backend** (`/admin`) — sign in to add, edit, and delete listings.
- Each listing has a product name, price, specs, description, a photo, and
  contact methods (email / phone) so buyers can reach the seller directly.

Data is stored in a plain JSON file (`data/listings.json`) and uploaded photos
in `public/uploads/`. There is **no database to install** and no native build
steps — it runs anywhere Node runs, including Windows.

## Run it locally

```bash
cd "ebike-dealership"
npm install
npm start
```

Then open:

- Storefront → http://localhost:3000/
- Admin → http://localhost:3000/admin (redirects to the sign-in page)

On the very first run the server prints the seeded admin credentials:

```
username: admin   password: admin123
```

Change them **before** first run by setting `ADMIN_USERNAME` / `ADMIN_PASSWORD`
(see `.env.example`), or later by editing `data/admins.json`. To reset an
account entirely, delete `data/admins.json` and restart — it will be re-seeded.

## How admins list an item

1. Sign in at `/login`.
2. On the dashboard, fill in the **Add a bike** form: product name (required),
   price, range/motor/top-speed, a description, and at least one contact method.
3. Optionally attach a photo (JPG/PNG/WebP, up to 8 MB).
4. Click **Add bike** — it appears on the storefront immediately.

Existing listings can be edited or deleted from the inventory list on the right.

## The logo

Drop the logo file at **`public/img/logo.png`**. It appears as the big badge on
the storefront hero and the small round mark in the admin/login headers. If it's
missing, the pages still work — the logo just doesn't show.

## Storage

The app has two interchangeable storage drivers (see `store.js`):

- **MongoDB** (production) — set `MONGODB_URI` and everything (listings, photos,
  admins, sessions) lives in MongoDB. No disk needed, so it runs on free hosts.
- **Files** (local dev) — leave `MONGODB_URI` unset and it uses `data/*.json`
  plus the `public/uploads/` folder. Zero setup.

Uploaded photos are stored **in the database** in MongoDB mode and served from
`/media/:id`. Fine for a small dealership; for very high volume you'd move images
to object storage (e.g. Cloudinary) later.

## Deploying free (Render + MongoDB Atlas)

Both are free. One-time setup, ~10 minutes.

**1. Create a free database (MongoDB Atlas)**
   - Sign up at mongodb.com/atlas → create a free **M0** cluster.
   - Database Access → add a user (username + password).
   - Network Access → allow `0.0.0.0/0` (from anywhere).
   - Connect → Drivers → copy the connection string. It looks like
     `mongodb+srv://USER:PASS@cluster0.xxxx.mongodb.net/kylers?retryWrites=true&w=majority`
     (add `/kylers` before the `?` to name the database).

**2. Deploy the app (Render)**
   - Push this repo to GitHub.
   - In Render: **New + → Blueprint** → connect the repo (it reads `render.yaml`).
   - Set these environment variables when prompted:
     `MONGODB_URI` (from step 1), `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
   - Apply. Your site goes live at `https://kylers-ebikes.onrender.com` (or similar).

> The free Render plan sleeps after ~15 min of inactivity, so the first visit
> after idle takes ~30–50s to wake up. Upgrading to Starter (~$7/mo) keeps it
> always-on. Data persists either way (it's in Atlas).

| Variable         | Purpose                                             |
|------------------|-----------------------------------------------------|
| `MONGODB_URI`    | MongoDB Atlas connection string (enables DB mode)   |
| `ADMIN_USERNAME` | Admin login (first run only)                        |
| `ADMIN_PASSWORD` | Admin password (first run only)                     |
| `SESSION_SECRET` | Signs session cookies (auto-generated on Render)    |
| `PORT`           | Port to listen on (host sets this)                  |
| `NODE_ENV`       | `production` on a live host                          |
| `TRUST_PROXY`    | `1` when behind an HTTPS proxy (secure cookies)     |

## Rename / rebrand

The dealership is branded **Kyler's E-Bikes**. To rename it, search the
`public/` folder for `KYLER'S` / `Kyler's` and replace it, swap `public/img/logo.png`,
and update the `K` favicon in each page's `<head>`.

## Project layout

```
server.js            Express server + auth + routes
store.js             Pluggable storage (MongoDB driver + local file driver)
scripts/test-mongo.js  Smoke test for the MongoDB driver (in-memory Mongo)
public/
  index.html         Storefront
  login.html         Admin sign-in
  admin.html         Admin dashboard
  css/styles.css     Black & white theme
  js/main.js         Storefront logic
  js/login.js        Sign-in logic
  js/admin.js        Dashboard CRUD logic
  img/logo.png       Brand logo (add this file)
  uploads/           Uploaded photos (created at runtime)
data/                listings.json, admins.json, session secret (created at runtime)
render.yaml          Render Blueprint (web service + persistent disk)
```
