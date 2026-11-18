(function (root) {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[char]);
  const collator = new Intl.Collator('en');
  const sortByName = (a,b) => collator.compare(a.name,b.name);
  let catalog, pending;
  let selected = 'government';

  function pathTo(entry, byId) {
    const path = [entry];
    while (path[0].parent) path.unshift(byId.get(path[0].parent));
    return path;
  }

  function openExplorer(host, catalog) {
    const organizations = catalog.organizations;
    const byId = new Map(organizations.map(entry => [entry.id,entry]));
    const sectors = [...new Set(organizations.map(entry => entry.sector))].sort();
    host.innerHTML = `<div class="organogram">
      <div class="organogram-controls">
        <label>Find an organization<input type="search" data-org-query placeholder="Try BPDB, gas, or Rooppur"></label>
        <label>Sector<select data-org-sector><option value="">All sectors</option>${sectors.map(sector =>
          `<option value="${escape(sector)}">${escape(sector)}</option>`).join('')}</select></label>
      </div>
      <section class="organogram-search-results" aria-labelledby="organogram-results-title" hidden>
        <h2 id="organogram-results-title" aria-live="polite"></h2>
        <div class="organogram-cards" data-org-results></div>
      </section>
      <div data-org-path role="navigation" aria-label="Organization hierarchy"></div>
      <div class="organogram-layout">
        <div data-org-ancestry></div>
        <section class="organogram-profile" aria-labelledby="organogram-name" data-org-profile></section>
        <section class="organogram-branches" aria-labelledby="organogram-branches">
          <h2 id="organogram-branches"></h2><div class="organogram-cards" data-org-cards></div>
        </section>
      </div>
    </div>`;
    const search = host.querySelector('[data-org-query]');
    const sector = host.querySelector('[data-org-sector]');
    const breadcrumbs = host.querySelector('[data-org-path]');
    const profile = host.querySelector('[data-org-profile]');
    const branchHeading = host.querySelector('#organogram-branches');
    const searchResults = host.querySelector('.organogram-search-results');
    const resultsHeading = host.querySelector('#organogram-results-title');
    const results = host.querySelector('[data-org-results]');
    const ancestry = host.querySelector('[data-org-ancestry]');
    const cards = host.querySelector('[data-org-cards]');
    const children = new Map(organizations.map(entry => [entry.id,[]]));
    for (const entry of organizations) {
      if (entry.parent) children.get(entry.parent).push(entry);
    }
    for (const branch of children.values()) branch.sort(sortByName);

    function mark(entry) {
      const acronym = entry.name.match(/\(([A-Za-z]{2,})\)$/)?.[1];
      if (acronym) return acronym.toUpperCase();
      return {'government':'BD','power-grid':'GRID','petrobangla':'PB','power-division':'PD','power-cell':'PC'}[entry.id] || entry.id.toUpperCase();
    }

    function linkedCount(entry) {
      const count = children.get(entry.id).length;
      return count ? `<small class="organogram-linked-count">${count} linked ${count === 1 ? 'organization' : 'organizations'}</small>` : '';
    }

    function node(entry, context, type = 'branch') {
      return `<button type="button" class="organogram-node organogram-${type}" data-org-open="${escape(entry.id)}" data-sector="${escape(entry.sector)}">
        <span class="organogram-mark" aria-hidden="true">${escape(mark(entry))}</span>
        <span class="organogram-node-text"><strong>${escape(entry.name)}</strong><small>${escape(context)}</small>${linkedCount(entry)}</span>
        <span class="organogram-node-arrow" aria-hidden="true">${type==='parent'?'↑':'→'}</span>
      </button>`;
    }

    function renderResults() {
      const words = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      searchResults.hidden = !words.length && !sector.value;
      if (searchResults.hidden) {
        results.innerHTML = '';
        return;
      }
      const matches = organizations.filter(item => {
        if (sector.value && item.sector !== sector.value) return false;
        const terms = [item.name,item.role,item.publicData,item.sector,item.relationship,...item.links.map(link => link.label)].join(' ').toLowerCase();
        return words.every(word => terms.includes(word));
      }).sort(sortByName);
      resultsHeading.textContent = `Search results (${matches.length})`;
      results.innerHTML = matches.length
        ? matches.map(item => node(item, byId.get(item.parent)?.name || item.sector)).join('')
        : '<p>No organizations match those filters.</p>';
    }

    function show(entry, focus = false) {
      selected = entry.id;
      const path = pathTo(entry, byId);
      breadcrumbs.innerHTML = `<ol>${path.map(node => node.id === entry.id
        ? `<li aria-current="location" data-sector="${escape(node.sector)}">${escape(node.name)}</li>`
        : `<li data-sector="${escape(node.sector)}"><button type="button" data-org-open="${escape(node.id)}">${escape(node.name)}</button></li>`).join('')}</ol>`;
      const parent = byId.get(entry.parent);
      ancestry.hidden = !parent;
      ancestry.innerHTML = parent ? node(parent,'Parent organization','parent') : '';
      const branch = children.get(entry.id);
      branchHeading.textContent = 'Linked organizations';
      cards.innerHTML = branch.length ? branch.map(item => node(item,item.sector)).join('')
        : '<p>No organizations are listed under this entry.</p>';
      profile.dataset.sector = entry.sector;
      const links = entry.links.map(({label,url}) => `<li><a href="${escape(url)}" target="_blank" rel="noopener noreferrer"><span>${escape(label)}</span><span aria-hidden="true">↗</span></a></li>`).join('');
      profile.innerHTML = `<div class="organogram-profile-title">
        <span class="organogram-mark" aria-hidden="true">${escape(mark(entry))}</span>
        <div><span class="organogram-sector">${escape(entry.sector)}</span>
          <h2 id="organogram-name" tabindex="-1">${escape(entry.name)}</h2>${linkedCount(entry)}</div></div>
        <div class="organogram-profile-body"><h3>Role</h3><p>${escape(entry.role)}</p>
        ${entry.relationship ? `<p class="organogram-relationship">${escape(entry.relationship)}</p>` : ''}
        ${entry.publicData ? `<h3>Public data and materials</h3><p>${escape(entry.publicData)}</p>` : ''}
        ${links ? `<ul aria-label="Website">${links}</ul>` : ''}</div>`;
      renderResults();
      if (focus) profile.querySelector('#organogram-name').focus();
    }

    search.addEventListener('input', renderResults);
    sector.addEventListener('change', renderResults);
    host.querySelector('.organogram').addEventListener('click', event => {
      const button = event.target.closest('[data-org-open]');
      if (!button) return;
      const entry = byId.get(button.dataset.orgOpen);
      search.value = '';
      sector.value = '';
      show(entry, true);
    });
    show(byId.get(selected));
  }

  async function mount() {
    const host = document.querySelector('#content');
    document.querySelectorAll('nav a').forEach(link => link.classList.toggle('active',link.hash === '#organogram'));
    document.querySelector('#title').textContent = 'Organogram';
    document.querySelector('#subtitle').textContent = 'Explore who governs, operates, regulates, and supplies Bangladesh’s electric grid.';
    for (const id of ['report-date-controls','date-status','day-sources','error']) document.getElementById(id).hidden = true;
    document.querySelector('.header-meta .status').textContent = 'SECTOR DIRECTORY';
    document.querySelector('#source').textContent = '';
    const stamp = document.querySelector('#data-updated');
    stamp.textContent = '';
    stamp.dataset.view = 'organogram';
    stamp.tabIndex = -1;
    if (host.querySelector('.organogram')) return;

    host.innerHTML = '<p role="status">Loading the organogram…</p>';
    try {
      pending ||= fetch('organogram-data.json?v=public-data-v2').then(response => {
        if (!response.ok) throw new Error('Organogram unavailable');
        return response.json();
      });
      catalog ||= await pending;
      if (location.hash === '#organogram' && !host.querySelector('.organogram')) openExplorer(host, catalog);
    } catch {
      pending = null;
      catalog = null;
      if (location.hash !== '#organogram') return;
      host.innerHTML = '<p role="status">The organogram could not be loaded.</p><button type="button">Retry</button>';
      host.querySelector('button').addEventListener('click', mount);
    }
  }

  root.BEGDOrganogram = {mount};
  if (location.hash === '#organogram') mount();
})(window);
