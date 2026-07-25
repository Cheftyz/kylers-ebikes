// Login page: authenticate, then send the admin to the dashboard.
(function () {
  const form = document.getElementById('loginForm');
  const alertEl = document.getElementById('alert');
  const btn = document.getElementById('submitBtn');

  function showError(msg) {
    alertEl.textContent = msg;
    alertEl.classList.add('show');
  }

  // If already signed in, skip straight to the dashboard.
  fetch('/api/me')
    .then((r) => r.json())
    .then((d) => { if (d.authenticated) location.href = '/admin'; })
    .catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertEl.classList.remove('show');
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value,
          password: document.getElementById('password').value
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sign in failed.');
      location.href = '/admin';
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
})();
