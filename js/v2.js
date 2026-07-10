/* AdFyrr V2 — shared interactions (scroll reveal, counters, form, year) */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var els = Array.prototype.slice.call(document.querySelectorAll('.rv'));
  var nums = Array.prototype.slice.call(document.querySelectorAll('[data-count]'));

  function animate(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var dec = parseInt(el.getAttribute('data-dec') || '0', 10);
    if (!reduced) {
      var t0 = null, dur = 1400;
      var frame = function (t) {
        if (!t0) t0 = t;
        var p = Math.min((t - t0) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.childNodes[0].nodeValue = (target * eased).toFixed(dec);
        if (p < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }
    setTimeout(function () { el.childNodes[0].nodeValue = target.toFixed(dec); }, reduced ? 0 : 1700);
  }

  if (reduced) {
    els.forEach(function (e) { e.classList.add('in'); });
    nums.forEach(animate);
  } else {
    var last = 0;
    var reveal = function () {
      var h = window.innerHeight;
      els = els.filter(function (e) {
        var r = e.getBoundingClientRect();
        if (r.top < h - 24 || r.bottom < h) { e.classList.add('in'); return false; }
        return true;
      });
      nums = nums.filter(function (n) {
        var r = n.getBoundingClientRect();
        if (r.top < h && r.bottom > 0) { animate(n); return false; }
        return true;
      });
    };
    var onScroll = function () {
      var now = Date.now();
      if (now - last > 80) { last = now; reveal(); }
      else { clearTimeout(onScroll.t); onScroll.t = setTimeout(reveal, 90); }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    window.addEventListener('load', reveal);
    reveal();
    setTimeout(reveal, 350);
  }

  /* Current year in footer */
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

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
