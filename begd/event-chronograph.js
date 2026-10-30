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
    if (event.unavailable) return `<strong>${description}</strong><span class="event-tooltip-time">No event time reported</span><p>No timeseries point can be linked without a reported time.</p>`;
    if (event.duration != null) {
      return `<strong>${description}</strong><span class="event-tooltip-time">Outage ${formatClock(event.outage)} · restoration ${formatClock(event.restoration)} · ${event.duration} min</span><div class="event-tooltip-endpoint"><b>Start · ${formatClock(event.outage)}</b>${pointRows(event.outage)}</div><div class="event-tooltip-endpoint"><b>End · ${formatClock(event.restoration)}</b>${pointRows(event.end)}</div><small>Values between hourly readings are interpolated from P4 actuals.</small>`;
    }
    const minutes = event.outage ?? event.restoration;
    return `<strong>${description}</strong><span class="event-tooltip-time">${event.outage != null ? 'Outage' : 'Restoration'} · ${formatClock(minutes)}</span>${pointRows(minutes)}<small>Values between hourly readings are interpolated from P4 actuals.</small>`;
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

  function segmentPath(readings, key, start, end, yAt) {
    const last = Math.min(1440, end);
    if (start > last) return '';
    const points = [];
    const firstValue = valueAt(readings, key, start);
    if (firstValue != null) points.push([xAt(start), yAt(firstValue)]);
    for (const point of readings) {
      if (point.minutes <= start || point.minutes >= last || !Number.isFinite(point.row[key])) continue;
      points.push([xAt(point.minutes), yAt(point.row[key])]);
    }
    const lastValue = valueAt(readings, key, last);
    if (lastValue != null && (last !== start || !points.length)) points.push([xAt(last), yAt(lastValue)]);
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

  function eventLinkMarkup(events, readings, yAt, laneInfo, showEventLanes = true) {
    return events.filter(event => !event.unavailable).map(event => {
      const start = event.start ?? event.restoration;
      const end = event.duration != null ? event.end : start;
      const lane = laneInfo.positions.get(event.index) || 0;
      const markerY = eventAxisY + 9 + lane * eventLaneStep;
      const connectorAt = minutes => seriesKeys.map(key => {
        if (!showEventLanes) return '';
        const value = valueAt(readings, key, minutes);
        return value == null ? '' : `<line class="event-time-connector ${key}" x1="${xAt(minutes)}" x2="${xAt(minutes)}" y1="${markerY}" y2="${yAt(value)}"/>`;
      }).join('');
      const connectors = event.duration != null ? connectorAt(start) + connectorAt(end) : connectorAt(start);
      const highlights = event.duration != null ? seriesKeys.map(key => {
        const points = segmentPath(readings, key, start, end, yAt);
        return points ? `<polyline class="event-series-highlight ${key}" points="${points}"/>` : '';
      }).join('') : '';
      const endpointTimes = event.duration != null ? [start, end] : [start];
      const dots = endpointTimes.flatMap(minutes => seriesKeys.map(key => {
        const value = valueAt(readings, key, minutes);
        return value == null ? '' : `<circle class="event-linked-dot ${key}" cx="${xAt(minutes)}" cy="${yAt(value)}" r="4.5"/>`;
      })).join('');
      return `<g class="event-chart-link" data-event-link="${event.index}" aria-hidden="true">${connectors}${highlights}${dots}</g>`;
    }).join('');
  }

  function demandPlot(rows, events = [], { showEventLanes = true } = {}) {
    const readings = (rows || []).filter(row => clock(row.time) != null);
    const values = readings.flatMap(row => [row.demand_mw, row.generation_mw]).filter(Number.isFinite);
    const low = values.length ? Math.min(...values) : 0, high = values.length ? Math.max(...values) : 1, padding = Math.max((high - low) * .12, 100);
    const min = low - padding, max = high + padding, top = 25, bottom = 142;
    const yAt = value => bottom - ((value - min) / (max - min || 1)) * (bottom - top);
    const timedReadings = readingsWithTime(rows);
    const laneInfo = showEventLanes ? lanePositions(events) : { count: 0, positions: new Map() };
    const height = showEventLanes ? 248 + laneInfo.count * eventLaneStep : 190;
    const ticks = Array.from({ length: values.length ? 5 : 0 }, (_, index) => {
      const value = min + (max - min) * index / 4, y = yAt(value);
      return `<line class="event-plot-grid" x1="${plotLeft}" x2="${plotRight}" y1="${y}" y2="${y}"/><text class="event-plot-y-label" x="${plotLeft - 12}" y="${y + 3}" text-anchor="end">${Math.round(value).toLocaleString('en-US')}</text>`;
    }).join('');
    const grid = [0, 4, 8, 12, 16, 20, 24].map(hour => {
      const x = xAt(hour * 60);
      return `<line class="event-time-grid" x1="${x}" x2="${x}" y1="${top}" y2="${height - 15}"/><text class="event-time-label" x="${x}" y="164" text-anchor="${hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle'}">${String(hour).padStart(2, '0')}:00</text>`;
    }).join('');
    const line = (key, cssClass) => {
      const points = readings.filter(row => Number.isFinite(row[key])).map(row => `${xAt(clock(row.time))},${yAt(row[key])}`);
      const dots = readings.filter(row => Number.isFinite(row[key])).map(row => {
        const minute = clock(row.time), x = xAt(minute), y = yAt(row[key]);
        return `<g class="event-series-point" data-series-key="${key}" data-series-time="${esc(row.time)}" data-series-value="${row[key]}" tabindex="0" role="button" aria-label="${esc(row.time)} · ${esc(seriesName(key))}: ${Math.round(row[key]).toLocaleString('en-US')} MW"><circle class="event-series-point-hit" cx="${x}" cy="${y}" r="9"/><circle cx="${x}" cy="${y}" r="2.7" class="${cssClass}-dot"/></g>`;
      }).join('');
      return `${points.length > 1 ? `<polyline class="${cssClass}" points="${points.join(' ')}"/>` : ''}${dots}`;
    };
    const links = eventLinkMarkup(events, timedReadings, yAt, laneInfo, showEventLanes);
    const markers = showEventLanes ? events.map(event => timelineMarkerMarkup(event, laneInfo)).join('') : '';
    const unplaced = events.filter(event => event.unavailable);
    const noTimeMarkup = unplaced.length ? `<div class="event-unplaced-list" aria-label="Events without a reported time"><span>No reported time</span>${unplaced.map(event => `<button type="button" class="event-unplaced-chip" data-event-index="${event.index}" title="${esc(eventSummary(event))}" aria-label="${esc(eventSummary(event))}">${esc(event.description || 'Event without a description')}</button>`).join('')}</div>` : '';
    const eventAxis = showEventLanes ? `<line class="event-axis-line" x1="${plotLeft}" x2="${plotRight}" y1="${eventAxisY}" y2="${eventAxisY}"/><text class="event-axis-label" x="${plotLeft - 12}" y="${eventAxisY + 3}" text-anchor="end">EVENTS</text>` : '';
    const ariaLabel = showEventLanes ? 'P4 hourly demand and generation with outage and restoration times on a shared 24-hour timeline' : 'P4 hourly demand and generation response on a 24-hour timeline';
    return `${values.length ? '' : '<p class="event-plot-empty">P4 hourly demand and generation are unavailable for this report. Reported event times remain shown below.</p>'}<div class="event-context-group"><div class="event-context-wrap"><svg class="event-context-svg" viewBox="0 0 1120 ${height}" role="group" aria-label="${ariaLabel}"><title>Daily demand and generation response with grid events · P4 actual · MW</title>${ticks}${grid}${eventAxis}${line('demand_mw', 'event-demand-line')}${line('generation_mw', 'event-generation-line')}${links}${markers}</svg></div><div class="event-context-tooltip" role="tooltip" aria-live="polite" hidden></div></div>${noTimeMarkup}`;
  }

  function densityBins(events) {
    const bins = Array.from({ length: 48 }, (_, index) => ({
      index, start: index * 30, end: (index + 1) * 30,
      outage: 0, restoration: 0, period: 0, active: 0, starts: [], overlapping: []
    }));
    const overlaps = (event, bin) => {
      if (event.duration == null || event.duration <= 0) return false;
      const end = Math.min(event.end, 1440);
      return event.start < bin.end && end > bin.start;
    };
    for (const event of events) {
      if (event.unavailable) continue;
      const start = event.outage ?? event.restoration;
      const bin = bins[Math.min(47, Math.floor(start / 30))];
      if (event.duration != null) bin.period++;
      else if (event.outage != null) bin.outage++;
      else bin.restoration++;
      bin.starts.push(event);
      for (const target of bins) {
        if (overlaps(event, target)) {
          target.active++;
          target.overlapping.push(event);
        }
      }
    }
    return bins;
  }

  function densitySelectionMarkup(bin, readings) {
    const mid = (bin.start + bin.end) / 2;
    const related = new Map();
    for (const event of bin.starts) related.set(event.index, { event, started: true });
    for (const event of bin.overlapping) {
      if (!related.has(event.index)) related.set(event.index, { event, started: false });
    }
    const events = [...related.values()].sort((a, b) => a.event.sortTime - b.event.sortTime || a.event.index - b.event.index);
    const reading = minutes => seriesKeys.map(key => {
      const value = valueAt(readings, key, minutes);
      return `<span><i class="${key}">${key === 'demand_mw' ? 'D' : 'G'}</i> ${value == null ? '—' : Math.round(value).toLocaleString('en-US')}</span>`;
    }).join('');
    const eventMarkup = events.map(({ event, started }) => {
      const start = event.start ?? event.restoration;
      const endpoints = event.duration != null
        ? `<div class="event-density-endpoints"><span>Start ${formatClock(event.start)} ${reading(event.start)}</span><span>End ${formatClock(event.end)} ${reading(event.end)}</span></div>`
        : `<div class="event-density-endpoints"><span>${event.outage != null ? 'Outage' : 'Restoration'} ${formatClock(start)} ${reading(start)}</span></div>`;
      return `<li><div class="event-density-item-head"><span>${esc(eventLabel(event))}</span><small>${started ? 'Starts in window' : 'Active in window'}</small></div><strong>${esc(event.description || 'Event without a description')}</strong>${endpoints}</li>`;
    }).join('');
    return `<div class="event-density-selection-head"><div><h3>${formatClock(bin.start)}–${formatClock(bin.end)}</h3><span>${bin.starts.length} event starts · ${bin.active} outage periods active</span></div><div class="event-density-midpoint"><small>At ${formatClock(mid)} · P4 actual</small>${reading(mid)}<small>MW · interpolated where needed</small></div></div>${events.length ? `<ol class="event-density-list">${eventMarkup}</ol>` : '<p class="event-density-empty">No event starts or active outage periods in this window.</p>'}`;
  }

  function densityView(rows, events) {
    const readings = readingsWithTime(rows), bins = densityBins(events);
    const values = readings.flatMap(point => [point.row.demand_mw, point.row.generation_mw]).filter(Number.isFinite);
    const maxCount = Math.max(1, ...bins.map(bin => bin.outage + bin.restoration + bin.period));
    const maxActive = Math.max(1, ...bins.map(bin => bin.active));
    const busiest = bins.reduce((best, bin) =>
      bin.outage + bin.restoration + bin.period > best.outage + best.restoration + best.period ? bin : best, bins[0]);
    const x0 = 62, x1 = 982, width = x1 - x0, slot = width / 48;
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
    const timeTicks = [0, 4, 8, 12, 16, 20, 24].map(hour => {
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
      const total = bin.outage + bin.restoration + bin.period;
      const barHeight = total / maxCount * maxBarHeight;
      const barX = xAt(bin.start) + 1.2, barWidth = Math.max(2, slot - 2.4), base = barsBottom;
      let y = base;
      const stack = [['outage', bin.outage], ['restoration', bin.restoration], ['period', bin.period]].map(([kind, count]) => {
        if (!count) return '';
        const segmentHeight = count / maxCount * maxBarHeight;
        y -= segmentHeight;
        return `<rect class="event-density-bar ${kind}" x="${barX}" y="${y}" width="${barWidth}" height="${segmentHeight}"/>`;
      }).join('');
      const activeOpacity = bin.active ? (.18 + .68 * bin.active / maxActive).toFixed(2) : '.04';
      const aria = `${formatClock(bin.start)} to ${formatClock(bin.end)}: ${total} event starts, ${bin.active} active outage periods`;
      return `<g class="event-density-bin${bin === busiest ? ' is-selected' : ''}" data-density-index="${bin.index}" data-density-start="${bin.start}" tabindex="0" role="button" aria-pressed="${bin === busiest}" aria-label="${esc(aria)}"><rect class="event-density-hit" x="${xAt(bin.start)}" y="${barsTop - 5}" width="${slot}" height="${activeY + 15 - (barsTop - 5)}"/><rect class="event-density-active" x="${xAt(bin.start) + 1}" y="${activeY}" width="${Math.max(1, slot - 2)}" height="9" style="opacity:${activeOpacity}"/>${stack}</g>`;
    }).join('');
    const picker = bins.map(bin => {
      const count = bin.outage + bin.restoration + bin.period;
      return `<button type="button" class="event-density-bin-button${bin === busiest ? ' is-selected' : ''}" data-density-index="${bin.index}" aria-pressed="${bin === busiest}" aria-label="Select ${formatClock(bin.start)} to ${formatClock(bin.end)}: ${count} event starts, ${bin.active} active periods"><span>${formatClock(bin.start)}</span><strong>${count}</strong></button>`;
    }).join('');
    return `<div class="event-density-chart-wrap"><svg class="event-density-svg" viewBox="0 0 1000 390" role="group" aria-label="Demand and generation curves with a 30-minute event activity histogram"><title>Demand and generation with 30-minute outage activity · P4 actual · MW</title><rect class="event-density-selected-window" data-density-selected-window="" x="${selectedX}" y="${top - 6}" width="${selectedWidth}" height="${activeY + 19 - (top - 6)}"/>${curveGrid}${timeTicks}<line class="event-density-separator" x1="${x0}" x2="${x1}" y1="${barsTop - 9}" y2="${barsTop - 9}"/><text class="event-density-section-label" x="${x0}" y="${barsTop - 15}">EVENT STARTS · 30 MIN</text><text class="event-density-section-label" x="${x0}" y="${activeY + 8}">ACTIVE PERIODS</text><line class="event-density-baseline" x1="${x0}" x2="${x1}" y1="${barsBottom}" y2="${barsBottom}"/>${curve('demand_mw')}${curve('generation_mw')}${bars}</svg></div><div class="event-density-legend"><span class="demand-key">Demand</span><span class="generation-key">Generation</span><span class="outage-key">Outage starts</span><span class="restoration-key">Restoration starts</span><span class="period-key">Period starts</span><span class="active-key">Active periods</span></div><div class="event-density-mobile-picker" role="group" aria-label="Choose a 30-minute time window">${picker}</div><section class="event-density-selection" aria-live="polite" aria-label="Events and actual values for selected time window">${densitySelectionMarkup(busiest, readings)}</section>`;
  }

  function selectDensityBin(target) {
    const panel = target.closest('.event-chronograph-panel');
    const index = Number(target.dataset.densityIndex);
    const bin = densityBins([...currentEventsByIndex.values()])[index];
    if (!panel || !bin) return;
    panel.querySelectorAll('[data-density-index]').forEach(node => {
      const selected = Number(node.dataset.densityIndex) === index;
      node.classList.toggle('is-selected', selected);
      node.setAttribute('aria-pressed', String(selected));
    });
    const windowRect = panel.querySelector('[data-density-selected-window]');
    if (windowRect) {
      const width = 920 / 48;
      windowRect.setAttribute('x', 62 + index * width);
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
      const key = Math.floor((event.start ?? event.restoration) / 10), lane = key % 6, radius = 122 + lane * 8;
      if (event.start != null && event.restoration != null) {
        const start = event.start, end = event.end, a = polar(cx, cy, radius, start), b = polar(cx, cy, radius, end);
        const sweepMinutes = Math.min(1440, end - start), large = sweepMinutes > 720 ? 1 : 0;
        const visibleEnd = Math.min(end, start + 1439.9);
        const endPoint = polar(cx, cy, radius, visibleEnd);
        const nextDay = end > 1440;
        const midnight = polar(cx, cy, radius, 1440), nextDayArc = nextDay ? `<path class="event-dial-span" d="M${midnight.x} ${midnight.y} A${radius} ${radius} 0 0 1 ${b.x} ${b.y}"/>` : '';
        return `<g class="event-dial-event" data-event-index="${event.index}" tabindex="0" role="button" aria-label="${esc(eventSummary(event))}"><path class="event-dial-span" d="M${a.x} ${a.y} A${radius} ${radius} 0 ${large} 1 ${endPoint.x} ${endPoint.y}"><title>${esc(eventSummary(event))}${nextDay ? ' · restoration after midnight' : ''}</title></path>${nextDayArc}<circle class="event-dial-endpoint event-outage-point" cx="${a.x}" cy="${a.y}" r="3.5"/><circle class="event-dial-endpoint event-restoration-point" cx="${b.x}" cy="${b.y}" r="3.5"/></g>`;
      }
      const time = event.outage ?? event.restoration, point = polar(cx, cy, radius, time);
      return `<g class="event-dial-event" data-event-index="${event.index}" tabindex="0" role="button" aria-label="${esc(eventSummary(event))}"><path class="event-dial-point ${event.outage != null ? 'event-outage-point' : 'event-restoration-point'}" d="M${point.x} ${point.y - 5}l5 5-5 5-5-5z"><title>${esc(eventSummary(event))}</title></path></g>`;
    }).join('');
    const list = events.map(event => `<li><button type="button" class="event-chronograph-list-item" data-event-index="${event.index}" aria-label="${esc(eventSummary(event))}"><span class="event-list-time">${esc(eventLabel(event))}</span><span>${esc(event.description || 'Event without a description')}</span></button></li>`).join('');
    return `<div class="event-dial-layout"><svg class="event-dial-svg" viewBox="0 0 440 440" role="group" aria-label="24-hour clock dial with outage spans and event markers"><title>24-hour event dial · each marked hour is Bangladesh time</title><circle class="event-dial-face" cx="${cx}" cy="${cy}" r="${face}"/><circle class="event-dial-ring" cx="${cx}" cy="${cy}" r="126"/><circle class="event-dial-ring" cx="${cx}" cy="${cy}" r="150"/>${ticks}${marks}<text class="event-dial-center" x="${cx}" y="${cy - 5}" text-anchor="middle">24 HOUR</text><text class="event-dial-center-note" x="${cx}" y="${cy + 14}" text-anchor="middle">BST</text></svg><div class="event-dial-list-wrap"><h3>Chronological event list</h3><ol class="event-dial-list">${list}</ol></div></div>`;
  }

  const viewDescriptions = {
    table: 'Outage, restoration, and operating notes from the report.',
    lanes: 'Hover or focus an event dot or period to connect it to demand and generation. Start and end values are shown together.',
    density: 'Event pulse pairs daily curves with 30-minute event-start counts. Choose a window to inspect its events and matching P4 values.',
    dial: 'The 24-hour dial places times by angle. Outage and restoration pairs appear as arcs; the adjacent list keeps every description.'
  };
  let selectedView = 'table';

  function render(rawEvents = [], hourly = [], tableMarkup = '') {
    const events = normalise(rawEvents);
    currentEventsByIndex = new Map(events.map(event => [event.index, event]));
    currentReadings = readingsWithTime(hourly);
    const controls = [['table', 'Table'], ['lanes', 'Timeline'], ['density', 'Event pulse'], ['dial', '24-hour dial']]
      .map(([key, label]) => `<button type="button" data-event-view-select="${key}" aria-pressed="${key === selectedView}">${label}</button>`).join('');
    const view = (key, markup) => `<div class="event-view" data-event-view="${key}"${key === selectedView ? '' : ' hidden'}>${markup}</div>`;
    // Keep the deployed table, including source notes and workbook ordering, inside the first view.
    const table = tableMarkup.replace(/^<section class="panel full">/, '<div>').replace(/<div class="panel-head">.*?<\/div><span class="tag">.*?<\/span><\/div>/s, '').replace(/<\/section>$/, '</div>');
    const legend = `<div class="event-mark-legend"><span><i class="event-mark-outage"></i>Outage/event time</span><span><i class="event-mark-period"></i>Outage–restoration period</span><span><i class="event-mark-restoration"></i>Restoration-only time</span><span><i class="event-mark-unplaced"></i>No reported time</span></div>`;
    const heading = `<div class="event-plot-heading"><div><h3>Demand &amp; generation response</h3><span>P4 actual · MW · Bangladesh time</span></div><div class="event-plot-legend"><span class="demand-key">Demand</span><span class="generation-key">Generation</span></div></div>`;
    return `<section class="panel full event-chronograph-panel"><div class="panel-head"><div><h2>Daily event log</h2><p>Outage, restoration, and operating notes from the report</p></div><span class="tag">${events.length} EVENTS · BST</span></div><div class="event-view-controls" role="group" aria-label="Choose an event log view">${controls}</div><div class="event-view-description" aria-live="polite">${viewDescriptions[selectedView]}</div>${view('table', table)}${view('lanes', heading + legend + demandPlot(hourly, events))}${view('density', densityView(hourly, events))}${view('dial', heading + legend + demandPlot(hourly, events, { showEventLanes: false }) + dialView(events))}<p class="event-view-note"${selectedView === 'table' ? ' hidden' : ''}>Bangladesh time · P1 events and P4 actuals. Values between hourly readings are interpolated; restoration values beyond this day’s profile are unavailable.</p></section>`;
  }

  function showTooltipFor(target) {
    const wrapper = target.closest?.('.event-context-group');
    const panel = target.closest?.('.event-chronograph-panel');
    const tooltip = wrapper?.querySelector('.event-context-tooltip');
    if (!wrapper || !panel || !tooltip) return;
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
      selectDensityBin(densityBin);
      return;
    }
    const view = event.target.closest?.('[data-event-view-select]');
    if (view) {
      const panel = view.closest('.event-chronograph-panel');
      if (!panel) return;
      const selected = view.dataset.eventViewSelect;
      selectedView = selected;
      panel.querySelectorAll('[data-event-view-select]').forEach(button => button.setAttribute('aria-pressed', String(button === view)));
      panel.querySelectorAll('[data-event-view]').forEach(section => { section.hidden = section.dataset.eventView !== selected; });
      const description = panel.querySelector('.event-view-description');
      if (description) description.textContent = viewDescriptions[selected];
      const note = panel.querySelector('.event-view-note');
      if (note) note.hidden = selected === 'table';
      return;
    }
    const item = event.target.closest?.('[data-event-index]');
    const panel = item?.closest('.event-chronograph-panel');
    if (!panel) return;
    if (item.matches('.event-time-marker,.event-unplaced-chip')) showTooltipFor(item);
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
      selectDensityBin(densityBin);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('[data-event-index][role=button]')) {
      event.preventDefault();
      event.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return;
    }
    if (event.key !== 'Escape') return;
    event.target.closest?.('.event-chronograph-panel')?.querySelectorAll('[data-event-index].is-selected').forEach(node => node.classList.remove('is-selected'));
    event.target.closest?.('.event-context-group')?.querySelectorAll('.event-context-tooltip').forEach(node => { node.hidden = true; });
    event.target.closest?.('.event-chronograph-panel')?.querySelectorAll('.event-time-marker.is-active,.event-chart-link.is-active').forEach(node => node.classList.remove('is-active'));
  });

  window.BEGDEventChronograph = { render, normalise };
})();
