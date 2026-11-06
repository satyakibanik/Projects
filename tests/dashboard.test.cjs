const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function app(document={addEventListener(){},querySelector(){return {addEventListener(){}}}}){
 const source=fs.readFileSync(path.join(root,'begd/app.js'),'utf8').replace('loadCurrentDay();window.setInterval(loadCurrentDay,180000);','').replace(/refreshDateList\(\);\s*$/,'');
 const context=vm.createContext({document,window:{addEventListener(){}},console});
 vm.runInContext(source,context);return context;
}
test('legend geometry follows bar/line style changes, including dotted forecasts',()=>{
 const c=app();
 const draw=style=>vm.runInContext(`dispatchChartStyle='${style}';chart([{time:'00:00',demand:20,forecast:22},{time:'23:00',demand:30,forecast:25}],[{key:'demand',name:'Demand',color:'#c48722',dash:true},{key:'forecast',name:'Forecast',color:'#df6f9b',dot:true,pointsOnly:true,connectPoints:true}],{styleSetting:'dispatch'})`,c);
 const line=draw('line'),bar=draw('bar');
 assert.match(line,/Demand · dashed line/);assert.match(line,/Forecast · dotted line/);
 assert.match(bar,/Demand · solid fill/);assert.match(bar,/Forecast · dotted line/);
 assert.match(line,/stroke-dasharray="1 5" stroke-linecap="round"/);
 assert.match(line,/stroke-dasharray="6 4"/);
});
test('stacked-area hatch samples share plot angle, spacing, color and opacity',()=>{
 const c=app();
 const html=vm.runInContext(`stackedAreaChart([{time:'00:00',a:10,b:20},{time:'23:00',a:15,b:25}],[{key:'a',name:'A',color:'#123456',hatch:true},{key:'b',name:'B',color:'#abcdef',hatch:true}])`,c);
 const patterns=[...html.matchAll(/<pattern id="([^"]+)"([^]*?)<\/pattern>/g)];
 assert.equal(patterns.length,4);
 for(let i=0;i<2;i++)assert.equal(patterns[i][2],patterns[i+2][2]);
 const line=vm.runInContext(`enCurveChartStyle='line';chart([{time:'00:00',a:10},{time:'23:00',a:20}],[{key:'a',name:'A',color:'#123456',hatch:true}],{styleSetting:'en-curve'})`,c);
 assert.doesNotMatch(line,/<pattern/);assert.match(line,/A · solid line/);
});
class Element{
 constructor(dataset={}){this.dataset=dataset;this.events={};this.attrs={};this.innerHTML='Default map detail';this.isConnected=true;const classes=new Set();this.classList={toggle(n,on){on?classes.add(n):classes.delete(n)},remove(...names){names.forEach(n=>classes.delete(n))},contains(n){return classes.has(n)}}}
 addEventListener(n,fn){this.events[n]=fn}setAttribute(n,v){this.attrs[n]=v}
}
test('evening peak time follows matching observed demand rather than a fixed time',()=>{
 const c=app();
 const note=report=>vm.runInContext(`eveningPeakNote(${JSON.stringify(report)})`,c);
 const report={summary:{peak_demand_mw:15696.9,peak_time:'19:30'},hourly:[{time:'19:00',demand_mw:15696.9},{time:'19:30',demand_mw:15372.22}]};
 assert.equal(note(report),'Generation side · 19:00 BST (observed)');
 report.hourly.push({time:'20:00',demand_mw:15696.9});
 assert.equal(note(report),'Generation side · 19:00, 20:00 BST (observed)');
 report.hourly=[];assert.equal(note(report),'Generation side · time not available');
 report.hourly=[{time:'12:00',demand_mw:15696.9}];assert.equal(note(report),'Generation side · time not available');
 report.hourly=[{time:'19:30',demand_mw:16000}];assert.equal(note(report),'Generation side · time not available');
 assert.equal(note({summary:{}}),'Generation side');
});
test('region hover and keyboard exit restore all colors; zoom resets to fitted bounds',async()=>{
 const frame=new Element(),svg=new Element(),group={getBBox:()=>({x:900,y:0,width:4600,height:6000})},detail=new Element(),keys=['dhaka','cumilla'].map(name=>new Element({mapSelect:name[0].toUpperCase()+name.slice(1)})),regions=['dhaka','cumilla'].map(region=>new Element({region})),zoomIn=new Element(),zoomOut=new Element(),reset=new Element();
 frame.querySelector=s=>s==='svg'?svg:null;svg.querySelector=()=>group;frame.querySelectorAll=()=>regions;
 const document={addEventListener(){},querySelector(s){return {'#region-map-frame':frame,'#region-map-detail':detail,'[data-map-zoom="in"]':zoomIn,'[data-map-zoom="out"]':zoomOut,'[data-map-reset]':reset}[s]||new Element()},querySelectorAll:()=>keys};
 const c=app(document);c.fetch=async()=>({ok:true,text:async()=>'<svg/>'});
 vm.runInContext(`data={regions:[{name:'Dhaka',energy_mwh:10,demand_mw:5,shed_mw:0},{name:'Cumilla',energy_mwh:12,demand_mw:6,shed_mw:0}]}`,c);
 await vm.runInContext('setupRegionMap()',c);
 const home=svg.attrs.viewBox;assert.equal(home,'800 -100 4800 6200');
 const assertClear=()=>{for(const r of regions){assert.equal(r.classList.contains('is-selected'),false);assert.equal(r.classList.contains('is-muted'),false);assert.equal(r.attrs['aria-pressed'],'false')}assert.equal(detail.innerHTML,'Default map detail')};
 regions[0].events.pointerenter();assert.equal(regions[1].classList.contains('is-muted'),true);regions[0].events.pointerleave();assertClear();
 regions[1].events.focus();assert.equal(regions[1].attrs['aria-pressed'],'true');regions[1].events.blur();assertClear();
 keys[0].events.pointerenter();keys[0].events.pointerleave();assertClear();
 zoomIn.events.click();assert.notEqual(svg.attrs.viewBox,home);reset.events.click();assert.equal(svg.attrs.viewBox,home);assertClear();
});
test('forecast numeric sorts preserve zero, order numerically and leave missing values last',()=>{
 const c=app();
 vm.runInContext(`var forecastFixture=[{name:'small',capacity_mw:9},{name:'large',capacity_mw:100},{name:'missing',capacity_mw:null},{name:'zero',capacity_mw:0},{name:'bad',capacity_mw:NaN}]`,c);
 const order=direction=>JSON.parse(vm.runInContext(`JSON.stringify(sortForecastRows(forecastFixture,{key:'capacity_mw',direction:'${direction}'}).map(r=>r.name))`,c));
 assert.deepEqual(order('asc'),['zero','small','large','missing','bad']);
 assert.deepEqual(order('desc'),['large','small','zero','missing','bad']);
 assert.equal(vm.runInContext('forecastFixture[0].name',c),'small');
});
test('forecast text sorts naturally and every column has an accessible sort control',()=>{
 const c=app();
 assert.equal(vm.runInContext(`sortForecastRows([{name:'Unit 10'},{name:'Unit 2'}],{key:'name',direction:'asc'})[0].name`,c),'Unit 2');
 vm.runInContext(`data={forecast:{date:'2026-10-16',totals:{},plants:[]}}`,c);
 const html=vm.runInContext('forecast()',c);
 assert.equal((html.match(/data-forecast-sort=/g)||[]).length,9);
 assert.match(html,/Scrollable generation availability forecast/);
 assert.match(html,/Forecast for 16 Oct 2026/);
 assert.match(html,/forecast-day/);assert.match(html,/forecast-evening/);
});
test('forecast subtitle distinguishes forecast target date from actuals and does not invent a missing date',()=>{
 const c=app();
 const forecast=vm.runInContext(`reportSubtitle('forecast',{date:'2026-10-15',published_date:'2026-10-16',forecast:{date:'2026-10-16'}})`,c);
 assert.match(forecast,/Workbook availability forecast for 16 October 2026/);assert.match(forecast,/Actuals in this workbook cover 15 October 2026/);
 assert.doesNotMatch(forecast,/Operating date 15/);
 assert.match(vm.runInContext(`reportSubtitle('forecast',{date:'2026-10-15'})`,c),/Workbook availability forecast for unavailable/);
 assert.match(vm.runInContext(`reportSubtitle('overview',{date:'2026-10-15'})`,c),/Operating date 15 October 2026/);
});
test('real-time subtitle uses the snapshot date instead of the selected workbook and handles unavailable data',()=>{
 const c=app();
 vm.runInContext("currentDayData={today_date:'2026-10-24'}",c);
 const html=vm.runInContext("reportSubtitle('realtime',{date:'2026-10-23'})",c);
 assert.match(html,/operating-date-highlight.*Snapshot date 24 October 2026/);
 assert.doesNotMatch(html,/23 October/);
 vm.runInContext('currentDayData=null',c);
 assert.match(vm.runInContext("reportSubtitle('realtime',{date:'2026-10-23'})",c),/Snapshot date unavailable/);
});
test('chart hover shows the same line colors, dash patterns and markers as the plot',()=>{
 const tooltip={style:{},classList:{remove(){}},getBoundingClientRect:()=>({width:400})},cursor={setAttribute(){},removeAttribute(){}};
 const hit=new Element(),svg=new Element();svg.getBoundingClientRect=()=>({left:0,width:800});
 const wrapper={dataset:{chart:'plot-1'},getBoundingClientRect:()=>({left:0,width:800}),addEventListener(){},
  querySelectorAll:s=>s==='[data-point]'?[hit]:[],
  querySelector:s=>s==='.chart-tooltip'?tooltip:s==='.chart-cursor'?cursor:s==='svg'?svg:s.startsWith('[data-toggle-series=')?{checked:true}:null};
 hit.dataset.point='0';
 const document={addEventListener(){},querySelector:()=>new Element(),querySelectorAll:s=>s==='.interactive-chart'?[wrapper]:[]};
 const c=app(document);
 vm.runInContext("chart([{time:'00:00',actual:12,forecast:13,water:102.1}],[{key:'actual',name:'Actual <ERP>',color:'#b46c13',marker:'circle'},{key:'forecast',name:'Forecast',color:'#c77e21',marker:'diamond',dashArray:'3 4'},{key:'water',name:'Water level',color:'#087e8b',axis:'right',unit:'ft MSL'}])",c);
 vm.runInContext(fs.readFileSync(path.join(root,'begd/chart-controls.js'),'utf8'),c);
 vm.runInContext("setupCharts('realtime')",c);hit.events.focus();
 assert.equal(tooltip.hidden,false);
 assert.match(tooltip.innerHTML,/Actual &lt;ERP&gt;/);
 assert.match(tooltip.innerHTML,/stroke="#b46c13"[^>]*stroke-dasharray="none"/);
 assert.match(tooltip.innerHTML,/stroke="#c77e21"[^>]*stroke-dasharray="3 4"/);
 assert.match(tooltip.innerHTML,/data-marker="diamond"/);
 assert.match(tooltip.innerHTML,/13 MW/);assert.match(tooltip.innerHTML,/102.1 ft MSL/);
});
test('largest circuit flow uses signed individual observations, ignores gaps and does not sum circuits',()=>{
 const c=app();
 const peak=JSON.parse(vm.runInContext(`JSON.stringify(largestCircuitFlow([{time:'01:00',ishwardi_ghorashal:800,sirajganj_sreepur:900},{time:'02:00',gopalganj_aminbazar:-1338},{time:'03:00',ishwardi_ghorashal:null}]))`,c));
 assert.deepEqual(peak,{key:'gopalganj_aminbazar',time:'02:00',value:-1338,magnitude:1338});
 assert.equal(vm.runInContext('largestCircuitFlow([])',c),null);
 assert.equal(vm.runInContext(`largestCircuitFlow([{time:'00:00',ishwardi_ghorashal:0}]).magnitude`,c),0);
});
test('real-time dispatch always contains separate aligned generation and shedding plots',()=>{
 const c=app();
 vm.runInContext(`currentDayData={today_date:'2026-10-22',demand_hourly:[{time:'00:00',demand_mw:12000,shed_mw:0}],generation_hourly:[{time:'00:00',total_mw:11900}],imports:[]}`,c);
 const html=vm.runInContext('realTime()',c);
 assert.equal((html.match(/data-sync-group="realtime-dispatch"/g)||[]).length,2);
 const models=vm.runInContext('[...chartData.values()].filter(m=>m.syncGroup)',c);
 assert.equal(models.length,2);assert.equal(models[0].series.some(s=>s.key==='shed_mw'),false);assert.equal(models[1].series[0].key,'shed_mw');assert.equal(models[1].rows[0].shed_mw,0);assert.equal(models[0].x(models[0].rows[0]),models[1].x(models[1].rows[0]));
 vm.runInContext('currentDayData.demand_hourly=[];currentDayData.generation_hourly=[]',c);
 const empty=vm.runInContext('realTime()',c);assert.equal((empty.match(/data-sync-group="realtime-dispatch"/g)||[]).length,2);assert.match(empty,/No reported load shedding readings/);
});
test('only Karnaphuli Hydro gets matching hourly lake readings, with missing, zero and legacy values distinguished',()=>{
 const c=app();c.sample={water_level:{source_range:'GenLog!FG13:FG37',hourly:[{time:'00:00',level_ft_msl:102.13},{time:'01:00',level_ft_msl:0},{time:'02:00',level_ft_msl:null},{time:'03:00',level_ft_msl:NaN},{time:'04:00',level_ft_msl:-1}]}};
 assert.equal(vm.runInContext("plantWaterOverlay('Karnaphuli Power Ltd.',sample)",c),null);
 const overlay=vm.runInContext("plantWaterOverlay('Karnaphuli Hydro PP Unit-1,2,3,4, 5',sample)",c);
 assert.equal(overlay.byTime.get('00:00'),102.13);assert.equal(overlay.byTime.get('01:00'),0);assert.equal(overlay.byTime.has('02:00'),false);assert.equal(overlay.byTime.size,2);
 c.sample={plant_units:[{name:'Water Level',hourly:[{time:'00:00',mw:101}]}]};
 assert.equal(vm.runInContext("plantWaterOverlay('Karnaphuli Hydro PP',sample).byTime.get('00:00')",c),101);
});
test('water overlay uses a separate axis, does not rescale MW, and retains gaps and per-series units',()=>{
 const c=app();const rows="[{time:'00:00',mw:20,water:102.1},{time:'01:00',mw:30,water:null},{time:'02:00',mw:40,water:102.05}]";
 const power="{key:'mw',name:'Output',color:'#123'}",water="{key:'water',name:'Kaptai Lake water level',color:'#087e8b',axis:'right',unit:'ft MSL'}";
 const base=vm.runInContext(`chart(${rows},[${power}])`,c),overlay=vm.runInContext(`chart(${rows},[${power},${water}])`,c);
 const ticks=html=>[...html.matchAll(/data-tick-label="\d"[^>]*>([^<]*)/g)].map(m=>m[1]);
 assert.deepEqual(ticks(overlay),ticks(base));assert.match(overlay,/right axis \(ft MSL\)/);assert.match(overlay,/102.1 ft MSL/);assert.match(overlay,/Output: 20 MW/);
 const group=overlay.split('data-series="water"')[1].split('</g>')[0];assert.equal((group.match(/<polyline/g)||[]).length,2);
 const hidden=vm.runInContext(`chart(${rows},[${power},{...${water},defaultVisible:false}])`,c);assert.doesNotMatch(hidden,/class="chart-secondary-axis"/);
});
test('yesterday extends the timeline with ERP supply and reported shedding, preserving dates, gaps and zero',()=>{
 const c=app();
 vm.runInContext(`currentDayData={today_date:'2026-01-01',demand_hourly:[{time:'00:00',demand_mw:100,supply_mw:95,shed_mw:4}],generation_hourly:[],imports:[],forecast_history:{'2025-12-31':{demand_hourly:[{time:'00:00',demand_mw:90,supply_mw:90,shed_mw:0},{time:'23:00',demand_mw:110,supply_mw:100,shed_mw:9}]},'2025-12-30':{demand_hourly:[{time:'12:00',demand_mw:999}]}}}`,c);
 let html=vm.runInContext('realTime()',c);
 assert.match(html,/id="realtime-yesterday">/);assert.doesNotMatch(html,/yesterday_demand_mw/);
 vm.runInContext('chartData.clear();realtimeYesterday=true',c);
 html=vm.runInContext('realTime()',c);
 assert.match(html,/id="realtime-yesterday" checked/);assert.match(html,/31 Dec 2025/);
 const models=vm.runInContext('[...chartData.values()].filter(m=>m.syncGroup)',c);
 assert.equal(models[0].rows.length,3);assert.equal(models[0].rows[1].demand_mw,null);
 assert.equal(models[0].rows[0].yesterday_supply_mw,90);
 assert.equal(models[1].rows[0].yesterday_shed_mw,0);assert.equal(models[1].rows[1].yesterday_shed_mw,9);
 assert.equal(models[1].rows[2].shed_mw,4);
 assert.equal(models[0].rows[2].minute,1440);assert.match(models[0].rows[2].label,/1 Jan 2026/);
 assert(models[0].x(models[0].rows[2])>models[0].x(models[0].rows[1]));
 assert(models[0].series.filter(s=>s.key.startsWith('yesterday_')).every(s=>s.dashArray==='6 4'));
 assert.equal(models[0].x(models[0].rows[1]),models[1].x(models[1].rows[1]));
 vm.runInContext('delete currentDayData.forecast_history["2025-12-31"];chartData.clear()',c);
 html=vm.runInContext('realTime()',c);
 assert.match(html,/id="realtime-yesterday" checked disabled/);assert.match(html,/ERP readings unavailable/);
 assert.equal(vm.runInContext('[...chartData.values()][0].series.length',c),2);
});
test('the shared yesterday control extends fuel, shares, total imports and every route with exact-date readings',()=>{
 const c=app();
 vm.runInContext(`var gen={time:'00:00',total_mw:100,gas_mw:30,liquid_mw:20,coal_mw:30,hydro_mw:10,solar_mw:0,wind_mw:0};var routes=['Bheramara HVDC','Tripura','Adani','Nepal'].map((name,i)=>({name,hourly:[{time:'00:00',mw:i+1}]}));currentDayData={today_date:'2026-01-01',demand_hourly:[],generation_hourly:[gen],imports:routes,realtime_history:{'2025-12-31':{generation_hourly:[{...gen,gas_mw:25}],imports:routes.slice().reverse()}},forecast_history:{}};realtimeYesterday=true`,c);
 const html=vm.runInContext('realTime()',c);
 assert(html.indexOf('id="realtime-yesterday"')<html.indexOf('realtime-grid'));
 const models=vm.runInContext('[...chartData.values()]',c);
 const byScope=key=>models.find(m=>m.scope===key);
 const fuel=byScope('realtime:gas_mw');assert.equal(fuel.rows[0].yesterday_gas_mw,25);assert.equal(fuel.rows[0].yesterday_solar_mw,0);
 const shares=byScope('realtime:import_dependence_pct');assert.equal(shares.rows[0].yesterday_import_dependence_pct,10);assert.equal(shares.rows[0].yesterday_renewable_share_pct,10);assert.equal(shares.unit,'%');
 const total=byScope('realtime:total_import_mw');assert.equal(total.rows[0].yesterday_total_import_mw,10);
 const imports=byScope('realtime:import_0');assert.equal(imports.series.filter(s=>s.key.startsWith('yesterday_')).length,4);
 for(const item of imports.series.filter(s=>!s.key.startsWith('yesterday_')))assert.equal(imports.rows[0]['yesterday_'+item.key],imports.rows[1][item.key],'Route order changed the comparison');
 for(const model of [fuel,shares,total,imports]){assert.match(model.rows[0].label,/31 Dec 2025/);assert.match(model.rows[1].label,/1 Jan 2026/);assert(model.x(model.rows[0])<model.x(model.rows[1]));}
 vm.runInContext('currentDayData.realtime_history={};chartData.clear()',c);
 const missing=vm.runInContext('realTime()',c);assert.match(missing,/Yesterday’s readings unavailable for this plot/);
 assert(vm.runInContext('[...chartData.values()].every(m=>m.series.every(s=>!s.key.startsWith("yesterday_")))',c));
});
test('historical shares require matching routes, positive total generation and complete renewable readings',()=>{
 const c=app();
 const evaluate=(generation,routes,rows)=>JSON.parse(vm.runInContext(`JSON.stringify(realtimeShares(${JSON.stringify(generation)},${JSON.stringify(routes)},${JSON.stringify(rows)}))`,c))[0];
 const gen=[{time:'00:00',total_mw:100,hydro_mw:0,solar_mw:0,wind_mw:0}],imports=[{time:'00:00',total_import_mw:10}];
 assert.equal(evaluate(gen,[],imports).import_dependence_pct,null);
 assert.equal(vm.runInContext(`realtimeImportRows([{name:'Nepal',hourly:[{time:'00:00',mw:0}]}],['Nepal'])[0].total_import_mw`,c),null);
 assert.equal(evaluate(gen,[],imports).renewable_share_pct,0);
 assert.equal(evaluate([{...gen[0],total_mw:0}],[],imports).renewable_share_pct,null);
 assert.equal(evaluate([{...gen[0],wind_mw:null}],[],imports).renewable_share_pct,null);
});
test('comparison tooltips show only the inspected date, without empty rows for the other day',()=>{
 const tooltip={style:{},classList:{remove(){}},getBoundingClientRect:()=>({width:300})},cursor={setAttribute(){},removeAttribute(){}};
 const hits=[new Element(),new Element()];hits.forEach((hit,i)=>hit.dataset.point=String(i));
 const svg=new Element();svg.getBoundingClientRect=()=>({left:0,width:800});
 const wrapper={dataset:{chart:'plot-1'},getBoundingClientRect:()=>({left:0,width:800}),addEventListener(){},querySelectorAll:s=>s==='[data-point]'?hits:[],querySelector:s=>s==='.chart-tooltip'?tooltip:s==='.chart-cursor'?cursor:s==='svg'?svg:s.startsWith('[data-toggle-series=')?{checked:true}:null};
 const document={addEventListener(){},querySelector:()=>new Element(),querySelectorAll:s=>s==='.interactive-chart'?[wrapper]:[]};
 const c=app(document);
 vm.runInContext("currentDayData={today_date:'2026-01-01'};realtimeYesterday=true;realtimePlot([{time:'00:00',demand:100}],[{key:'demand',name:'Demand',color:'#123456'}],[{time:'00:00',demand:90}])",c);
 vm.runInContext(fs.readFileSync(path.join(root,'begd/chart-controls.js'),'utf8'),c);vm.runInContext("setupCharts('realtime')",c);
 c.window.matchMedia=()=>({matches:true});tooltip.hidden=true;
 hits[0].events.pointerenter({pointerType:'mouse'});assert.equal(tooltip.hidden,true);
 hits[0].events.pointerenter({pointerType:'touch'});hits[0].events.click({pointerType:'touch'});assert.equal(tooltip.hidden,true);
 hits[0].events.focus();assert.match(tooltip.innerHTML,/31 Dec 2025/);assert.match(tooltip.innerHTML,/90 MW/);assert.doesNotMatch(tooltip.innerHTML,/100 MW|— MW/);
 hits[1].events.focus();assert.match(tooltip.innerHTML,/1 Jan 2026/);assert.match(tooltip.innerHTML,/100 MW/);assert.doesNotMatch(tooltip.innerHTML,/yesterday|90 MW|— MW/);
});

