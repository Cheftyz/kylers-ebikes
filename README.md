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

## Deploying (Render, recommended)

This app needs a **persistent disk** so listings and photos survive restarts —
serverless platforms (e.g. Vercel) have an ephemeral filesystem and would lose
them. The included `render.yaml` sets this up automatically.

1. Push this folder to a GitHub repo.
2. In Render: **New + → Blueprint**, connect the repo. Render reads `render.yaml`
   (Node web service on the **Starter** plan + a 1 GB disk mounted at `/var/data`).
3. Before the first deploy, set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the
   Render dashboard (they seed the admin login on first run).
4. Deploy. Your site is live at the Render URL.

> Render disks require a paid instance (Starter, ~$7/mo). That's why the app
> persists reliably. On a free instance the filesystem resets on every deploy.

Environment variables (all handled by `render.yaml` except the two admin creds):

| Variable         | Purpose                                             |
|------------------|-----------------------------------------------------|
| `ADMIN_USERNAME` | Admin login (first run only) — set in dashboard     |
| `ADMIN_PASSWORD` | Admin password (first run only) — set in dashboard  |
| `SESSION_SECRET` | Signs session cookies (auto-generated on Render)    |
| `DATA_DIR`       | Where `listings.json` / `admins.json` live          |
| `UPLOAD_DIR`     | Where uploaded photos live                           |
| `PORT`           | Port to listen on (host sets this)                  |
| `NODE_ENV`       | `production` on a live host                          |
| `TRUST_PROXY`    | `1` when behind an HTTPS proxy (secure cookies)     |

## Rename / rebrand

The dealership is branded **Kyler's E-Bikes**. To rename it, search the
`public/` folder for `KYLER'S` / `Kyler's` and replace it, swap `public/img/logo.png`,
and update the `K` favicon in each page's `<head>`.

## Project layout

```
server.js            Express server + JSON store + auth + upload handling
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
