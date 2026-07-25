// Admin dashboard: auth gate + create / edit / delete listings.
(function () {
  const els = {
    who: document.getElementById('who'),
    logout: document.getElementById('logoutBtn'),
    form: document.getElementById('listingForm'),
    formTitle: document.getElementById('formTitle'),
    formSub: document.getElementById('formSub'),
    formAlert: document.getElementById('formAlert'),
    id: document.getElementById('listingId'),
    removeImage: document.getElementById('removeImage'),
    image: document.getElementById('image'),
    imgPreview: document.getElementById('imgPreview'),
    imgPreviewEl: document.getElementById('imgPreviewEl'),
    imgHint: document.getElementById('imgHint'),
    saveBtn: document.getElementById('saveBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    list: document.getElementById('adminList'),
    listCount: document.getElementById('listCount')
  };

  const FIELDS = ['title', 'brand', 'price', 'range', 'motor', 'topSpeed', 'description', 'contactEmail', 'contactPhone'];

  const BIKE_SVG = `<svg class="placeholder" width="30" height="30" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/>
      <path d="M5.5 17 10 7h4l3 6"/><path d="M10 7h5"/><path d="M14 7l4.5 10"/></svg>`;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function money(n) {
    if (n == null || n === '') return '—';
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function flash(msg, kind) {
    els.formAlert.textContent = msg;
    els.formAlert.className = 'alert show ' + (kind || 'ok');
    if (kind !== 'error') setTimeout(() => els.formAlert.classList.remove('show'), 3500);
  }

  // ---- Auth gate ----------------------------------------------------------
  async function ensureAuth() {
    try {
      const d = await (await fetch('/api/me')).json();
      if (!d.authenticated) { location.href = '/login'; return false; }
      els.who.textContent = 'Signed in as ' + d.username;
      return true;
    } catch {
      location.href = '/login';
      return false;
    }
  }

  els.logout.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/';
  });

  // ---- Image preview ------------------------------------------------------
  els.image.addEventListener('change', () => {
    const file = els.image.files[0];
    if (file) {
      els.imgPreviewEl.src = URL.createObjectURL(file);
      els.imgPreview.classList.add('show');
      els.removeImage.value = '0';
    }
  });

  // ---- Form: edit / reset -------------------------------------------------
  function resetForm() {
    els.form.reset();
    els.id.value = '';
    els.removeImage.value = '0';
    els.imgPreview.classList.remove('show');
    els.imgPreviewEl.removeAttribute('src');
    els.imgHint.innerHTML = 'JPG / PNG / WebP, up to 8&nbsp;MB.';
    els.formTitle.textContent = 'Add a bike';
    els.formSub.textContent = 'List a new e-bike on the storefront.';
    els.saveBtn.textContent = 'Add bike';
    els.cancelBtn.style.display = 'none';
    els.formAlert.classList.remove('show');
  }

  function editListing(l) {
    resetForm();
    els.id.value = l.id;
    FIELDS.forEach((f) => { if (els.form[f]) els.form[f].value = l[f] == null ? '' : l[f]; });
    els.formTitle.textContent = 'Edit bike';
    els.formSub.textContent = 'Update this listing.';
    els.saveBtn.textContent = 'Save changes';
    els.cancelBtn.style.display = '';
    if (l.image) {
      els.imgPreviewEl.src = l.image;
      els.imgPreview.classList.add('show');
      els.imgHint.innerHTML = 'Leave empty to keep the current photo. Uploading a new file replaces it.';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  els.cancelBtn.addEventListener('click', resetForm);

  // ---- Submit -------------------------------------------------------------
  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = els.id.value;
    const fd = new FormData();
    FIELDS.forEach((f) => fd.append(f, els.form[f] ? els.form[f].value : ''));
    if (els.image.files[0]) fd.append('image', els.image.files[0]);
    if (els.removeImage.value === '1') fd.append('removeImage', '1');

    els.saveBtn.disabled = true;
    els.saveBtn.textContent = id ? 'Saving…' : 'Adding…';
    try {
      const res = await fetch(id ? `/api/listings/${id}` : '/api/listings', {
        method: id ? 'PUT' : 'POST',
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed.');
      resetForm();
      await loadList();
      flash(id ? 'Listing updated.' : 'Bike added to the lot.', 'ok');
    } catch (err) {
      flash(err.message, 'error');
    } finally {
      els.saveBtn.disabled = false;
      els.saveBtn.textContent = els.id.value ? 'Save changes' : 'Add bike';
    }
  });

  // ---- List + delete ------------------------------------------------------
  let cache = [];

  function itemRow(l) {
    const thumb = l.image
      ? `<img src="${esc(l.image)}" alt="" />`
      : BIKE_SVG;
    const specs = [l.brand, money(l.price), l.range, l.motor].filter((x) => x && x !== '—').join(' · ');
    const contact = [l.contactEmail, l.contactPhone].filter(Boolean).join(' · ') || 'No contact set';
    return `
      <div class="admin-item" data-id="${esc(l.id)}">
        <div class="thumb">${thumb}</div>
        <div class="meta">
          <h3>${esc(l.title)}</h3>
          <div class="line">${esc(specs)}</div>
          <div class="line">${esc(contact)}</div>
        </div>
        <div class="actions">
          <button class="btn small ghost" data-act="edit">Edit</button>
          <button class="btn small danger" data-act="delete">Delete</button>
        </div>
      </div>`;
  }

  async function loadList() {
    try {
      cache = await (await fetch('/api/listings')).json();
      els.listCount.textContent = cache.length + (cache.length === 1 ? ' bike' : ' bikes');
      els.list.innerHTML = cache.length
        ? cache.map(itemRow).join('')
        : '<div class="empty">No bikes listed yet. Add your first above.</div>';
    } catch {
      els.list.innerHTML = '<div class="empty">Couldn\'t load listings.</div>';
    }
  }

  els.list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const row = btn.closest('.admin-item');
    const id = row.dataset.id;
    const listing = cache.find((l) => l.id === id);

    if (btn.dataset.act === 'edit') {
      if (listing) editListing(listing);
      return;
    }
    if (btn.dataset.act === 'delete') {
      if (!confirm(`Delete “${listing ? listing.title : 'this listing'}”? This can't be undone.`)) return;
      btn.disabled = true;
      try {
        const res = await fetch(`/api/listings/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        if (els.id.value === id) resetForm();
        await loadList();
      } catch {
        btn.disabled = false;
        flash('Delete failed.', 'error');
      }
    }
  });

  // ---- Boot ---------------------------------------------------------------
  (async function init() {
    if (await ensureAuth()) loadList();
  })();
})();
