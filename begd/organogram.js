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
    const sectorCounts = new Map();
    for (const {sector} of organizations) {
      sectorCounts.set(sector, (sectorCounts.get(sector) || 0) + 1);
    }
    const sectors = [...sectorCounts.keys()].sort(collator.compare);
    host.innerHTML = `<div class="organogram">
      <div class="organogram-controls">
        <label>Find an organization<input type="search" data-org-query placeholder="Try BPDB, gas, or Rooppur"></label>
        <label>Sector<select data-org-sector><option value="">All sectors (${organizations.length})</option>${sectors.map(sector =>
          `<option value="${escape(sector)}">${escape(sector)} (${sectorCounts.get(sector)})</option>`).join('')}</select></label>
      </div>
      <div data-org-path role="navigation" aria-label="Organization hierarchy"></div>
      <section class="organogram-profile" aria-labelledby="organogram-name" data-org-profile></section>
      <section class="organogram-branches" aria-labelledby="organogram-branches">
        <h2 id="organogram-branches">Organization tree</h2>
        <p data-org-status role="status" hidden></p>
        <div data-org-tree></div>
      </section>
    </div>`;
    const search = host.querySelector('[data-org-query]');
    const sector = host.querySelector('[data-org-sector]');
    const breadcrumbs = host.querySelector('[data-org-path]');
    const profile = host.querySelector('[data-org-profile]');
    const tree = host.querySelector('[data-org-tree]');
    const status = host.querySelector('[data-org-status]');
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

    const collapsed = new Set();
    const filteredCollapsed = new Set();
    let filtering = false;

    function renderTree() {
      const words = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      filtering = words.length > 0 || Boolean(sector.value);
      const matches = organizations.filter(item => {
        if (sector.value && item.sector !== sector.value) return false;
        const terms = [item.name,item.role,item.publicData,item.sector,item.relationship,...item.links.map(link => link.label)].join(' ').toLowerCase();
        return words.every(word => terms.includes(word));
      });
      const matchingIds = new Set(matches.map(item => item.id));
      const visibleIds = new Set(matches.flatMap(item => pathTo(item, byId).map(ancestor => ancestor.id)));
      status.hidden = !filtering;
      status.textContent = matches.length
        ? `${matches.length} matching ${matches.length === 1 ? 'organization' : 'organizations'}`
        : 'No organizations match those filters.';

      function branch(entries, parent) {
        const visible = entries.filter(entry => visibleIds.has(entry.id));
        if (!visible.length) return '';
        const closed = filtering ? filteredCollapsed : collapsed;
        const attributes = parent
          ? ` id="org-children-${escape(parent)}"${closed.has(parent) ? ' hidden' : ''}`
          : '';
        return `<ul class="organogram-tree"${attributes}>
          ${visible.map(entry => {
            const id = escape(entry.id);
            const descendants = branch(children.get(entry.id), entry.id);
            return `<li>
              <div class="organogram-tree-row">
                <button type="button" class="organogram-node${matchingIds.has(entry.id) ? '' : ' organogram-context'}"
                  data-org-open="${id}" data-sector="${escape(entry.sector)}"
                  ${entry.id === selected ? 'aria-current="true"' : ''}>
                  <span class="organogram-mark" aria-hidden="true">${escape(mark(entry))}</span>
                  <span class="organogram-node-text"><strong>${escape(entry.name)}</strong><small>${escape(entry.sector)}</small></span>
                </button>
                ${descendants ? `<button type="button" class="organogram-toggle" data-org-toggle="${id}"
                  aria-expanded="${!closed.has(entry.id)}" aria-controls="org-children-${id}"
                  aria-label="Toggle organizations under ${escape(entry.name)}"><span aria-hidden="true"></span></button>` : ''}
              </div>
              ${descendants}
            </li>`;
          }).join('')}
        </ul>`;
      }

      tree.innerHTML = branch(organizations.filter(entry => !entry.parent).sort(sortByName));
    }

    function show(entry, focus = false) {
      selected = entry.id;
      const path = pathTo(entry, byId);
      breadcrumbs.innerHTML = `<ol>${path.map(node => node.id === entry.id
        ? `<li aria-current="location" data-sector="${escape(node.sector)}">${escape(node.name)}</li>`
        : `<li data-sector="${escape(node.sector)}"><button type="button" data-org-open="${escape(node.id)}">${escape(node.name)}</button></li>`).join('')}</ol>`;
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
      renderTree();
      if (focus) profile.querySelector('#organogram-name').focus();
    }

    function applyFilters() {
      filteredCollapsed.clear();
      renderTree();
    }

    search.addEventListener('input', applyFilters);
    sector.addEventListener('change', applyFilters);
    tree.addEventListener('click', event => {
      const toggle = event.target.closest('[data-org-toggle]');
      if (!toggle) return;
      const closed = filtering ? filteredCollapsed : collapsed;
      const id = toggle.dataset.orgToggle;
      const isExpanded = closed.delete(id);
      if (!isExpanded) closed.add(id);
      toggle.setAttribute('aria-expanded', String(isExpanded));
      document.getElementById(toggle.getAttribute('aria-controls')).hidden = !isExpanded;
    });
    host.querySelector('.organogram').addEventListener('click', event => {
      const button = event.target.closest('[data-org-open]');
      if (!button) return;
      const entry = byId.get(button.dataset.orgOpen);
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
