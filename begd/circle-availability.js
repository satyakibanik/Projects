(function (root) {
  const metrics = [
    {id: 'substation', title: 'Substation availability'},
    {id: 'line', title: 'Transmission line availability'},
  ];
  const format = new Intl.NumberFormat('en', {minimumFractionDigits: 2, maximumFractionDigits: 5});
  const monthLabel = new Intl.DateTimeFormat('en', {month: 'short', timeZone: 'UTC'});
  let pending, selectedYear;

  function load() {
    if (!pending) {
      pending = fetch('circle-availability.json', {cache: 'no-cache'}).then(response => {
        if (!response.ok) throw Error('Availability data could not be loaded.');
        return response.json();
      }).catch(error => {
        pending = null;
        throw error;
      });
    }
    return pending;
  }

  const reliabilityMetrics = [
    {id: 'outages', title: 'Reported tripping and outages', unit: 'events', color: '#c48722'},
    {id: 'energy', title: 'Outage-related unserved energy', unit: 'MWh', color: '#b95442'},
  ];
  const summaryNumber = new Intl.NumberFormat('en', {maximumFractionDigits: 2});

  const previousOnly = record => Boolean(record?.outages?.basis === 'previous' || record?.energy?.basis === 'previous');

  function monthRows(records) {
    const months = [...records.keys()].sort();
    if (!months.length) return [];
    const next = new Date(months[0] + '-01T00:00:00Z');
    const rows = [];
    while (next.toISOString().slice(0, 7) <= months.at(-1)) {
      const date = next.toISOString().slice(0, 10);
      const record = records.get(date.slice(0, 7));
      rows.push({date, record, label: monthLabel.format(next) + ' ' + next.getUTCFullYear() +
        (previousOnly(record) ? ' · previous-month column' : '')});
      next.setUTCMonth(next.getUTCMonth() + 1);
    }
    return rows;
  }

  function dateTicks(rows, history) {
    if (!history) return rows.map((row, index) => ({
      index, label: row.label.split(' ')[0] + (previousOnly(row.record) ? '*' : ''),
      sparse: rows.length > 6 && index % 2 === 1,
    }));
    const last = rows.length - 1;
    const startYear = Number(rows[0].date.slice(0, 4));
    const endYear = Number(rows[last].date.slice(0, 4));
    const stride = Math.max(1, Math.ceil((endYear - startYear) / 6));
    return rows.flatMap((row, index) => {
      const year = Number(row.date.slice(0, 4));
      return index === 0 || index === last ||
        (row.date.endsWith('-01-01') && year > startYear && year < endYear && (year - startYear) % stride === 0
          && index > 8 && index < last - 8)
        ? [{index, label: String(year), sparse: index !== 0 && index !== last}] : [];
    });
  }

  function renderReliability(host, reliability, {plot, setupTooltips, releaseCharts}, history = false) {
    const charts = host.querySelector('.reliability-charts');
    const records = new Map(Object.entries(reliability).filter(([month, record]) =>
      history ? record.outages || record.energy : month.startsWith(selectedYear)));
    const rows = monthRows(records);
    const status = host.querySelector('.reliability-status');
    if (!rows.length) {
      status.textContent = 'No national totals are available for this year.';
      releaseCharts(charts);
      charts.replaceChildren();
      return;
    }
    status.textContent = history
      ? records.size + ' months · ' + rows[0].label.split(' · ')[0] + ' to ' + rows.at(-1).label.split(' · ')[0]
      : records.size + ' months in ' + selectedYear + ' · * Previous-month figure';
    releaseCharts(charts);
    charts.innerHTML = reliabilityMetrics.map(metric => {
      const figure = plot(rows, [{
        name: 'Published total', color: metric.color, width: 2.8,
        value: row => row.record?.[metric.id]?.total ?? null,
      }], metric.title, metric.unit, false, {
        compact: true, hideLegend: true, syncGroup: history ? 'historical-reliability' : 'monthly-reliability',
        key: (history ? 'historical-reliability-' : 'monthly-reliability-') + metric.id,
        ticks: dateTicks(rows, history),
      });
      return '<section class="availability-chart"><h3>' + metric.title + '</h3>' + figure + '</section>';
    }).join('');
    setupTooltips(charts);
    if (history) return;
    const table = host.querySelector('.reliability-sources tbody');
    table.replaceChildren(...rows.flatMap(row => reliabilityMetrics.map(metric => {
      const tr = document.createElement('tr');
      const item = row.record?.[metric.id];
      const values = item ? [item.tripping, item.emergency, item.scheduled, item.total] : [];
      const delta = values.length && values.every(Number.isFinite) ? item.total - item.tripping - item.emergency - item.scheduled : null;
      const cells = [row.label, metric.unit, ...Array.from({length: 4}, (_, index) =>
        values[index] == null ? '—' : summaryNumber.format(values[index])),
        delta != null && Math.abs(delta) >= 0.005 ? summaryNumber.format(delta) : '—',
        item ? item.file + ' · ' + item.cell : '—'];
      cells.forEach((value, index) => {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        if (index === 0) cell.scope = 'row';
        cell.textContent = value;
        tr.append(cell);
      });
      return tr;
    })));
  }

  async function mount(host, {plot, setupTooltips, releaseCharts}, history) {
    if (!host) return;
    const status = host.querySelector('.availability-status');
    let reports, reliability;
    try {
      ({reports, reliability} = await load());
    } catch {
      host.querySelectorAll('[role="status"]').forEach(message => { message.textContent = 'Monthly records could not be loaded.'; });
      return;
    }
    if (!host.isConnected) return;
    const yearSelect = host.querySelector('[data-availability-year]');
    const chartReports = reports.filter(report => report.values.length);
    const years = [...new Set(chartReports.map(report => report.month.slice(0, 4)))].reverse();
    selectedYear = years.includes(selectedYear) ? selectedYear : years[0];
    if (yearSelect) {
      yearSelect.replaceChildren(...years.map(year => new Option(year, year)));
      yearSelect.value = selectedYear;
    }

    const circles = [...new Set(reports.flatMap(report => report.values.map(value => value.circle)))].sort();
    const colors = ['#416fa8', '#bd573a', '#16805a', '#8a55a3', '#9a711e', '#008093',
      '#c34478', '#747643', '#495a91', '#8d6451', '#267941', '#865474'];
    const circleColors = new Map(circles.map((circle, index) => [circle, colors[index % colors.length]]));
    const api = {plot, setupTooltips, releaseCharts};

    function renderAvailability(charts, sourceReports, history) {
      const rows = monthRows(new Map(sourceReports.map(report => [report.month, report])));
      const observedCircles = new Set(sourceReports.flatMap(report => report.values.map(value => value.circle)));
      rows.forEach(row => {
        row.values = new Map((row.record?.values || []).map(value => [value.metric + '|' + value.circle, value]));
      });
      const values = sourceReports.flatMap(report => report.values.map(value => value.fraction * 100));
      const low = values.length ? Math.min(...values) : 99;
      const domain = [Math.max(0, low - Math.max((100 - low) * 0.12, 0.005)), 100];
      const group = history ? 'historical-availability' : 'circle-availability';
      releaseCharts(charts);
      charts.innerHTML = metrics.map(metric => {
        const series = circles.filter(circle => observedCircles.has(circle)).map(circle => ({
          name: circle, color: circleColors.get(circle), width: 2,
          value: row => {
            const value = row.values.get(metric.id + '|' + circle);
            return value ? value.fraction * 100 : null;
          },
          formatValue: value => format.format(value) + '%',
        }));
        const figure = plot(rows, series, metric.title, '%', false, {
          key: group + '-' + metric.id, domain, tickDecimals: domain[0] > 99.9 ? 3 : 2,
          hideLegend: true, compact: !history, syncGroup: group, ticks: dateTicks(rows, history),
        });
        return '<section class="availability-chart"><h3>' + metric.title + '</h3>' + figure + '</section>';
      }).join('');
      const legend = document.createElement('ul');
      legend.className = 'availability-circle-key';
      legend.setAttribute('aria-label', 'Reporting circles');
      const groups = [...charts.querySelectorAll('[data-trend-series]')];
      let hoveredCircle, focusedCircle;
      function updateHighlight() {
        const active = hoveredCircle ?? focusedCircle;
        for (const group of groups) {
          const matches = group.dataset.trendSeries === active;
          group.classList.toggle('availability-series-highlighted', matches);
          group.classList.toggle('availability-series-dimmed', Boolean(active) && !matches);
        }
      }
      for (const circle of circles.filter(circle => observedCircles.has(circle))) {
        const item = document.createElement('li');
        const swatch = document.createElement('i');
        swatch.style.backgroundColor = circleColors.get(circle);
        item.append(swatch, circle);
        item.tabIndex = 0;
        item.addEventListener('pointerenter', () => {
          hoveredCircle = circle;
          updateHighlight();
        });
        item.addEventListener('pointerleave', () => {
          hoveredCircle = null;
          updateHighlight();
        });
        item.addEventListener('focus', () => {
          focusedCircle = circle;
          updateHighlight();
        });
        item.addEventListener('blur', () => {
          focusedCircle = null;
          updateHighlight();
        });
        legend.append(item);
      }
      charts.append(legend);
      setupTooltips(charts);
      return rows;
    }

    function renderYear() {
      selectedYear = yearSelect.value;
      const selected = chartReports.filter(report => report.month.startsWith(selectedYear));
      const rows = renderAvailability(host.querySelector('[data-availability-plots]'), selected, false);
      status.textContent = selected.length + ' reports in ' + selectedYear + ' · Zoomed scale shared by both availability charts';
      const table = host.querySelector('.availability-sources tbody');
      table.replaceChildren(...rows.flatMap(row => {
        const names = [...new Set((row.record?.values || []).map(value => value.circle))];
        return (names.length ? names : ['—']).map(circle => {
          const tr = document.createElement('tr');
          const cells = [row.label, circle, ...metrics.map(metric => {
            const item = row.values.get(metric.id + '|' + circle);
            return item ? format.format(item.fraction * 100) + '% · ' + item.cell : '—';
          }), row.record?.file || '—'];
          cells.forEach((value, index) => {
            const cell = document.createElement(index === 0 ? 'th' : 'td');
            if (index === 0) cell.scope = 'row';
            cell.textContent = value;
            tr.append(cell);
          });
          return tr;
        });
      }));
      renderReliability(host, reliability, api);
    }
    if (history) {
      const rows = renderAvailability(host.querySelector('[data-availability-plots]'), chartReports, true);
      status.textContent = chartReports.length + ' monthly reports · ' + rows[0].label + ' to ' +
        rows.at(-1).label + ' · Zoomed scale shared by both charts';
      renderReliability(host, reliability, api, true);
      return;
    }
    yearSelect.addEventListener('change', renderYear);
    renderYear();
  }

  root.BEGDCircleAvailability = {mount};
})(window);
