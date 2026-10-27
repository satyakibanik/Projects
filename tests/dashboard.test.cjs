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
 hits[0].events.focus();assert.match(tooltip.innerHTML,/31 Dec 2025/);assert.match(tooltip.innerHTML,/90 MW/);assert.doesNotMatch(tooltip.innerHTML,/100 MW|— MW/);
 hits[1].events.focus();assert.match(tooltip.innerHTML,/1 Jan 2026/);assert.match(tooltip.innerHTML,/100 MW/);assert.doesNotMatch(tooltip.innerHTML,/yesterday|90 MW|— MW/);
});
