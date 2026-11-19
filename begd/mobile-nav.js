(() => {
  const toggle = document.getElementById('mobile-nav-toggle');
  const drawer = document.getElementById('mobile-nav-drawer');
  const nav = document.getElementById('dashboard-nav');
  const mobile = matchMedia('(max-width: 800px)');
  const desktopPosition = document.createComment('Dashboard navigation');
  nav.before(desktopPosition);

  toggle.addEventListener('click', () => {
    if (!mobile.matches || drawer.open) return;
    drawer.append(nav);
    drawer.showModal();
    toggle.setAttribute('aria-expanded', 'true');
    const activeLink = nav.querySelector('a.active');
    if (activeLink) activeLink.scrollIntoView({block: 'nearest'});
  });

  drawer.addEventListener('close', () => {
    desktopPosition.after(nav);
    toggle.setAttribute('aria-expanded', 'false');
  });
  drawer.addEventListener('click', event => {
    if (event.target === drawer) drawer.close();
  });
  nav.addEventListener('click', event => {
    if (drawer.open && event.target.closest('a[href^="#"]')) drawer.close();
  });
  window.addEventListener('hashchange', () => {
    if (drawer.open) drawer.close();
  });
  mobile.addEventListener('change', () => {
    if (!mobile.matches && drawer.open) drawer.close();
  });
})();
