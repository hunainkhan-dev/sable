// Auth page logic
(function () {
  'use strict';
  var tabs = document.querySelectorAll('.auth-tab');
  var loginForm = document.getElementById('loginForm');
  var signupForm = document.getElementById('signupForm');

  // if already signed in, skip to app
  try { if (localStorage.getItem('sable-token')) location.replace('/app'); } catch (e) {}

  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) { x.classList.toggle('is-active', x === t); });
      var isLogin = t.dataset.tab === 'login';
      loginForm.hidden = !isLogin;
      signupForm.hidden = isLogin;
    });
  });

  function save(data) {
    try {
      localStorage.setItem('sable-token', data.token);
      localStorage.setItem('sable-user', JSON.stringify(data.user));
    } catch (e) {}
    location.href = '/app';
  }

  async function submit(form, url, errEl) {
    errEl.textContent = '';
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Please wait…';
    var body = Object.fromEntries(new FormData(form).entries());
    try {
      var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Something went wrong.');
      save(data);
    } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false;
      btn.textContent = form.id === 'loginForm' ? 'Sign in' : 'Create account';
    }
  }

  loginForm.addEventListener('submit', function (e) { e.preventDefault(); submit(loginForm, '/api/auth/login', document.getElementById('loginErr')); });
  signupForm.addEventListener('submit', function (e) { e.preventDefault(); submit(signupForm, '/api/auth/signup', document.getElementById('signupErr')); });
})();
