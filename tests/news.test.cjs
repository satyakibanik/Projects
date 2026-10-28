const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function news(hash='#overview',response){
 const nodes=new Map();const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{hidden:false,textContent:'',innerHTML:'',value:'',addEventListener(){},setAttribute(){}});return nodes.get(selector)};
 const document={body:{classList:{add(){},remove(){}}},querySelector:node,getElementById:node,querySelectorAll:()=>[]};
 const window={addEventListener(){}};
 const context={window,document,location:{hash},setInterval(){},fetch:response||(()=>{throw Error('Unexpected fetch')})};
 vm.runInNewContext(fs.readFileSync(path.join(root,'begd/news.js'),'utf8'),context);
 return {api:window.BEGDNews,nodes,node};
}
test('New uses verified timestamps with strict 24-hour bounds, not publication dates',()=>{
 const {isNew}=news().api,now=Date.parse('2026-10-28T12:00:00+06:00');
 for(const [hours,expected] of [[0,true],[23.999,true],[24,false],[48,false],[-1,false]])assert.equal(isNew({publication_time_verified:true,published_at:new Date(now-hours*3600000).toISOString()},now),expected);
 for(const article of [{date:'2026-10-28'},{published_at:'2026-10-28T11:00:00+06:00'},{publication_time_verified:true,published_at:'bad'}])assert.equal(isNew(article,now),false);
});
test('publication time renders as AM/PM in Bangladesh time and omits unknown time',()=>{
 const {postingLabel}=news().api;assert.equal(postingLabel({publication_time_verified:true,published_at:'2026-10-27T15:05:00Z'}),'9:05 PM BST');assert.equal(postingLabel({date:'2026-10-27'}),'');
});
test('chronology sorts days and known times descending without inventing missing times',()=>{
 const {chronological}=news().api;
 const a=[{id:'1',date:'2026-10-26'},{id:'2',date:'2026-10-27'},{id:'3',date:'2026-10-27',published_at:'2026-10-27T21:05:00+06:00',publication_time_verified:true},{id:'4',date:'2026-10-27',published_at:'2026-10-27T14:00:00+06:00',publication_time_verified:true}];
 assert.deepEqual(a.sort(chronological).map(x=>x.id),['3','4','2','1']);
});
test('news catalog retains unique source-linked articles, explicit languages and valid verified times',()=>{
 const d=JSON.parse(fs.readFileSync(path.join(root,'begd/news-data.json'),'utf8'));
 assert.equal(new Set(d.articles.map(a=>a.id)).size,d.articles.length);assert.equal(new Set(d.articles.map(a=>a.url.replace(/\/$/,''))).size,d.articles.length);
 assert.ok(d.articles.some(a=>a.language==='bn'));assert.ok(d.articles.some(a=>a.language==='en'));
 for(const a of d.articles){assert.match(a.url,/^https:\/\//);assert.ok(a.title&&a.source&&a.summary&&d.event_labels[a.event]);assert.ok(['en','bn'].includes(a.language));assert.ok(a.date>='2026-07-30'&&a.date<='2026-10-27');if(a.publication_time_verified){assert.ok(Number.isFinite(Date.parse(a.published_at)));assert.equal(a.published_at.slice(0,10),a.date);}}
 assert.equal(d.refresh_mode,'saved-catalog');assert.equal(d.coverage_complete,false);
});
test('News TEST appears last after Forecast and a divider',()=>{
 const html=fs.readFileSync(path.join(root,'begd/index.html'),'utf8'),nav=html.match(/<nav aria-label="Dashboard views">([\s\S]*?)<\/nav>/)[1];
 assert.match(nav,/#forecast[\s\S]*?<hr class="nav-section-divider"[^>]*><a href="#news">[\s\S]*?TEST/);
 const links=[...nav.matchAll(/href="#([^"]+)"/g)].map(m=>m[1]);assert.equal(links.at(-1),'news');assert.equal(links.at(-2),'forecast');
});
test('news mounts without a workbook and limits the main feed to 20 cards',async()=>{
 const d=JSON.parse(fs.readFileSync(path.join(root,'begd/news-data.json'),'utf8'));
 const source=fs.readFileSync(path.join(root,'begd/news.js'),'utf8');
 const nodes=new Map();const n=s=>{if(!nodes.has(s))nodes.set(s,{hidden:false,textContent:'',innerHTML:'',addEventListener(){}});return nodes.get(s)};
 const window={addEventListener(){}};
 vm.runInNewContext(source,{window,location:{hash:'#news'},document:{body:{classList:{add(){}}},querySelector:n,getElementById:n,querySelectorAll:()=>[]},setInterval(){},fetch:async()=>({ok:true,json:async()=>d})});
 await window.BEGDNews.mount();
 assert.equal((n('#news-results').innerHTML.match(/<article class="news-card/g)||[]).length,20);
 assert.match(n('#news-results').innerHTML,/News page 5/);assert.match(n('#content').innerHTML,/Last successful refresh/);
});

test('automatic collection status distinguishes partial and failed refreshes',()=>{
 const {collectionStatus,newsGroups}=news().api;
 const base={refresh_mode:'automatic',curated_on:'2026-10-27',last_successful_refresh_at:'2026-10-28T10:00:00+06:00',last_attempt_at:'2026-10-28T10:15:00+06:00',feed_status:[{status:'ok'},{status:'failed'}]};
 assert.match(collectionStatus({...base,collection_status:'partial'}),/Partial collection/);
 assert.match(collectionStatus({...base,collection_status:'partial'}),/1\/2 feeds checked/);
 assert.match(collectionStatus({...base,collection_status:'failed'}),/keeping saved coverage/);
 assert.match(collectionStatus(base),/every build/);assert.doesNotMatch(collectionStatus(base),/Automatic collection off/);
 assert.deepEqual(Array.from(newsGroups({articles:[{event:'auto-single'},{event:'auto-pair'},{event:'auto-pair'},{event:'curated'}]})),['auto-pair','curated']);
});

test('open news tabs replace the catalog only with a newer valid build and retain it on errors',async()=>{
 const seed=JSON.parse(fs.readFileSync(path.join(root,'begd/news-data.json'),'utf8'));
 const first={...seed,last_attempt_at:'2026-10-28T10:00:00+06:00'};
 let response=first;
 const {api,node}=news('#news',async()=>({ok:true,json:async()=>response}));
 await api.mount();
 response={...first,refresh_mode:'automatic',collection_status:'success',last_attempt_at:'2026-10-28T10:15:00+06:00',last_successful_refresh_at:'2026-10-28T10:15:00+06:00'};
 await api.refreshCatalog();assert.match(node('#content').innerHTML,/Automatic collection every build/);
 const shown=node('#content').innerHTML;
 response=first;await api.refreshCatalog();assert.equal(node('#content').innerHTML,shown);
 response={...first,last_attempt_at:'bad'};await api.refreshCatalog();assert.equal(node('#content').innerHTML,shown);
 response=null;await api.refreshCatalog();assert.equal(node('#content').innerHTML,shown);
});
