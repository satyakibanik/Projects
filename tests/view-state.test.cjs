const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function codec(){const window={};vm.runInNewContext(fs.readFileSync(path.join(root,'begd/view-state.js'),'utf8'),{window,URL,Date});return window.BEGDViewCodec;}
const plain=value=>JSON.parse(JSON.stringify(value));
test('independent realtime forecasts are off by default and explicit selections survive URL roundtrip',()=>{
 const api=codec(),gen='realtime:total_mw|independent_generation_mw',demand='realtime:total_mw|independent_demand_mw';
 const base={...api.defaults,date:'2026-10-21',custom:[],presets:{},trendLayers:[]};
 const off=api.encode('https://example.test/begd/#realtime',{...base,layers:[[gen,false],[demand,false]]});
 assert.equal(new URL(off).searchParams.has('hide'),false);
 const on=api.encode('https://example.test/begd/#realtime',{...base,layers:[[gen,true],[demand,true]]});
 assert.match(new URL(on).searchParams.get('show'),/rt\.ig/);assert.match(new URL(on).searchParams.get('show'),/rt\.id/);
 assert.deepEqual(plain(api.decode(on).state.layers),[[demand,true],[gen,true]]);
});
test('view URL roundtrip preserves settings, resolved dates, stable series IDs and legacy hashes',()=>{
 const api=codec(),state={...api.defaults,date:'2026-10-19',custom:['2026-08-01','2026-07-02'],presets:{yesterday:'2026-10-18',tomorrow:'unavailable',highest:'2026-05-20'},dispatch:'bar',shed:'line',fuel:'ring',regional:'line',curve:'line',table:'mw',days:'365',generationUnit:'MW',importsUnit:'MW',temperatureUnit:'F',detail:'weekly',layers:[['overview:dispatch|generation_mw',false],['imports:Adani|mw',true]],trendLayers:[['generation-demand|temperature_c',true],['fuel-mix|coal',false]]};
 for(const hash of ['overview','trends','en-curve','regions','realtime']){
  const url=api.encode('https://example.test/Projects/begd/?utm_source=test#'+hash,state),parsed=new URL(url);
  assert.equal(parsed.hash,'#'+hash);assert.equal(parsed.searchParams.get('utm_source'),'test');assert.equal(parsed.searchParams.get('highest'),'2026-05-20');
  const restored=plain(api.decode(url));assert.deepEqual(restored.warnings,[]);
  assert.equal(api.encode(url,restored.state),url);
  for(const key of ['date','custom','presets','dispatch','shed','fuel','regional','curve','table','days','generationUnit','importsUnit','temperatureUnit','detail'])assert.deepEqual(restored.state[key],plain(state[key]));
  assert.deepEqual(restored.state.layers,plain(api.visibilityOverrides(state.layers)));
  assert.deepEqual(plain(api.visibilityOverrides(restored.state.trendLayers,true)),plain(api.visibilityOverrides(state.trendLayers,true)));
 }
});
test('empty/legacy links retain sensible defaults; compare accepts repeated and comma-separated dates',()=>{
 const api=codec();assert.deepEqual(plain(api.decode('https://example.test/#overview').state),{...plain(api.defaults),custom:[],presets:{},layers:[],trendLayers:[]});
 const state=api.decode('https://example.test/?compare=2026-10-18,2026-10-17&compare=2026-10-18#overview').state;assert.deepEqual(plain(state.custom),['2026-10-18','2026-10-17']);
});
test('date validation rejects normalized calendar errors and uses date-only operating dates',()=>{
 const api=codec();for(const date of ['2024-02-29','2026-10-19'])assert.equal(api.validDate(date),true);
 for(const date of ['2026-02-29','2026-04-31','2026-13-01','2026-01-00','2026-1-1','2026-10-19T23:00:00-04:00','bad',null])assert.equal(api.validDate(date),false);
});
test('invalid/outdated parameters are explained and cannot become executable chart data',()=>{
 const {state,warnings}=codec().decode('https://example.test/?v=99&date=2026-02-30&days=999&dispatch=weird&layers='+encodeURIComponent('[["x","false"]]')+'&trendLayers=%7Bbad&compare=bad&yesterday=latest');
 assert.equal(state.date,undefined);assert.equal(state.days,'30');assert.equal(state.dispatch,'line');assert.deepEqual(plain(state.layers),[]);assert.deepEqual(plain(state.trendLayers),[]);assert.equal(warnings.length,8);
});
test('resolved highest-generation dates survive future updates and unknown series remain harmless',()=>{
 const api=codec();const state=api.decode('https://example.test/?date=2026-10-19&highest=2026-05-20&layers='+encodeURIComponent('[["retired-chart|retired-series",false]]')).state;
 const link=api.encode('https://example.test/#overview',state);assert.equal(new URL(link).searchParams.get('highest'),'2026-05-20');assert.equal(api.decode(link).state.layers[0][0],'retired-chart|retired-series');
});
test('trends visibility state restores before asynchronous mount with stable IDs',()=>{
 const window={addEventListener(){}};vm.runInNewContext(fs.readFileSync(path.join(root,'begd/trends.js'),'utf8'),{window,Date,Map,Set});
 const api=codec(),state=api.decode('https://example.test/?days=90&generationUnit=MW&importsUnit=MW&temperatureUnit=F&detail=daily&trendLayers='+encodeURIComponent('[["generation-demand|temperature_c",true],["generation-demand|generation_mwh",false],["fuel-mix|coal",false]]')).state;
 window.BEGDTrends.setViewState(state);const restored=plain(window.BEGDTrends.getViewState());assert.equal(restored.days,'90');assert.equal(restored.temperatureUnit,'F');assert.equal(restored.detail,'daily');assert.equal(restored.generationUnit,'MW');assert.deepEqual(restored.trendLayers,[...plain(state.trendLayers)].sort(([a],[b])=>a.localeCompare(b)));
});
function comparisonApp(){
 const nodes=new Map(),document={addEventListener(){},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{textContent:'',innerHTML:'',value:'',checked:false,attrs:{},getAttribute(key){return this.attrs[key]},setAttribute(key,value){this.attrs[key]=value},addEventListener(){},focus(){}});return nodes.get(selector);}};
 const window={addEventListener(){},BEGDViewCodec:codec(),BEGDView:{commit(){}}};
 const context=vm.createContext({window,document,URL,Date,Response,console});
 let source=fs.readFileSync(path.join(root,'begd/app.js'),'utf8').replace('loadCurrentDay();window.setInterval(loadCurrentDay,180000);','').replace(/refreshDateList\(\);\s*$/,'');
 vm.runInContext(source,context);vm.runInContext(fs.readFileSync(path.join(root,'begd/comparisons.js'),'utf8'),context);vm.runInContext('render=()=>{};',context);
 return {context,nodes,run:code=>vm.runInContext(code,context)};
}
test('custom comparisons retain multiple dates, reject duplicates, preserve unavailable dates, and reject mismatched reports',async()=>{
 const {context,run,nodes}=comparisonApp();let calls=0;
 context.fetch=async url=>{calls++;const date=new URL(url,'https://example.test').searchParams.get('date');return date==='2026-10-18'?new Response(JSON.stringify({date,published_date:'2026-10-19',hourly:[]})):date==='2026-10-17'?new Response(JSON.stringify({date:'2026-10-16'})):new Response('{}',{status:404});};
 assert.equal(await run("addCustomComparison('2026-10-18')"),true);
 assert.equal(await run("addCustomComparison('2026-10-18')"),false);assert.equal(calls,1);assert.match(nodes.get('#comparison-status').textContent,/already included/);
 await run("addCustomComparison('2026-10-17')");assert.match(run("customComparisons.get('2026-10-17').error"),/does not match/);
 await run("addCustomComparison('1900-01-01')");assert.match(run("customComparisons.get('1900-01-01').error"),/No archived report/);assert.equal(run('customComparisons.size'),3);
 assert.match(nodes.get('#custom-comparisons').innerHTML,/Remove comparison for operating date 1900-01-01/);
 assert.equal(run('comparisonSources().length'),1);assert.equal(run("comparisonSources()[0][0]"),'custom_2026-10-18');
});
test('late custom report responses cannot resurrect removed or replaced comparisons',async()=>{
 const {context,run}=comparisonApp();let finish;context.fetch=()=>new Promise(resolve=>{finish=resolve});
 const pending=run("addCustomComparison('2026-10-18')");run("customComparisons.clear()");finish(new Response(JSON.stringify({date:'2026-10-18'})));await pending;assert.equal(run('customComparisons.size'),0);
});
test('custom comparison dates use deterministic colors/dashes across add order and chart sources',()=>{
 const {run}=comparisonApp();const style=plain(run("comparisonStyle('2026-10-18')"));assert.deepEqual(plain(run("comparisonStyle('custom_2026-10-18')")),style);
 run("customComparisons.set('2026-10-18',{report:{date:'2026-10-18',hourly:[{time:'00:00',generation_mw:15,demand_mw:20}]}})");
 const series=plain(run("comparedRows([{time:'00:00'}],comparisonSources(),[{key:'generation_mw',name:'Generation'},{key:'demand_mw',name:'Demand'}])"));assert.equal(series.rows[0]['generation_mw_custom_2026-10-18'],15);assert.equal(series.series[0].color,style.color);
 const html=run("chart([{time:'00:00','generation_mw_custom_2026-10-18':15,'demand_mw_custom_2026-10-18':20}],comparedRows([],comparisonSources(),[{key:'generation_mw',name:'Generation'},{key:'demand_mw',name:'Demand'}]).series,{balanceLegend:true,styleSetting:'dispatch'})");
 assert.match(html,/data-toggle-series="generation_mw_custom_2026-10-18"/);assert.ok(html.includes('stroke-dasharray="'+style.dash+'"'));assert.ok(html.includes('stroke-dasharray="'+style.dash+' 1 3"'));
});
test('each chart retains independent stable visibility choices when another chart uses the same series key',()=>{
 const {run}=comparisonApp();run("chartVisibility.set('imports:route-a|mw',false)");
 const a=run("chart([{time:'00:00',mw:1}],[{key:'mw',name:'Import',color:'#123'}],{key:'imports:route-a'})"),b=run("chart([{time:'00:00',mw:1}],[{key:'mw',name:'Import',color:'#123'}],{key:'imports:route-b'})");
 assert.match(a,/<g data-series="mw" style="display:none"/);assert.doesNotMatch(b,/<g data-series="mw" style="display:none"/);
});
test('compact URLs omit default options and default visibility while preserving enabled opt-in layers',()=>{
 const api=codec(),state={...api.defaults,date:'2026-10-19',layers:[['overview:dispatch|generation_mw',true],['overview:dispatch|east_grid_mw',true],['overview:dispatch|west_grid_mw',false]],trendLayers:[['generation-demand|temperature_c',true],['generation-demand|generation_mwh',true],['temperature-subplot|temperature_c',true],['fuel-mix|coal',true]]};
 const url=api.encode('https://example.test/begd/#trends',state),p=new URL(url).searchParams;
 assert.equal(p.get('v'),'2');assert.equal(p.has('dispatch'),false);assert.equal(p.has('days'),false);assert.equal(p.has('layers'),false);assert.equal(p.has('trendLayers'),false);assert.equal(p.has('hide'),false);assert.equal(p.get('show'),'od.e,tg.t');
 const decoded=plain(api.decode(url));assert.deepEqual(decoded.warnings,[]);assert.deepEqual(decoded.state.layers,[['overview:dispatch|east_grid_mw',true]]);assert.deepEqual(decoded.state.trendLayers,[['generation-demand|temperature_c',true]]);
});
test('the supplied long v1 view becomes over 80 percent shorter with equivalent settings',t=>{
 const api=codec(),state={...api.defaults,date:'2026-10-19',custom:['2026-08-15','2026-04-26'],presets:{yesterday:'2026-10-18',highest:'2026-05-20'},days:'365',detail:'daily',layers:['demand_mw','demand_mw_custom_2026-04-26','demand_mw_custom_2026-08-15','demand_mw_highest','demand_mw_yesterday','forecasted_demand_mw'].map(series=>['overview:dispatch|'+series,false]),trendLayers:['dependence-renewables|import-share','dependence-renewables|renewable-share','fuel-mix|coal','fuel-mix|gas','fuel-mix|hfo','fuel-mix|hsd','fuel-mix|hydro','fuel-mix|imports','fuel-mix|solar','fuel-mix|wind','generation-demand|demand_mwh','generation-demand|generation_mwh','generation-demand|temperature_c','imports|adani-power-jharkhanda-ltd','imports|bheramara-hvdc-','imports|hvdc-nepal-','imports|import-tripura-','imports|imports_mwh','load-shedding|shed_peak_mw','temperature-subplot|temperature_c','unserved-share|unserved-share'].map(id=>[id,true])};
 const legacy=new URL('https://satyakibanik.github.io/Projects/begd/#trends');legacy.searchParams.set('v','1');legacy.searchParams.set('date',state.date);
 for(const date of state.custom)legacy.searchParams.append('compare',date);for(const [key,value] of Object.entries(state.presets))legacy.searchParams.set(key,value);
 for(const key of Object.keys(api.defaults))legacy.searchParams.set(key,state[key]);for(const key of ['layers','trendLayers'])legacy.searchParams.set(key,JSON.stringify(state[key]));
 const decoded=api.decode(legacy.href);assert.deepEqual(plain(decoded.warnings),[]);
 const compact=api.encode(legacy.href,decoded.state),restored=api.decode(compact);
 assert.ok(compact.length<legacy.href.length*.2,`${legacy.href.length} -> ${compact.length}`);t.diagnostic(`${legacy.href.length} characters -> ${compact.length} characters`);
 for(const key of ['date','custom','presets',...Object.keys(api.defaults)])assert.deepEqual(plain(restored.state[key]),plain(state[key]));
 assert.deepEqual(plain(restored.state.layers),plain(api.visibilityOverrides(state.layers)));assert.deepEqual(plain(restored.state.trendLayers),plain(api.visibilityOverrides(state.trendLayers,true)));
 assert.equal(api.encode(compact,restored.state),compact);assert.equal(new URL(compact).hash,'#trends');
});
test('unknown workbook and route IDs roundtrip losslessly without alias collisions',()=>{
 const api=codec(),ids=['imports:Route A|mw','plants:কর্ণফুলী|output_selected','imports:Route.A,B%|mw','__proto__|constructor','historical-generation|retired-series'];
 const state={...api.defaults,layers:ids.map(id=>[id,false]),trendLayers:[['imports|Route 😀 / A,B.%',false]]},link=api.encode('https://example.test/#imports',state),decoded=plain(api.decode(link));
 assert.deepEqual(decoded.warnings,[]);assert.deepEqual(decoded.state.layers,plain(api.visibilityOverrides(state.layers)));assert.deepEqual(decoded.state.trendLayers,state.trendLayers);
});
test('invalid compact visibility tokens are explained without discarding other valid settings',()=>{
 const {state,warnings}=codec().decode('https://example.test/?v=2&hide=bad,od.d,od.d.c20260230,dx-%25ZZ,__proto__.x&show=tg.t');
 assert.equal(warnings.length,4);assert.deepEqual(plain(state.layers),[['overview:dispatch|demand_mw',false]]);assert.deepEqual(plain(state.trendLayers),[['generation-demand|temperature_c',true]]);
});
test('compact visibility overrides take precedence over compatible legacy JSON parameters',()=>{
 const api=codec(),url='https://example.test/?layers='+encodeURIComponent('[["overview:dispatch|generation_mw",true]]')+'&hide=od.g&show=tg.t';
 assert.deepEqual(plain(api.decode(url).state.layers),[['overview:dispatch|generation_mw',false]]);
});
function headerApp(){
 const result=comparisonApp();result.run("data={report_id:'1',date:'2026-10-19',published_date:'2026-10-20'};load=async(id,report)=>{data=report;document.querySelector('#report-date').value=report.date;return true;};");return result;
}
test('header date picker loads exact operating dates and preserves custom/highest comparisons',async()=>{
 const {context,run,nodes}=headerApp(),calls=[];
 context.fetch=async url=>{calls.push(url);const date=new URL(url,'https://example.test').searchParams.get('date');return new Response(JSON.stringify({report_id:'2',date,published_date:'2026-10-18'}));};
 run("customComparisons.set('2026-08-15',{report:{date:'2026-08-15'}});pinnedComparisons.yesterday='2026-10-18';pinnedComparisons.highest='2026-05-20'");
 assert.equal(await run("selectOperatingDate('2026-10-17')"),true);
 assert.deepEqual(calls,['/api/report?date=2026-10-17']);assert.equal(run('data.date'),'2026-10-17');assert.equal(nodes.get('#report-date').value,'2026-10-17');assert.equal(nodes.get('#load-report').disabled,false);
 assert.equal(run("customComparisons.has('2026-08-15')"),true);assert.equal(run('pinnedComparisons.highest'),'2026-05-20');assert.equal(run('pinnedComparisons.yesterday'),undefined);
 assert.match(nodes.get('#date-status').textContent,/operating 2026-10-17 · published 2026-10-18/);
});
test('invalid and missing header dates never substitute a different report or clear the current view',async()=>{
 const {context,run,nodes}=headerApp();let calls=0;context.fetch=async()=>{calls++;return new Response('{}',{status:404});};
 assert.equal(await run("selectOperatingDate('')"),false);assert.equal(calls,0);assert.match(nodes.get('#date-status').textContent,/valid operating date/);
 assert.equal(await run("selectOperatingDate('1900-01-01')"),false);assert.equal(run('data.date'),'2026-10-19');assert.equal(nodes.get('#report-date').value,'2026-10-19');assert.match(nodes.get('#date-status').textContent,/No archived report.*Still showing operating date 2026-10-19/);
});
test('a late header date response cannot overwrite a more recent selection',async()=>{
 const {context,run,nodes}=headerApp(),pending=new Map();context.fetch=url=>new Promise(resolve=>pending.set(new URL(url,'https://example.test').searchParams.get('date'),resolve));
 const first=run("selectOperatingDate('2026-10-17')"),second=run("selectOperatingDate('2026-10-18')");
 pending.get('2026-10-18')(new Response(JSON.stringify({report_id:'2',date:'2026-10-18'})));assert.equal(await second,true);
 pending.get('2026-10-17')(new Response(JSON.stringify({report_id:'3',date:'2026-10-17'})));assert.equal(await first,false);assert.equal(run('data.date'),'2026-10-18');assert.equal(nodes.get('#report-date').value,'2026-10-18');
});
test('header arrows use available operating dates and skip archive gaps',()=>{
 const {context,run}=headerApp();context.window.BEGD_STATIC_DATA={reports_by_operating_date:{'2026-10-19':'1','2026-10-17':'2','2026-10-15':'3'}};
 assert.equal(run('reportDayNavigationTarget(-1)'),'2026-10-17');assert.equal(run('reportDayNavigationTarget(1)'),null);
 run("data.date='2026-10-17'");assert.equal(run('reportDayNavigationTarget(-1)'),'2026-10-15');assert.equal(run('reportDayNavigationTarget(1)'),'2026-10-19');
 delete context.window.BEGD_STATIC_DATA;assert.equal(run('reportDayNavigationTarget(1)'),'2026-10-18');
});
test('Latest report returns from a pinned older date to the newest publication and updates the view',async()=>{
 const {context,run,nodes}=headerApp(),calls=[];
 const reports=[{id:'5175',published_date:'2026-10-25'},{id:'5177',published_date:'2026-10-27'}];
 context.fetch=async url=>{calls.push(url);return new Response(JSON.stringify(url==='/api/reports'?{reports}:{report_id:'5177',date:'2026-10-26',published_date:'2026-10-27'}));};
 assert.equal(await run('selectLatestReport()'),true);
 assert.equal(run('data.date'),'2026-10-26');assert.equal(nodes.get('#report-date').value,'2026-10-26');
 assert.deepEqual(calls,['/api/reports','/api/report?id=5177','/api/report?date=2026-10-26']);
 assert.equal(nodes.get('#latest-report').disabled,false);
 assert.match(nodes.get('#date-status').textContent,/operating 2026-10-26 · published 2026-10-27/);
});
test('Latest report failure preserves the selected report and releases controls',async()=>{
 const {context,run,nodes}=headerApp();context.fetch=async()=>new Response('{}',{status:503});
 assert.equal(await run('selectLatestReport()'),false);assert.equal(run('data.date'),'2026-10-19');
 assert.equal(nodes.get('#latest-report').disabled,false);assert.match(nodes.get('#date-status').textContent,/Still showing operating date 2026-10-19/);
});
function sharingApp(hash){
 const {context,run,nodes}=headerApp(),location=new URL('https://example.test/begd/?v=2&date=2026-10-24'+hash),events={};
 context.location=location;context.history={replaceState(state,_,url){location.href=url;},pushState(state,_,url){location.href=url;}};
 context.window.BEGDTrends={getViewState:()=>({}),setViewState(){}};
 context.window.addEventListener=(name,fn)=>{events[name]=fn;};
 context.window.BEGDViewCodec=codec();
 run("data={report_id:'5177',date:'2026-10-26',published_date:'2026-10-27'};render=()=>{};renderCustomComparisons=()=>{};");
 vm.runInContext(fs.readFileSync(path.join(root,'begd/share-view.js'),'utf8'),context);
 return {context,run,nodes,location,events};
}
test('legacy realtime link drops the hidden archive date and does not load the older report',async()=>{
 const {context,run,location}=sharingApp('#realtime');let calls=0;context.fetch=async()=>{calls++;throw Error('Unexpected archive request');};
 await context.window.BEGDView.start();assert.equal(calls,0);assert.equal(run('data.date'),'2026-10-26');
 assert.equal(location.searchParams.has('date'),false);assert.equal(location.hash,'#realtime');
 assert.equal(context.window.BEGDView.capture().date,undefined);
 location.hash='#overview';context.window.BEGDView.commit({replace:true});
 assert.equal(location.searchParams.get('date'),'2026-10-26');
});
test('explicit overview archive links still restore their exact operating date',async()=>{
 const {context,run,location}=sharingApp('#overview');
 context.fetch=async()=>new Response(JSON.stringify({report_id:'5175',date:'2026-10-24',published_date:'2026-10-25'}));
 await context.window.BEGDView.start();assert.equal(run('data.date'),'2026-10-24');assert.equal(location.searchParams.get('date'),'2026-10-24');
});
test('cost averaging period and rate-chart layers survive shared view URLs without changing other cost layers',()=>{
 const api=codec(),state={...api.defaults,costAverageDays:'90',trendLayers:[['bpdb-unit-cost|gas',false],['bpdb-cost|coal',true]]};
 const url=api.encode('https://example.test/begd/#trends',state),restored=plain(api.decode(url));
 assert.equal(new URL(url).searchParams.get('costAverageDays'),'90');assert.equal(restored.state.costAverageDays,'90');assert.deepEqual(plain(api.visibilityOverrides(restored.state.trendLayers,true)),plain(api.visibilityOverrides(state.trendLayers,true)));
 assert.equal(api.decode('https://example.test/?costAverageDays=999').state.costAverageDays,'30');
});
