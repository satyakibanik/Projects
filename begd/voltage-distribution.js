/* Distribution of station daily extrema. Whiskers use the full observed range. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BEGDVoltageDistribution=api})(typeof window==='undefined'?globalThis:window,()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function quantile(sorted,p){if(!sorted.length)return null;const pos=(sorted.length-1)*p,i=Math.floor(pos),f=pos-i;return sorted[i]+f*((sorted[i+1]??sorted[i])-sorted[i])}
 function summary(values){const s=[...values].sort((a,b)=>a-b);return s.length?{n:s.length,min:s[0],q1:quantile(s,.25),median:quantile(s,.5),q3:quantile(s,.75),max:s.at(-1)}:null}
 function render(groups,{colors,register=()=>{}}){
  const title='Voltage distribution · box-and-whisker plots',text='Separate boxes summarize station minima and maxima by voltage class. Box = middle 50%; center line = median; whiskers = full observed range. Dots show station readings, spread horizontally only to reduce overlap. All values are per unit of the respective class rating.';
  const nonempty=groups.filter(g=>g.length),rows=nonempty.flat(),id='vb-analysis';
  if(!rows.length)return {title,text,html:'<p class="vb-empty">No valid voltage readings match the chart filters.</p>'};
  const W=1000,H=390,L=75,R=30,T=30,B=65,pw=W-L-R,ph=H-T-B;
  const lo=Math.min(1,...rows.map(r=>r.min_pu)),hi=Math.max(1,...rows.map(r=>r.max_pu)),pad=Math.max(.015,(hi-lo)*.1),low=lo-pad,high=hi+pad,y=v=>T+(high-v)/(high-low)*ph;
  let plot='';
  for(let i=0;i<=5;i++){const v=low+(high-low)*i/5;plot+=`<line class="vb-gridline" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text class="vb-axis" x="${L-12}" y="${y(v)+4}" text-anchor="end">${v.toFixed(3)}</text>`}
  plot+=`<line class="vb-nominal" x1="${L}" x2="${W-R}" y1="${y(1)}" y2="${y(1)}"/><text class="vb-ref-label" x="${W-R}" y="14" text-anchor="end">Dashed: 1.000 p.u. nominal</text>`;
  const slot=pw/nonempty.length,table=[];
  nonempty.forEach((g,j)=>{
   const center=L+(j+.5)*slot,color=colors[g[0].nominal_kv];
   for(const [side,offset] of [['min',-.19],['max',.19]]){
    const cx=center+slot*offset,s=summary(g.map(r=>r[side+'_pu'])),width=Math.min(68,slot*.22),label=side==='min'?'Minima':'Maxima';
    table.push(`<tr><td>${g[0].nominal_kv} kV ${label.toLowerCase()}</td><td>${s.n}</td>${['min','q1','median','q3','max'].map(k=>`<td class="num">${s[k].toFixed(3)}</td>`).join('')}</tr>`);
    plot+=`<g><title>${g[0].nominal_kv} kV ${label}: n=${s.n}, min=${s.min.toFixed(3)}, Q1=${s.q1.toFixed(3)}, median=${s.median.toFixed(3)}, Q3=${s.q3.toFixed(3)}, max=${s.max.toFixed(3)} p.u.</title><line x1="${cx}" x2="${cx}" y1="${y(s.max)}" y2="${y(s.min)}" stroke="${color}"/><path d="M${cx-width/3},${y(s.min)}H${cx+width/3} M${cx-width/3},${y(s.max)}H${cx+width/3}" stroke="${color}"/><rect x="${cx-width/2}" y="${y(s.q3)}" width="${width}" height="${Math.max(.6,y(s.q1)-y(s.q3))}" fill="${color}" fill-opacity="${side==='min'?.12:.3}" stroke="${color}"/><line x1="${cx-width/2}" x2="${cx+width/2}" y1="${y(s.median)}" y2="${y(s.median)}" stroke="${color}" stroke-width="3"/></g>`;
    g.forEach((r,i)=>{const key=`distribution-${r.nominal_kv}-${side}-${i}`;register(key,{row:r,id,unit:'pu',analysis:true});plot+=`<circle class="vb-analysis-dot" tabindex="0" role="img" aria-label="${esc(r.name)}, ${r.nominal_kv} kV ${label.toLowerCase()}: ${r[side+'_pu'].toFixed(3)} p.u." data-vb-point="${key}" cx="${cx+(((i*37)%101)/100-.5)*width*.75}" cy="${y(r[side+'_pu'])}" r="2.4" fill="${color}" fill-opacity=".55"><title>${esc(r.name)} · ${r.nominal_kv} kV · ${r.min_kv}–${r.max_kv} kV</title></circle>`});
    plot+=`<text class="vb-axis" x="${cx}" y="${H-B+20}" text-anchor="middle">${label}</text>`;
   }
   plot+=`<text class="vb-axis-title" x="${center}" y="${H-B+43}" text-anchor="middle">${g[0].nominal_kv} kV · ${g.length} records</text>`;
  });
  plot+=`<text class="vb-axis-title" transform="translate(18 ${T+ph/2}) rotate(-90)" text-anchor="middle">Voltage (p.u.)</text>`;
  return {title,text,html:`<svg class="vb-chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="Voltage distribution box-and-whisker plots">${plot}</svg><div class="vb-reading" id="${id}-reading" aria-live="polite">Hover or focus a station mark to see its readings and times.</div><details class="vb-stats"><summary>Distribution statistics (p.u.)</summary><div class="table-wrap"><table><thead><tr><th>Class / reading</th><th>Records</th><th>Minimum</th><th>Q1</th><th>Median</th><th>Q3</th><th>Maximum</th></tr></thead><tbody>${table.join('')}</tbody></table></div></details>`};
 }
 return {quantile,summary,render};
});
