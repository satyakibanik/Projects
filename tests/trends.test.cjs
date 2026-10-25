const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function load(){const window={addEventListener(){}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/trends.js'),'utf8'),{window,Date,Map,Set});return window.BEGDTrends}
test('minimum–maximum bands split at missing or reversed extrema and retain isolated days',()=>{
 const api=load(),rows=[{date:'2026-01-01',lo:.9,hi:1},{date:'2026-01-02',lo:.91,hi:1.01},{date:'2026-01-03',lo:.92},{date:'2026-01-04',lo:.93,hi:1.03},{date:'2026-01-05',lo:1.1,hi:1}];
 const segments=api.rangeBandSegments(rows,r=>r.lo,r=>r.hi);
 assert.equal(segments.length,2);assert.equal(segments[0].length,2);assert.equal(segments[1][0].index,3);
 const series=[{name:'Minimum voltage',color:'#123456',value:r=>r.lo},{name:'Maximum voltage',color:'#abcdef',value:r=>r.hi}];
 const html=api.plot(rows,series,'Voltage range','p.u.',false,{band:{low:r=>r.lo,high:r=>r.hi,color:'#123456'},reference:{value:1,label:'Nominal · 1 p.u.'},fitExtent:true});
 assert.equal((html.match(/class="trends-range-band"/g)||[]).length,2);
 assert.match(html,/Nominal · 1 p.u./);assert.doesNotMatch(html,/NaN|undefined/);
});
test('per-unit voltage tooltips and accessible marks retain original kV in brackets',()=>{
 const api=load(),rows=[{date:'2026-10-24',min_kv:122}],series=[{name:'Minimum voltage',color:'#123456',value:row=>row.min_kv/132,formatValue:(value,row)=>`${value.toFixed(3)} p.u. [${row.min_kv} kV]`}];
 const html=api.plot(rows,series,'Station minimum','p.u.',false,{fitExtent:true,nonNegative:true,tickDecimals:3});
 assert.match(html,/Minimum voltage: 0\.924 p\.u\. \[122 kV\]/);
 assert.match(api.tooltipRows({rows,series,unit:'p.u.'},0),/0\.924 p\.u\. \[122 kV\]/);
 rows[0].min_kv=null;series[0].value=()=>null;
 assert.match(api.tooltipRows({rows,series,unit:'p.u.'},0),/Not reported/);
});
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
  if(selector==='[data-temperature-unit]'){
   this.temperatures=[...this.innerHTML.matchAll(/data-temperature-unit="([^"]+)"/g)].map(match=>({dataset:{temperatureUnit:match[1]},addEventListener(_,handler){this.handler=handler},focus(){}}));return this.temperatures;
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
 const data={end_date:'2026-01-01',days:[{date:'2026-01-01',generation_mwh:2400,temperature_c:25,report_id:'1'}]};
 const window={location:{hash:'#trends'},addEventListener(){}};
 const document={querySelector:s=>s==='#content'?host:node(s),querySelectorAll:()=>[],getElementById:node};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/trends.js'),'utf8'),{window,document,fetch:async url=>({ok:true,json:async()=>url==='trends-data.json'?data:history}),Date,Map,Set});
 await window.BEGDTrends.mount();
 assert.match(host.innerHTML,/Generation & demand/);assert.doesNotMatch(host.innerHTML,/A decade of generation|Seasonality & growth by month|Generation in MW over time|Daily values & source reports|Data coverage:/);
 const temperature=host.layers.find(input=>input.dataset.trendLayer==='Maximum temperature');
 assert.equal(temperature.checked,false);assert.doesNotMatch(host.innerHTML,/trends-secondary-axis|data-temperature-unit/);
 temperature.checked=true;temperature.handler();
 assert.match(host.innerHTML,/Maximum temperature subplot \(°C\)/);
 assert.doesNotMatch(host.innerHTML,/trends-secondary-axis/);
 assert.match(host.innerHTML,/Maximum temperature: 25 °C/);
 host.temperatures.find(button=>button.dataset.temperatureUnit==='°F').handler();
 assert.match(host.innerHTML,/Maximum temperature subplot \(°F\)/);
 for(const range of ['30','60','90','365']){
  host.buttons[range].handler();
  assert.equal(host.layers.find(input=>input.dataset.trendLayer==='Maximum temperature').checked,true);
  assert.match(host.innerHTML,/Maximum temperature subplot \(°F\)/);
 }
 const selectedTemperature=host.layers.find(input=>input.dataset.trendLayer==='Maximum temperature');selectedTemperature.checked=false;selectedTemperature.handler();
 assert.doesNotMatch(host.innerHTML,/trends-secondary-axis|data-temperature-unit/);
 const layer=host.layers.find(input=>input.dataset.trendLayer==='Demand requirement');layer.checked=false;layer.handler();
 host.units.find(control=>control.dataset.unitChart==='generation'&&control.dataset.trendUnit==='MW').handler();
 assert.match(host.innerHTML,/Generation and demand \(MW\)/);
 assert.equal(host.layers.find(input=>input.dataset.trendLayer==='Demand requirement').checked,false);
 host.buttons['365'].handler();
 assert.equal(host.layers.find(input=>input.dataset.trendLayer==='Demand requirement').checked,false);
 host.layers.filter(input=>input.dataset.trendChartKey==='generation-demand').forEach(input=>{if(input.checked){input.checked=false;input.handler()}});
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

test('temperature conversion preserves missing readings, negatives and zero',()=>{
 const api=load();assert.equal(api.temperatureValue(0,'°F'),32);assert.equal(api.temperatureValue(-40,'°F'),-40);assert.equal(api.temperatureValue(25,'°F'),77);assert.equal(api.temperatureValue(33.7),33.7);assert.equal(api.temperatureValue(null,'°F'),null);assert.equal(api.temperatureValue(NaN),null);
});
test('right-axis series do not change primary scale and tooltips use per-series units',()=>{
 const rows=[{date:'2026-01-01',energy:10,temp:1000},{date:'2026-01-02',energy:20,temp:null},{date:'2026-01-03',energy:15,temp:1002}];
 const energy={name:'Energy',color:'#123456',value:r=>r.energy},temp={name:'Temperature',color:'#ba477b',axis:'right',unit:'°C',value:r=>r.temp};
 const first=load().plot(rows,[energy],'Primary','GWh'),both=load().plot(rows,[energy,temp],'Combined','GWh');
 const leftTicks=html=>[...html.matchAll(/text-anchor="end">([^<]+)<\/text>/g)].map(m=>m[1]);
 assert.deepEqual(leftTicks(first),leftTicks(both));assert.match(both,/right axis \(°C\)/);assert.match(both,/1,000 °C/);assert.doesNotMatch(both,/1000 GWh|NaN/);
 const tip=load().tooltipRows({rows,series:[energy,temp],unit:'GWh'},0);assert.match(tip,/10 GWh/);assert.match(tip,/1,000 °C/);
});

test('7-day comparison averages preserve units, partial windows and gaps',()=>{
 const api=load(),rows=Array.from({length:15},(_,i)=>({date:'2026-01-'+String(i+1).padStart(2,'0'),generation_mwh:i+1,demand_mwh:(i+1)*2,temperature_c:i-5}));
 let weeks=api.weeklyComparisonRows(rows);assert.equal(weeks.length,3);assert.equal(weeks[0].generation_mwh,4);assert.equal(weeks[1].generation_mwh,11);assert.equal(weeks[2].generation_mwh,15);assert.equal(weeks[2].window_days,1);assert.equal(weeks[0].temperature_c,-2);
 assert.equal(weeks[0].period_start,'2026-01-01');assert.equal(weeks[0].period_end,'2026-01-07');
 rows[2].temperature_c=null;weeks=api.weeklyComparisonRows(rows);assert.equal(weeks[0].temperature_c,null);assert.equal(weeks[0].generation_mwh,4);
 const tip=api.tooltipRows({rows:weeks,series:[{name:'Generation',color:'#123456',value:r=>r.generation_mwh}],unit:'GWh'},0);assert.match(tip,/1 Jan 2026 – 7 Jan 2026/);assert.match(tip,/7-day average/);
 assert.equal(api.weeklyComparisonRows([]).length,0);
});

test('compact temperature subplot has its own signed scale and suppresses duplicate legend',()=>{
 const html=load().plot([{date:'2026-01-01',t:-40},{date:'2026-01-02',t:0}],[{name:'Maximum temperature',color:'#ba477b',value:r=>r.t}],'Maximum temperature subplot','°C',false,{compact:true,temperatureScale:true,hideLegend:true});
 assert.match(html,/viewBox="0 0 840 180"/);assert.match(html,/>-42<\/text>/);assert.match(html,/>2<\/text>/);assert.doesNotMatch(html,/data-trend-layer=/);
});

test('linked charts share generation, demand and temperature readouts with independent units',()=>{
 const api=load(),rows=[{date:'2026-10-19',generation:10,demand:12,temp:33.7}];
 const shared=[{name:'Generation',unit:'GWh',value:r=>r.generation},{name:'Demand requirement',unit:'GWh',value:r=>r.demand},{name:'Maximum temperature',unit:'°C',value:r=>r.temp}];
 const upper=api.tooltipRows({rows,series:shared.slice(0,2),tooltipSeries:shared,unit:'GWh'},0);
 const lower=api.tooltipRows({rows,series:shared.slice(2),tooltipSeries:shared,unit:'°C'},0);
 assert.equal(upper,lower);for(const text of ['Generation','Demand requirement','Maximum temperature','10 GWh','12 GWh','33.7 °C'])assert.ok(lower.includes(text),text);
 rows[0].temp=null;assert.match(api.tooltipRows({rows,series:shared,tooltipSeries:shared,unit:'GWh'},0),/Not reported/);
});
test('fitted value axis follows visible data extrema with padding and handles constant or absent values',()=>{
 const api=load(),series=[{name:'Energy',color:'#123456',value:r=>r.v}];
 const ticks=html=>[...html.matchAll(/text-anchor="end">([^<]+)<\/text>/g)].map(m=>Number(m[1].replaceAll(',',''))).filter(Number.isFinite);
 let html=api.plot([{date:'2026-01-01',v:200},{date:'2026-01-02',v:300}],series,'Fitted range','GWh',false,{fitExtent:true});
 let axis=ticks(html);assert.ok(axis[0]>0&&axis[0]<200);assert.ok(axis.at(-1)>300);assert.doesNotMatch(html,/NaN|Infinity/);
 html=api.plot([{date:'2026-01-01',v:250}],series,'Constant range','GWh',false,{fitExtent:true});axis=ticks(html);assert.ok(axis[0]<250&&axis.at(-1)>250);
 html=api.plot([{date:'2026-01-01',v:0}],series,'Zero range','GWh',false,{fitExtent:true});assert.doesNotMatch(html,/NaN|Infinity/);
 html=api.plot([{date:'2026-01-01',v:null}],series,'Empty range','GWh',false,{fitExtent:true});assert.doesNotMatch(html,/NaN|Infinity/);assert.match(html,/No reported values/);
});
