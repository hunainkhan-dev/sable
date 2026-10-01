/* Sable — premium interactions. Progressive enhancement: works without GSAP/Lenis. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(pointer:fine)').matches;
  var root = document.documentElement;

  /* ---------- Theme toggle (persisted) ---------- */
  try { var saved = localStorage.getItem('sable-theme'); if (saved) root.setAttribute('data-theme', saved); } catch (e) {}
  var themeBtn = document.getElementById('themeToggle');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('sable-theme', next); } catch (e) {}
  });

  /* ---------- Lenis smooth scroll ---------- */
  var lenis = null;
  if (!reduce && window.Lenis) {
    lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 1 });
    (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(0);
  }
  function scrollToTarget(target) {
    if (lenis) lenis.scrollTo(target, { offset: -70, duration: 1.1 });
    else { var el = document.querySelector(target); if (el) el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); }
  }

  /* ---------- Nav scrolled state + scroll progress ---------- */
  var nav = document.getElementById('nav');
  var prog = document.getElementById('scrollProg');
  var ticking = false;
  function onScroll() {
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 12);
    if (prog) {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      prog.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
    }
    ticking = false;
  }
  onScroll();
  window.addEventListener('scroll', function () {
    if (!ticking) { window.requestAnimationFrame(onScroll); ticking = true; }
  }, { passive: true });

  /* ---------- Smooth anchor links ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    var id = a.getAttribute('href');
    if (id.length < 2) return;
    a.addEventListener('click', function (e) {
      var el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      scrollToTarget(id);
    });
  });

  /* ---------- Custom cursor ---------- */
  if (finePointer && !reduce) {
    var dot = document.getElementById('cursorDot');
    var ring = document.getElementById('cursorRing');
    if (dot && ring) {
      document.body.classList.add('has-cursor');
      var mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my, shown = false;
      window.addEventListener('mousemove', function (e) {
        mx = e.clientX; my = e.clientY;
        dot.style.transform = 'translate(' + mx + 'px,' + my + 'px)';
        if (!shown) { shown = true; dot.classList.add('on'); ring.classList.add('on'); }
      }, { passive: true });
      (function ring_loop() {
        rx += (mx - rx) * 0.18; ry += (my - ry) * 0.18;
        ring.style.transform = 'translate(' + rx + 'px,' + ry + 'px)';
        requestAnimationFrame(ring_loop);
      })();
      var hotSel = 'a,button,summary,input,select,.btn,[data-tilt],.acc';
      document.querySelectorAll(hotSel).forEach(function (el) {
        el.addEventListener('mouseenter', function () { dot.classList.add('hot'); ring.classList.add('hot'); });
        el.addEventListener('mouseleave', function () { dot.classList.remove('hot'); ring.classList.remove('hot'); });
      });
      window.addEventListener('mouseleave', function () { dot.classList.remove('on'); ring.classList.remove('on'); });
      window.addEventListener('mouseenter', function () { dot.classList.add('on'); ring.classList.add('on'); });
    }
  }

  /* ---------- Mobile menu ---------- */
  var menuBtn = document.getElementById('menuBtn');
  var mobileMenu = document.getElementById('mobileMenu');
  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', function () {
      var open = mobileMenu.hasAttribute('hidden');
      if (open) { mobileMenu.removeAttribute('hidden'); } else { mobileMenu.setAttribute('hidden', ''); }
      menuBtn.classList.toggle('open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    mobileMenu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        mobileMenu.setAttribute('hidden', ''); menuBtn.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------- Animated counters ---------- */
  function animateCount(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var prefix = el.getAttribute('data-prefix') || '';
    var suffix = el.getAttribute('data-suffix') || '';
    var decimals = (String(target).split('.')[1] || '').length;
    if (reduce) { el.textContent = prefix + target.toFixed(decimals) + suffix; return; }
    var start = performance.now(), dur = 1600;
    (function tick(now) {
      var p = Math.min((now - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + (target * eased).toFixed(decimals) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    })(performance.now());
  }

  /* ---------- Reveal + triggers via IntersectionObserver ---------- */
  var counted = new WeakSet();
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var t = en.target;
        t.classList.add('in');
        t.querySelectorAll('[data-count]').forEach(function (c) { if (!counted.has(c)) { counted.add(c); animateCount(c); } });
        if (t.matches('[data-count]') && !counted.has(t)) { counted.add(t); animateCount(t); }
        if (t.querySelector('.chart')) t.querySelector('.chart').classList.add('drawn');
        if (t.classList.contains('bars')) t.classList.add('animate');
        io.unobserve(t);
      });
    }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal, .stat__num, .chart, .bars').forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
    document.querySelectorAll('[data-count]').forEach(animateCount);
    document.querySelectorAll('.bars').forEach(function (b) { b.classList.add('animate'); });
    var ch = document.querySelector('.chart'); if (ch) ch.classList.add('drawn');
  }

  /* ---------- Hero headline word reveal ---------- */
  var title = document.querySelector('.hero__title');
  if (title) {
    if (window.gsap && !reduce) {
      window.gsap.set('.hero__title .w>i', { yPercent: 115 });
      window.gsap.to('.hero__title .w>i', { yPercent: 0, duration: 1.1, stagger: 0.09, ease: 'power4.out', delay: 0.15 });
    } else { title.classList.add('ready'); }
  }

  /* ---------- GSAP scroll-driven depth ---------- */
  window.addEventListener('load', function () {
    if (reduce || !window.gsap || !window.ScrollTrigger) return;
    var gsap = window.gsap, ST = window.ScrollTrigger;
    gsap.registerPlugin(ST);
    if (lenis) lenis.on('scroll', ST.update);

    var panel = document.querySelector('.hero__panel');
    if (panel) gsap.to(panel, { yPercent: -8, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.6 } });

    var aurora = document.querySelector('.hero__aurora');
    if (aurora) gsap.to(aurora, { yPercent: 26, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.8 } });

    // Bento cards rise + settle
    gsap.utils.toArray('.bento__card').forEach(function (card, i) {
      gsap.from(card, { y: 40, opacity: 0, duration: 0.9, ease: 'power3.out',
        scrollTrigger: { trigger: card, start: 'top 90%' }, delay: (i % 3) * 0.06 });
    });

    // Section titles clip-reveal
    gsap.utils.toArray('.section__title').forEach(function (h) {
      gsap.from(h, { clipPath: 'inset(0 0 100% 0)', y: 20, duration: 1, ease: 'power4.out',
        scrollTrigger: { trigger: h, start: 'top 88%' } });
    });

    // Pricing featured subtle float
    var feat = document.querySelector('.plan--featured');
    if (feat) gsap.to(feat, { y: -14, ease: 'none', scrollTrigger: { trigger: feat, start: 'top bottom', end: 'top top', scrub: 1 } });
  });

  /* ---------- Magnetic buttons (pointer-fine only) ---------- */
  if (!reduce && finePointer) {
    document.querySelectorAll('.btn--primary, .btn--lg').forEach(function (btn) {
      btn.style.willChange = 'transform';
      btn.addEventListener('mousemove', function (e) {
        var r = btn.getBoundingClientRect();
        var mx = (e.clientX - r.left - r.width / 2) / r.width;
        var my = (e.clientY - r.top - r.height / 2) / r.height;
        btn.style.transform = 'translate(' + (mx * 8).toFixed(1) + 'px,' + (my * 8 - 2).toFixed(1) + 'px)';
      });
      btn.addEventListener('mouseleave', function () { btn.style.transform = ''; });
    });
  }

  /* ---------- Aurora mouse parallax ---------- */
  if (!reduce && finePointer) {
    var aur = document.querySelector('.hero__aurora');
    if (aur) {
      var blobs = aur.querySelectorAll('span');
      window.addEventListener('mousemove', function (e) {
        var cx = (e.clientX / window.innerWidth - 0.5);
        var cy = (e.clientY / window.innerHeight - 0.5);
        blobs.forEach(function (b, i) {
          var d = (i + 1) * 14;
          b.style.marginLeft = (cx * d).toFixed(1) + 'px';
          b.style.marginTop = (cy * d).toFixed(1) + 'px';
        });
      }, { passive: true });
    }
  }

  /* ---------- Demo form (client-side validation only) ---------- */
  var form = document.getElementById('demoForm');
  var note = document.getElementById('formNote');
  var field = form ? form.querySelector('.field') : null;
  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = document.getElementById('email');
    var val = email.value.trim();
    var valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
    if (!valid) {
      field.classList.add('invalid');
      note.textContent = 'Please enter a valid work email.';
      note.className = 'cta__note err';
      email.focus();
      return;
    }
    field.classList.remove('invalid');
    note.textContent = '✓ Thanks! A product specialist will reach out to ' + val + ' shortly.';
    note.className = 'cta__note ok';
    form.reset();
  });

  /* ---------- Footer year ---------- */
  var y = document.querySelector('.footer__bottom span');
  if (y) y.textContent = y.textContent.replace('2026', new Date().getFullYear());
})();
