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

  // Consent management: region-scoped Consent Mode v2 (defaults set in <head>:
  // EEA/UK/CH default-denied until opt-in; US/rest-of-world default-granted with
  // opt-out). This runtime only pushes an UPDATE on an explicit signal — GPC
  // (opt-out everywhere) or a saved choice — so it never clobbers the regional
  // default for no-signal visitors.
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

    function loadMetaPixel() {
      const id = window.__EP_META_PIXEL;
      if (!id || window.__epPixelLoaded) return;
      window.__epPixelLoaded = true;
      !function (f, b, e, v, n, t, s) {
        if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
        t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
      }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', id);
      window.fbq('track', 'PageView');
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
      if (!deny) { loadGtag(); loadMetaPixel(); }
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
    if (GPC) {
      // GPC is an opt-out that applies everywhere — overrides the regional default.
      setStatus('denied', false);
    } else if (saved === 'granted' || saved === 'denied') {
      // Honor the visitor's explicit prior choice (banner click).
      setStatus(saved, false);
    }
    // No signal: leave the region-scoped Consent Mode default from <head> in place
    // (US/rest-of-world granted, EEA/UK/CH denied). gtag.js already loaded in <head>.

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

  // Conversion-event tracking. gtag()/fbq() only exist after consent opt-in,
  // so events for non-consenting visitors are simply dropped (compliant).
  // GA4 events fire now; Google Ads conversions + Meta events activate once
  // __EP_ADS_ID/__EP_ADS_LABELS/__EP_META_PIXEL are populated from site.json.
  (function () {
    function ga(name, params) {
      if (typeof window.gtag === 'function') {
        window.gtag('event', name, Object.assign({ transport_type: 'beacon' }, params || {}));
      }
    }
    function adsConv(key, extra) {
      var id = window.__EP_ADS_ID, labels = window.__EP_ADS_LABELS || {};
      if (typeof window.gtag !== 'function' || !id || !labels[key]) return;
      window.gtag('event', 'conversion', Object.assign({ send_to: id + '/' + labels[key], transport_type: 'beacon' }, extra || {}));
    }
    function meta(name) {
      if (typeof window.fbq === 'function') window.fbq('track', name);
    }
    document.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (href.indexOf('order.online') !== -1) {
        ga('order_click', { link_url: href, location: a.getAttribute('data-loc') || '' });
        adsConv('order');
        meta('InitiateCheckout');
      } else if (href.indexOf('tel:') === 0) {
        ga('call_click', { phone: href.replace('tel:', '') });
        adsConv('call');
        meta('Contact');
      }
    }, true);
    document.addEventListener('submit', function (e) {
      var f = e.target;
      if (!f || f.tagName !== 'FORM') return;
      var action = f.getAttribute('action') || '';
      if (action.indexOf('/api/') !== 0) return;
      ga('form_submit', { form_type: action.replace('/api/', '') });
      // Enhanced conversions: hand the lead's own email/phone to gtag, which
      // normalizes + SHA-256 hashes it client-side before sending (terms accepted
      // account-side). Improves match-back of this lead to its originating ad click.
      try {
        var ud = {};
        var em = f.querySelector('[name="email"]');
        var ph = f.querySelector('[name="phone"]');
        if (em && em.value) ud.email = em.value.trim().toLowerCase();
        if (ph && ph.value) {
          var raw = ph.value.replace(/[^\d+]/g, '');
          if (raw && raw.charAt(0) !== '+') {
            if (raw.length === 10) raw = '+1' + raw;
            else if (raw.length === 11 && raw.charAt(0) === '1') raw = '+' + raw;
          }
          if (raw) ud.phone_number = raw;
        }
        if (typeof window.gtag === 'function' && (ud.email || ud.phone_number)) {
          window.gtag('set', 'user_data', ud);
        }
      } catch (e2) {}
      adsConv('lead');
      meta('Lead');
    }, true);
  })();

  // Site-wide Happy Hour live indicator — checks current local time,
  // shows the header pill (and updates the /bars/ band if on that page)
  // every minute. HH window: 14:00–19:00 daily.
  function checkHH() {
    var now = new Date();
    var hf = now.getHours() + now.getMinutes() / 60;
    var live = hf >= 14 && hf < 19;
    try {
      var qs = new URLSearchParams(location.search);
      if (qs.get('hh') === '1') live = true;
    } catch (e) {}
    var indicators = document.querySelectorAll('[data-hh-indicator]');
    for (var i = 0; i < indicators.length; i++) {
      if (live) indicators[i].removeAttribute('hidden');
      else indicators[i].setAttribute('hidden', '');
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
        config: 'Our form service is not configured yet. Please email hello@elpueblomex.com.',
        rate: 'Too many submissions — try again in a few minutes.',
        parse: 'We could not read that submission. Please try again.',
        missing: 'Please fill in the required fields.',
        email: 'That email address looks invalid.',
        send: 'We could not send your message. Please try again or email hello@elpueblomex.com.',
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