test('Operations overlays every comparison source on the union of EWIC timestamps without zero-filling',()=>{
 const c=app();
 const report={date:'2026-10-26',operations:{ewic:[{time:'00:00',ishwardi_ghorashal:0,sirajganj_sreepur:-10,gopalganj_aminbazar:20},{time:'02:00',ishwardi_ghorashal:30}]}};
 const sources=[['yesterday',{date:'2026-10-25',operations:{ewic:[{time:'01:00',ishwardi_ghorashal:-40,sirajganj_sreepur:50}]}}],['tomorrow',{date:'2026-10-27',operations:{ewic:[]}}],['highest',{date:'2026-05-20',operations:{ewic:[{time:'02:00',gopalganj_aminbazar:60}]}}],['custom_2026-09-13',{date:'2026-09-13',operations:{ewic:[{time:'03:00',ishwardi_ghorashal:70}]}}]];
 const result=vm.runInContext(`operationsFlowComparison(${JSON.stringify(report)},${JSON.stringify(sources)})`,c);
 assert.deepEqual(Array.from(result.rows,r=>r.time),['00:00','01:00','02:00','03:00']);
 assert.equal(result.rows[0].ishwardi_ghorashal,0);assert.equal(result.rows[0].sirajganj_sreepur,-10);
 assert.equal(result.rows[1].ishwardi_ghorashal,null);assert.equal(result.rows[1].ishwardi_ghorashal_yesterday,-40);
 assert.equal(result.rows[2].gopalganj_aminbazar_highest,60);
 assert.equal(result.rows[3]['ishwardi_ghorashal_custom_2026-09-13'],70);
 assert.equal(result.series.length,15);assert.match(result.series[3].name,/Yesterday \(25 Oct 2026\)/);
 assert.equal(result.series[3].source,'yesterday');assert.equal(result.series[0].key,'ishwardi_ghorashal');
 assert.equal(result.rows[0].ishwardi_ghorashal_tomorrow,null);
});
test('Operations passes selected and comparison circuits to the chart while keeping daily summaries selected-day only',()=>{
 const c=app();
 vm.runInContext(`data={date:'2026-10-26',operations:{ewic:[{time:'00:00',ishwardi_ghorashal:1}]}};comparisonData.yesterday={date:'2026-10-25',operations:{ewic:[{time:'01:00',ishwardi_ghorashal:2}]}};chart=(rows,series)=>JSON.stringify({rows,series});metric=()=>'';`,c);
 const html=vm.runInContext('operations()',c);assert.match(html,/ishwardi_ghorashal_yesterday/);assert.match(html,/Yesterday \(25 Oct 2026\)/);assert.match(html,/selected and comparison operating dates/);
});

