(function () {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const clock = value => {
    const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hour = Number(match[1]), minute = Number(match[2]);
    return hour < 24 && minute < 60 ? hour * 60 + minute : null;
  };
  const formatClock = minutes => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const normalise = (events = []) => events.map((event, index) => {
    const outage = clock(event.outage_time), restoration = clock(event.restoration_time);
    let start = outage, end = restoration;
    if (start != null && end != null && end < start) end += 1440;
    const sortTime = start ?? restoration ?? Infinity;
    return { ...event, index, outage, restoration, start, end, sortTime,
      duration: start != null && end != null ? end - start : null,
      unavailable: start == null && end == null };
  }).sort((a, b) => a.sortTime - b.sortTime || a.index - b.index);
  const plotLeft = 150, plotWidth = 820, plotRight = plotLeft + plotWidth;
  const xAt = minutes => plotLeft + (Math.min(1440, Math.max(0, minutes)) / 1440) * plotWidth;
  const plotTicks = (y1, y2, labelY) => [0, 4, 8, 12, 16, 20, 24].map(hour => {
    const x = xAt(hour * 60);
    return `<line class="event-time-grid" x1="${x}" x2="${x}" y1="${y1}" y2="${y2}"/><text class="event-time-label" x="${x}" y="${labelY}" text-anchor="${hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle'}">${String(hour).padStart(2, '0')}:00</text>`;
  }).join('');
  const eventLabel = event => event.unavailable ? 'Time not reported' :
    event.outage != null && event.restoration != null ? `${formatClock(event.outage)}–${formatClock(event.restoration)}` :
      event.outage != null ? `${formatClock(event.outage)} · outage` : `${formatClock(event.restoration)} · restoration`;
  const eventSummary = event => `${event.description || 'Event'} · ${eventLabel(event)}${event.duration != null ? ` · ${event.duration} min` : ''}`;

  const eventAxisY = 194;
  const eventLaneStep = 24;
  const seriesKeys = ['demand_mw', 'generation_mw'];
  const seriesName = key => key === 'demand_mw' ? 'Demand' : 'Generation';
  let currentEventsByIndex = new Map();
  let currentReadings = [];

  function eventTooltipMarkup(event, readings) {
    const description = esc(event.description || 'Event without a description');
    const pointRows = minutes => seriesKeys.map(key => {
      const value = valueAt(readings, key, minutes);
      return `<div class="event-tooltip-reading"><span>${seriesName(key)}</span><strong>${value == null ? 'Unavailable' : `${Math.round(value).toLocaleString('en-US')} MW`}</strong></div>`;
    }).join('');
    const summary = time => `<div class="event-tooltip-summary"><strong>${description}</strong><span class="event-tooltip-time">${time}</span></div>`;
    if (event.unavailable) return `${summary('No event time reported')}<p>No timeseries point can be linked without a reported time.</p>`;
    const note = '<small class="event-tooltip-note">Values between hourly readings are interpolated from P4 actuals.</small>';
    if (event.duration != null) {
      return `${summary(`Outage ${formatClock(event.outage)} · restoration ${formatClock(event.restoration)} · ${event.duration} min`)}<div class="event-tooltip-endpoint"><b>Start · ${formatClock(event.outage)}</b>${pointRows(event.outage)}</div><div class="event-tooltip-endpoint"><b>End · ${formatClock(event.restoration)}</b>${pointRows(event.end)}</div>${note}`;
    }
    const minutes = event.outage ?? event.restoration;
    const values = seriesKeys.map(key => {
      const value = valueAt(readings, key, minutes);
      return `<div class="event-tooltip-endpoint"><b>${seriesName(key)}</b><strong>${value == null ? 'Unavailable' : `${Math.round(value).toLocaleString('en-US')} MW`}</strong></div>`;
    }).join('');
    return `${summary(`${event.outage != null ? 'Outage' : 'Restoration'} · ${formatClock(minutes)}`)}${values}${note}`;
  }

  function seriesTooltipMarkup(target) {
    const time = target.dataset.seriesTime, key = target.dataset.seriesKey;
    const value = Number(target.dataset.seriesValue);
    return `<strong>${esc(time)} · Bangladesh time</strong><div class="event-tooltip-reading"><span>${seriesName(key)}</span><strong>${Number.isFinite(value) ? `${Math.round(value).toLocaleString('en-US')} MW` : 'Unavailable'}</strong></div>`;
  }

  function readingsWithTime(rows) {
    return (rows || []).map(row => ({ row, minutes: clock(row.time) }))
      .filter(point => point.minutes != null).sort((a, b) => a.minutes - b.minutes);
  }

  function valueAt(readings, key, minutes) {
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) return null;
    const exact = readings.find(point => point.minutes === minutes);
    if (exact) return Number.isFinite(exact.row[key]) ? exact.row[key] : null;
    let before = null, after = null;
    for (const point of readings) {
      if (!Number.isFinite(point.row[key])) continue;
      if (point.minutes < minutes) before = point;
      else if (point.minutes > minutes) { after = point; break; }
    }
    if (!before || !after || after.minutes - before.minutes > 180) return null;
    const fraction = (minutes - before.minutes) / (after.minutes - before.minutes);
    return before.row[key] + (after.row[key] - before.row[key]) * fraction;
  }

  function lanePositions(events) {
    const occupiedUntil = [];
    const positions = new Map();
    for (const event of events.filter(item => !item.unavailable)) {
      const start = event.start ?? event.restoration;
      const end = event.duration != null ? Math.min(1440, event.end) : start;
      let lane = 0;
      while (lane < occupiedUntil.length && start <= occupiedUntil[lane] + 18) lane++;
      occupiedUntil[lane] = end;
      positions.set(event.index, lane);
    }
    return { positions, count: occupiedUntil.length };
  }

  function segmentPath(readings, key, start, end, yAt, xFor = xAt) {
    const last = Math.min(1440, end);
    if (start > last) return '';
    const points = [];
    const firstValue = valueAt(readings, key, start);
    if (firstValue != null) points.push([xFor(start), yAt(firstValue)]);
    for (const point of readings) {
      if (point.minutes <= start || point.minutes >= last || !Number.isFinite(point.row[key])) continue;
      points.push([xFor(point.minutes), yAt(point.row[key])]);
    }
    const lastValue = valueAt(readings, key, last);
    if (lastValue != null && (last !== start || !points.length)) points.push([xFor(last), yAt(lastValue)]);
    if (points.length < 2) return '';
    return points.map(point => point.join(',')).join(' ');
  }

  function timelineMarkerMarkup(event, laneInfo) {
    if (event.unavailable) return '';
    const lane = laneInfo.positions.get(event.index) || 0;
    const y = eventAxisY + 9 + lane * eventLaneStep;
    const label = esc(eventSummary(event));
    if (event.duration != null) {
      const x1 = xAt(event.start), x2 = xAt(Math.min(1440, event.end));
      const nextDay = event.end > 1440;
      return `<g class="event-time-marker event-period-marker" data-event-index="${event.index}" tabindex="0" role="button" aria-label="${label}"><line class="event-duration-hit" x1="${x1}" x2="${Math.max(x1 + 4, x2)}" y1="${y}" y2="${y}"/><line class="event-duration" x1="${x1}" x2="${Math.max(x1 + 4, x2)}" y1="${y}" y2="${y}"/><circle class="event-outage-point" cx="${x1}" cy="${y}" r="4.5"/><circle class="event-restoration-point" cx="${x2}" cy="${y}" r="4.5"/>${nextDay ? `<path class="event-continuation" d="M${plotRight - 8} ${y - 4}l7 4-7 4"/>` : ''}</g>`;
    }
    const minutes = event.outage ?? event.restoration, x = xAt(minutes);
    const kind = event.outage != null ? 'event-outage-point' : 'event-restoration-point';
    const stem = lane ? `<line class="event-marker-stem" x1="${x}" x2="${x}" y1="${eventAxisY}" y2="${y}"/>` : '';
    return `<g class="event-time-marker event-single-marker" data-event-index="${event.index}" tabindex="0" role="button" aria-label="${label}">${stem}<circle class="${kind}" cx="${x}" cy="${y}" r="6"/><circle class="event-marker-hit" cx="${x}" cy="${y}" r="10"/></g>`;
  }

  function eventLinkMarkup(events, readings, yAt, laneInfo, showEventLanes = true, xFor = xAt) {
    return events.filter(event => !event.unavailable).map(event => {
      const start = event.start ?? event.restoration;
      const end = event.duration != null ? event.end : start;
      const lane = laneInfo.positions.get(event.index) || 0;
      const markerY = eventAxisY + 9 + lane * eventLaneStep;
      const connectorAt = minutes => seriesKeys.map(key => {
        if (!showEventLanes) return '';
        const value = valueAt(readings, key, minutes);
        return value == null ? '' : `<line class="event-time-connector ${key}" x1="${xFor(minutes)}" x2="${xFor(minutes)}" y1="${markerY}" y2="${yAt(value)}"/>`;
      }).join('');
      const connectors = event.duration != null ? connectorAt(start) + connectorAt(end) : connectorAt(start);
      const highlights = event.duration != null ? seriesKeys.map(key => {
        const points = segmentPath(readings, key, start, end, yAt, xFor);
        return points ? `<polyline class="event-series-highlight ${key}" points="${points}"/>` : '';
      }).join('') : '';
      const endpointTimes = event.duration != null ? [start, end] : [start];
      const dots = endpointTimes.flatMap(minutes => seriesKeys.map(key => {
        const value = valueAt(readings, key, minutes);
        return value == null ? '' : `<circle class="event-linked-dot ${key}" cx="${xFor(minutes)}" cy="${yAt(value)}" r="4.5"/>`;
      })).join('');
      return `<g class="event-chart-link" data-event-link="${event.index}" aria-hidden="true">${connectors}${highlights}${dots}</g>`;
    }).join('');
  }

  function demandPlot(rows, events = [], { showEventLanes = true } = {}) {
    const compact = !showEventLanes && Boolean(window.matchMedia?.('(max-width: 760px)').matches);
    const chartWidth = compact ? 640 : 1120, chartHeight = compact ? 280 : 190;
    const left = compact ? 120 : plotLeft, right = compact ? 610 : plotRight;
    const xFor = minutes => left + Math.min(1440, Math.max(0, minutes)) / 1440 * (right - left);
    const readings = (rows || []).filter(row => clock(row.time) != null);
    const values = readings.flatMap(row => [row.demand_mw, row.generation_mw]).filter(Number.isFinite);
    const low = values.length ? Math.min(...values) : 0, high = values.length ? Math.max(...values) : 1, padding = Math.max((high - low) * .12, 100);
    const min = low - padding, max = high + padding, top = compact ? 45 : 25, bottom = compact ? 225 : 142;
    const yAt = value => bottom - ((value - min) / (max - min || 1)) * (bottom - top);
    const timedReadings = readingsWithTime(rows);
    const laneInfo = showEventLanes ? lanePositions(events) : { count: 0, positions: new Map() };
    const height = showEventLanes ? 248 + laneInfo.count * eventLaneStep : 190;
    const ticks = Array.from({ length: values.length ? (compact ? 3 : 5) : 0 }, (_, index) => {
      const value = min + (max - min) * index / (compact ? 2 : 4), y = yAt(value);
      return `<line class="event-plot-grid" x1="${left}" x2="${right}" y1="${y}" y2="${y}"/><text class="event-plot-y-label" x="${left - 12}" y="${y + 3}" text-anchor="end">${Math.round(value).toLocaleString('en-US')}</text>`;
    }).join('');
    const grid = (compact ? [0, 8, 16, 24] : [0, 4, 8, 12, 16, 20, 24]).map(hour => {
      const x = xFor(hour * 60);
      return `<line class="event-time-grid" x1="${x}" x2="${x}" y1="${top}" y2="${showEventLanes ? height - 15 : chartHeight - 35}"/><text class="event-time-label" x="${x}" y="${compact ? 257 : 164}" text-anchor="${hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle'}">${String(hour).padStart(2, '0')}:00</text>`;
    }).join('');
    const line = (key, cssClass) => {
      const points = readings.filter(row => Number.isFinite(row[key])).map(row => `${xFor(clock(row.time))},${yAt(row[key])}`);
      const dots = readings.filter(row => Number.isFinite(row[key])).map(row => {
        const minute = clock(row.time), x = xFor(minute), y = yAt(row[key]);
        return `<g class="event-series-point" data-series-key="${key}" data-series-time="${esc(row.time)}" data-series-value="${row[key]}" tabindex="0" role="button" aria-label="${esc(row.time)} · ${esc(seriesName(key))}: ${Math.round(row[key]).toLocaleString('en-US')} MW"><circle class="event-series-point-hit" cx="${x}" cy="${y}" r="9"/><circle cx="${x}" cy="${y}" r="2.7" class="${cssClass}-dot"/></g>`;
      }).join('');
      return `${points.length > 1 ? `<polyline class="${cssClass}" points="${points.join(' ')}"/>` : ''}${dots}`;
    };
    const links = eventLinkMarkup(events, timedReadings, yAt, laneInfo, showEventLanes, xFor);
    const markers = showEventLanes ? events.map(event => timelineMarkerMarkup(event, laneInfo)).join('') : '';
    const unplaced = events.filter(event => event.unavailable);
    const noTimeMarkup = unplaced.length ? `<div class="event-unplaced-list" aria-label="Events without a reported time"><span>No reported time</span>${unplaced.map(event => `<button type="button" class="event-unplaced-chip" data-event-index="${event.index}" title="${esc(eventSummary(event))}" aria-label="${esc(eventSummary(event))}">${esc(event.description || 'Event without a description')}</button>`).join('')}</div>` : '';
    const eventAxis = showEventLanes ? `<line class="event-axis-line" x1="${left}" x2="${right}" y1="${eventAxisY}" y2="${eventAxisY}"/><text class="event-axis-label" x="${left - 12}" y="${eventAxisY + 3}" text-anchor="end">EVENTS</text>` : '';
    const ariaLabel = showEventLanes ? 'P4 hourly demand and generation with outage and restoration times on a shared 24-hour timeline' : 'P4 hourly demand and generation response on a 24-hour timeline';
    return `${values.length ? '' : '<p class="event-plot-empty">P4 hourly demand and generation are unavailable for this report. Reported event times remain shown below.</p>'}<div class="event-context-group${showEventLanes ? '' : ' event-context-fixed'}"><div class="event-context-wrap"><div class="event-context-canvas">${showEventLanes ? '' : fixedChartLegend()}<svg class="event-context-svg" viewBox="0 0 ${chartWidth} ${chartHeight}" role="group" aria-label="${ariaLabel}"><title>Daily demand and generation response with grid events · P4 actual · MW</title>${ticks}${grid}${line('demand_mw', 'event-demand-line')}${line('generation_mw', 'event-generation-line')}${links}${showEventLanes ? chartLegend(1120) : ''}</svg>${showEventLanes ? `<div class="event-lanes-scroll" tabindex="0" role="region" aria-label="Scrollable event timeline"><svg class="event-context-svg event-lanes-svg" viewBox="0 185 1120 ${height - 185}" role="group" aria-label="Event times and outage periods">${grid}${eventAxis}${markers}</svg></div>` : ''}</div></div><div class="event-context-tooltip" role="tooltip" aria-live="polite" hidden></div></div>${noTimeMarkup}`;
  }

  function densityBins(events) {
    const bins = Array.from({ length: 48 }, (_, index) => ({
      index, start: index * 30, end: (index + 1) * 30,
      outage: 0, restoration: 0, entries: [], overlapping: []
    }));
    const add = (event, minutes, kind) => {
      if (minutes == null || minutes >= 1440) return;
      const bin = bins[Math.floor(minutes / 30)];
      bin[kind]++;
      if (!bin.entries.includes(event)) bin.entries.push(event);
    };
    for (const event of events) {
      add(event, event.outage, 'outage');
      add(event, event.end ?? event.restoration, 'restoration');
      if (event.duration > 0) for (const bin of bins) {
        if (event.start < bin.end && Math.min(event.end, 1440) > bin.start) bin.overlapping.push(event);
      }
    }
    return bins;
  }

  function densitySelectionMarkup(bin) {
    const events = [...new Map([...bin.entries, ...bin.overlapping].map(event => [event.index, event])).values()]
      .sort((a, b) => a.sortTime - b.sortTime || a.index - b.index);
    const eventMarkup = events.map(event => {
      const outageHere = event.outage != null && event.outage >= bin.start && event.outage < bin.end;
      const restorationTime = event.end ?? event.restoration;
      const restorationHere = restorationTime != null && restorationTime >= bin.start && restorationTime < bin.end;
      const label = outageHere && restorationHere ? 'Outage and restoration in window' : outageHere ? 'Outage in window' : restorationHere ? 'Restoration in window' : 'Ongoing from earlier';
      return `<li><div class="event-density-item-head"><span>${esc(eventLabel(event))}</span><small>${label}</small></div><span class="event-category">${esc(window.BEGDOperationalEvents?.categoryLabel(event.description))}</span><strong>${esc(event.description || 'Event without a description')}</strong></li>`;
    }).join('');
    return `<div class="event-density-selection-head"><div><h3>${formatClock(bin.start)}–${formatClock(bin.end)}</h3><span>${bin.outage} outages · ${bin.restoration} restorations</span></div></div>${events.length ? `<ol class="event-density-list">${eventMarkup}</ol>` : '<p class="event-density-empty">No reported events in this window.</p>'}`;
  }

  function fixedChartLegend() {
    return '<div class="event-fixed-legend"><span class="demand-key">Demand (MW)</span><span class="generation-key">Generation (MW)</span></div>';
  }

  function centerPulseWindow() {
    const wrap = document.querySelector('[data-event-view="density"] .event-density-chart-wrap');
    const chart = wrap?.querySelector('.event-density-svg');
    const selected = chart?.querySelector('[data-density-selected-window]');
    if (!wrap || !chart || !selected || wrap.scrollWidth <= wrap.clientWidth) return;
    const scale = chart.clientWidth / Number(chart.dataset.densityWidth);
    const middle = (Number(selected.getAttribute('x')) + Number(selected.getAttribute('width')) / 2) * scale;
    wrap.scrollLeft = Math.max(0, middle - wrap.clientWidth / 2);
  }

  function chartLegend(width) {
    return `<g class="event-chart-legend" transform="translate(${width - 350} 15)" aria-label="Demand (MW), Generation (MW)"><rect x="-8" y="-13" width="326" height="24" rx="3"/><line class="demand_mw" x1="0" x2="18" y1="0" y2="0"/><text x="24" y="4">Demand (MW)</text><line class="generation_mw" x1="155" x2="173" y1="0" y2="0"/><text x="179" y="4">Generation (MW)</text></g>`;
  }

  function densityView(rows, events) {
    const readings = readingsWithTime(rows), bins = densityBins(events);
    const values = readings.flatMap(point => [point.row.demand_mw, point.row.generation_mw]).filter(Number.isFinite);
    const maxCount = Math.max(1, ...bins.map(bin => bin.outage + bin.restoration));
    const busiest = bins.reduce((best, bin) =>
      bin.outage + bin.restoration > best.outage + best.restoration ? bin : best, bins[0]);
    const mobile = Boolean(window.matchMedia?.('(max-width: 760px)').matches);
    const chartWidth = mobile ? 2256 : 1000;
    const x0 = mobile ? 72 : 62, x1 = mobile ? 2184 : 982, width = x1 - x0, slot = width / 48;
    const top = 27, curveBottom = 170, barsTop = 226, barsBottom = 320, activeY = 333;
    const range = values.length ? Math.max(...values) - Math.min(...values) : 1;
    const min = values.length ? Math.min(...values) - Math.max(80, range * .1) : 0;
    const max = values.length ? Math.max(...values) + Math.max(80, range * .1) : 1;
    const yAt = value => curveBottom - (value - min) / (max - min || 1) * (curveBottom - top);
    const xAt = minutes => x0 + minutes / 1440 * width;
    const mid = (busiest.start + busiest.end) / 2;
    const selectedX = xAt(busiest.start), selectedWidth = xAt(busiest.end) - selectedX;
    const curveGrid = [0, 1, 2].map(index => {
      const y = top + (curveBottom - top) * index / 2;
      const value = max - (max - min) * index / 2;
      return `<line class="event-density-grid" x1="${x0}" x2="${x1}" y1="${y}" y2="${y}"/><text class="event-density-y-label" x="52" y="${y + 3}" text-anchor="end">${Math.round(value).toLocaleString('en-US')}</text>`;
    }).join('');
    const timeTicks = (mobile ? Array.from({ length: 25 }, (_, hour) => hour) : [0, 4, 8, 12, 16, 20, 24]).map(hour => {
      const x = xAt(hour * 60);
      return `<line class="event-density-time-grid" x1="${x}" x2="${x}" y1="${top}" y2="${activeY + 12}"/><text class="event-density-time-label" x="${x}" y="${activeY + 29}" text-anchor="${hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle'}">${String(hour).padStart(2, '0')}:00</text>`;
    }).join('');
    const curve = key => {
      const points = readings.filter(point => Number.isFinite(point.row[key]));
      const polyline = points.map(point => `${xAt(point.minutes)},${yAt(point.row[key])}`).join(' ');
      const circles = points.map(point => `<circle class="event-density-point ${key}" cx="${xAt(point.minutes)}" cy="${yAt(point.row[key])}" r="2.5"/>`).join('');
      return `${points.length > 1 ? `<polyline class="event-density-line ${key}" points="${polyline}"/>` : ''}${circles}`;
    };
    const maxBarHeight = barsBottom - barsTop;
    const bars = bins.map(bin => {
      const total = bin.outage + bin.restoration;
      const barHeight = total / maxCount * maxBarHeight;
      const barX = xAt(bin.start) + 1.2, barWidth = Math.max(2, slot - 2.4), base = barsBottom;
      let y = base;
      const stack = [['outage', bin.outage], ['restoration', bin.restoration]].map(([kind, count]) => {
        if (!count) return '';
        const segmentHeight = count / maxCount * maxBarHeight;
        y -= segmentHeight;
        return `<rect class="event-density-bar ${kind}" x="${barX}" y="${y}" width="${barWidth}" height="${segmentHeight}"/>`;
      }).join('');
      const aria = `${formatClock(bin.start)} to ${formatClock(bin.end)}: ${bin.outage} outages, ${bin.restoration} restorations`;
      return `<g class="event-density-bin${bin === busiest ? ' is-selected' : ''}" data-density-index="${bin.index}" data-density-start="${bin.start}" tabindex="0" role="button" aria-pressed="${bin === busiest}" aria-label="${esc(aria)}"><rect class="event-density-hit" x="${xAt(bin.start)}" y="${barsTop - 5}" width="${slot}" height="${activeY + 15 - (barsTop - 5)}"/>${stack}</g>`;
    }).join('');
    return `<div class="event-density-chart-wrap" tabindex="0" role="region" aria-label="Scrollable event pulse chart">${mobile ? fixedChartLegend() : ''}<svg class="event-density-svg" viewBox="0 0 ${chartWidth} 390" data-density-width="${chartWidth}" data-density-left="${x0}" data-density-slot="${slot}" role="group" aria-label="Demand and generation curves with a 30-minute event activity histogram"><title>Demand and generation with 30-minute outage activity · P4 actual · MW</title><rect class="event-density-selected-window" data-density-selected-window="" x="${selectedX}" y="${top - 6}" width="${selectedWidth}" height="${activeY + 19 - (top - 6)}"/>${curveGrid}${timeTicks}<line class="event-density-separator" x1="${x0}" x2="${x1}" y1="${barsTop - 9}" y2="${barsTop - 9}"/><text class="event-density-section-label" x="${x0}" y="${barsTop - 15}">EVENT COUNTS · 30 MIN</text><line class="event-density-baseline" x1="${x0}" x2="${x1}" y1="${barsBottom}" y2="${barsBottom}"/>${curve('demand_mw')}${curve('generation_mw')}${bars}${mobile ? '' : chartLegend(1000)}</svg></div><div class="event-density-legend"><span class="outage-key">Outage</span><span class="restoration-key">Restoration</span></div><section class="event-density-selection" aria-live="polite" aria-label="Events and actual values for selected time window">${densitySelectionMarkup(busiest, readings)}</section>`;
  }

  function selectDensityBin(target, pin = false) {
    const panel = target.closest('.event-chronograph-panel');
    const index = Number(target.dataset.densityIndex);
    const bin = densityBins([...currentEventsByIndex.values()])[index];
    if (!panel || !bin) return;
    if (!pin && panel.dataset.densityPinned != null) return;
    if (pin) panel.dataset.densityPinned = String(index);
    panel.querySelectorAll('[data-density-index]').forEach(node => {
      const selected = Number(node.dataset.densityIndex) === index;
      node.classList.toggle('is-selected', selected);
      node.setAttribute('aria-pressed', String(selected));
    });
    const windowRect = panel.querySelector('[data-density-selected-window]');
    if (windowRect) {
      const chart = panel.querySelector('.event-density-svg');
      const width = Number(chart?.dataset.densitySlot) || 920 / 48;
      const left = Number(chart?.dataset.densityLeft) || 62;
      windowRect.setAttribute('x', left + index * width);
      windowRect.setAttribute('width', width);
    }
    const selection = panel.querySelector('.event-density-selection');
    if (selection) selection.innerHTML = densitySelectionMarkup(bin, currentReadings);
  }

  function polar(cx, cy, radius, minutes) {
    const angle = (minutes / 1440) * Math.PI * 2;
    return { x: cx + Math.sin(angle) * radius, y: cy - Math.cos(angle) * radius };
  }
  function dialView(events) {
    const cx = 220, cy = 220, face = 178;
    const ticks = Array.from({ length: 24 }, (_, hour) => {
      const p1 = polar(cx, cy, hour % 2 === 0 ? 158 : 164, hour * 60), p2 = polar(cx, cy, face - 1, hour * 60);
      const label = hour % 2 === 0 ? polar(cx, cy, 194, hour * 60) : null;
      return `<line class="event-dial-tick${hour % 2 === 0 ? ' major' : ''}" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}"/>${label ? `<text class="event-dial-label" x="${label.x}" y="${label.y + 3}" text-anchor="middle">${String(hour).padStart(2, '0')}</text>` : ''}`;
    }).join('');
    const marks = events.filter(event => !event.unavailable).map(event => {
      const key = Math.floor((event.start ?? event.restoration) / 10), lane = key % 6, radius = 100 + lane * 14;
      if (event.start != null && event.restoration != null) {
        const start = event.start, end = event.end, a = polar(cx, cy, radius, start), b = polar(cx, cy, radius, end);
        const sweepMinutes = Math.min(1440, end - start), large = sweepMinutes > 720 ? 1 : 0;
        const visibleEnd = Math.min(end, start + 1439.9);
        const endPoint = polar(cx, cy, radius, visibleEnd);
        const nextDay = end > 1440;
        const midnight = polar(cx, cy, radius, 1440), nextDayArc = nextDay ? `<path class="event-dial-span" d="M${midnight.x} ${midnight.y} A${radius} ${radius} 0 0 1 ${b.x} ${b.y}"/>` : '';
        return `<g class="event-dial-event" data-event-index="${event.index}" tabindex="0" role="button" aria-label="${esc(eventSummary(event))}"><path class="event-dial-hit" d="M${a.x} ${a.y} A${radius} ${radius} 0 ${large} 1 ${endPoint.x} ${endPoint.y}"/><path class="event-dial-span" d="M${a.x} ${a.y} A${radius} ${radius} 0 ${large} 1 ${endPoint.x} ${endPoint.y}"><title>${esc(eventSummary(event))}${nextDay ? ' · restoration after midnight' : ''}</title></path>${nextDayArc}<circle class="event-dial-endpoint event-outage-point" cx="${a.x}" cy="${a.y}" r="5"/><circle class="event-dial-endpoint event-restoration-point" cx="${b.x}" cy="${b.y}" r="5"/></g>`;
      }
      const time = event.outage ?? event.restoration, point = polar(cx, cy, radius, time);
      return `<g class="event-dial-event" data-event-index="${event.index}" tabindex="0" role="button" aria-label="${esc(eventSummary(event))}"><circle class="event-dial-point-hit" cx="${point.x}" cy="${point.y}" r="16"/><path class="event-dial-point ${event.outage != null ? 'event-outage-point' : 'event-restoration-point'}" d="M${point.x} ${point.y - 7}l7 7-7 7-7-7z"><title>${esc(eventSummary(event))}</title></path></g>`;
    }).join('');
    const list = events.map(event => `<li><button type="button" class="event-chronograph-list-item" data-event-index="${event.index}" aria-label="${esc(eventSummary(event))}"><span class="event-list-time">${esc(eventLabel(event))}</span><span>${esc(event.description || 'Event without a description')}</span></button></li>`).join('');
    return `<div class="event-dial-layout"><svg class="event-dial-svg" viewBox="0 0 440 440" role="group" aria-label="24-hour clock dial with outage spans and event markers"><title>24-hour event dial · each marked hour is Bangladesh time</title><circle class="event-dial-face" cx="${cx}" cy="${cy}" r="${face}"/><circle class="event-dial-ring" cx="${cx}" cy="${cy}" r="126"/><circle class="event-dial-ring" cx="${cx}" cy="${cy}" r="150"/>${ticks}${marks}<text class="event-dial-center" x="${cx}" y="${cy - 5}" text-anchor="middle">24 HOUR</text><text class="event-dial-center-note" x="${cx}" y="${cy + 14}" text-anchor="middle">BST</text></svg><div class="event-dial-list-wrap"><h3>Chronological event list</h3><ol class="event-dial-list">${list}</ol></div></div>`;
  }

  let selectedView = 'table';

  function render(rawEvents = [], hourly = [], tableMarkup = '') {
    window.requestAnimationFrame?.(() => { if (selectedView === 'density') centerPulseWindow(); });
    const events = normalise(rawEvents);
    currentEventsByIndex = new Map(events.map(event => [event.index, event]));
    currentReadings = readingsWithTime(hourly);
    const controls = [['table', 'Table'], ['lanes', 'Timeline'], ['density', 'Event pulse'], ['dial', '24-hour dial']]
      .map(([key, label]) => `<button type="button" data-event-view-select="${key}" aria-pressed="${key === selectedView}">${label}</button>`).join('');
    const view = (key, markup) => `<div class="event-view" data-event-view="${key}"${key === selectedView ? '' : ' hidden'}>${markup}</div>`;
    // Keep the deployed table, including source notes and workbook ordering, inside the first view.
    const table = tableMarkup.replace(/^<section class="panel full">/, '<div>').replace(/<div class="panel-head">.*?<\/div><span class="tag">.*?<\/span><\/div>/s, '').replace(/<\/section>$/, '</div>');
    const legend = `<div class="event-mark-legend"><span><i class="event-mark-outage"></i>Outage/event time</span><span><i class="event-mark-period"></i>Outage–restoration period</span><span><i class="event-mark-restoration"></i>Restoration-only time</span><span><i class="event-mark-unplaced"></i>No reported time</span></div>`;
    return `<section class="panel full event-chronograph-panel"><div class="panel-head"><div><h2>Daily event log</h2><p>Outage, restoration, and operating notes from the report</p></div><span class="tag">${events.length} EVENTS · BST</span></div><div class="event-view-controls" role="group" aria-label="Choose an event log view">${controls}</div>${view('table', table)}${view('lanes', legend + demandPlot(hourly, events))}${view('density', densityView(hourly, events))}${view('dial', legend + demandPlot(hourly, events, { showEventLanes: false }) + dialView(events))}<p class="event-view-note"${selectedView === 'table' ? ' hidden' : ''}>Bangladesh time · P1 events and P4 actuals. Values between hourly readings are interpolated; restoration values beyond this day’s profile are unavailable.</p></section>`;
  }

  function showTooltipFor(target, pin = false) {
    const wrapper = target.closest?.('.event-context-group');
    const panel = target.closest?.('.event-chronograph-panel');
    const tooltip = wrapper?.querySelector('.event-context-tooltip');
    if (!wrapper || !panel || !tooltip) return;
    if (!pin && wrapper.dataset.pinnedEvent) return;
    if (pin) wrapper.dataset.pinnedEvent = target.dataset.eventIndex ?? 'series';
    let content = '';
    if (target.matches('.event-series-point')) content = seriesTooltipMarkup(target);
    else {
      const item = currentEventsByIndex.get(Number(target.dataset.eventIndex));
      if (!item) return;
      content = eventTooltipMarkup(item, currentReadings);
    }
    tooltip.innerHTML = content;
    tooltip.hidden = false;
    const index = target.dataset.eventIndex;
    panel.querySelectorAll('.event-time-marker').forEach(node => node.classList.toggle('is-active', node.dataset.eventIndex === index));
    panel.querySelectorAll('.event-chart-link').forEach(node => node.classList.toggle('is-active', node.dataset.eventLink === index));
  }

  function hideTooltip(wrapper) {
    if (wrapper?.dataset.pinnedEvent) return;
    const tooltip = wrapper?.querySelector('.event-context-tooltip');
    if (tooltip) tooltip.hidden = true;
    const panel = wrapper?.closest('.event-chronograph-panel');
    panel?.querySelectorAll('.event-time-marker.is-active,.event-chart-link.is-active').forEach(node => node.classList.remove('is-active'));
  }

  function selectEvent(panel, item) {
    const index = item.dataset.eventIndex;
    panel.querySelectorAll('[data-event-index]').forEach(node => node.classList.toggle('is-selected', node.dataset.eventIndex === index));
    panel.querySelectorAll('.event-time-marker,.event-chart-link').forEach(node => {
      const linkedIndex = node.dataset.eventIndex ?? node.dataset.eventLink;
      node.classList.toggle('is-active', linkedIndex === index);
    });
    if (item.matches('.event-dial-event')) {
      const list = panel.querySelector('.event-dial-list');
      const row = list && [...list.querySelectorAll('.event-chronograph-list-item')].find(node => node.dataset.eventIndex === index);
      if (list && row) {
        const listRect = list.getBoundingClientRect(), rowRect = row.getBoundingClientRect();
        const rowTop = list.scrollTop + rowRect.top - listRect.top;
        const rowBottom = rowTop + rowRect.height;
        if (rowTop < list.scrollTop || rowBottom > list.scrollTop + list.clientHeight) {
          list.scrollTo({ top: Math.max(0, rowTop - (list.clientHeight - rowRect.height) / 2), behavior: 'smooth' });
        }
      }
    }
  }

  document.addEventListener('pointerover', event => {
    const bin = event.target.closest?.('[data-density-index]');
    if (!bin || event.relatedTarget?.closest?.('[data-density-index]') === bin) return;
    selectDensityBin(bin);
  });

  const linkedTargets = '.event-time-marker,.event-unplaced-chip,.event-series-point';
  document.addEventListener('pointerover', event => {
    const target = event.target.closest?.(linkedTargets);
    if (!target || event.relatedTarget?.closest?.(linkedTargets) === target) return;
    showTooltipFor(target);
  });
  document.addEventListener('pointerout', event => {
    const target = event.target.closest?.(linkedTargets);
    if (!target || event.relatedTarget?.closest?.(linkedTargets) === target) return;
    if (document.activeElement === target) return;
    hideTooltip(target.closest('.event-context-group'));
  });
  document.addEventListener('focusin', event => {
    const target = event.target.closest?.(linkedTargets);
    if (target) showTooltipFor(target);
  });
  document.addEventListener('focusout', event => {
    const target = event.target.closest?.(linkedTargets);
    if (!target || event.relatedTarget?.closest?.(linkedTargets)) return;
    hideTooltip(target.closest('.event-context-group'));
  });

  document.addEventListener('click', event => {
    const densityBin = event.target.closest?.('[data-density-index]');
    if (densityBin) {
      selectDensityBin(densityBin, true);
      return;
    }
    document.querySelectorAll('[data-density-pinned]').forEach(panel => { delete panel.dataset.densityPinned; });
    const view = event.target.closest?.('[data-event-view-select]');
    if (view) {
      const panel = view.closest('.event-chronograph-panel');
      if (!panel) return;
      const selected = view.dataset.eventViewSelect;
      selectedView = selected;
      panel.querySelectorAll('[data-event-view-select]').forEach(button => button.setAttribute('aria-pressed', String(button === view)));
      panel.querySelectorAll('[data-event-view]').forEach(section => { section.hidden = section.dataset.eventView !== selected; });
      if (selected === 'density') centerPulseWindow();
      document.dispatchEvent?.(new Event('begd:event-view-change'));
      const note = panel.querySelector('.event-view-note');
      if (note) note.hidden = selected === 'table';
      return;
    }
    const item = event.target.closest?.('[data-event-index]');
    const panel = item?.closest('.event-chronograph-panel');
    if (!panel) return;
    if (item.matches('.event-time-marker,.event-unplaced-chip')) showTooltipFor(item, true);
    selectEvent(panel, item);
  });
  document.addEventListener('focusin', event => {
    const densityBin = event.target.closest?.('[data-density-index]');
    if (densityBin) selectDensityBin(densityBin);
  });
  document.addEventListener('focusin', event => {
    const item = event.target.closest?.('[data-event-index]'), panel = item?.closest('.event-chronograph-panel');
    if (!panel) return;
    selectEvent(panel, item);
  });
  document.addEventListener('keydown', event => {
    const densityBin = event.target.closest?.('.event-density-bin');
    if (densityBin && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      selectDensityBin(densityBin, true);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('[data-event-index][role=button]')) {
      event.preventDefault();
      event.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return;
    }
    if (event.key !== 'Escape') return;
    const pinned = event.target.closest?.('.event-chronograph-panel');
    if (pinned) delete pinned.dataset.densityPinned;
    pinned?.querySelectorAll('.event-context-group').forEach(node => { delete node.dataset.pinnedEvent; });
    event.target.closest?.('.event-chronograph-panel')?.querySelectorAll('[data-event-index].is-selected').forEach(node => node.classList.remove('is-selected'));
    event.target.closest?.('.event-context-group')?.querySelectorAll('.event-context-tooltip').forEach(node => { node.hidden = true; });
    event.target.closest?.('.event-chronograph-panel')?.querySelectorAll('.event-time-marker.is-active,.event-chart-link.is-active').forEach(node => node.classList.remove('is-active'));
  });

  window.matchMedia?.('(max-width: 760px)').addEventListener?.('change', () => {
    const panel = document.querySelector('.event-chronograph-panel');
    if (!panel) return;
    const events = [...currentEventsByIndex.values()], rows = currentReadings.map(point => point.row);
    const selected = panel.querySelector('.event-density-bin.is-selected')?.dataset.densityIndex;
    const wasPinned = panel.dataset.densityPinned != null;
    delete panel.dataset.densityPinned;
    const pulse = panel.querySelector('[data-event-view="density"]');
    if (pulse) pulse.innerHTML = densityView(rows, events);
    const target = pulse?.querySelector(`[data-density-index="${selected}"]`);
    if (target) selectDensityBin(target, wasPinned);
    const fitted = panel.querySelector('.event-context-fixed');
    if (fitted) fitted.outerHTML = demandPlot(rows, events, { showEventLanes: false });
    centerPulseWindow();
  });

  window.BEGDEventChronograph = { render, normalise };
})();
