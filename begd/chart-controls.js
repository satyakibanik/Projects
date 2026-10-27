// Keep legend nodes mounted: replacing them invalidates mobile scroll anchors.
const chartBindings=new WeakMap(),synchronizedCharts=new WeakMap();
function bindChartControl(node,type,handler){
  let bindings=chartBindings.get(node);if(!bindings){bindings=new Map();chartBindings.set(node,bindings)}
  if(bindings.has(type))node.removeEventListener(type,bindings.get(type));
  bindings.set(type,handler);node.addEventListener(type,handler);
}
function refreshChart(wrapper,view){
  const previous=wrapper.dataset.chart,model=chartData.get(previous);
  const template=document.createElement('template');template.innerHTML=model.redraw();
  const next=template.content.querySelector('.interactive-chart');
  wrapper.querySelector('svg.chart').replaceWith(next.querySelector('svg.chart'));
  wrapper.dataset.chart=next.dataset.chart;chartData.delete(previous);
  wrapper.querySelector('.chart-tooltip').hidden=true;
  const nextModel=chartData.get(wrapper.dataset.chart);
  wrapper.querySelectorAll('[data-toggle-series]').forEach(input=>{
    input.checked=nextModel.series.find(series=>series.key===input.dataset.toggleSeries)?.defaultVisible!==false;
  });
  setupCharts(view,[wrapper]);
}
function setupCharts(view,wrappers=null) {
  if(!wrappers)setupRegionalSnapshotTooltips();
  (wrappers||document.querySelectorAll('.interactive-chart')).forEach(wrapper => {
    const model = chartData.get(wrapper.dataset.chart);
    const tooltip = wrapper.querySelector('.chart-tooltip');
    const cursor = wrapper.querySelector('.chart-cursor');
    let selected = null, touch = null;
    const highlightSeries = key => {
      const target = key && wrapper.querySelector(`.chart [data-series="${key}"]`);
      if (target?.style.display === 'none') key = null;
      wrapper.querySelectorAll('.chart [data-series]').forEach(group => {
      const active = Boolean(key) && group.dataset.series === key;
      group.classList.toggle('is-highlighted', active);
      group.classList.toggle('is-dimmed', Boolean(key) && !active);
      });
    };
    const peers=()=>model.syncGroup?[...document.querySelectorAll('[data-sync-group="'+model.syncGroup+'"]')]:[wrapper];
    function show(index,linked=false) {
      selected = index;
      const row = model.rows[index];
      const visible = peers().flatMap(peer=>chartData.get(peer.dataset.chart).series.filter(s=>peer.querySelector(`[data-toggle-series="${s.key}"]`).checked));
      const ordered = model.enCurve ? visible.slice().reverse() : visible;
      tooltip.innerHTML = `<strong>${esc(row.time)} · Bangladesh time</strong>` + ordered.map(s => `<div><span class="tooltip-series">${legendSwatch(s,Math.max(0,model.series.indexOf(s)))}<span>${esc(s.name)}</span></span><b${s.key === 'shortage_mw' ? ' style="color:#ed4d4d"' : ''}>${fmt(row[s.key],2)} ${esc(s.unit||model.unit||'MW')}</b></div>`).join('');
      if (!visible.length) tooltip.innerHTML += '<div>No series selected</div>';
      tooltip.hidden = false;
      const fraction = model.x(row) / (model.width||800);
      const plot = wrapper.querySelector('svg');
      const plotBounds = plot.getBoundingClientRect(), wrapperBounds = wrapper.getBoundingClientRect();
      const plotOffset = (plotBounds.left - wrapperBounds.left) / wrapperBounds.width;
      const plotWidth = plotBounds.width / wrapperBounds.width;
      const tooltipWidth=tooltip.getBoundingClientRect().width,anchor=(plotOffset+fraction*plotWidth)*wrapperBounds.width;
      tooltip.style.left = `${Math.max(0,Math.min(wrapperBounds.width-tooltipWidth,anchor-(fraction>.65?tooltipWidth:0)))}px`;
      tooltip.style.transform = 'none';
      if(touch?.pinned)window.BEGDChartTouch.position(tooltip,touch.event);else{tooltip.classList.remove('is-touch-tooltip');tooltip.style.top='8px';}
      cursor.setAttribute('x1', model.x(row));
      cursor.setAttribute('x2', model.x(row));
      cursor.removeAttribute('hidden');
      if(!linked)peers().filter(peer=>peer!==wrapper).forEach(peer=>{const linkedChart=synchronizedCharts.get(peer);linkedChart?.show(index,true);if(touch?.pinned)peer.querySelector('.chart-tooltip').hidden=true});
    }
    function hide(linked=false) { if(touch?.pinned)return;tooltip.hidden = true; cursor.setAttribute('hidden', ''); selected = null;
      if(!linked)peers().filter(peer=>peer!==wrapper).forEach(peer=>synchronizedCharts.get(peer)?.hide(true));
    }
    synchronizedCharts.set(wrapper,{show,hide});
    wrapper.querySelectorAll('[data-series-label]').forEach(label => {
      const highlight = () => highlightSeries(label.dataset.seriesLabel);
      const clear = () => highlightSeries(null);
      bindChartControl(label,'pointerenter', highlight);
      bindChartControl(label,'pointerleave', clear);
      bindChartControl(label,'focus', highlight);
      bindChartControl(label,'blur', clear);
    });
    const styleControl=wrapper.querySelector('[data-chart-style]');
    if(styleControl)bindChartControl(styleControl,'change', event => {
      if (event.target.dataset.chartStyle === 'dispatch') dispatchChartStyle = event.target.value;
      if (event.target.dataset.chartStyle === 'shed') shedChartStyle = event.target.value;
      if (event.target.dataset.chartStyle === 'en-curve') enCurveChartStyle = event.target.value;
      const style=event.target.dataset.chartStyle;render();
      document.querySelector(`[data-chart-style="${style}"]`)?.focus({preventScroll:true});
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
    const svg=wrapper.querySelector('svg');
    touch=window.BEGDChartTouch?.bind(svg,{tip:tooltip,hide:()=>hide(),select:event=>{
      const matrix=svg.getScreenCTM();if(!matrix||!model.rows.length)return;
      const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
      const local=point.matrixTransform(matrix.inverse());
      const index=model.rows.reduce((nearest,row,i)=>Math.abs(model.x(row)-local.x)<Math.abs(model.x(model.rows[nearest])-local.x)?i:nearest,0);
      show(index);
    }});
    svg.addEventListener('pointerleave', () => hide());
    bindChartControl(wrapper,'focusout', event => { if (!wrapper.contains(event.relatedTarget)) hide(); });
    wrapper.querySelectorAll('[data-toggle-family]').forEach(master => {
      const members=[...wrapper.querySelectorAll(`[data-series-family="${master.dataset.toggleFamily}"]`)];
      const checked=members.filter(input=>input.checked).length;master.checked=checked===members.length;master.indeterminate=checked>0&&checked<members.length;
      bindChartControl(master,'change', () => {
      wrapper.querySelectorAll(`[data-series-family="${master.dataset.toggleFamily}"]`).forEach(input => {
        input.checked=master.checked;
        chartVisibility.set(model.scope+'|'+input.dataset.toggleSeries,master.checked);
      });
      refreshChart(wrapper,view);
    });});
    wrapper.querySelectorAll('[data-toggle-series]').forEach(input => bindChartControl(input,'change', () => {
      const key=input.dataset.toggleSeries;
      chartVisibility.set(model.scope+'|'+key,input.checked);
      refreshChart(wrapper,view);
    }));
  });
}

function setupRegionalSnapshotTooltips() {
  document.querySelectorAll('.regional-snapshot-chart-wrap').forEach(wrapper => {
    const tooltip = wrapper.querySelector('.regional-snapshot-tooltip');
    const hide = () => { tooltip.hidden = true; };
    const show = point => {
      const {region,report,metric,label,value} = point.dataset;
      tooltip.dataset.metric = metric;
      tooltip.innerHTML = `<strong>${esc(region)} · ${esc(report)}</strong><div><span>${esc(label)}</span><b>${esc(value)} MW</b></div>`;
      tooltip.hidden = false;
      const bounds = wrapper.getBoundingClientRect(), target = point.getBoundingClientRect();
      const x = target.left + target.width / 2 - bounds.left;
      const width = tooltip.getBoundingClientRect().width;
      tooltip.style.left = `${Math.max(0, Math.min(x - width / 2, bounds.width - width))}px`;
      tooltip.style.top = `${Math.max(0, target.top - bounds.top - tooltip.offsetHeight - 12)}px`;
    };
    wrapper.querySelectorAll('.regional-snapshot-point').forEach(point => {
      point.addEventListener('pointerenter', () => show(point));
      point.addEventListener('pointerleave', hide);
      point.addEventListener('focus', () => show(point));
      point.addEventListener('blur', hide);
      point.addEventListener('click', () => show(point));
      point.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    });
    wrapper.querySelector('.regional-snapshot-chart-scroll').addEventListener('scroll', hide);
  });
}

// Rebuild geometry only when crossing the phone breakpoint, not when browser toolbars resize height.
let phoneChartLayout=window.innerWidth<600;
window.addEventListener('resize',()=>{
  const phone=window.innerWidth<600;
  if(phone!==phoneChartLayout){phoneChartLayout=phone;if(location.hash!=='#trends'&&typeof render==='function')render()}
});