test('regional stacked comparisons have full-bar hatching, numbered dates and matching legend patterns',()=>{
 const c=app();vm.runInContext(fs.readFileSync(path.join(root,'begd/comparisons.js'),'utf8'),c);
 vm.runInContext(`data={date:'2026-10-26',regions:[{name:'Dhaka',energy_mwh:24000,demand_mw:2000,shed_mw:10}]};comparisonData.yesterday={date:'2026-10-25',regions:[{name:'Dhaka',energy_mwh:20000,demand_mw:1800,shed_mw:5}]};regionalSnapshotStyle='stacked';`,c);
 const html=vm.runInContext('regionalSnapshotChart()',c);
 assert.match(html,/class="regional-snapshot-date-outline"[^>]*fill="url\(#regional-dates-\d+-1\)"[^>]*pointer-events="none"/);
 assert.match(html,/class="regional-date-number"[^>]*>1<\/text>/);assert.match(html,/class="regional-date-number"[^>]*>2<\/text>/);
 assert.match(html,/2 · 25 Oct 2026/);assert.match(html,/<small>Yesterday<\/small>/);assert.match(html,/regional-dates-\d+-legend-1/);
 const again=vm.runInContext('regionalSnapshotChart()',c);assert.notEqual(html.match(/pattern id="([^"]+)"/)[1],again.match(/pattern id="([^"]+)"/)[1]);
 const line=vm.runInContext("regionalSnapshotStyle='line';regionalSnapshotChart()",c);assert.doesNotMatch(line,/class="regional-date-number"/);
});

