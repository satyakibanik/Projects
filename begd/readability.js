/* Readable type scale shared with the local typography study.
 * Text roles are assigned to new render output; SVG labels retain a 13px screen size.
 * Notes stay in their original panel with their IDs and event listeners intact.
 */
(()=>{'use strict';
function roleFor(el,doc,nativeSize){
 if(el.closest('.brand-acronym'))return 'micro';
 if(el.closest('.brand-title'))return 'brand';
 if(el.closest('.news-card h2'))return el.closest('[lang="bn"]')?'bangla':'article';
 if(el.closest('.hero h1'))return 'hero';
 if(el.closest('h1'))return 'title';
 if(el.closest('.nav-caption span'))return 'subheading';
 if(el.closest('.context-reading.region-names'))return 'body';
 if(el.closest('.composition-key strong,.context-reading strong,.bpdb-cost-summary strong'))return el.matches('strong')?'reading':'small';
 if(el.closest('.dashboard-link .link-label'))return 'subheading';
 if(el.closest('.metric .value'))return el.matches('.value')?'metric':'small';
 if(el.closest('h2'))return 'heading';
 if(el.closest('.realtime-dispatch-plots>h3'))return 'heading';
 if(el.closest('h3,h4,h5,h6'))return 'subheading';
 if(el.namespaceURI==='http://www.w3.org/2000/svg')return 'chart';
 if(el.closest('table'))return 'table';
 if(el.closest('.tag,.section-number,.eyebrow,.nav-test-badge,.news-new,.unit,.chart-unit,.brand small,.scope-number'))return 'micro';
 if(el.closest('button,input,select,textarea,label,nav a,.chart-legend,.chart-selector,.region-key-item,summary'))return 'controls';
 if(el.closest('.note,small,.panel-head p,.chart-help,.header-meta,.header-location,.report-date-context,.bangladesh-clock,.data-updated,.metric .label,.news-meta,.news-freshness,.news-count,.news-group-help,.context-reading span,.region-map-reading span,.region-map-kicker,.trends-status,.trends-note,footer,.site-footer,.entry-note'))return 'small';
 if(el.closest('.more-information'))return 'small';
 if(el.closest('p,li,blockquote,.hero-description'))return 'body';
 if(nativeSize<=12)return 'small';if(nativeSize>=30)return 'metric';return 'body';
}
function textElements(doc){return [...doc.querySelectorAll('body *')].filter(el=>!el.closest('script,style,noscript,svg defs,.brand-logo,.mark')&&(el.matches('input,select,textarea')||[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())));}
function svgScale(el){try{const m=el.getScreenCTM();return m?Math.hypot(m.c,m.d)||1:1;}catch{return 1;}}

const noteSelector='.note,.information-note,.chart-help,.vb-method,.bpdb-fit-note,.trends-coverage,.plant-metric-date,.plant-map-attribution,.dispatch-bottom,.panel-head p,.vb-chart-heading p,.mae-caption,figcaption';
const informationPanel='.forecast-subplot,.vb-combined,.plant-detail,.panel,.dispatch-main,.energy-band';
function collapseNotes(){
 const groups=new Map();
 for(const note of document.querySelectorAll('#content '+noteSelector.split(',').join(',#content '))){
  const panel=note.closest(informationPanel);
  const disclosure=note.closest('details:not(.more-information)');
  // Top-level sources, comparison controls, errors and live status stay visible.
  if(!panel||note.closest('[role="status"],[role="alert"],.chart-tooltip,.plant-tooltip,.trends-tooltip')||(disclosure&&!disclosure.classList.contains('panel'))||!note.textContent.trim())continue;
  if(/^(no |unavailable|unable |loading|failed|missing )/i.test(note.textContent.trim()))continue;
  if(note.parentElement.closest(noteSelector)&&note.parentElement.closest(noteSelector)!==panel)continue;
  if(!groups.has(panel))groups.set(panel,[]);
  groups.get(panel).push(note);
 }
 for(const [panel,notes] of groups){
  let details=[...panel.children].find(el=>el.classList.contains('more-information'));
  if(!details){details=document.createElement('details');details.className='more-information';const summary=document.createElement('summary');summary.textContent='More information';details.append(summary);panel.append(details);}
  const hints=new Set();
  for(const note of notes){
   const text=note.textContent.trim();
   if(note.matches('.chart-help')&&!note.id){if(hints.has(text)){note.remove();continue;}hints.add(text);}
   note.classList.add('information-note');if(note.parentElement!==details)details.append(note);
  }
 }
 // Renderers can replace or clear a chart's notes. Never leave a blank disclosure.
 for(const details of document.querySelectorAll('#content .more-information')){
  const children=[...details.children].filter(el=>el.tagName!=='SUMMARY');
  if(!children.some(el=>el.textContent.trim()&&!el.matches('.chart-touch-help,[hidden]'))){
   for(const child of children)details.before(child);
   details.remove();
  }
 }
}
const nativeSizes=new WeakMap();
function refresh(){
 observer.disconnect();
 try{
 collapseNotes();
 const elements=textElements(document);
 // Batch reads before writes to avoid a forced layout for every table cell or map label.
 const assignments=elements.map(el=>{if(!nativeSizes.has(el))nativeSizes.set(el,parseFloat(getComputedStyle(el).fontSize));return [el,roleFor(el,document,nativeSizes.get(el))];});
 for(const [el,role] of assignments)if(el.dataset.textRole!==role)el.dataset.textRole=role;
 const labels=assignments.filter(([,role])=>role==='chart').map(([el])=>[el,(13/svgScale(el)).toFixed(3)+'px']);
 for(const [el,size] of labels)if(el.style.getPropertyValue('--readable-svg-size')!==size)el.style.setProperty('--readable-svg-size',size);

 }finally{observer.observe(document.body,{childList:true,subtree:true});}
}
let queued=false;
function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;refresh();});}
const observer=new MutationObserver(records=>{if(records.every(r=>r.target.closest?.('#bangladesh-clock')))return;schedule();});
let previousWidth=0;new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(width!==previousWidth){previousWidth=width;schedule();}}).observe(document.documentElement);
window.addEventListener('resize',schedule);
document.addEventListener('toggle',schedule,true);
document.fonts?.ready.then(schedule);
refresh();
})();
