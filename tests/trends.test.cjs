const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function load(){const window={addEventListener(){}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/trends.js'),'utf8'),{window,Date,Map,Set});return window.BEGDTrends}
test('each range is an inclusive calendar window and retains missing dates across leap day',()=>{
 const api=load();for(const count of [30,60,90,365]){const rows=api.windowDays({end_date:'2024-03-01',days:[{date:'2024-02-29',generation_mwh:0}]},count);assert.equal(rows.length,count);assert.equal(rows.at(-1).date,'2024-03-01');assert.equal(rows.at(-2).generation_mwh,0);assert.equal(rows.at(-3).generation_mwh,undefined)}
 assert.equal(api.windowDays({end_date:null,days:[]},30).length,0);
});
test('partial totals count only actual observations while preserving real zero',()=>{
 const api=load();let t=api.total([{v:null},{v:0},{v:20},{},{v:NaN}],'v');assert.equal(t.value,20);assert.equal(t.count,2);assert.equal(api.total([{v:null}],'v').value,null);
});
test('chart lines break at gaps and do not bridge missing calendar days',()=>{
 const html=load().plot([{date:'2026-01-01',v:10},{date:'2026-01-02'},{date:'2026-01-03',v:20}],[{name:'Demand',color:'#123456',value:r=>r.v}],'Demand','GWh');
 assert.match(html,/<path d="M[^L]*M/);assert.match(html,/2026-01-03 · Demand: 20 GWh/);assert.doesNotMatch(html,/NaN|undefined/);
});
test('stacked shares omit incomplete fuel days rather than treating blanks as zero',()=>{
 const api=load();const html=api.plot([{date:'2026-01-01',gas:10,coal:10},{date:'2026-01-02',gas:10}],[{name:'Gas',color:'#123456',value:r=>r.gas},{name:'Coal',color:'#abcdef',value:r=>r.coal}],'Fuel mix','%',true);
 assert.equal((html.match(/<rect /g)||[]).length,2);assert.match(html,/Gas: 50%/);assert.doesNotMatch(html,/2026-01-02 · Gas/);
});
test('30-day rolling means require full calendar coverage and never substitute zero',()=>{
 const api=load();const rows=Array.from({length:31},(_,i)=>({date:String(i),mw:i+1}));
 let result=api.rollingMean(rows,'mw');assert.equal(result[28].rolling_mw,null);assert.equal(result[29].rolling_mw,15.5);assert.equal(result[30].rolling_mw,16.5);
 rows[10].mw=null;result=api.rollingMean(rows,'mw');assert.equal(result[30].rolling_mw,null);
 assert.equal(api.ratio(10,0),null);assert.equal(api.ratio(null,100),null);assert.equal(api.ratio(0,100),0);assert.equal(api.ratio(25,100),25);
});
test('hover summaries retain all series, exact units, zero and explicit missing readings',()=>{
 const api=load();const html=api.tooltipRows({rows:[{date:'2026-01-01',a:0,b:null}],series:[{name:'Observed <supply>',color:'#123456',value:r=>r.a},{name:'Demand',color:'#abcdef',value:r=>r.b}],unit:'MW'},0);
 assert.match(html,/1 Jan 2026/);assert.match(html,/0 MW/);assert.match(html,/Not reported/);assert.match(html,/Observed &lt;supply&gt;/);
});
test('fuel tooltips show both energy and share and do not fabricate incomplete shares',()=>{
 const api=load();const config={rows:[{date:'2026-01-01',a:1,b:3}],series:[{name:'Gas',color:'#123456',value:r=>r.a},{name:'Coal',color:'#abcdef',value:r=>r.b}],unit:'%',stacked:true};
 assert.match(api.tooltipRows(config,0),/25% · 1 GWh/);assert.match(api.tooltipRows(config,0),/75% · 3 GWh/);
 config.rows[0].b=null;assert.match(api.tooltipRows(config,0),/incomplete mix/);assert.doesNotMatch(api.tooltipRows(config,0),/100%/);
});
test('historical lines without markers still register a full-chart interactive tooltip',()=>{
 const html=load().plot([{date:'2015-01-01',v:1000}],[{name:'Daily mean',color:'#123456',markers:false,value:r=>r.v}],'History','MW');
 assert.match(html,/data-trend-chart=/);assert.match(html,/tabindex="0"/);assert.match(html,/role="tooltip" hidden/);assert.match(html,/data-trend-cursor/);assert.doesNotMatch(html,/<circle/);
});
test('10y switches to historical panels and recent ranges exclude both decade charts',async()=>{
 const nodes=new Map();
 const node=key=>{if(!nodes.has(key))nodes.set(key,{textContent:'',hidden:false});return nodes.get(key)};
 const host={innerHTML:'',buttons:{},layers:[],units:[],querySelector(){return null},querySelectorAll(selector){
  if(selector==='[data-trend-layer]'){
   if(this.layersHTML===this.innerHTML)return this.layers;this.layersHTML=this.innerHTML;
   this.layers=[...this.innerHTML.matchAll(/data-trend-layer="([^"]+)" data-trend-chart-key="([^"]+)" (checked)?/g)].map(match=>({dataset:{trendLayer:match[1],trendChartKey:match[2]},checked:!!match[3],addEventListener(_,handler){this.handler=handler},focus(){}}));return this.layers;
  }
  if(selector==='[data-trend-unit]'){
   if(this.unitsHTML===this.innerHTML)return this.units;this.unitsHTML=this.innerHTML;
   this.units=[...this.innerHTML.matchAll(/data-trend-unit="([^"]+)" data-unit-chart="([^"]+)"/g)].map(match=>({dataset:{trendUnit:match[1],unitChart:match[2]},addEventListener(_,handler){this.handler=handler},focus(){}}));return this.units;
  }
  if(selector!=='[data-trend-days]')return [];
  this.buttons={};
  return [...this.innerHTML.matchAll(/data-trend-days="([^"]+)"/g)].map(match=>{
   const button={dataset:{trendDays:match[1]},addEventListener(_,handler){this.handler=handler}};
   this.buttons[match[1]]=button;return button;
  });
 }};
 const history={start_date:'2015-04-17',end_date:'2015-04-18',days:[{date:'2015-04-17',mean_mw:5000,observations:24},{date:'2015-04-18',mean_mw:5500,observations:24}],months:[{month:'2015-04',median_mw:5200,days:2,observations:48}],excluded_records:[],source:'https://data.mendeley.com/datasets/xx9dhmy9rj/2',attribution:'BengalGrid',doi:'10.17632/xx9dhmy9rj.2'};
 const data={end_date:'2026-01-01',days:[{date:'2026-01-01',generation_mwh:2400,report_id:'1'}]};
 const window={location:{hash:'#trends'},addEventListener(){}};
 const document={querySelector:s=>s==='#content'?host:node(s),querySelectorAll:()=>[],getElementById:node};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/trends.js'),'utf8'),{window,document,fetch:async url=>({ok:true,json:async()=>url==='trends-data.json'?data:history}),Date,Map,Set});
 await window.BEGDTrends.mount();
 assert.match(host.innerHTML,/Generation & demand/);assert.doesNotMatch(host.innerHTML,/A decade of generation|Seasonality & growth by month|Generation in MW over time|Daily values & source reports|Data coverage:/);
 const layer=host.layers.find(input=>input.dataset.trendLayer==='Demand requirement');layer.checked=false;layer.handler();
 host.units.find(control=>control.dataset.unitChart==='generation'&&control.dataset.trendUnit==='MW').handler();
 assert.match(host.innerHTML,/Generation and demand \(MW\)/);
 assert.equal(host.layers.find(input=>input.dataset.trendLayer==='Demand requirement').checked,false);
 host.buttons['365'].handler();
 assert.equal(host.layers.find(input=>input.dataset.trendLayer==='Demand requirement').checked,false);
 host.layers.filter(input=>input.dataset.trendChartKey==='Generation and demand').forEach(input=>{if(input.checked){input.checked=false;input.handler()}});
 assert.match(host.innerHTML,/Select a legend layer to display/);
 const generation=host.layers.find(input=>input.dataset.trendLayer==='Generation');generation.checked=true;generation.handler();
 assert.doesNotMatch(host.innerHTML,/Select a legend layer to display/);
 host.units.find(control=>control.dataset.unitChart==='imports'&&control.dataset.trendUnit==='MW').handler();
 assert.match(host.innerHTML,/Imports \(MW\)/);
 host.buttons['10y'].handler();
 assert.match(host.innerHTML,/A decade of generation/);assert.match(host.innerHTML,/Seasonality & growth by month/);
 assert.doesNotMatch(host.innerHTML,/Generation & demand|Total demand requirement/);
 assert.match(host.innerHTML,/data-trend-days="10y" aria-pressed="true"/);
 assert.match(host.innerHTML,/no reported observations/);
 host.buttons['60'].handler();
 assert.match(host.innerHTML,/Generation & demand/);assert.doesNotMatch(host.innerHTML,/A decade of generation|Seasonality & growth by month/);
});
test('365-day charts label each month and identify a sparse subset for small containers',()=>{
 const api=load(),rows=api.windowDays({end_date:'2026-10-18',days:[]},365);
 const ticks=api.monthTicks(rows);
 assert.equal(ticks.length,12);assert.equal(ticks[0].label,'Nov 25');assert.equal(ticks.at(-1).label,'Oct 26');
 assert.ok(ticks.filter(tick=>tick.sparse).length<ticks.length);
 assert.ok(ticks.every(tick=>rows[tick.index].date.endsWith('-01')));
 const html=api.plot(rows.map(r=>({...r,v:10})),[{name:'Generation',color:'#123456',value:r=>r.v}],'Generation','MW');
 assert.equal((html.match(/class="trends-date-tick/g)||[]).length,12);
});
test('energy/power conversions preserve missing data and use daily average MW',()=>{
 const api=load();assert.equal(api.energyValue(24000,'GWh'),24);assert.equal(api.energyValue(24000,'MW'),1000);
 assert.equal(api.energyValue(0,'MW'),0);assert.equal(api.energyValue(null,'MW'),null);
});
test('selected fuel tooltips retain the full mix denominator',()=>{
 const api=load(),gas={name:'Gas',color:'#123456',value:r=>r.gas},coal={name:'Coal',color:'#abcdef',value:r=>r.coal};
 const html=api.tooltipRows({rows:[{date:'2026-01-01',gas:1,coal:3}],series:[gas],allSeries:[gas,coal],unit:'%',stacked:true},0);
 assert.match(html,/25% · 1 GWh/);assert.doesNotMatch(html,/Coal|100%/);
});

test('Trends navigation follows Real time and precedes the horizontal divider',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../begd/index.html'),'utf8');
 const nav=html.slice(html.indexOf('<nav '),html.indexOf('</nav>'));
 assert.ok(nav.indexOf('href="#realtime"')<nav.indexOf('href="#trends"'));
 assert.ok(nav.indexOf('href="#trends"')<nav.indexOf('<hr '));
 assert.ok(nav.indexOf('<hr ')<nav.indexOf('href="#overview"'));
});