test('fuel icons remain in legends without adding icons to series endpoints',()=>{
 const c=app();
 const html=vm.runInContext(`chart([{time:'00:00',gas:10},{time:'23:00',gas:20}],[{key:'gas',name:'Gas',color:'#123456',fuelIcon:'gas-factory.png'}])`,c);
 assert.match(html,/class="series-fuel-icon"/);assert.match(html,/gas-factory.png/);
 assert.doesNotMatch(html,/series-end-icon|<mask|<image/);
});

test('realtime polling keeps chart update time on unchanged snapshots and retains readings when refresh fails',async()=>{
 const c=app();c.location={hash:'#overview'};
 const snapshot={today_date:'2026-10-28',updated_at:'2026-10-28T14:46:52Z',demand_hourly:[{time:'15:00'}],generation_hourly:[],imports:[]};
 c.fetch=async()=>({ok:true,json:async()=>snapshot});
 await vm.runInContext('loadCurrentDay()',c);
 assert(Number.isFinite(Date.parse(vm.runInContext('currentDayChartUpdatedAt',c))));
 vm.runInContext("currentDayChartUpdatedAt='2026-10-28T17:00:00Z'",c);
 await vm.runInContext('loadCurrentDay()',c);
 assert.equal(vm.runInContext('currentDayChartUpdatedAt',c),'2026-10-28T17:00:00Z');
 c.fetch=async()=>{throw Error('offline')};await vm.runInContext('loadCurrentDay()',c);
 assert.equal(vm.runInContext('currentDayData.demand_hourly[0].time',c),'15:00');
 assert.equal(vm.runInContext('currentDayData.snapshot_refresh_failed',c),true);
 assert.equal(vm.runInContext('currentDayChartUpdatedAt',c),'2026-10-28T17:00:00Z');
});

