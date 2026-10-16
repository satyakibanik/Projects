function setupCharts(view) {
  document.querySelectorAll('.interactive-chart').forEach(wrapper => {
    const model = chartData.get(wrapper.dataset.chart);
    const tooltip = wrapper.querySelector('.chart-tooltip');
    const cursor = wrapper.querySelector('.chart-cursor');
    let selected = null;
    const highlightSeries = key => {
      const target = key && wrapper.querySelector(`.chart [data-series="${key}"]`);
      if (target?.style.display === 'none') key = null;
      wrapper.querySelectorAll('.chart [data-series]').forEach(group => {
      const active = Boolean(key) && group.dataset.series === key;
      group.classList.toggle('is-highlighted', active);
      group.classList.toggle('is-dimmed', Boolean(key) && !active);
      });
    };
    function show(index) {
      selected = index;
      const row = model.rows[index];
      const visible = model.series.filter(s => wrapper.querySelector(`[data-toggle-series="${s.key}"]`).checked);
      const ordered = model.enCurve ? visible.slice().reverse() : visible;
      tooltip.innerHTML = `<strong>${esc(row.time)} · Bangladesh time</strong>` + ordered.map(s => `<div><span><i style="background:${s.color}"></i>${esc(s.name)}</span><b${s.key === 'shortage_mw' ? ' style="color:#ed4d4d"' : ''}>${fmt(row[s.key],2)} MW</b></div>`).join('');
      if (!visible.length) tooltip.innerHTML += '<div>No series selected</div>';
      tooltip.hidden = false;
      const fraction = model.x(row) / 800;
      const plot = wrapper.querySelector('svg');
      const plotBounds = plot.getBoundingClientRect(), wrapperBounds = wrapper.getBoundingClientRect();
      const plotOffset = (plotBounds.left - wrapperBounds.left) / wrapperBounds.width;
      const plotWidth = plotBounds.width / wrapperBounds.width;
      tooltip.style.left = `${Math.max(2, Math.min(98, (plotOffset + fraction * plotWidth) * 100))}%`;
      tooltip.style.transform = fraction > .65 ? 'translateX(-100%)' : 'translateX(0)';
      cursor.setAttribute('x1', model.x(row));
      cursor.setAttribute('x2', model.x(row));
      cursor.removeAttribute('hidden');
    }
    function hide() { tooltip.hidden = true; cursor.setAttribute('hidden', ''); selected = null; }
    wrapper.querySelectorAll('[data-series-label]').forEach(label => {
      const highlight = () => highlightSeries(label.dataset.seriesLabel);
      const clear = () => highlightSeries(null);
      label.addEventListener('pointerenter', highlight);
      label.addEventListener('pointerleave', clear);
      label.addEventListener('focus', highlight);
      label.addEventListener('blur', clear);
    });
    wrapper.querySelector('[data-chart-style]')?.addEventListener('change', event => {
      if (event.target.dataset.chartStyle === 'dispatch') dispatchChartStyle = event.target.value;
      if (event.target.dataset.chartStyle === 'shed') shedChartStyle = event.target.value;
      if (event.target.dataset.chartStyle === 'en-curve') enCurveChartStyle = event.target.value;
      render();
    });
    wrapper.querySelectorAll('[data-point]').forEach(hit => {
      const index = Number(hit.dataset.point);
      hit.addEventListener('pointerenter', () => show(index));
      hit.addEventListener('click', () => show(index));
      hit.addEventListener('focus', () => show(index));
      hit.addEventListener('keydown', event => {
        if (event.key === 'Escape') hide();
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const next = Math.max(0, Math.min(model.rows.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
          wrapper.querySelector(`[data-point="${next}"]`).focus();
        }
      });
    });
    wrapper.querySelector('svg').addEventListener('pointerleave', hide);
    wrapper.addEventListener('focusout', event => { if (!wrapper.contains(event.relatedTarget)) hide(); });
    wrapper.querySelectorAll('[data-toggle-family]').forEach(master => master.addEventListener('change', () => {
      const family = master.dataset.toggleFamily, checked = master.checked;
      [...wrapper.querySelectorAll(`[data-series-family="${family}"]`)].forEach(input => {
        input.checked = checked;
        input.dispatchEvent(new Event('change'));
      });
    }));
    wrapper.querySelectorAll('[data-toggle-series]').forEach(input => input.addEventListener('change', () => {
      if (input.dataset.seriesFamily || model.enCurve) dispatchVisibility.set(input.dataset.toggleSeries, input.checked);
      if (model.stackedArea) { render(); return; }
      wrapper.querySelector(`[data-series="${input.dataset.toggleSeries}"]`).style.display = input.checked ? '' : 'none';
      const visible = model.series.filter(s => wrapper.querySelector(`[data-toggle-series="${s.key}"]`).checked);
      const scale = chartScale(model.rows, visible);
      const y = value => 218 - (value - scale.min) / (scale.max - scale.min) * 204;
      for (let i = 0; i <= 4; i++) {
        const value = scale.min + (scale.max - scale.min) * i / 4;
        wrapper.querySelector(`[data-tick-label="${i}"]`).textContent = fmt(value, 2);
      }
      model.series.forEach(series => {
        const group = wrapper.querySelector(`[data-series="${series.key}"]`);
        if (series.bar) {
          group.querySelectorAll('rect').forEach(rect => {
            const value=model.rows[Number(rect.dataset.rowIndex)][series.key];
            rect.setAttribute('y', y(value));
            rect.setAttribute('height', Math.max(0, 218 - y(value)));
          });
        } else {
          const points = series.pointsOnly && !series.connectPoints ? '' : model.rows.filter(row => typeof row[series.key] === 'number').map(row => `${model.x(row)},${y(row[series.key])}`).join(' ');
          group.querySelector('polyline').setAttribute('points', points);
          group.querySelectorAll('circle').forEach(circle => circle.setAttribute('cy', y(model.rows[Number(circle.dataset.rowIndex)][series.key])));
        }
      });
      wrapper.querySelectorAll('[data-toggle-family]').forEach(master => {
        const inputs = [...wrapper.querySelectorAll(`[data-series-family="${master.dataset.toggleFamily}"]`)];
        const checked = inputs.filter(item => item.checked).length;
        master.checked = checked === inputs.length;
        master.indeterminate = checked > 0 && checked < inputs.length;
      });
      if (selected !== null) show(selected);
    }));
  });
}
