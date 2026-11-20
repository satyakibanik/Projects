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
  const phone=root.matchMedia?.('(max-width:600px)');
  let renderCurrent=null;
  phone?.addEventListener('change',()=>renderCurrent?.());
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
  // Shared by the daily Operations views so category wording stays consistent.
  const categoryLabel=description=>labels[classify(description)]||labels.review;
  function clockMinutes(value){
    const match=/^(\d{2}):(\d{2})$/.exec(String(value));
    if(!match)return null;
    const hour=Number(match[1]),minute=Number(match[2]);
    return minute<60&&(hour<24||(hour===24&&minute===0))?hour*60+minute:null;
  }
  function selectWindow(bundle,count,endDate){
    const fullArchive=count==='10y';
    if(!fullArchive&&(!endDate||![7,30,60,90,365].includes(Number(count))))return {rows:[],available:0};
    const end=fullArchive?null:Date.parse(endDate+'T00:00:00Z'),start=fullArchive?null:end-(count-1)*86400000;
    const days=fullArchive?bundle.days:bundle.days.filter(day=>{
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
  function categoryOptions(rows,search,selected){
    const matches=filterRows(rows,search,'');
    const counts=new Map(CATEGORIES.map(([id])=>[id,0]));
    matches.forEach(row=>counts.set(row.category,(counts.get(row.category)||0)+1));
    return `<option value="">All categories (${matches.length.toLocaleString('en-US')})</option>${CATEGORIES.map(([id,label])=>`<option value="${id}"${selected===id?' selected':''}>${escape(label)} (${counts.get(id)||0})</option>`).join('')}`;
  }
  function shell(){
    return `<section class="panel full operational-event-explorer" aria-labelledby="operational-event-heading"><div class="panel-head"><div><h2 id="operational-event-heading">Operational Event Explorer (logs)</h2><p>P1 event log · Bangladesh time (Asia/Dhaka)</p></div></div><div class="event-explorer-tabs" role="tablist" aria-label="Operational event explorer views"><button type="button" role="tab" data-event-explorer-view="logs" aria-controls="event-explorer-logs" aria-selected="${view==='logs'}">Logs</button><button type="button" role="tab" data-event-explorer-view="heatmap" aria-controls="event-explorer-heatmap" aria-selected="${view==='heatmap'}">Category × hour</button></div><p class="note">Dates identify the operating report; start and end retain the workbook’s outage/event and restoration fields. A dash means no time was reported. After-midnight entries can refer to the following day. Categories follow the wording; generic shutdowns stay unspecified.</p><div class="event-explorer-filters"><label for="operational-event-search" data-event-search-field>Search description<input id="operational-event-search" type="search" placeholder="Search full source descriptions" value="${escape(query)}"></label><label for="operational-event-category" data-event-category-field>Category<select id="operational-event-category">${categoryOptions([],query,category)}</select></label></div><p class="note" role="status" aria-live="polite" data-event-result></p><div id="event-explorer-logs" role="tabpanel"><form class="event-date-jump" aria-label="Jump to log date"><label>Year <select data-event-jump-year disabled><option value="">Select year</option></select></label><label>Month <select data-event-jump-month disabled><option value="">Any month</option></select></label><label>Day <select data-event-jump-day disabled><option value="">Any day</option></select></label><button type="submit" disabled>Go to date</button></form><div class="table-wrap event-explorer-scroll" tabindex="0" role="region" aria-label="Operational event log table"><table><thead><tr><th scope="col">Date / time (start–end)</th><th scope="col">Category</th><th scope="col">Full source description</th></tr></thead><tbody data-event-rows></tbody></table></div><div class="event-explorer-pages" role="group" aria-label="Event log pages"><button type="button" data-event-start>To start</button><button type="button" data-event-prev><span aria-hidden="true">← </span>Previous</button><span data-event-page aria-live="polite"></span><button type="button" data-event-next>Next<span aria-hidden="true"> →</span></button><button type="button" data-event-end>To end</button></div></div><div id="event-explorer-heatmap" role="tabpanel" hidden></div></section>`;
  }
  async function load(){
    if(data)return data;
    if(!pending)pending=fetch('operational-events.json',{cache:'no-store'}).then(response=>{
      if(!response.ok)throw Error('Event logs unavailable');return response.json();
    }).then(result=>{if(result.version!==1||!Array.isArray(result.days))throw Error('Invalid event log bundle');data=result;error=null;return data}).catch(reason=>{error=reason}).finally(()=>{pending=null});
    return pending;
  }
  async function mount(host,count,endDate){
    if(!host||(count!=='10y'&&(![7,30,60,90,365].includes(Number(count))||!endDate)))return;
    const key=String(count)+'|'+endDate;if(key!==windowKey){page=0;windowKey=key}
    host.innerHTML=shell();
    if(count==='10y'){
      const dates=host.querySelector('.operational-event-explorer > .note');
      dates.append(' The daily log archive has its own coverage, separate from the monthly Operations reports.');
    }
    const search=host.querySelector('#operational-event-search'),select=host.querySelector('#operational-event-category');
    const tbody=host.querySelector('[data-event-rows]'),status=host.querySelector('[data-event-result]');
    const pager=host.querySelector('.event-explorer-pages');
    const first=pager.querySelector('[data-event-start]'),last=pager.querySelector('[data-event-end]');
    const previous=pager.querySelector('[data-event-prev]'),next=pager.querySelector('[data-event-next]'),pageLabel=pager.querySelector('[data-event-page]');
    const jump=host.querySelector('.event-date-jump');
    const year=jump.querySelector('[data-event-jump-year]');
    const month=jump.querySelector('[data-event-jump-month]');
    const day=jump.querySelector('[data-event-jump-day]');
    const go=jump.querySelector('button');
    const monthName=new Intl.DateTimeFormat('en',{month:'short',timeZone:'UTC'});
    let lastPage=0,dateIndexes=new Map();

    function updateJumpOptions(){
      function options(control,values,placeholder,label=value=>value){
        const current=control.value;
        control.replaceChildren(new Option(placeholder,''),...values.map(value=>new Option(label(value),value)));
        if(values.includes(current))control.value=current;
        control.disabled=!values.length;
      }
      const dates=[...dateIndexes.keys()];
      options(year,[...new Set(dates.map(date=>date.slice(0,4)))],'Select year');
      const yearDates=year.value?dates.filter(date=>date.startsWith(year.value+'-')):[];
      options(month,[...new Set(yearDates.map(date=>date.slice(5,7)))],'Any month',
        value=>monthName.format(new Date('2000-'+value+'-01T00:00:00Z')));
      options(day,month.value?yearDates.filter(date=>date.slice(5,7)===month.value).map(date=>date.slice(8)) : [],'Any day');
      go.disabled=!year.value;
    }

    year.addEventListener('change',()=>{
      month.value='';
      day.value='';
      updateJumpOptions();
    });
    month.addEventListener('change',()=>{
      day.value='';
      updateJumpOptions();
    });
    jump.addEventListener('submit',event=>{
      event.preventDefault();
      if(!year.value)return;
      const prefix=[year.value,month.value,day.value].filter(Boolean).join('-');
      const entry=[...dateIndexes].find(([date])=>date.startsWith(prefix));
      if(!entry)return;
      const index=entry[1];
      goToPage(Math.floor(index/PAGE_SIZE));
      tbody.rows[index%PAGE_SIZE]?.scrollIntoView({block:'nearest'});
    });
    function render(){
      if(!host.isConnected)return;
      if(phone?.matches)view='logs';
      host.querySelector('#event-explorer-logs').hidden=view!=='logs';
      host.querySelector('#event-explorer-heatmap').hidden=view!=='heatmap';
      host.querySelector('.event-explorer-filters').hidden=view!=='logs';
      host.querySelector('[data-event-search-field]').hidden=view!=='logs';
      host.querySelector('[data-event-category-field]').hidden=view!=='logs';
      host.querySelectorAll('[data-event-explorer-view]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.eventExplorerView===view)));
      if(!data){
        status.textContent=error?'Operational event logs could not be loaded.':'Loading operational event logs…';
        tbody.innerHTML='<tr><td colspan="3" class="empty">'+(error?'Event log data is unavailable.':'Loading…')+'</td></tr>';
        first.disabled=previous.disabled=next.disabled=last.disabled=true;pageLabel.textContent='';
        if(error){const retry=document.createElement('button');retry.type='button';retry.textContent='Retry event logs';retry.addEventListener('click',async()=>{error=null;render();await load();render()});status.append(' ',retry)}
        return;
      }
      const window=selectWindow(data,count,endDate);
      select.innerHTML=categoryOptions(window.rows,query,category);
      const matches=filterRows(window.rows,query,category);
      dateIndexes=new Map();
      matches.forEach((row,index)=>{
        if(!dateIndexes.has(row.date))dateIndexes.set(row.date,index);
      });
      updateJumpOptions();
      lastPage=Math.max(0,Math.ceil(matches.length/PAGE_SIZE)-1);
      page=Math.max(0,Math.min(page,lastPage));
      const start=page*PAGE_SIZE,visible=matches.slice(start,start+PAGE_SIZE);
      const coverage=count==='10y'
        ? `${window.available} days with P1 logs in the local archive`
        : `${window.available} / ${count} days with P1 logs`;
      status.textContent=`${matches.length.toLocaleString('en-US')} of ${window.rows.length.toLocaleString('en-US')} entries match · ${matches.length?start+1:0}–${Math.min(start+PAGE_SIZE,matches.length)} shown · ${coverage}`;
      tbody.innerHTML=rowsHTML(visible)||(window.available?' <tr><td colspan="3" class="empty">No entries match these filters.</td></tr>':'<tr><td colspan="3" class="empty">No P1 event logs are available for this window.</td></tr>');
      first.disabled=previous.disabled=page===0;
      last.disabled=next.disabled=page===lastPage;
      pageLabel.textContent=`Page ${page+1} of ${lastPage+1}`;
      if(view==='heatmap'){
        status.textContent='';
        root.BEGDEventHeatmap?.render(host.querySelector('#event-explorer-heatmap'),window.rows,window.available,heatSettings,CATEGORIES,render);
      }
    }
    renderCurrent=render;
    host.querySelectorAll('[data-event-explorer-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.eventExplorerView;render()}));
    host.querySelector('[role="tablist"]').addEventListener('keydown',event=>{
      if(phone?.matches)return;
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();view=event.key==='Home'?'logs':event.key==='End'?'heatmap':view==='logs'?'heatmap':'logs';render();
      host.querySelector('[data-event-explorer-view="'+view+'"]').focus();
    });
    search.addEventListener('input',()=>{query=search.value;page=0;render()});
    select.addEventListener('change',()=>{category=select.value;page=0;render()});
    function goToPage(target){
      const nextPage=Math.max(0,Math.min(target,lastPage));
      if(nextPage===page)return;
      const focused=document.activeElement;
      page=nextPage;
      render();
      host.querySelector('.event-explorer-scroll').scrollTop=0;
      if(pager.contains(focused)&&focused.disabled){
        (page===0?next:previous).focus({preventScroll:true});
      }
    }
    first.addEventListener('click',()=>goToPage(0));
    previous.addEventListener('click',()=>goToPage(page-1));
    next.addEventListener('click',()=>goToPage(page+1));
    last.addEventListener('click',()=>goToPage(lastPage));
    pager.addEventListener('keydown',event=>{
      const targets={ArrowLeft:page-1,ArrowRight:page+1,Home:0,End:lastPage};
      if(!Object.hasOwn(targets,event.key))return;
      event.preventDefault();
      goToPage(targets[event.key]);
    });
    render();if(!data&&!error){await load();render()}
  }
  root.BEGDOperationalEvents={mount,classify,categoryLabel,selectWindow,filterRows,rowsHTML,clockMinutes};
})(window);
