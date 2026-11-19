(function (root) {
  const sources = {
    demand: 'Demand, supply and load shedding',
    generation: 'Generation by source',
    imports: 'India imports',
    operations: 'Daily operational workbook'
  };
  const minute = 60_000;
  const dayLength = 24 * 60;
  const dateTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const format = instant => instant ? dateTime.format(new Date(instant)) : '—';
  const offset = (day, timestamp) => (timestamp - Date.parse(day.date + 'T00:00:00+06:00')) / minute;

  function dailyRows(feed = {}, maxWindow = 45) {
    const days = new Map();
    for (const row of feed.observations || []) {
      if (!days.has(row.date)) days.set(row.date, []);
      days.get(row.date).push(row);
    }
    return [...days].sort(([a], [b]) => b.localeCompare(a)).map(([date, records]) => {
      records.sort((a, b) => Date.parse(a.first_seen_at) - Date.parse(b.first_seen_at)
        || (a.reading_time || a.report_id).localeCompare(b.reading_time || b.report_id));
      const first = records[0];
      const upper = Date.parse(first.first_seen_at);
      // If multiple records appeared in the same poll, use the earliest
      // supported lower bound. Any unbounded record makes the whole day unbounded.
      const tied = records.filter(row => Date.parse(row.first_seen_at) === upper);
      const lower = Math.min(...tied.map(row => row.absent_after ? Date.parse(row.absent_after) : -Infinity));
      const bounded = Number.isFinite(lower);
      const baseline = date <= feed.baseline_through;
      return {
        date, records, first, upper, lower, bounded, baseline,
        eligible: !baseline && bounded && upper >= lower && upper - lower <= maxWindow * minute
      };
    });
  }

  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function estimate(days, minimum) {
    const samples = days.filter(day => day.eligible);
    if (samples.length < minimum) return {count: samples.length};
    return {
      count: samples.length,
      lower: Math.floor(median(samples.map(day => offset(day, day.lower)))),
      upper: Math.ceil(median(samples.map(day => offset(day, day.upper))))
    };
  }

  function wallTime(minutes) {
    const day = Math.floor(minutes / dayLength);
    const clock = minutes - day * dayLength;
    const pad = number => String(number).padStart(2, '0');
    return pad(Math.floor(clock / 60)) + ':' + pad(clock % 60)
      + (day ? ' (' + (day > 0 ? '+' : '') + day + 'd)' : '');
  }

  function tickStep(span) {
    const target = span / 6;
    if (target <= 5) return Math.max(1, Math.ceil(target));
    for (const step of [10, 15, 30, 60, 120, 180, 360, 720, dayLength]) {
      if (step >= target) return step;
    }
    return Math.ceil(target / dayLength) * dayLength;
  }

  function plotScale(rows, band) {
    const limits = rows.flatMap(row => row.range || [row.lower ?? row.upper, row.upper]);
    if (band) limits.push(band.lower, band.upper);
    const min = Math.min(...limits);
    const max = Math.max(...limits);
    const step = tickStep(max - min);
    const start = Math.floor((min - step / 4) / step) * step;
    const end = Math.ceil((max + step / 4) / step) * step;
    const ticks = [];
    for (let tick = start; tick <= end; tick += step) ticks.push(tick);
    return {start, end, ticks};
  }

  function plot(rows, name, band) {
    const frame = element('div');
    frame.className = 'timing-plot';
    frame.setAttribute('role', 'region');
    frame.setAttribute('aria-label', name);
    frame.tabIndex = 0;
    const chart = element('div');
    chart.className = 'timing-plot-chart';
    frame.append(chart);

    const {start, end, ticks} = plotScale(rows, band);
    const position = value => (value - start) / (end - start) * 100 + '%';
    const axis = element('div');
    axis.className = 'timing-plot-row timing-plot-axis';
    axis.append(element('span', 'Bangladesh time'));
    const labels = element('div');
    labels.className = 'timing-plot-track';
    for (const tick of ticks) {
      const label = element('span', wallTime(tick));
      label.style.left = position(tick);
      labels.append(label);
    }
    axis.append(labels);
    chart.append(axis);

    function interval(track, className, lower, upper) {
      const mark = element('span');
      mark.className = className;
      mark.style.left = position(lower);
      mark.style.width = (upper - lower) / (end - start) * 100 + '%';
      track.append(mark);
    }

    for (const row of rows) {
      const line = element('div');
      line.className = 'timing-plot-row';
      const label = element('span', row.label);
      const track = element('div');
      track.className = 'timing-plot-track';
      // The adjacent tables provide exact timestamps and eligibility for screen readers.
      line.setAttribute('aria-hidden', 'true');
      line.title = row.description;
      if (band) interval(track, 'timing-plot-band', band.lower, band.upper);
      for (const tick of ticks) interval(track, 'timing-plot-grid', tick, tick);
      if (row.lower != null) {
        interval(track, row.eligible ? 'timing-plot-window' : 'timing-plot-window excluded', row.lower, row.upper);
      }
      if (row.point) {
        interval(track, row.eligible ? 'timing-plot-dot' : 'timing-plot-dot excluded', row.upper, row.upper);
      }
      for (const mark of row.marks || []) {
        interval(track, 'timing-plot-dot timing-mark-' + mark.type, mark.time, mark.time);
      }
      line.append(label, track);
      chart.append(line);
    }

    return frame;
  }

  function observedPlot(days, typical) {
    return plot(days.map(day => ({
      label: day.date,
      lower: day.bounded ? offset(day, day.lower) : null,
      upper: offset(day, day.upper),
      eligible: day.eligible,
      point: true,
      description: day.date + ' · ' + (day.bounded ? format(day.lower) + ' – ' : 'First seen ')
        + format(day.upper) + ' · ' + dayStatus(day)
    })), 'Daily publication window plot', typical.lower === undefined ? null : typical);
  }

  function dayStatus(day) {
    if (day.baseline) return 'Already present during setup';
    if (day.eligible) return 'Used';
    return day.bounded ? 'Poll gap too wide' : 'No prior absence';
  }

  function workbookTime(value) {
    if (!value) return '—';
    if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return format(value);
    return value.replace('T', ' ') + ' (time zone unspecified)';
  }

  function workbookMetadata(row) {
    return 'Excel created ' + workbookTime(row.excel_created_at)
      + ' · Excel modified ' + workbookTime(row.excel_modified_at);
  }

  function workbookHistory(archive, observations = []) {
    const byId = new Map((archive?.reports || []).map(row => [row.report_id, row]));
    for (const observation of observations) {
      const historical = byId.get(observation.report_id);
      byId.set(observation.report_id, {...historical, ...observation, listed_date: observation.date,
        download_failed: false});
    }
    return [...byId.values()].sort((a, b) => b.listed_date.localeCompare(a.listed_date)
      || Number(b.report_id) - Number(a.report_id));
  }

  function workbookPlotRows(reports) {
    // Compare local clock times across different listing dates. Keep the full
    // workbook timestamp and original date in the table and plot tooltip.
    const localTime = value => {
      if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return NaN;
      const parts = Object.fromEntries(dateTime.formatToParts(date).map(part => [part.type, Number(part.value)]));
      return parts.hour * 60 + parts.minute + parts.second / 60;
    };
    return reports.flatMap(row => {
      const marks = [
        {time: localTime(row.excel_created_at), type: 'created'},
        {time: localTime(row.excel_modified_at), type: 'modified'}
      ].filter(mark => Number.isFinite(mark.time));
      if (!marks.length) return [];
      return [{
        label: row.listed_date + ' · #' + row.report_id,
        description: row.listed_date + ' · Report ' + row.report_id + ' · ' + workbookMetadata(row),
        range: marks.map(mark => mark.time), marks
      }];
    });
  }

  const HISTORY_DAYS = 60;

  function archiveHistory(readings, workbook, feeds) {
    const localDate = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Dhaka'});
    const feedDates = Object.values(feeds).map(feed => {
      const received = Date.parse(feed.last_poll?.received_at);
      return Number.isFinite(received) ? localDate.format(received) : feed.last_poll?.latest_date;
    });
    const newest = [readings?.end_date, workbook?.end_date, ...feedDates]
      .filter(Boolean).sort().at(-1);
    const end = Date.parse(newest + 'T00:00:00Z');
    const dates = Number.isFinite(end)
      ? Array.from({length: HISTORY_DAYS}, (_, index) => new Date(end - index * 86_400_000).toISOString().slice(0, 10))
      : [];
    const workbooks = new Map();
    for (const report of workbookHistory(workbook, feeds.operations?.observations)) {
      if (!workbooks.has(report.listed_date)) workbooks.set(report.listed_date, []);
      workbooks.get(report.listed_date).push(report);
    }
    const bySource = {};
    for (const source of Object.keys(sources)) {
      const saved = readings?.sources?.[source];
      const slots = new Map(dates.map(date => [date, new Set(saved?.days?.[date] || [])]));
      if (source !== 'operations') {
        for (const [key, date] of Object.entries(feeds[source]?.seen || {})) {
          const slot = key.slice(11);
          if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot)) slots.get(date)?.add(slot);
        }
      }
      const unavailable = new Set(saved?.unavailable || []);
      bySource[source] = dates.map(date => ({
        date, slots: [...slots.get(date)].sort(), reports: source === 'operations' ? workbooks.get(date) || [] : [],
        unavailable: unavailable.has(date)
      }));
    }
    return bySource;
  }

  function coveragePlot(counts) {
    const frame = element('div');
    frame.className = 'timing-coverage';
    for (const [source, count] of Object.entries(counts)) {
      const line = element('label');
      const progress = element('progress');
      progress.max = HISTORY_DAYS;
      progress.value = count;
      line.append(element('span', sources[source]), progress, element('span', count + ' / ' + HISTORY_DAYS));
      frame.append(line);
    }
    return frame;
  }

  function archiveReadingPlot(rows) {
    const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const points = rows.filter(row => row.slots.length).map(row => ({
      label: row.date,
      range: row.slots.map(minutes),
      marks: row.slots.map(time => ({time: minutes(time), type: 'slot'})),
      description: row.date + ' · ' + row.slots.join(', ')
    }));
    return points.length ? plot(points, 'Archived ERP reading times') : null;
  }

  function historyDetails(row, observation) {
    if (!row.slots.length && !row.reports.length) return observation ? recordsForDay(observation) : '—';
    const details = element('details');
    details.append(element('summary', row.slots.length ? 'Reading slots' : 'Workbook metadata'));
    if (row.slots.length) details.append(element('p', row.slots.join(', ')));
    for (const report of row.reports) {
      details.append(element('p', 'Report ' + report.report_id + ' · ' + workbookMetadata(report)));
    }
    if (!observation) return details;
    const cell = element('div');
    cell.append(details, recordsForDay(observation));
    return cell;
  }

  function workbookArchive(archive, observations) {
    const section = element('section');
    section.className = 'timing-workbook-archive';
    const heading = element('h2', 'Excel creation and modification times');
    heading.tabIndex = -1;
    section.append(heading);
    const records = workbookHistory(archive, observations);
    if (!records.length) {
      section.append(element('p', 'Workbook metadata history is unavailable.'));
      return {section, heading};
    }
    if (archive) section.append(element('p', archive.reports.length + ' workbook records from the ERP archive search for '
      + archive.start_date + ' through ' + archive.end_date + '.'));
    section.append(element('p', 'These timestamps come from the Excel file. The archive supplies the listed date. '
      + '“First seen” is filled only when the collector recorded a receipt.'));
    const rows = records.map(row => [
      row.listed_date,
      row.report_id,
      workbookTime(row.excel_created_at),
      workbookTime(row.excel_modified_at),
      format(row.first_seen_at),
      row.download_failed ? 'Download failed' : row.excel_created_at || row.excel_modified_at ? 'Available' : 'Unavailable'
    ]);
    section.append(table(['Listed date', 'Report ID', 'Excel created', 'Excel modified', 'First seen', 'Metadata'],
      rows, 'Excel workbook timestamp history'));
    const plotted = workbookPlotRows(records);
    if (plotted.length) {
      section.append(element('p', 'Circles show creation and diamonds show modification. The plot compares Bangladesh clock times '
        + 'for timestamps with a known offset. The table gives the full dates and times, including older workbook creation dates.'));
      section.append(plot(plotted, 'Excel creation and modification time plot'));
    }
    return {section, heading};
  }

  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function table(headers, rows, label) {
    const wrap = element('div');
    wrap.className = 'table-wrap';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', label || (headers[0] === 'Source' ? 'Typical first appearance by source' : 'Source observation history'));
    const grid = element('table');
    const heading = grid.createTHead().insertRow();
    for (const label of headers) {
      const th = element('th', label);
      th.scope = 'col';
      heading.append(th);
    }
    const body = grid.createTBody();
    for (const values of rows) {
      const row = body.insertRow();
      for (const value of values) {
        const cell = row.insertCell();
        cell.append(value);
      }
    }
    wrap.append(grid);
    return wrap;
  }

  function recordLabel(row) {
    return row.reading_time || 'Report ' + row.report_id + ' · Operating date ' + row.operating_date;
  }

  function recordsForDay(day) {
    const details = element('details');
    const count = day.records.length;
    details.append(element('summary', count + (count === 1 ? ' record' : ' records')));
    details.addEventListener('toggle', () => {
      if (!details.open || details.childElementCount > 1) return;
      const list = element('ul');
      for (const row of day.records) {
        list.append(element('li', recordLabel(row) + ' · First seen ' + format(row.first_seen_at)
          + (row.absent_after ? ' · Absent at ' + format(row.absent_after) : '')
          + (row.report_id ? ' · ' + workbookMetadata(row) : '')));
      }
      details.append(list);
    });
    return details;
  }

  function show(panel, bundle, archive, readings) {
    const {feeds, max_window_minutes: maxWindow, min_estimate_days: minimum} = bundle;
    const daysBySource = Object.fromEntries(Object.keys(sources).map(key => [key, dailyRows(feeds[key], maxWindow)]));
    const estimates = Object.fromEntries(Object.keys(sources).map(key => [key, estimate(daysBySource[key], minimum)]));
    const history = archiveHistory(readings, archive, feeds);
    const counts = Object.fromEntries(Object.entries(history).map(([key, rows]) =>
      [key, rows.filter(row => row.slots.length || row.reports.length).length]));
    const summaries = Object.entries(sources).map(([key, label]) => {
      const value = estimates[key];
      return [
        label, value.lower === undefined ? 'Collecting observations' : wallTime(value.lower) + ' – ' + wallTime(value.upper),
        String(value.count), String(counts[key]), format(feeds[key]?.last_poll?.received_at)
      ];
    });
    const guide = element('p', 'Typical windows use the median bounds across at least ' + minimum
      + ' days with poll gaps of ' + maxWindow + ' minutes or less. All times are Bangladesh time. '
      + 'Offsets such as +1d are relative to the source date.');
    const heading = element('h2', 'Typical first appearance');
    const typical = Object.entries(sources).filter(([key]) => estimates[key].lower !== undefined)
      .map(([key, label]) => {
        const {lower, upper} = estimates[key];
        return {label, lower, upper, eligible: true, description: label + ' · ' + wallTime(lower) + ' – ' + wallTime(upper)};
      });
    const typicalPlot = typical.length ? plot(typical, 'Typical publication windows by source')
      : element('p', 'The comparison plot appears when a source has enough observations to estimate its window.');
    const summary = table(['Source', 'Estimated window', 'Days used', 'Days with source data', 'Last successful poll'], summaries);
    const historyHeading = element('h2', 'Daily observation history');
    const label = element('label', 'Source ');
    const select = element('select');
    for (const [key, title] of Object.entries(sources)) {
      const option = element('option', title);
      option.value = key;
      select.append(option);
    }
    label.append(select);
    const results = element('div');
    function renderHistory() {
      const workbook = select.value === 'operations';
      const archiveDays = history[select.value];
      const firstDate = archiveDays.at(-1)?.date;
      const days = daysBySource[select.value].filter(day => !firstDate || day.date >= firstDate);
      const note = element('p', workbook
        ? 'Source date is the ERP listing’s publication date. First seen is when BEGD downloaded a workbook that passed parsing.'
        : 'Source date and reading time come from the ERP table. First seen is when BEGD received the first newly observed reading for that date.');
      results.replaceChildren(note);
      const observed = new Map(days.map(day => [day.date, day]));
      if (archiveDays.length) {
        const evidence = workbook
          ? 'The Excel plot shows file creation and modification clock times. Full dates are in the table.'
          : 'Each dot is a dated ERP reading slot. First-seen times come from the live poll log.';
        const archivedPlot = workbook
          ? workbookPlotRows(archiveDays.flatMap(day => day.reports))
          : archiveReadingPlot(archiveDays);
        const chart = workbook
          ? (archivedPlot.length ? plot(archivedPlot, 'Archived Excel workbook clock times') : null)
          : archivedPlot;
        if (chart) results.append(element('h3', workbook ? 'Archived Excel timestamps' : 'ERP reading times'),
          element('p', evidence), chart);
      }
      if (days.length) {
        results.append(element('h3', 'Observed publication windows'),
          element('p', 'Lines span the previous absence and first receipt. Hollow dots mark days excluded from the estimate. The shaded band shows the typical window when available.'),
          observedPlot(days, estimates[select.value]));
      }
      if (!archiveDays.length) {
        results.append(element('p', 'No source data is available yet.'));
        return;
      }
      const rows = archiveDays.map(row => {
        const day = observed.get(row.date);
        const report = row.reports[0];
        const sourceData = row.slots.length
          ? row.slots[0] + ' – ' + row.slots.at(-1) + ' · ' + row.slots.length + ' slots'
          : row.unavailable ? 'Archive unavailable' : '—';
        return [
          row.date, workbook ? row.reports.map(item => '#' + item.report_id).join(', ') || '—' : sourceData,
          ...(workbook ? [workbookTime(report?.excel_created_at), workbookTime(report?.excel_modified_at)] : []),
          day?.bounded ? format(day.lower) : '—', day ? format(day.upper) : '—',
          day ? dayStatus(day) : '—', historyDetails(row, day)
        ];
      });
      const headers = [workbook ? 'Listed date' : 'Reading date', workbook ? 'ERP reports' : 'Reading range',
        ...(workbook ? ['Excel created', 'Excel modified'] : []), 'Previously absent', 'First seen', 'Estimate', 'Details'];
      const historyTable = table(headers, rows);
      historyTable.classList.add('timing-daily-table');
      results.append(historyTable);
    }
    select.addEventListener('change', renderHistory);
    renderHistory();
    const workbook = workbookArchive(archive, feeds.operations?.observations);
    const jump = element('button', 'View Excel creation and modification times');
    jump.className = 'timing-archive-link';
    jump.type = 'button';
    jump.addEventListener('click', () => workbook.heading.focus());
    const timing = [heading, guide, typicalPlot, summary, element('h2', 'Source coverage for the last 60 days'),
      coveragePlot(counts), historyHeading,
      element('p', 'The table covers 60 calendar days. Existing records at the first poll establish the baseline.'),
      label, results];
    panel.replaceChildren(...(new URLSearchParams(location.search).get('timing') === 'workbooks'
      ? [workbook.section, ...timing] : [jump, ...timing, workbook.section]));
    if (bundle.unavailable) panel.prepend(element('p', 'Publication timing history is unavailable. Try reloading the page.'));
  }

  async function mount(content) {
    if (content.querySelector('#publication-timing-panel')) return;
    const panel = element('section');
    panel.id = 'publication-timing-panel';
    panel.className = 'panel full';
    panel.append(element('p', 'Loading publication observations…'));
    content.replaceChildren(panel);
    const load = async file => {
      const response = await fetch(file, {cache: 'no-cache'});
      if (!response.ok) throw Error('History unavailable');
      return response.json();
    };
    const [polls, workbook, history] = await Promise.allSettled([
      load('publication-timing.json'), load('workbook-timestamp-history.json'), load('source-reading-history.json')
    ]);
    const bundle = polls.value?.version === 1 && polls.value.feeds ? polls.value
      : {feeds: {}, max_window_minutes: 45, min_estimate_days: 5, retention_days: 90, unavailable: true};
    const archive = Array.isArray(workbook.value?.reports) ? workbook.value : null;
    show(panel, bundle, archive, history.value?.version === 1 ? history.value : null);
  }

  if (typeof module === 'object') module.exports = {dailyRows, estimate, wallTime, plotScale, workbookTime, workbookHistory, workbookPlotRows, archiveHistory};
  else root.BEGDPublicationTiming = {mount};
})(typeof window === 'undefined' ? null : window);
