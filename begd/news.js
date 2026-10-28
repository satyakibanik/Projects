(function(){
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let bundle,pending,query='',language='all',publisher='',group='',page=1;
 const dateLabel=date=>new Date(date+'T12:00:00+06:00').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Dhaka'});
 const sourceName=a=>({'BSS':'Bangladesh Sangbad Sangstha','UNB':'United News of Bangladesh'}[a.source]||a.source);
 const postingLabel=a=>a.publication_time_verified&&a.published_at?new Date(a.published_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'Asia/Dhaka'})+' BST':'';
 const isNew=(a,now=Date.now())=>{if(!a.publication_time_verified||!a.published_at)return false;const age=now-Date.parse(a.published_at);return Number.isFinite(age)&&age>=0&&age<86400000;};
 const chronological=(a,b)=>b.date.localeCompare(a.date)||(b.publication_time_verified?b.published_at:'').localeCompare(a.publication_time_verified?a.published_at:'')||a.id.localeCompare(b.id,undefined,{numeric:true});
 const refreshLabel=value=>new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Dhaka',hour12:true});
 function collectionStatus(data){
  const latest=data.last_successful_refresh_at?refreshLabel(data.last_successful_refresh_at):dateLabel(data.last_successful_refresh_date||data.curated_on);
  if(data.refresh_mode!=='automatic')return `<strong>Last successful refresh: ${esc(latest)}</strong> · Saved catalog · Automatic collection off. All times BST. Catalog coverage is not exhaustive.`;
  const feeds=data.feed_status||[],ok=feeds.filter(feed=>feed.status==='ok').length;
  const status=data.collection_status==='failed'?'Collection failed; keeping saved coverage':data.collection_status==='partial'?'Partial collection':'Collection successful';
  return `<strong>Last successful refresh: ${esc(latest)}</strong> · ${status}${feeds.length?` · ${ok}/${feeds.length} feeds checked`:''} · Automatic collection every build (scheduled every 15 minutes).${data.last_attempt_at?` Last attempt: ${esc(refreshLabel(data.last_attempt_at))}.`:''} All times BST. Coverage is not exhaustive.`;
 }
 function newsGroups(data){
  const counts=new Map();data.articles.forEach(a=>counts.set(a.event,(counts.get(a.event)||0)+1));
  return [...counts.keys()].filter(key=>!key.startsWith('auto-')||counts.get(key)>1);
 }
 async function mount(){
 document.body.classList.add('news-view');
 document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash==='#news'));
 document.querySelector('#title').textContent='Grid news';
 document.querySelector('#subtitle').textContent='Bangladesh’s power sector · Latest coverage first';
 ['report-date-controls','date-status','day-sources','error'].forEach(id=>document.getElementById(id).hidden=true);
 document.querySelector('.header-meta .status').textContent='NEWS · TEST';
 document.querySelector('.method').hidden=true;
 if(!bundle){document.querySelector('#content').innerHTML='<p role="status">Loading news…</p>';try{pending ||= fetch('news-data.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('News file unavailable');return r.json()});bundle=await pending;if(!Array.isArray(bundle?.articles)||!bundle.curated_on)throw Error('Invalid news catalog');}catch(e){pending=null;bundle=null;if(location.hash!=='#news')return;document.querySelector('#content').textContent='Could not load news. Reload to retry.';return;}}
 if(location.hash!=='#news')return;
 document.querySelector('#content').innerHTML=`<div class="news-lab"><div class="news-tools"><label class="news-search">Search news<input id="news-query" type="search" placeholder="Search headlines, summaries, or sources" value="${esc(query)}"></label><label>Publisher<select id="news-publisher"><option value="">All publishers</option>${[...new Set(bundle.articles.map(sourceName))].sort((a,b)=>a.localeCompare(b)).map(name=>`<option value="${esc(name)}" ${name===publisher?'selected':''}>${esc(name)}</option>`).join('')}</select></label><label>News group<select id="news-group" aria-describedby="news-group-help"><option value="">All news groups</option>${newsGroups(bundle).sort((a,b)=>(bundle.event_labels[a]||a).localeCompare(bundle.event_labels[b]||b)).map(key=>`<option value="${esc(key)}" ${key===group?'selected':''}>${esc(bundle.event_labels[key]||key)}</option>`).join('')}</select></label><div class="news-language" role="group" aria-label="Article language">${[['all','All'],['en','English'],['bn','বাংলা']].map(([key,label])=>`<button type="button" data-news-language="${key}" aria-pressed="${key===language}">${label}</button>`).join('')}</div><button type="button" id="news-reset" class="news-reset">Reset</button></div><p id="news-group-help" class="news-group-help">Existing groups are curated around the same story. Automatically collected articles are grouped only when headlines closely match within three days.</p><p class="news-freshness" role="status">${collectionStatus(bundle)}</p><div id="news-results" aria-live="polite"></div></div>`;
 document.querySelector('#news-query').addEventListener('input',e=>{query=e.target.value;page=1;results()});
 document.querySelectorAll('[data-news-language]').forEach(button=>button.addEventListener('click',()=>{language=button.dataset.newsLanguage;page=1;updateLanguage();results();}));
 document.querySelector('#news-publisher').addEventListener('change',e=>{publisher=e.target.value;page=1;results()});
 document.querySelector('#news-group').addEventListener('change',e=>{group=e.target.value;page=1;results()});
 document.querySelector('#news-reset').addEventListener('click',()=>{query='';language='all';publisher='';group='';page=1;document.querySelector('#news-query').value='';updateLanguage();document.querySelector('#news-publisher').value='';document.querySelector('#news-group').value='';results();});results();
 }
 function updateLanguage(){document.querySelectorAll('[data-news-language]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.newsLanguage===language)));}
 function results(){
 const inWindow=bundle.articles.slice().sort(chronological);
 const search=query.trim().toLowerCase();
 const rows=inWindow.filter(a=>(language==='all'||a.language===language)&&(!publisher||sourceName(a)===publisher)&&(!group||a.event===group)&&`${a.title} ${sourceName(a)} ${a.summary}`.toLowerCase().includes(search));
 const pages=Math.max(1,Math.ceil(rows.length/20));page=Math.min(page,pages);const offset=(page-1)*20,visible=rows.slice(offset,offset+20);
 document.querySelector('#news-results').innerHTML=`<p class="news-count">${rows.length?offset+1:0}–${Math.min(offset+20,rows.length)} of ${rows.length} articles</p>`+(rows.length?visible.map(a=>{
 const related=inWindow.filter(other=>other.event===a.event&&other.id!==a.id&&(language==='all'||other.language===language));
 return `<article class="news-card${isNew(a)?' news-card-new':''}" lang="${a.language==='bn'?'bn':'en'}"><div class="news-meta">${isNew(a)?'<span class="news-new" title="Published less than 24 hours ago">New</span>':''}<span>${esc(sourceName(a))}</span><span aria-hidden="true">·</span><time datetime="${esc(a.published_at||a.date)}">${dateLabel(a.date)}${postingLabel(a)?` · ${postingLabel(a)}`:` · ${a.language==='bn'?'প্রকাশের সময় পাওয়া যায়নি':'Posting time unavailable'}`}</time></div><h2><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title)} <span aria-hidden="true">↗</span></a></h2><p>${esc(a.summary)}</p>${related.length?`<details class="news-related"><summary>Related articles (${related.length}) <span>· ${esc(bundle.event_labels[a.event]||'Same story')}</span></summary><ul>${related.map(r=>`<li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)} ↗</a><small>${esc(sourceName(r))} · ${dateLabel(r.date)}${postingLabel(r)?` · ${postingLabel(r)}`:''}</small></li>`).join('')}</ul></details>`:''}</article>`;
 }).join(''):'<div class="news-empty"><h2>No matching articles</h2><p>Try another language, another search, or fewer filters.</p></div>')+`<div class="news-pagination" role="navigation" aria-label="News pages"><button type="button" data-news-page="${page-1}" ${page===1?'disabled':''} aria-label="Previous news page">Previous</button>${Array.from({length:pages},(_,i)=>`<button type="button" data-news-page="${i+1}" ${i+1===page?'aria-current="page"':''} aria-label="News page ${i+1}">${i+1}</button>`).join('')}<button type="button" data-news-page="${page+1}" ${page===pages?'disabled':''} aria-label="Next news page">Next</button></div>`;
 document.querySelectorAll('[data-news-page]').forEach(button=>button.addEventListener('click',()=>{page=Number(button.dataset.newsPage);results();document.querySelector('.news-tools').scrollIntoView({block:'start'});}));
 }
 let checkingCatalog=false;
 async function refreshCatalog(){
  if(location.hash!=='#news'||!bundle||checkingCatalog)return;
  checkingCatalog=true;
  try{
   const response=await fetch('news-data.json',{cache:'no-store'});if(!response.ok)return;
   const next=await response.json();
   if(!Array.isArray(next?.articles)||!next.curated_on||!next.last_attempt_at||!Number.isFinite(Date.parse(next.last_attempt_at))||Date.parse(next.last_attempt_at)<=Date.parse(bundle.last_attempt_at||'1970-01-01'))return;
   bundle=next;if(location.hash==='#news')await mount();
  }catch(e){/* Keep the displayed catalog if the next deployment cannot be fetched. */}
  finally{checkingCatalog=false;}
 }
 setInterval(refreshCatalog,180000);
 window.BEGDNews={mount,isNew,chronological,postingLabel,collectionStatus,newsGroups,refreshCatalog};
 // News does not depend on the workbook API being available.
 if(location.hash==='#news')mount();
 setInterval(()=>{if(location.hash==='#news'&&bundle){document.querySelectorAll('.news-new').forEach(badge=>{const time=badge.closest('.news-card').querySelector('time').dateTime;const age=Date.now()-Date.parse(time);if(!Number.isFinite(age)||age<0||age>=86400000){badge.closest('.news-card').classList.remove('news-card-new');badge.remove();}});}},60000);window.addEventListener('hashchange',()=>{if(location.hash!=='#news'){document.querySelector('.method').hidden=false;document.body.classList.remove('news-view');}});
})();