test('daily Operations table uses the same categories as the Trends Explorer',()=>{
 const c=app();
 vm.runInContext(fs.readFileSync(path.join(root,'begd/operational-events.js'),'utf8'),c);
 const html=vm.runInContext(`data={operations:{events:[{outage_time:'08:00',restoration_time:'—',description:'Grid Forced S/D Due to CB tripped <source>'},{description:'Unspecified note'}]}};operations()`,c);
 assert.match(html,/Filter daily event log by category/);
 assert.match(html,/<td class="event-category">Forced Shutdown<\/td>/);
 assert.match(html,/<td class="event-category">Unclassified \/ Source Fragment<\/td>/);
 assert.match(html,/&lt;source&gt;/);assert.doesNotMatch(html,/<source>/);
 assert.match(vm.runInContext('data={operations:{events:[]}};operations()',c),/colspan="4"/);
});

test('daily event category filter keeps the chart mounted and updates matching rows and count',()=>{
 const c=app(),rows=[{dataset:{eventCategory:'trip'},hidden:false},{dataset:{eventCategory:'forced'},hidden:false}],count={textContent:''};
 const wrap={scrollTop:100,querySelectorAll(){return rows},parentElement:{querySelector(){return count}}};
 c.control={value:'trip',closest(){return wrap}};
 vm.runInContext('filterDailyEvents(control)',c);
 assert.deepEqual(rows.map(row=>row.hidden),[false,true]);assert.equal(count.textContent,'1 of 2 entries shown');assert.equal(wrap.scrollTop,0);
 c.control.value='';vm.runInContext('filterDailyEvents(control)',c);
 assert.deepEqual(rows.map(row=>row.hidden),[false,false]);assert.equal(count.textContent,'2 of 2 entries shown');
});
test('daily event filter persists where available and resets for a report without that category',()=>{
 const c=app();vm.runInContext(fs.readFileSync(path.join(root,'begd/operational-events.js'),'utf8'),c);
 let html=vm.runInContext(`dailyEventCategory='trip';data={operations:{events:[{description:'Unit Tripped'},{description:'Grid Forced S/D'}]}};operations()`,c);
 assert.match(html,/<option value="trip" selected>/);assert.match(html,/data-event-category="forced" hidden/);assert.match(html,/1 of 2 entries shown/);
 html=vm.runInContext(`data={operations:{events:[{description:'Grid Forced S/D'}]}};operations()`,c);
 assert.equal(vm.runInContext('dailyEventCategory',c),'');assert.match(html,/1 of 1 entries shown/);
});

