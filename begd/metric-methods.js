/* Provenance for headline metrics; figures continue to use the published data. */
(function(root){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const energy='Published daily energy, including cross-border imports. The dashboard reads the reported total; it does not integrate the chart readings.';
 const shortage='Published daily energy required but not supplied. The dashboard reads the reported total, not the gap between forecast demand and actual generation. The workbook does not expose the upstream calculation formula.';
 const definitions={
  'Largest listed circuit flow':['Largest absolute reported MW reading among the three individual EWIC circuits over the listed times. Positive readings mean west to east; negative mean east to west. This is an individual circuit maximum, not the simultaneous sum of circuits or the P1 transfer maximum.','EWIC!B9:B34, D9:D34, F9:F34; times A9:A34','MW',0],
  'Fuel mix':['Each fuel’s published daily energy ÷ national generated energy × 100. Imports form a separate category and are already included in the denominator.','P1!E26:L26 ÷ P1!K8 × 100','%',1],
  'Maximum temperature':['Published maximum temperature for the operating day.','P1!K11','°C',1],
  'Imported energy share':['Published daily imported energy ÷ national generated energy × 100.','P1!K26 ÷ P1!K8 × 100','%',1],
  'Generating units':['Count of parsed GenLog unit columns; if unavailable, count of parsed P2 plant entries. Includes entries with zero reported output.','GenLog!row 11, B onward; fallback P2!B, row 11 onward','entries',0],
  'Operating regions':['Names of regions with a reported P1 daily energy total.','P1!B17:B25 with numeric M17:M25','region names',0],
  'Evening peak demand':['Reported generation-side evening peak demand. This is a published summary value, not the maximum of the plotted forecast.','P1!E11','MW',0],
  'Peak generation':['Published maximum generation, including cross-border imports.','P1!E13','MW',0],
  'Energy generated':[energy,'P1!K8','GWh',2],
  'Energy not served':[shortage,'P1!K9','GWh',2],
  'Total energy requirement':['Published daily energy requirement: generated energy plus energy not served. This is not separately metered consumption.','En-Curve!U9','GWh',2],
  'Total imported energy':['Published daily imported energy, already included in national generated energy.','P1!K26','GWh',2],
  'Share of total energy':['Imported energy ÷ national generated energy × 100. Both inputs use the same operating day.','P1!K26 ÷ P1!K8 × 100','%',1],
  'Import routes':['Count of GenLog columns named HVDC, Tripura, Adani or Nepal with numeric published daily energy.','GenLog!B11:last column; row 38','routes',0],
  'Domestic energy':['National generated energy minus imported energy.','P1!K8 − P1!K26','GWh',2],
  'Substations reporting load':['Count of named P3 entries with numeric maximum served load.','P3!C:E, G:I, K:M; row 17 onward','entries',0],
  'Highest served load':['Maximum of the reported station maximum loads; station peaks may occur at different times.','P3!D, H, L; row 17 onward','MW',1],
  'Voltage classes':['Count of distinct class labels among parsed station voltage records.','Voltage!A and F class headings; row 7 onward','classes',0],
  'Voltage readings':['Count of station/class records with both a numeric maximum and minimum voltage. One record contains two extrema.','Voltage!A:E and F:J; row 7 onward','records',0],
  'Planned shutdown capacity':['Sum of capacities for named units in the published planned shutdown table. This is unavailable capacity, not energy lost.','P1!D74:D80 and G74:G80','MW',1],
  'Forced shutdown capacity':['Sum of capacities for named units in the published forced shutdown table. This is unavailable capacity, not energy lost.','P1!I74:I80 and L74:L80','MW',1],
  'East → west energy':['Published daily east-to-west transferred energy in kWh ÷ 1,000.','P1!E53','MWh',2],
  'West → east energy':['Published daily west-to-east transferred energy in kWh ÷ 1,000.','P1!E54','MWh',2],
  'Forecast available · day peak':['Published forecast available generation for day peak; this is availability, not predicted actual output.','Forecast!J, System Total row','MW',0],
  'Forecast available · evening peak':['Published forecast available generation for evening peak; this is availability, not predicted actual output.','Forecast!K, System Total row','MW',0],
  'Effective available · day peak':['Published effective available generation for day peak after the report’s adjustments.','Forecast!L, System Total row','MW',0],
  'Effective available · evening peak':['Published effective available generation for evening peak after the report’s adjustments.','Forecast!M, System Total row','MW',0],
  'Total generation':['Sum of published daily national generated energy over reported days in the selected window. Includes imports.','P1!K8 for each contributing operating day','GWh',2,'generation_mwh'],
  'Total demand requirement':['Sum of matching-date En-Curve requirement totals; where unavailable, daily P1 generation plus reported unserved energy. Not independently metered demand.','En-Curve!U9; fallback P1!K8 + K9','GWh',2,'demand_mwh'],
  'Maximum reported load shedding':['Largest available P4 load-shedding reading across reported days in the selected window. This is power curtailed at a reading, not daily unserved energy.','P4!E9:E33 for each contributing day','MW',2,'shed_peak_mw'],
  'Total imports':['Sum of published daily imported energy over reported days in the selected window. Already included in total generation.','P1!K26 for each contributing operating day','GWh',2,'imports_mwh']
 };
 function sourceLink(report){
  const url=report.source_url;
  if(!/^https:\/\/erp\.powergrid\.gov\.bd\//i.test(url||''))return '<span>Original report link unavailable</span>';
  return `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Original report · ${escape(report.date||'selected day')} · Download workbook (XLSX/XLSM)</a>`;
 }
 let dialogId=0;
 function render(label,{report={},rows=null,curve=false}={}){
  const def=definitions[label];if(!def)return '';
  let [definition,cells,unit,digits,key]=def;
  if(curve){cells={'Energy generated':'En-Curve!U7','Energy not served':'En-Curve!U8','Total energy requirement':'En-Curve!U9'}[label]||cells;}
  // Pre-P4 reports have different summary coordinates. Do not assert modern cells.
  const legacy=report.workbook_layout==='legacy'||(!rows&&report.summary?.unserved_mwh==null&&report.hourly?.length&&report.hourly.every(r=>r.demand_mw==null));
  if(legacy)cells={'Evening peak demand':'P1!D10','Peak generation':'P1!D9','Energy generated':'P1!D12'}[label]||'Unavailable in this legacy workbook layout';
  const contributing=rows?rows.filter(r=>typeof r[key]==='number'&&Number.isFinite(r[key])):null;
  const conversion=unit==='GWh'?'Source MKWHr (million kWh) = GWh; imported data is stored in MWh and divided by 1,000 for display. ':'';
  const rounding=unit==='routes'||unit==='entries'||unit==='classes'||unit==='records'||unit==='region names'?'Whole-number count; no rounding.':`Rounded to at most ${digits} decimal place${digits===1?'':'s'} for display only. Calculations use unrounded stored values. Missing values appear as —.`;
  const sources=contributing?`<p>Only reported values contribute; gaps are not zero-filled. ${contributing.length} contributing days.</p><details class="metric-report-list"><summary>Original reports (${contributing.length})</summary><ul>${contributing.map(r=>`<li>${sourceLink(r)}${key==='demand_mwh'?`<span class="metric-source-basis">${escape(r.demand_basis||'Basis unavailable')}</span>`:''}</li>`).join('')}</ul></details>`:`<p>${sourceLink(report)}</p><p>Operating date: ${escape(report.date||'unavailable')}${label.includes('available ·')?`; forecast date: ${escape(report.forecast?.date||'unavailable')}`:''}.</p>`;
  if(label==='Largest listed circuit flow'){
   const names={ishwardi_ghorashal:'Ishurdi–Ghorashal',sirajganj_sreepur:'Sirajganj–Sreepur',gopalganj_aminbazar:'Gopalganj–Aminbazar'};
   let peak=null;
   for(const row of report.operations?.ewic||[])for(const key of Object.keys(names))if(typeof row[key]==='number'&&Number.isFinite(row[key])&&(!peak||Math.abs(row[key])>Math.abs(peak.value)))peak={value:row[key],key,time:row.time};
   if(peak)definition+=` Selected report: ${names[peak.key]}, ${peak.time} BST, signed reading ${peak.value.toLocaleString('en-US',{maximumFractionDigits:3})} MW.`;
  }
  const id='metric-method-'+(++dialogId);
  return `<div class="metric-method"><button type="button" class="metric-method-trigger" aria-label="How calculated: ${escape(label)}" aria-haspopup="dialog" data-method-open="${id}">How calculated</button><dialog id="${id}" class="metric-method-dialog" aria-labelledby="${id}-title"><div class="metric-method-heading"><h3 id="${id}-title">${escape(label)}</h3><button type="button" data-method-close aria-label="Close calculation details">Close</button></div><div class="metric-method-body"><p>${escape(definition)}</p><dl><dt>Units</dt><dd>${escape(unit)}</dd><dt>Workbook reference</dt><dd>${escape(cells)}</dd><dt>Conversion & rounding</dt><dd>${escape(conversion+rounding)}</dd></dl><p>Clicking an original report link starts downloading the report as an XLSX/XLSM workbook.</p>${sources}</div></dialog></div>`;
 }
 root.document?.addEventListener('click',event=>{
  const open=event.target.closest('[data-method-open]'),close=event.target.closest('[data-method-close]');
  if(open)root.document.getElementById(open.dataset.methodOpen)?.showModal();
  if(close)close.closest('dialog')?.close();
 });
 root.BEGDMetricMethods={render,definitions};
})(window);
