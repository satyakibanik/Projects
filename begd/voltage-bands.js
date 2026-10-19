/* Daily extrema by station; this chart does not infer hourly voltage traces. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BEGDVoltageBands=api})(typeof window==='undefined'?globalThis:window,()=>{
 const analysis=typeof module==='object'&&module.exports?require('./voltage-distribution.js'):globalThis.BEGDVoltageDistribution;
 const classes=[400,230,132],colors={400:'#8b58b0',230:'#168577',132:'#c16a21'};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const nominal=r=>{const m=String(r.voltage_class||'').trim().match(/^(132|230|400)\s*kV$/i);return m?Number(m[1]):null};
 const numeric=v=>typeof v==='number'&&Number.isFinite(v);
 function prepare(rows){
  const groups=new Map(classes.map(k=>[k,[]])),excluded=[];
  for(const r of rows||[]){
   const kv=nominal(r);
   if(!kv||!numeric(r.min_kv)||!numeric(r.max_kv)||r.min_kv<=0||r.max_kv<r.min_kv){excluded.push(r);continue}
   groups.get(kv).push({...r,nominal_kv:kv,min_pu:r.min_kv/kv,max_pu:r.max_kv/kv,mid_pu:(r.min_kv+r.max_kv)/(2*kv)});
  }
  for(const group of groups.values())group.sort((a,b)=>a.mid_pu-b.mid_pu||a.name.localeCompare(b.name));
  return {groups,excluded};
 }
 const rank=(index,count)=>count<=1?.5:index/(count-1);
 function extent(groups,unit){const values=groups.flatMap(g=>g.flatMap(r=>unit==='pu'?[r.min_pu,r.max_pu]:[r.min_kv,r.max_kv]));if(!values.length)return null;return [Math.min(...values),Math.max(...values)]}
 const format=(v,pu=false)=>pu?v.toFixed(3):Number(v).toLocaleString('en-US',{maximumFractionDigits:1});
 const rangeText=(groups,unit)=>{const e=extent(groups,unit);return e?`${format(e[0],unit==='pu')}–${format(e[1],unit==='pu')} ${unit==='pu'?'p.u.':'kV'}`:'No valid voltage readings'};
 let state={rows:[],date:'',query:'',hidden:new Set()},hoverItems=new Map();
 function chart(groups,unit,id){
  const pu=unit==='pu',nonempty=groups.filter(g=>g.length),envelope=extent(nonempty,unit);
  if(!envelope)return '<p class="vb-empty">No voltage records match the current station and class selection.</p>';
  const W=1000,H=330,L=70,R=24,T=22,B=65,pw=W-L-R,ph=H-T-B;
  const ref=pu?1:nonempty[0][0].nominal_kv;
  const span=Math.max(envelope[1]-envelope[0],pu?.025:ref*.025),pad=span*.12;
  const low=Math.min(envelope[0],ref)-pad,high=Math.max(envelope[1],ref)+pad;
  const x=r=>L+r*pw,y=v=>T+(high-v)/(high-low)*ph;
  const get=(r,side)=>pu?r[side+'_pu']:r[side+'_kv'];
  let plot='';
  for(let i=0;i<=5;i++){const value=low+(high-low)*i/5;plot+=`<line class="vb-gridline" x1="${L}" x2="${W-R}" y1="${y(value)}" y2="${y(value)}"/><text class="vb-axis" x="${L-12}" y="${y(value)+4}" text-anchor="end">${format(value,pu)}</text>`}
  for(const p of [0,.25,.5,.75,1])plot+=`<text class="vb-axis" x="${x(p)}" y="${H-B+24}" text-anchor="middle">${p*100}%</text>`;
  plot+=`<line class="vb-nominal" x1="${L}" x2="${W-R}" y1="${y(ref)}" y2="${y(ref)}"/><text class="vb-ref-label" x="${W-R}" y="${T-8}" text-anchor="end">Dashed: ${pu?'1.000 p.u.':ref+' kV'} nominal</text>`;
  for(const group of nonempty){
   const kv=group[0].nominal_kv,color=colors[kv],points=group.map((r,i)=>({r,i,x:x(rank(i,group.length)),lo:y(get(r,'min')),hi:y(get(r,'max'))}));
   const path=points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)},${p.hi.toFixed(2)}`).join(' ')+points.slice().reverse().map(p=>` L${p.x.toFixed(2)},${p.lo.toFixed(2)}`).join(' ')+' Z';
   plot+=`<path d="${path}" fill="${color}" fill-opacity="${pu?.13:.18}" stroke="none"/>`;
   for(const side of ['lo','hi'])plot+=`<path d="${points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)},${p[side].toFixed(2)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
   for(const p of points){
    const hid=`${id}-${kv}-${p.i}`;hoverItems.set(hid,{row:p.r,index:p.i,count:group.length,unit,id});
    const label=`${p.r.name}, ${kv} kV: ${format(p.r.min_kv)} to ${format(p.r.max_kv)} kV, ${format(p.r.min_pu,true)} to ${format(p.r.max_pu,true)} p.u.`;
    plot+=`<g class="vb-station" tabindex="0" role="img" aria-label="${esc(label)}" data-vb-point="${hid}" data-vb-panel="${id}"><title>${esc(label)}</title><line x1="${p.x}" x2="${p.x}" y1="${p.hi}" y2="${p.lo}" stroke="${color}" stroke-opacity="${group.length>80?.23:.55}" stroke-width="${group.length===1?5:2}" vector-effect="non-scaling-stroke"/><circle cx="${p.x}" cy="${p.hi}" r="${group.length>80?1.8:2.8}" fill="${color}"/><circle cx="${p.x}" cy="${p.lo}" r="${group.length>80?1.8:2.8}" fill="${color}"/><line class="vb-hit" x1="${p.x}" x2="${p.x}" y1="${p.hi}" y2="${p.lo}" stroke="transparent" stroke-width="${pu?9:Math.max(5,Math.min(18,pw/group.length))}" vector-effect="non-scaling-stroke"/></g>`;
   }
  }
  plot+=`<text class="vb-axis-title" x="${L+pw/2}" y="${H-10}" text-anchor="middle">Station rank within each class · lowest → highest voltage midpoint</text><text class="vb-axis-title" transform="translate(18 ${T+ph/2}) rotate(-90)" text-anchor="middle">${pu?'Voltage (p.u.)':'Voltage (kV)'}</text>`;
  return `<svg class="vb-chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="${pu?'Per-unit voltage bands for selected voltage classes':nonempty[0][0].nominal_kv+' kV daily minimum–maximum voltage band'}">${plot}</svg><div class="vb-reading" id="${id}-reading" aria-live="polite"><span>Hover or focus a station’s range to see its readings and times.</span></div>`;
 }
 function figures(){
  hoverItems=new Map();
  const filtered=state.rows.filter(r=>String(r.name).toLowerCase().includes(state.query.toLowerCase())),prepared=prepare(filtered),visible=classes.filter(k=>!state.hidden.has(k));
  const groups=visible.map(k=>prepared.groups.get(k)),allGroups=classes.map(k=>prepared.groups.get(k));
  const count=allGroups.reduce((n,g)=>n+g.length,0);
  const legend=classes.map(k=>`<button type="button" class="vb-legend-toggle ${state.hidden.has(k)?'is-off':''}" aria-pressed="${!state.hidden.has(k)}" data-vb-class="${k}" style="--vb-color:${colors[k]}"><i></i>${k} kV <small>${prepared.groups.get(k).length} records</small></button>`).join('');
  const extra=analysis.render(groups,{colors,register:(id,item)=>hoverItems.set(id,item)});
  const extraMarkup=`<article class="vb-combined"><div class="vb-chart-heading"><h3>${extra.title}</h3></div><p class="vb-method vb-analysis-method">${extra.text}</p>${extra.html}</article>`;
  return `<div class="vb-context"><span>Operating date <strong>${esc(state.date)}</strong></span><span>${count} valid voltage records${prepared.excluded.length?' · '+prepared.excluded.length+' missing / invalid records omitted':''}</span></div><article class="vb-combined"><div class="vb-chart-heading"><div><h3>Per-unit voltage bands</h3><p>Daily minimum–maximum ÷ nominal class rating · 1.0 p.u. = nominal voltage</p></div><strong>${rangeText(groups,'pu')}</strong></div><div class="vb-legend" aria-label="Toggle voltage classes">${legend}</div>${chart(groups,'pu','vb-combined')}</article>${extraMarkup}`;
 }
 function render(rows,date){state={rows:rows||[],date:date||'',query:'',hidden:new Set()};return `<section class="panel full vb-panel" id="voltage-bands"><div class="panel-head"><div><span class="vb-kicker">VOLTAGE / DAILY EXTREMA</span><h2>Substation voltage analysis</h2><p>Observed ranges for the selected report · Voltage sheet</p></div><span class="tag">VOLTAGE · P.U.</span></div><div class="vb-toolbar"><label>Find station <input type="search" id="voltage-band-search" placeholder="Station name" aria-label="Find station in voltage bands"></label><button type="button" id="voltage-band-reset">Reset chart filters</button><span>Legend buttons show or hide a class in all charts.</span></div><p class="vb-method">Each vertical range is one station’s reported daily minimum and maximum. Stations are ranked separately within each voltage class by the midpoint of that range. Equal rank across classes does not mean the same station. Shading joins adjacent station ranges as a visual guide; this is not an hourly time series or an allowable-voltage limit.</p><div id="voltage-band-figures">${figures()}</div><p class="note vb-source">Source: selected daily workbook · Voltage sheet (max/min readings and their BST times). These charts include stations with voltage readings even when no P3 load is reported. Comparison-day controls above apply to the existing table; these bands show the selected day only.</p></section>`}
 function repaint(){const el=document.getElementById('voltage-band-figures');if(el)el.innerHTML=figures()}
 function show(item){const output=document.getElementById(item.id+'-reading');if(!output)return;const r=item.row;output.innerHTML=`<strong>${esc(r.name)} · ${r.nominal_kv} kV</strong><span><i class="vb-min-dot"></i>Min <b>${format(r.min_kv)} kV</b> (${format(r.min_pu,true)} p.u.) at ${esc(r.min_time||'unreported')} BST</span><span><i class="vb-max-dot"></i>Max <b>${format(r.max_kv)} kV</b> (${format(r.max_pu,true)} p.u.) at ${esc(r.max_time||'unreported')} BST</span><span>${item.analysis?`Daily range: ${format(r.max_kv-r.min_kv)} kV · ${((r.max_kv-r.min_kv)/r.nominal_kv*100).toFixed(2)}% of nominal`:`Rank ${item.index+1} of ${item.count}`}</span>`}
 if(typeof document!=='undefined'){
  document.addEventListener('input',e=>{if(e.target.id==='voltage-band-search'){state.query=e.target.value;repaint()}});
  document.addEventListener('click',e=>{const button=e.target.closest('[data-vb-class]');if(button){const k=Number(button.dataset.vbClass);state.hidden.has(k)?state.hidden.delete(k):state.hidden.add(k);repaint();document.querySelector(`[data-vb-class="${k}"]`)?.focus()}if(e.target.closest('#voltage-band-reset')){state.query='';state.hidden.clear();const search=document.getElementById('voltage-band-search');if(search)search.value='';repaint()}});
  document.addEventListener('pointerover',e=>{const point=e.target.closest('[data-vb-point]');if(point&&hoverItems.has(point.dataset.vbPoint))show(hoverItems.get(point.dataset.vbPoint))});
  document.addEventListener('focusin',e=>{const point=e.target.closest('[data-vb-point]');if(point&&hoverItems.has(point.dataset.vbPoint))show(hoverItems.get(point.dataset.vbPoint))});
 }
 return {prepare,rank,extent,render,nominal};
});
