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
})();
