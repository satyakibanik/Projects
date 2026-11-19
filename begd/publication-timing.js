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
    const offset = (day, timestamp) => (timestamp - Date.parse(day.date + 'T00:00:00+06:00')) / minute;
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

  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function table(headers, rows) {
    const wrap = element('div');
    wrap.className = 'table-wrap';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', headers[0] === 'Source' ? 'Typical first appearance by source' : 'Source observation history');
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
          + (row.absent_after ? ' · Absent at ' + format(row.absent_after) : '')));
      }
      details.append(list);
    });
    return details;
  }

  function show(panel, bundle) {
    const {feeds, max_window_minutes: maxWindow, min_estimate_days: minimum, retention_days: retention} = bundle;
    const daysBySource = Object.fromEntries(Object.keys(sources).map(key => [key, dailyRows(feeds[key], maxWindow)]));
    const summaries = Object.entries(sources).map(([key, label]) => {
      const value = estimate(daysBySource[key], minimum);
      return [
        label, value.lower === undefined ? 'Collecting observations' : wallTime(value.lower) + ' – ' + wallTime(value.upper),
        String(value.count), format(feeds[key]?.last_poll?.received_at)
      ];
    });
    const guide = element('p', 'Typical windows use the median bounds across at least ' + minimum
      + ' days with poll gaps of ' + maxWindow + ' minutes or less. All times are Bangladesh time. '
      + 'Offsets such as +1d are relative to the source date.');
    const heading = element('h2', 'Typical first appearance');
    const summary = table(['Source', 'Estimated window', 'Days used', 'Last successful poll'], summaries);
    const history = element('h2', 'Daily observation history');
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
      const days = daysBySource[select.value];
      const note = element('p', workbook
        ? 'Source date is the ERP listing’s publication date. First seen is when BEGD downloaded a workbook that passed parsing.'
        : 'Source date and reading time come from the ERP table. First seen is when BEGD received the first newly observed reading for that date.');
      const rows = days.map(day => [
        day.date, recordLabel(day.first), day.bounded ? format(day.lower) : '—', format(day.upper),
        day.baseline ? 'Already present during setup' : day.eligible ? 'Used' : day.bounded ? 'Poll gap too wide' : 'No prior absence',
        recordsForDay(day)
      ]);
      results.replaceChildren(note, rows.length
        ? table([workbook ? 'Listed date' : 'Reading date', 'First record', 'Previously absent', 'First seen', 'Estimate', 'Details'], rows)
        : element('p', 'No new records have been observed for this source yet.'));
    }
    select.addEventListener('change', renderHistory);
    renderHistory();
    panel.replaceChildren(heading, guide, summary, history, element('p', 'History covers up to ' + retention
      + ' days. Existing records at the first poll establish the baseline.'), label, results);
  }

  async function mount(content) {
    if (content.querySelector('#publication-timing-panel')) return;
    const panel = element('section');
    panel.id = 'publication-timing-panel';
    panel.className = 'panel full';
    panel.append(element('p', 'Loading publication observations…'));
    content.replaceChildren(panel);
    try {
      const response = await fetch('publication-timing.json', {cache: 'no-cache'});
      if (!response.ok) throw Error('History unavailable');
      const bundle = await response.json();
      if (bundle.version !== 1 || !bundle.feeds) throw Error('Unsupported history');
      show(panel, bundle);
    } catch {
      panel.replaceChildren(element('p', 'Publication timing history is unavailable. Try reloading the page.'));
    }
  }

  if (typeof module === 'object') module.exports = {dailyRows, estimate, wallTime};
  else root.BEGDPublicationTiming = {mount};
})(typeof window === 'undefined' ? null : window);
