/* P1 event evidence for recent trend windows; loaded independently of chart data. */
(function(root){
  const CATEGORIES=[
    ['scheduled','Scheduled Shutdown (S/D)'],['trip','Tripped (Automatic Trip)'],
    ['forced','Forced Shutdown'],['restored','Restored'],['shutdown','Shutdown'],
    ['synchronized','Synchronized'],['project','Project-work Shutdown'],
    ['commissioning','First Energization / Commissioning'],['switching','Switched On / Energization'],
    ['fgmo','FGMO Mode Change'],['generation','Generation Summary'],
    ['interruption','Supply Interruption'],['review','Unclassified / Source Fragment']
  ];
  const labels=Object.fromEntries(CATEGORIES),PAGE_SIZE=50;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data=null,pending=null,error=null,query='',category='',page=0,windowKey='',view='logs';
  const heatSettings=root.BEGDEventHeatmap?.defaults();
  function classify(description){
    const text=String(description||'');
    const action=text.split(/\bdue to\b|\bshowing\b|\bwith remarks\b/i)[0];
    const rules=[
      ['fgmo',/\bFGMO\s+is\s+(?:ON|OFF)\b/i],
      ['generation',/\b(?:peak|minimum)\s+generation\b/i,text],
      ['interruption',/\b(?:full(?: load)? interruption|\d+\s*MW interruption)\b/i,text],
      ['commissioning',/\bfirst time\b/i,text],
      ['forced',/\bforced\s+(?:s\s*\/\s*d|shut\s*down)\b/i],
      ['scheduled',/\b(?:scheduled|planned)\s+(?:s\s*\/\s*d|shut\s*down)\b/i],
      ['project',/\bproject\s+work\s+s\s*\/\s*d\b/i],
      ['restored',/\brestor(?:ed|ation)\b/i],
      ['synchronized',/\b(?:synchroni[sz]ed|syn)\b/i],
      ['trip',/\btripped\b|\btrip\b/i],
      ['switching',/\bswitched\s+on\b|\benergi[sz]ed\b|\bcharged\b/i],
      ['shutdown',/\bshut\s*down\b|\bs\s*\/\s*d\b/i]
    ];
    return rules.find(([,pattern,source])=>pattern.test(source??action))?.[0]||'review';
  }
  function clockMinutes(value){
    const match=/^(\d{2}):(\d{2})$/.exec(String(value));
    if(!match)return null;
    const hour=Number(match[1]),minute=Number(match[2]);
    return minute<60&&(hour<24||(hour===24&&minute===0))?hour*60+minute:null;
  }
  function selectWindow(bundle,count,endDate){
    if(!endDate||![30,60,90,365].includes(Number(count)))return {rows:[],available:0};
    const end=Date.parse(endDate+'T00:00:00Z'),start=end-(count-1)*86400000;
    const days=bundle.days.filter(day=>{
      const time=Date.parse(day.date+'T00:00:00Z');return time>=start&&time<=end;
    });
    const rows=days.flatMap(day=>Array.isArray(day.events)?day.events.map((event,index)=>({...event,date:day.date,report_id:day.report_id,source_url:day.source_url,index,category:classify(event.description)})):[]);
    rows.sort((a,b)=>b.date.localeCompare(a.date)||
      (clockMinutes(a.outage_time)??clockMinutes(a.restoration_time)??Infinity)-(clockMinutes(b.outage_time)??clockMinutes(b.restoration_time)??Infinity)||a.index-b.index);
    return {rows,available:days.filter(day=>Array.isArray(day.events)).length};
  }
  function filterRows(rows,search,selected){
    const needle=String(search||'').trim().toLocaleLowerCase();
    return rows.filter(row=>(!selected||row.category===selected)&&(!needle||String(row.description).toLocaleLowerCase().includes(needle)));
  }
  function rowsHTML(rows){
    return rows.map(row=>{
      const date=escape(row.date);
      return `<tr><td class="event-explorer-time">${date}<br><span>${escape(row.outage_time||'—')} – ${escape(row.restoration_time||'—')}</span></td><td>${escape(labels[row.category]||labels.review)}</td><td class="remarks">${escape(row.description)}</td></tr>`;
    }).join('');
  }
  function shell(){
    return `<section class="panel full operational-event-explorer" aria-labelledby="operational-event-heading"><div class="panel-head"><div><h2 id="operational-event-heading">Operational Event Explorer (logs)</h2><p>P1 event log · Bangladesh time (Asia/Dhaka)</p></div></div><div class="event-explorer-tabs" role="tablist" aria-label="Operational event explorer views"><button type="button" role="tab" data-event-explorer-view="logs" aria-controls="event-explorer-logs" aria-selected="${view==='logs'}">Logs</button><button type="button" role="tab" data-event-explorer-view="heatmap" aria-controls="event-explorer-heatmap" aria-selected="${view==='heatmap'}">Category × hour</button></div><p class="note">Dates identify the operating report; start and end retain the workbook’s outage/event and restoration fields. A dash means no time was reported. After-midnight entries can refer to the following day. Categories follow the wording; generic shutdowns stay unspecified.</p><div class="event-explorer-filters"><label for="operational-event-search" data-event-search-field>Search description<input id="operational-event-search" type="search" placeholder="Search full source descriptions" value="${escape(query)}"></label><label for="operational-event-category" data-event-category-field>Category<select id="operational-event-category"><option value="">All categories</option>${CATEGORIES.map(([id,label])=>`<option value="${id}"${category===id?' selected':''}>${escape(label)}</option>`).join('')}</select></label></div><p class="note" role="status" aria-live="polite" data-event-result></p><div id="event-explorer-logs" role="tabpanel"><div class="table-wrap event-explorer-scroll" tabindex="0" role="region" aria-label="Operational event log table"><table><thead><tr><th scope="col">Date / time (start–end)</th><th scope="col">Category</th><th scope="col">Full source description</th></tr></thead><tbody data-event-rows></tbody></table></div><div class="event-explorer-pages"><button type="button" data-event-prev>Previous</button><span data-event-page></span><button type="button" data-event-next>Next</button></div></div><div id="event-explorer-heatmap" role="tabpanel" hidden></div></section>`;
  }
  async function load(){
    if(data)return data;
    if(!pending)pending=fetch('operational-events.json',{cache:'no-store'}).then(response=>{
      if(!response.ok)throw Error('Event logs unavailable');return response.json();
    }).then(result=>{if(result.version!==1||!Array.isArray(result.days))throw Error('Invalid event log bundle');data=result;error=null;return data}).catch(reason=>{error=reason}).finally(()=>{pending=null});
    return pending;
  }
  async function mount(host,count,endDate){
    if(!host||![30,60,90,365].includes(Number(count))||!endDate)return;
    const key=String(count)+'|'+endDate;if(key!==windowKey){page=0;windowKey=key}
    host.innerHTML=shell();
    const search=host.querySelector('#operational-event-search'),select=host.querySelector('#operational-event-category');
    const tbody=host.querySelector('[data-event-rows]'),status=host.querySelector('[data-event-result]');
    const previous=host.querySelector('[data-event-prev]'),next=host.querySelector('[data-event-next]'),pageLabel=host.querySelector('[data-event-page]');
    function render(){
      if(!host.isConnected)return;
      host.querySelector('#event-explorer-logs').hidden=view!=='logs';
      host.querySelector('#event-explorer-heatmap').hidden=view!=='heatmap';
      host.querySelector('.event-explorer-filters').hidden=view!=='logs';
      host.querySelector('[data-event-search-field]').hidden=view!=='logs';
      host.querySelector('[data-event-category-field]').hidden=view!=='logs';
      host.querySelectorAll('[data-event-explorer-view]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.eventExplorerView===view)));
      if(!data){
        status.textContent=error?'Operational event logs could not be loaded.':'Loading operational event logs…';
        tbody.innerHTML='<tr><td colspan="3" class="empty">'+(error?'Event log data is unavailable.':'Loading…')+'</td></tr>';
        previous.disabled=true;next.disabled=true;pageLabel.textContent='';
        if(error){const retry=document.createElement('button');retry.type='button';retry.textContent='Retry event logs';retry.addEventListener('click',async()=>{error=null;render();await load();render()});status.append(' ',retry)}
        return;
      }
      const window=selectWindow(data,count,endDate),matches=filterRows(window.rows,query,category);
      page=Math.max(0,Math.min(page,Math.ceil(matches.length/PAGE_SIZE)-1));
      const start=page*PAGE_SIZE,visible=matches.slice(start,start+PAGE_SIZE);
      status.textContent=`${matches.length.toLocaleString('en-US')} of ${window.rows.length.toLocaleString('en-US')} entries match · ${matches.length?start+1:0}–${Math.min(start+PAGE_SIZE,matches.length)} shown`;
      tbody.innerHTML=rowsHTML(visible)||(window.available?' <tr><td colspan="3" class="empty">No entries match these filters.</td></tr>':'<tr><td colspan="3" class="empty">No P1 event logs are available for this window.</td></tr>');
      previous.disabled=page===0;next.disabled=start+PAGE_SIZE>=matches.length;
      pageLabel.textContent=`Page ${page+1} of ${Math.max(1,Math.ceil(matches.length/PAGE_SIZE))}`;
      if(view==='heatmap'){
        status.textContent='';
        root.BEGDEventHeatmap?.render(host.querySelector('#event-explorer-heatmap'),window.rows,window.available,heatSettings,CATEGORIES,render);
      }
    }
    host.querySelectorAll('[data-event-explorer-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.eventExplorerView;render()}));
    host.querySelector('[role="tablist"]').addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();view=event.key==='Home'?'logs':event.key==='End'?'heatmap':view==='logs'?'heatmap':'logs';render();
      host.querySelector('[data-event-explorer-view="'+view+'"]').focus();
    });
    search.addEventListener('input',()=>{query=search.value;page=0;render()});
    select.addEventListener('change',()=>{category=select.value;page=0;render()});
    previous.addEventListener('click',()=>{page=Math.max(0,page-1);render()});
    next.addEventListener('click',()=>{page++;render()});
    render();if(!data&&!error){await load();render()}
  }
  root.BEGDOperationalEvents={mount,classify,selectWindow,filterRows,rowsHTML,clockMinutes};
})(window);
