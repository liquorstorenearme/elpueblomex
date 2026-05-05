(function () {
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.getElementById('mobile-nav');
  const closeBtn = document.querySelector('[data-nav-close]');
  if (toggle && menu) {
    const close = () => {
      menu.setAttribute('hidden', '');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('nav-open');
      document.body.style.overflow = '';
    };
    const open = () => {
      menu.removeAttribute('hidden');
      toggle.setAttribute('aria-expanded', 'true');
      document.body.classList.add('nav-open');
      document.body.style.overflow = 'hidden';
    };
    toggle.addEventListener('click', () => {
      if (menu.hasAttribute('hidden')) open();
      else close();
    });
    if (closeBtn) closeBtn.addEventListener('click', close);
    menu.addEventListener('click', (e) => {
      if (e.target.matches('a')) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hasAttribute('hidden')) close();
    });
  }

  // Consent management: default-deny, honor GPC, Google Consent Mode v2.
  // Public API: window.__epOptIn / __epOptOut / __epConsentStatus
  // Event: 'ep-consent-changed' fires on every state change.
  (function () {
    const KEY = 'ep_consent_pref';
    const ONE_YEAR = 60 * 60 * 24 * 365;
    const GA_IDS = (window.__EP_GA_IDS || []);

    function setCookie(name, value, maxAge) {
      document.cookie = name + '=' + encodeURIComponent(value) + '; Max-Age=' + maxAge + '; Path=/; SameSite=Lax';
    }
    function getCookie(name) {
      return document.cookie.split('; ').reduce(function (acc, c) {
        const i = c.indexOf('='); if (i < 0) return acc;
        acc[c.slice(0, i)] = decodeURIComponent(c.slice(i + 1));
        return acc;
      }, {})[name];
    }

    function loadGtag() {
      if (window.__epGtagLoaded || !GA_IDS.length) return;
      window.__epGtagLoaded = true;
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_IDS[0]);
      document.head.appendChild(s);
    }

    function pushConsent(deny) {
      window.dataLayer = window.dataLayer || [];
      const fn = window.gtag || function () { window.dataLayer.push(arguments); };
      fn('consent', 'update', {
        ad_storage: deny ? 'denied' : 'granted',
        analytics_storage: deny ? 'denied' : 'granted',
        ad_user_data: deny ? 'denied' : 'granted',
        ad_personalization: deny ? 'denied' : 'granted',
        functionality_storage: 'granted',
        security_storage: 'granted'
      });
      GA_IDS.forEach(function (id) { window['ga-disable-' + id] = !!deny; });
      if (!deny) loadGtag();
    }

    function broadcast(status) {
      try { window.dispatchEvent(new CustomEvent('ep-consent-changed', { detail: { status: status } })); } catch (e) {}
    }

    function setStatus(status, persist) {
      if (persist) setCookie(KEY, status, ONE_YEAR);
      pushConsent(status === 'denied');
      broadcast(status);
    }

    const GPC = (typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true);
    const saved = getCookie(KEY);
    let initial;
    if (GPC) initial = 'denied';
    else if (saved === 'granted') initial = 'granted';
    else initial = 'denied';
    setStatus(initial, !!saved);

    const banner = document.getElementById('cookie-banner');
    if (banner && !saved && !GPC) {
      banner.removeAttribute('hidden');
      banner.addEventListener('click', function (e) {
        const accept = e.target.closest('[data-cookie-accept]');
        const decline = e.target.closest('[data-cookie-decline]');
        if (!accept && !decline) return;
        setStatus(accept ? 'granted' : 'denied', true);
        banner.setAttribute('hidden', '');
      });
    }

    window.__epOptIn = function () { setStatus('granted', true); };
    window.__epOptOut = function () { setStatus('denied', true); };
    window.__epConsentStatus = function () {
      if (typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true) return 'gpc';
      return getCookie(KEY) || 'denied';
    };
  })();

  // Site-wide Happy Hour live indicator — checks current local time,
  // shows the header pill (and updates the /bars/ band if on that page)
  // every minute. HH windows: 14:00–19:00 + 23:00–24:00 daily.
  function checkHH() {
    var now = new Date();
    var hf = now.getHours() + now.getMinutes() / 60;
    var live = (hf >= 14 && hf < 19) || (hf >= 23 && hf < 24);
    var pill = document.getElementById('header-hh');
    if (pill) {
      if (live) pill.removeAttribute('hidden');
      else pill.setAttribute('hidden', '');
    }
  }
  checkHH();
  setInterval(checkHH, 60000);

  const announce = document.querySelector('[data-announce]');
  if (announce) {
    const KEY = 'ep_announce_dismissed';
    const VER = 'la-jolla-2026';
    let dismissed = null;
    try { dismissed = localStorage.getItem(KEY); } catch (e) {}
    if (dismissed === VER) {
      announce.setAttribute('hidden', '');
    }
    const closeBtn = announce.querySelector('[data-announce-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        try { localStorage.setItem(KEY, VER); } catch (e) {}
        announce.setAttribute('hidden', '');
      });
    }
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      }
    }
  }, { rootMargin: '0px 0px -10% 0px' });
  document.querySelectorAll('.fade-in').forEach((el) => io.observe(el));

  const params = new URLSearchParams(location.search);
  const sent = params.get('sent');
  const err = params.get('err');
  if (sent || err) {
    const form = document.querySelector('.stack-form') || document.querySelector('.newsletter-form');
    const target = form ? form.parentElement : document.querySelector('main');
    if (target) {
      const status = document.createElement('div');
      status.className = 'form-status ' + (sent ? 'form-status--ok' : 'form-status--err');
      const messages = {
        config: 'Our form service is not configured yet. Please email info@elpueblomex.com.',
        rate: 'Too many submissions — try again in a few minutes.',
        parse: 'We could not read that submission. Please try again.',
        missing: 'Please fill in the required fields.',
        email: 'That email address looks invalid.',
        send: 'We could not send your message. Please try again or email info@elpueblomex.com.',
        size: 'Resume file is too large (10MB max).',
        type: 'Resume must be a PDF, DOC, DOCX, or TXT file.'
      };
      if (sent === 'newsletter') {
        status.textContent = 'Thanks — you are on the list. We will email you the moment we open the doors.';
      } else if (sent) {
        status.textContent = 'Thanks — we got your message and will be in touch shortly.';
      } else {
        status.textContent = messages[err] || 'Something went wrong. Please try again.';
      }
      target.insertBefore(status, form || target.firstChild);
      status.scrollIntoView({ behavior: 'smooth', block: 'center' });
      try {
        const url = new URL(location.href);
        url.searchParams.delete('sent');
        url.searchParams.delete('err');
        history.replaceState(null, '', url.toString());
      } catch (e) {}
    }
  }
})();