test('fresh workbook fetches pass the latest EWIC readings and P1 logs into matching, including same-ID refreshes',async()=>{
 const nodes=new Map();const document={addEventListener(){},querySelectorAll(){return []},querySelector(selector){
  if(!nodes.has(selector))nodes.set(selector,{textContent:'',innerHTML:'',checked:false,hidden:false,value:'',addEventListener(){}});return nodes.get(selector);
 }};
 const context=app(document),calls=[];
 context.location={hash:'#operations'};
 context.window.BEGDEWICMap={mount:(flows,events)=>calls.push({flows,events})};
 const payloads=[{report_id:'1',date:'2026-10-29',operations:{ewic:[{time:'01:00',ishwardi_ghorashal:10}],events:[{description:'Ishurdi-Ghorasal first entry'}]}},{report_id:'1',date:'2026-10-29',operations:{ewic:[{time:'02:00',ishwardi_ghorashal:-20}],events:[{description:'Sirajganj-Sreepur refreshed entry'}]}}];
 context.fetch=async()=>({ok:true,json:async()=>payloads.shift()});
 vm.runInContext("setupCharts=()=>{};operations=()=>'';reportSubtitle=()=>'';loadPreviousForecast=()=>{}",context);
 assert.equal(await vm.runInContext("load('1')",context),true);
 assert.equal(await vm.runInContext("load('1')",context),true);
 assert.equal(calls.length,2);assert.equal(calls[0].flows[0].ishwardi_ghorashal,10);assert.equal(calls[1].flows[0].ishwardi_ghorashal,-20);
 assert.match(calls[1].events[0].description,/refreshed entry/);
});

