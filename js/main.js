/* AdFyrr — interactions */
(function () {
  'use strict';

  /* Mobile nav toggle */
  var nav = document.querySelector('.nav');
  var toggle = document.querySelector('.nav-toggle');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      nav.classList.toggle('open');
    });
    nav.querySelectorAll('.nav-links a').forEach(function (a) {
      a.addEventListener('click', function () { nav.classList.remove('open'); });
    });
  }

  /* Current year in footer */
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* Scroll reveal */
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }

  /* Animated counters */
  var counters = document.querySelectorAll('[data-count]');
  if ('IntersectionObserver' in window && counters.length) {
    var co = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        var target = parseFloat(el.getAttribute('data-count'));
        var suffix = el.getAttribute('data-suffix') || '';
        var prefix = el.getAttribute('data-prefix') || '';
        var decimals = (target % 1 !== 0) ? 1 : 0;
        var start = 0, dur = 1600, t0 = null;
        function step(ts) {
          if (!t0) t0 = ts;
          var p = Math.min((ts - t0) / dur, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          var val = (start + (target - start) * eased);
          el.textContent = prefix + val.toFixed(decimals) + suffix;
          if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
        co.unobserve(el);
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { co.observe(el); });
  }

  /* Contact form — front-end only confirmation (no backend wired) */
  var form = document.querySelector('#contact-form');
  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var note = form.querySelector('.form-status');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      setTimeout(function () {
        if (note) {
          note.style.display = 'block';
          note.textContent = 'Thanks — your message has been received. Our team will reply within one business day.';
        }
        form.reset();
        if (btn) { btn.disabled = false; btn.textContent = 'Send message'; }
      }, 700);
    });
  }
})();
