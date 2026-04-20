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

  const banner = document.getElementById('cookie-banner');
  if (banner) {
    const KEY = 'ep_cookie_consent';
    let consent = null;
    try { consent = localStorage.getItem(KEY); } catch (e) {}
    if (!consent) {
      banner.removeAttribute('hidden');
    }
    banner.addEventListener('click', (e) => {
      const accept = e.target.closest('[data-cookie-accept]');
      const decline = e.target.closest('[data-cookie-decline]');
      if (!accept && !decline) return;
      try { localStorage.setItem(KEY, accept ? 'accept' : 'decline'); } catch (err) {}
      banner.setAttribute('hidden', '');
    });
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

  var params = new URLSearchParams(location.search);
  var sent = params.get('sent');
  var err = params.get('err');
  if (sent || err) {
    var form = document.querySelector('.stack-form') || document.querySelector('.newsletter-form');
    var target = form ? form.parentElement : document.querySelector('main');
    if (target) {
      var banner = document.createElement('div');
      banner.className = 'form-status ' + (sent ? 'form-status--ok' : 'form-status--err');
      var messages = {
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
        banner.textContent = 'Thanks — you are on the list. We will email you the moment we open the doors.';
      } else if (sent) {
        banner.textContent = 'Thanks — we got your message and will be in touch shortly.';
      } else {
        banner.textContent = messages[err] || 'Something went wrong. Please try again.';
      }
      target.insertBefore(banner, form || target.firstChild);
      banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
      try {
        var url = new URL(location.href);
        url.searchParams.delete('sent');
        url.searchParams.delete('err');
        history.replaceState(null, '', url.toString());
      } catch (e) {}
    }
  }
})();