test('EWIC event focus highlights the series and exact event time without emphasizing flow points',()=>{
 const selected=['ishwardi_ghorashal','sirajganj_sreepur','ishwardi_ghorashal_yesterday'].map(key=>{
  const classes=new Set();return {dataset:{series:key},style:{},classes,classList:{toggle(k,on){on?classes.add(k):classes.delete(k)}}};
 });
 const layers=[];const svg={append(node){layers.push(node)}};
 const wrapper={dataset:{chart:'test-ewic'},querySelector:()=>svg,querySelectorAll(selector){return selector.includes('data-series')?selected:layers.filter(l=>!l.removed)}};
 const document={addEventListener(){},querySelector:s=>s==='.ewic-chart-column .interactive-chart'?wrapper:{addEventListener(){}},createElementNS(_,tag){return {tag,attrs:{},children:[],setAttribute(k,v){this.attrs[k]=v},append(child){this.children.push(child)},remove(){this.removed=true}}}};
 const context=app(document);
 vm.runInContext("chartData.set('test-ewic',{rows:[{time:'18:30',ishwardi_ghorashal:50,sirajganj_sreepur:100}],series:[{key:'ishwardi_ghorashal',name:'Ishwardi–Ghorashal',color:'#123456'},{key:'sirajganj_sreepur',name:'Sirajganj–Sreepur',color:'#abcdef'}],x:row=>Number(row.time.slice(0,2))*60+Number(row.time.slice(3)),y:value=>200-value,plotBounds:{left:0,right:1440,top:10,bottom:200}})",context);
 vm.runInContext("highlightEWICMoment({time:'18:21',row:{time:'18:30'},reasons:[{keys:['ishwardi_ghorashal']}]})",context);
 assert.equal(selected[0].classes.has('ewic-series-focused'),true);
 assert.equal(selected[1].classes.has('ewic-series-muted'),true);
 assert.equal(selected[2].classes.has('ewic-series-muted'),true);
 const marks=layers.at(-1).children;
 assert.equal(marks.find(n=>n.tag==='line').attrs.x1,'1101');
 assert.equal(marks.filter(n=>n.tag==='circle').length,0);
 vm.runInContext('highlightEWICMoment(null)',context);
 assert.equal(layers[0].removed,true);assert.ok(selected.every(g=>g.classes.size===0));
});

test('EWIC chart redraws at measured dimensions and skips redundant size notifications',()=>{
 let callback;const updates=[];
 const svg={clientWidth:612,clientHeight:388};
 const wrapper={dataset:{chart:'resize-ewic'},isConnected:true,querySelector:()=>svg};
 const column={querySelector:()=>wrapper};
 const document={addEventListener(){},querySelector:s=>s==='.ewic-chart-column'?column:{addEventListener(){}}};
 const c=app(document);
 c.ResizeObserver=class{constructor(fn){callback=fn}observe(node){assert.equal(node,column)}};
 c.recordResize=(node,view,dimensions)=>{assert.equal(node,wrapper);assert.equal(view,'operations');updates.push(dimensions);vm.runInContext(`chartData.set('resize-ewic',{width:${dimensions.width},height:${dimensions.height}})`,c)};
 vm.runInContext("chartData.set('resize-ewic',{width:800,height:360});refreshChart=recordResize;setupEWICChartSize()",c);
 callback();assert.equal(updates.length,1);assert.equal(updates[0].width,612);assert.equal(updates[0].height,388);
 callback();assert.equal(updates.length,1);
 svg.clientWidth=520;callback();assert.equal(updates.length,2);assert.equal(updates[1].width,520);
 const html=vm.runInContext("chart([{time:'00:00',value:100}],[{key:'value',color:'#123456',name:'Flow'}],{width:612,height:388})",c);
 assert.match(html,/viewBox="0 0 612 388"/);assert.doesNotMatch(html,/preserveAspectRatio="none"/);
});
test('hourly shading follows selected, explicit forecast, and real-time dates across midnight',()=>{
 const c=app();c.window.BEGDDaylight=require('../begd/daylight.js');c.location={hash:'#overview'};
 vm.runInContext("data={date:'2026-11-02'};currentDayData={today_date:'2026-11-04'}",c);
 const draw=options=>vm.runInContext(`chart([{time:'00:00',mw:100},{time:'23:00',mw:200}],[{key:'mw',name:'Power',color:'#123456'}],${JSON.stringify(options)})`,c);
 const selected=draw({});assert.match(selected,/data-daylight-date="2026-11-02"/);
 assert.ok(selected.indexOf('daylight-background')<selected.indexOf('class="axis"'));
 assert.match(draw({date:'2026-06-21'}),/data-daylight-date="2026-06-21"/);
 c.location.hash='#realtime';assert.match(draw({}),/data-daylight-date="2026-11-04"/);
 const two=vm.runInContext("realtimeYesterday=true;realtimePlot([{time:'23:00',mw:100}],[{key:'mw',name:'Power',color:'#123456'}],[{time:'00:00',mw:90}])",c);
 assert.match(two,/data-daylight-date="2026-11-03"/);assert.match(two,/data-daylight-date="2026-11-04"/);
});

