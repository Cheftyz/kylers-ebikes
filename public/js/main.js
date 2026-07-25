// Storefront: fetch listings and render a dealership-style inventory with
// search, sort, price range, and brand filters (all client-side).
(function () {
  const grid = document.getElementById('grid');
  const countEl = document.getElementById('count');
  const searchEl = document.getElementById('search');
  const sortEl = document.getElementById('sort');
  const priceMinEl = document.getElementById('priceMin');
  const priceMaxEl = document.getElementById('priceMax');
  const brandGroup = document.getElementById('brandGroup');
  const brandFilters = document.getElementById('brandFilters');
  const resetBtn = document.getElementById('resetFilters');
  document.getElementById('year').textContent = new Date().getFullYear();

  let listings = [];

  const BIKE_SVG = `
    <svg class="placeholder" width="80" height="80" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/>
      <path d="M5.5 17 10 7h4l3 6"/><path d="M10 7h5"/><path d="M14 7l4.5 10"/>
    </svg>`;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function money(n) {
    if (n == null || n === '') return '';
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function card(l) {
    const specs = [l.range, l.motor, l.topSpeed]
      .filter(Boolean)
      .map((s) => `<span class="spec">${esc(s)}</span>`)
      .join('');

    const media = l.image
      ? `<img src="${esc(l.image)}" alt="${esc(l.title)}" loading="lazy" />`
      : BIKE_SVG;

    const contactBtns = [];
    if (l.contactEmail) {
      contactBtns.push(
        `<a class="btn small" href="mailto:${esc(l.contactEmail)}?subject=${encodeURIComponent('Interested in ' + (l.title || 'your e-bike'))}">Email</a>`
      );
    }
    if (l.contactPhone) {
      const tel = String(l.contactPhone).replace(/[^\d+]/g, '');
      contactBtns.push(`<a class="btn small ghost" href="tel:${esc(tel)}">Call</a>`);
    }

    return `
      <article class="card">
        <div class="card-media">${media}</div>
        <div class="card-body">
          ${l.brand ? `<div class="card-brand">${esc(l.brand)}</div>` : ''}
          <div class="card-title-row">
            <h3 class="card-title">${esc(l.title)}</h3>
            ${l.price != null ? `<span class="card-price">${money(l.price)}</span>` : ''}
          </div>
          ${specs ? `<div class="specs">${specs}</div>` : ''}
          ${l.description ? `<p class="card-desc">${esc(l.description)}</p>` : ''}
          ${contactBtns.length ? `<div class="card-contact">${contactBtns.join('')}</div>` : ''}
        </div>
      </article>`;
  }

  function selectedBrands() {
    return Array.from(brandFilters.querySelectorAll('input:checked')).map((i) => i.value);
  }

  function apply() {
    const q = (searchEl.value || '').trim().toLowerCase();
    const min = parseFloat(priceMinEl.value);
    const max = parseFloat(priceMaxEl.value);
    const brands = selectedBrands();

    let filtered = listings.filter((l) => {
      if (q) {
        const hay = [l.title, l.brand, l.description, l.motor, l.range]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (Number.isFinite(min) && (l.price == null || l.price < min)) return false;
      if (Number.isFinite(max) && (l.price == null || l.price > max)) return false;
      if (brands.length && !brands.includes(l.brand || '')) return false;
      return true;
    });

    const sort = sortEl.value;
    filtered.sort((a, b) => {
      if (sort === 'price-asc') return (a.price ?? Infinity) - (b.price ?? Infinity);
      if (sort === 'price-desc') return (b.price ?? -Infinity) - (a.price ?? -Infinity);
      if (sort === 'name') return String(a.title).localeCompare(String(b.title));
      return (b.createdAt || 0) - (a.createdAt || 0); // newest
    });

    countEl.textContent =
      listings.length === 0
        ? 'No bikes listed yet.'
        : `${filtered.length} of ${listings.length} ${listings.length === 1 ? 'bike' : 'bikes'}`;

    if (filtered.length === 0) {
      grid.innerHTML = `<div class="empty">${
        listings.length === 0
          ? 'The lot is empty right now. Check back soon.'
          : 'No bikes match your filters.'
      }</div>`;
      return;
    }
    grid.innerHTML = filtered.map(card).join('');
  }

  function buildBrandFilters() {
    const brands = [...new Set(listings.map((l) => l.brand).filter(Boolean))].sort();
    if (brands.length < 2) { brandGroup.style.display = 'none'; return; }
    brandGroup.style.display = '';
    brandFilters.innerHTML = brands
      .map(
        (b) => `<label class="check"><input type="checkbox" value="${esc(b)}" /> <span>${esc(b)}</span></label>`
      )
      .join('');
    brandFilters.querySelectorAll('input').forEach((i) => i.addEventListener('change', apply));
  }

  function reset() {
    searchEl.value = '';
    sortEl.value = 'newest';
    priceMinEl.value = '';
    priceMaxEl.value = '';
    brandFilters.querySelectorAll('input:checked').forEach((i) => (i.checked = false));
    apply();
  }

  async function load() {
    try {
      const res = await fetch('/api/listings');
      listings = await res.json();
      buildBrandFilters();
      apply();
    } catch (e) {
      grid.innerHTML = `<div class="empty">Couldn't load inventory. Please refresh.</div>`;
      countEl.textContent = '';
    }
  }

  [searchEl, priceMinEl, priceMaxEl].forEach((el) => el.addEventListener('input', apply));
  sortEl.addEventListener('change', apply);
  resetBtn.addEventListener('click', reset);
  load();
})();
