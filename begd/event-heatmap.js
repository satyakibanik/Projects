/* Category/hour counts and source evidence for the operational event explorer. */
(function(root){
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const DEFAULTS={asset:'',time:'action',date:'report',value:'count',extraOpen:false};
  const ASSETS=['Network equipment','Generator','Import link','System summary','Area / load','Unresolved asset'];
  function assetScope(row){
    if(row.category==='generation')return 'System summary';
    if(row.category==='interruption')return 'Area / load';
    const action=String(row.description||'').split(/\bdue to\b|\bshowing\b|\bwith remarks\b/i)[0];
    if(/\bhvdc\s*\(nepal\)/i.test(action))return 'Import link';
    if(/\bs\s*\/\s*s\b|\bckt\b|\bcircuit\b|\bbus\b|\b\d+\s*kv\b|\btransformer\b|\bbay\b/i.test(action))return 'Network equipment';
    return /\bMW\b|CCPP|TPP|GTPP|Power Limited|Biddut|FGMO|\bGT[- ]?\d|\bST\b/i.test(action)?'Generator':'Unresolved asset';
  }
  function timed(row,settings=DEFAULTS){
    let field=settings.time==='restoration'?'restoration_time':'outage_time';
    const clock=root.BEGDOperationalEvents.clockMinutes;
    if(settings.time==='action'&&clock(row[field])===null&&['restored','commissioning','switching','synchronized'].includes(row.category))field='restoration_time';
    const minutes=clock(row[field]);if(minutes===null)return null;
    const hour=Math.floor(minutes/60)%24;
    const next=settings.date==='rollover'&&(minutes===1440||hour<8);
    const assignedDate=next?new Date(Date.parse(row.date+'T00:00:00Z')+86400000).toISOString().slice(0,10):row.date;
    return {...row,hour,time_field:field,assigned_date:assignedDate};
  }
  function matrix(rows,available,settings=DEFAULTS,categories=[]){
    const eligible=rows.filter(row=>!settings.asset||assetScope(row)===settings.asset);
    const observations=eligible.map(row=>timed(row,settings)).filter(Boolean);
    const result=categories.map(([id,label])=>{
      const entries=observations.filter(row=>row.category===id),counts=Array(24).fill(0);
      entries.forEach(row=>counts[row.hour]++);
      return {id,label,counts,total:entries.length,values:counts.map(count=>!available?null:settings.value==='rate'?count/available:settings.value==='share'?(entries.length?100*count/entries.length:0):count)};
    });
    result.sort((a,b)=>b.total-a.total);
    return {rows:result,observations,missing:eligible.length-observations.length,available};
  }
  function options(items,value){return items.map(([id,label])=>`<option value="${escape(id)}"${id===value?' selected':''}>${escape(label)}</option>`).join('')}
  function render(host,rows,available,settings,categories,onChange){
    if(!host)return;
    const model=matrix(rows,available,settings,categories),max=Math.max(0,...model.rows.flatMap(row=>row.values).filter(v=>v!==null));
    const valueText=v=>v===null?'—':settings.value==='count'?String(v):settings.value==='share'?v.toFixed(1):v.toFixed(2);
    const unit=settings.value==='rate'?'entries per day with available logs':settings.value==='share'?'% of each category’s timed entries':'raw entry counts';
    host.innerHTML=`<details class="event-heatmap-settings"${settings.extraOpen?' open':''}><summary>Additional settings</summary><div class="event-explorer-filters"><label for="event-heatmap-asset">Asset<select id="event-heatmap-asset" data-heatmap-setting="asset">${options([['','All assets'],...ASSETS.map(a=>[a,a])],settings.asset)}</select></label><label for="event-heatmap-time">Time to analyze<select id="event-heatmap-time" data-heatmap-setting="time">${options([['action','Reported action time'],['start','Outage / event column only'],['restoration','Restoration column only']],settings.time)}</select></label><label for="event-heatmap-date">Weekday / date basis<select id="event-heatmap-date" data-heatmap-setting="date">${options([['report','Workbook report date'],['rollover','08:00 rollover hypothesis']],settings.date)}</select></label><label for="event-heatmap-value">Cell values<select id="event-heatmap-value" data-heatmap-setting="value">${options([['count','Raw entry counts'],['rate','Entries per day with available logs'],['share','% within each category']],settings.value)}</select></label></div><p class="note">Asset scope is inferred from source wording. Reported action time uses the outage/event column, or the restoration column for restoration, synchronization, switching and commissioning entries without an event time. No outage start is inferred from a restoration-only field. Date basis affects dates in cell evidence; category/hour totals are unchanged. The optional rollover assigns times before 08:00 to the next day as a hypothesis, not a confirmed event date.</p></details><div class="event-heatmap-heading"><h3>Category × hour · ${escape(unit)}</h3><span>0 <i></i> ${valueText(max)}${settings.value==='share'?'%':''}</span></div><p class="event-explorer-coverage">Bangladesh time · 08 means 08:00–08:59. Click a cell for its full source entries. Counts include all matching notifications, including duplicates and generation summaries; they are not unique incidents.</p><div class="table-wrap event-heatmap-scroll" tabindex="0" role="region" aria-label="Category by hour heatmap"><table class="event-heatmap"><caption class="visually-hidden">Operational log entries by category and hour of day, ${escape(unit)}</caption><thead><tr><th scope="col">Category</th>${Array.from({length:24},(_,h)=>`<th scope="col">${String(h).padStart(2,'0')}</th>`).join('')}<th scope="col">Timed total</th></tr></thead><tbody>${model.rows.map(row=>`<tr><th scope="row">${escape(row.label)}</th>${row.values.map((value,h)=>{
      if(value===null)return '<td class="event-heatmap-na">—</td>';
      const t=max?value/max:0,color=value===0?'#f1f4ed':`rgb(${Math.round(225-203*t)},${Math.round(239-135*t)},${Math.round(219-128*t)})`;
      return `<td><button type="button" data-heatmap-category="${row.id}" data-heatmap-hour="${h}" style="background:${color};color:${t>.58?'#fff':'#18392f'}" aria-label="${escape(row.label)}, ${String(h).padStart(2,'0')}:00, ${row.counts[h]} entries" title="${escape(row.label)} · ${String(h).padStart(2,'0')}:00 · ${row.counts[h]} entries · ${valueText(value)} ${escape(unit)}">${valueText(value)}</button></td>`;
    }).join('')}<td>${row.total}</td></tr>`).join('')}</tbody></table></div><p class="event-explorer-coverage">Scale: 0–${valueText(max)}${settings.value==='share'?'%':''}, recalculated for this selection. Missing logs are excluded from per-day rates; reported empty logs contribute zeros. These are descriptive patterns, not estimates of outage probability.</p><div data-heatmap-evidence><p>Select a cell to inspect its entries.</p></div>`;
    const details=host.querySelector('details');details.addEventListener('toggle',()=>{settings.extraOpen=details.open});
    host.querySelectorAll('[data-heatmap-setting]').forEach(control=>control.addEventListener('change',()=>{
      settings[control.dataset.heatmapSetting]=control.value;settings.extraOpen=details.open;
      const id=control.id;onChange();host.querySelector('#'+id)?.focus({preventScroll:true});
    }));
    let chosen=[],evidencePage=0,caption='';
    const evidence=host.querySelector('[data-heatmap-evidence]');
    function showEvidence(){
      const start=evidencePage*50,visible=chosen.slice(start,start+50);
      evidence.innerHTML=`<h3>${escape(caption)}</h3><p class="event-explorer-coverage" role="status">${chosen.length} entries · ${chosen.length?start+1:0}–${Math.min(start+50,chosen.length)} shown · ${settings.date==='report'?'Workbook report dates':'Inferred dates use the 08:00 rollover hypothesis'}</p><div class="table-wrap event-explorer-scroll"><table><thead><tr><th>Report date / time</th><th>Category</th><th>Full source description</th></tr></thead><tbody>${visible.map(row=>`<tr><td class="event-explorer-time">${escape(row.date)}<br>${escape(row.outage_time||'—')} – ${escape(row.restoration_time||'—')}${row.assigned_date!==row.date?`<br>Assigned: ${escape(row.assigned_date)}`:''}</td><td>${escape(categories.find(c=>c[0]===row.category)?.[1]||row.category)}</td><td class="remarks">${escape(row.description)}</td></tr>`).join('')||'<tr><td colspan="3">No entries in this cell.</td></tr>'}</tbody></table></div><div class="event-explorer-pages"><button type="button" data-heatmap-page="previous"${evidencePage===0?' disabled':''}>Previous entries</button><span>Page ${evidencePage+1} of ${Math.max(1,Math.ceil(chosen.length/50))}</span><button type="button" data-heatmap-page="next"${start+50>=chosen.length?' disabled':''}>Next entries</button></div>`;
    }
    host.querySelector('.event-heatmap-scroll').addEventListener('click',event=>{
      const cell=event.target.closest('[data-heatmap-category]');if(!cell)return;
      chosen=model.observations.filter(row=>row.category===cell.dataset.heatmapCategory&&row.hour===Number(cell.dataset.heatmapHour));evidencePage=0;
      caption=(categories.find(c=>c[0]===cell.dataset.heatmapCategory)?.[1]||'Category')+' · '+String(cell.dataset.heatmapHour).padStart(2,'0')+':00–'+String(cell.dataset.heatmapHour).padStart(2,'0')+':59';
      showEvidence();
    });
    evidence.addEventListener('click',event=>{const button=event.target.closest('[data-heatmap-page]');if(!button)return;evidencePage+=button.dataset.heatmapPage==='next'?1:-1;showEvidence()});
  }
  root.BEGDEventHeatmap={defaults:()=>({...DEFAULTS}),assetScope,timed,matrix,render};
})(window);