test('missing Energy Curve totals preserve readings instead of scaling all energy to zero',()=>{
 const c=app();
 const draw=totals=>vm.runInContext(`energyCurveHourlyTable([{time:'00:00',gas_mw:100,shortage_mw:2},{time:'00:30',gas_mw:100,shortage_mw:2}],[{key:'gas_mw',name:'Gas'},{key:'shortage_mw',name:'Shortage'}],${JSON.stringify(totals)},'energy')`,c);
 for(const totals of [{},{energy_generated_mwh:null,energy_not_served_mwh:null}]){
  const html=draw(totals);
  assert.match(html,/<td>100<\/td>/);
  assert.match(html,/unscaled readings/);
  assert.match(html,/class="energy-curve-shortage">2<\/td>/);
 }
 const reconciled=draw({energy_generated_mwh:200,energy_not_served_mwh:4});
 assert.match(reconciled,/<td>200<\/td>/);assert.match(reconciled,/class="energy-curve-shortage">4<\/td>/);
 assert.doesNotMatch(reconciled,/unscaled readings/);
 const zero=draw({energy_generated_mwh:0,energy_not_served_mwh:0});
 assert.doesNotMatch(zero,/<td>100<\/td>/);
});

test('unreported interconnector energy stays unavailable rather than becoming zero',()=>{
 const c=app();
 const html=vm.runInContext(`data={date:'2026-11-02',operations:{east_west:{energy_east_to_west_kwh:null,energy_west_to_east_kwh:45199472.73}},hourly:[]};operations()`,c);
 assert.match(html,/East → west energy[^]*?class="value">—/);
 assert.match(html,/45,199.47/);
});


test('overview energy composition mirrors realtime fuel and share charts from En-Curve readings',()=>{
 const c=app();
 const sources=[
  ['gas_public_mw','Gas-Public'],['gas_pvt_mw','Gas-Pvt'],['hfo_public_mw','HFO-Public'],['hsd_public_mw','HSD-Public'],
  ['coal_mw','Coal'],['hydro_mw','Hydro'],['solar_mw','Solar'],['wind_mw','Wind'],
  ['hvdc_mw','HVDC'],['nepal_mw','Nepal'],['tripura_mw','Tripura'],['adani_mw','Adani']
 ].map(([key,name])=>({key,name}));
 const first={time:'00:00',gas_public_mw:60,gas_pvt_mw:40,hfo_public_mw:20,hsd_public_mw:10,coal_mw:100,hydro_mw:30,solar_mw:20,wind_mw:10,hvdc_mw:50,nepal_mw:20,tripura_mw:20,adani_mw:20,total_generation_mw:400};
 const incomplete={...first,time:'00:30',gas_public_mw:55,adani_mw:null,wind_mw:null,total_generation_mw:300};
 const endpoint={...first,time:'24:00'};
 vm.runInContext(`data={date:'2026-11-05',en_curve:${JSON.stringify({date:'2026-11-05',sources,hourly:[first,incomplete,endpoint]})}}`,c);
 const html=vm.runInContext('overviewEnergyCompositionCharts()',c);
 const models=JSON.parse(vm.runInContext(`JSON.stringify([...chartData.values()].map(model=>({rows:model.rows,series:model.series.map(series=>({key:series.key,name:series.name})),unit:model.unit,xRight:model.plotBounds.right,xEnd:model.x(model.rows.at(-1))})))`,c));
 assert.match(html,/Generation by fuel type/);assert.match(html,/Import dependence \(%\) & renewable share \(%\)/);
 assert.equal(models.length,2);assert.equal(models[0].unit,'MW');assert.equal(models[1].unit,'%');
 assert.deepEqual(models[0].series.map(series=>series.name),['Gas','Liquid fuel','Coal','Hydro','Solar','Wind']);
 assert.equal(models[0].rows[0].fuel_type_0,100);assert.equal(models[0].rows[0].fuel_type_1,30);
 assert.ok(Math.abs(models[1].rows[0].import_dependence_pct-27.5)<1e-9);assert.ok(Math.abs(models[1].rows[0].renewable_share_pct-15)<1e-9);
 assert.equal(models[1].rows[1].import_dependence_pct,null);assert.equal(models[1].rows[1].renewable_share_pct,null);
 assert.equal(models[0].xEnd,models[0].xRight,'the 24:00 workbook endpoint should land at the right edge');
});
