const {test}=require('node:test');
const assert=require('node:assert/strict');
const {selectRows,difference,plot,tooltipHTML,historyNote}=require('../begd/fuel.js');
const rows=[{date:'2026-10-01',total:10},{date:'2026-10-03',total:20},{date:'2026-10-04',total:30}];
test('fuel ranges use calendar days, not report count, and never borrow future data',()=>{
 assert.deepEqual(selectRows(rows,'2026-10-03','2').map(r=>r.date),['2026-10-03']);
 assert.equal(selectRows(rows,'2026-10-03','all').length,2);
 assert.equal(selectRows(rows,'2026-10-04','365').length,3);
 assert.equal(selectRows(rows,'2026-09-30','7').length,0);
});
test('tooltips show all series, exact units, zero values and escaped source labels',()=>{
 const html=tooltipHTML({date:'2026-11-03',total:0,lng:983.6},[['total','Total','#123456'],['lng','LNG','#654321']]);
 assert.match(html,/3 Nov 2026/);assert.match(html,/0.0 MMCFD/);assert.match(html,/983.6 MMCFD/);
 const coal=tooltipHTML({year:'2025–2026',tonnes:762752.63},[['tonnes','Coal','#123456']],'metric tonnes',3);
 assert.match(coal,/762,752.630 metric tonnes/);
 assert.match(tooltipHTML({label:'<unsafe>',value:1},[['value','Gas & LNG','#123456']]),/&lt;unsafe&gt;/);
 assert.doesNotMatch(tooltipHTML({label:'<unsafe>',value:1},[['value','Gas','#123456']]),/<unsafe>/);
});
test('every daily and annual chart gives each observation a keyboard/touch/hover target',()=>{
 for(const html of [plot(rows,[['total','Total','#123456']]),plot([{year:'2025–2026',tonnes:0}],[['tonnes','Coal','#123456']],{bars:true,annual:true,unit:'metric tonnes'})]){
  assert.match(html,/data-fuel-point="0"/);assert.match(html,/tabindex="0"/);assert.match(html,/class="fuel-tooltip" role="tooltip" hidden/);
  assert.doesNotMatch(html,/NaN|undefined/);
 }
});
test('history notes distinguish saved coverage, calendar gaps and observed-day averages',()=>{
 const html=historyNote(rows,rows,'2026-10-04','7',[['total','Total','#123456']]);
 assert.match(html,/1 Oct 2026–4 Oct 2026/);assert.match(html,/3 published daily reports spanning 4 calendar days/);
 assert.match(html,/3 of 7 calendar days reported/);assert.match(html,/4 missing days/);assert.match(html,/Total: 20.0 MMCFD/);
 assert.match(html,/Earlier dates are unavailable in this saved dataset/);
});

async function rendered(search=''){
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),nodes=new Map();
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{hidden:false,innerHTML:'',textContent:'',addEventListener(){}});return nodes.get(selector);};
 const source=fs.readFileSync(path.join(__dirname,'../begd/fuel.js'),'utf8');
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../begd/fuel-data.json'),'utf8'));
 const window={addEventListener(){}},location={hash:'#fuel',search};
 vm.runInNewContext(source,{window,location,URLSearchParams,document:{querySelector:node,getElementById:node,querySelectorAll(){return[];}},fetch:async()=>({ok:true,json:async()=>data})});
 await window.BEGDFuel.mount();return {html:node('#content').innerHTML,subtitle:node('#subtitle').textContent};
}
test('Gas starts with its daily snapshot, then both histories and a collapsed table',async()=>{
 const {html}=await rendered('?fuelWindow=365');
 const headings=['Latest available day','Gas supply by source','Where the gas went','Gas supply over time','Gas supply & demand in the power sector','Daily gas data'];
 const positions=headings.map(h=>html.indexOf(h));assert.ok(positions.every(n=>n>=0));assert.deepEqual(positions,positions.slice().sort((a,b)=>a-b));
 assert.match(html,/<details class="fuel-panel" id="fuel-daily-table">/);
 assert.match(html,/of 365 calendar days reported/);assert.doesNotMatch(html,/Barapukuria coal production/);
});
test('Coal contains only annual data and its collapsed table, preserving a direct Coal URL',async()=>{
 const {html,subtitle}=await rendered('?fuelType=coal&fuelWindow=7&fuelDate=2026-10-27');
 assert.match(html,/id="fuel-tab-coal"[^>]*aria-selected="true"/);
 assert.match(html,/Annual Barapukuria coal production/);assert.match(html,/2005–2006/);assert.match(html,/2025–2026/);
 assert.match(html,/<details class="fuel-panel" id="fuel-coal-table">/);
 assert.doesNotMatch(html,/Gas time window|Latest available day|Daily gas data/);assert.match(subtitle,/annual Barapukuria/);
});
test('individual series selection removes hidden geometry and keeps all layer choices available',()=>{
 const fields=[['total','Total','#123456'],['lng','LNG','#654321']];
 const html=plot(rows.map(r=>({...r,lng:5})),fields,{chartKey:'gas-supply',hidden:['gas-supply:lng']});
 assert.equal((html.match(/<circle /g)||[]).length,3);
 assert.match(html,/data-fuel-layer="gas-supply:total" checked/);
 assert.match(html,/data-fuel-layer="gas-supply:lng" >/);
 assert.doesNotMatch(html,/<circle[^>]*fill="#654321"/);
});
test('none hides all marks without hiding All, None or individual controls',()=>{
 const html=plot(rows,[['total','Total','#123456']],{chartKey:'gas-supply',hidden:['gas-supply:total']});
 assert.match(html,/No layers selected/);assert.match(html,/data-fuel-layers="all"/);assert.match(html,/data-fuel-layers="none"/);
 assert.match(html,/data-fuel-layer="gas-supply:total"/);assert.doesNotMatch(html,/<circle |data-fuel-point=/);
});
test('highlighted toolbars are removed while individual legend toggles remain',async()=>{
 const coal=plot([{year:'2025–2026',tonnes:1}],[['tonnes','Coal','#123456']],{bars:true,annual:true,chartKey:'coal-production'});
 assert.doesNotMatch(coal,/fuel-layer-actions|data-fuel-layers=/);assert.match(coal,/data-fuel-layer="coal-production:tonnes"/);
 const categories=[{layerKey:'state',label:'State companies',year:'State',value:100}];
 const source=plot(categories,[['value','Gas','#123456']],{bars:true,categorical:true,chartKey:'gas-source'});
 assert.doesNotMatch(source,/fuel-layer-actions|data-fuel-layers=/);assert.match(source,/data-fuel-layer="gas-source:state"/);
 const distribution=plot(categories,[['value','Gas','#123456']],{bars:true,categorical:true,chartKey:'gas-distribution'});
 assert.doesNotMatch(distribution,/<span>Chart layers<\/span>/);assert.match(distribution,/data-fuel-layers="all"/);
});
test('daily source categories can be selected individually',()=>{
 const categories=[{layerKey:'state',label:'State companies',year:'State',value:100},{layerKey:'ioc',label:'International operators',year:'IOCs',value:200}];
 const html=plot(categories,[['value','Gas','#123456']],{bars:true,categorical:true,chartKey:'gas-source',hidden:['gas-source:state']});
 assert.match(html,/<title>International operators/);assert.doesNotMatch(html,/<title>State companies/);
 assert.match(html,/data-fuel-layer="gas-source:state" >/);assert.match(html,/data-fuel-layer="gas-source:ioc" checked/);
});
test('direct links restore per-chart layer selections independently',async()=>{
 const {html}=await rendered('?fuelHide=gas-supply:lng,gas-source:state');
 assert.match(html,/data-fuel-layer="gas-supply:lng" >/);assert.match(html,/data-fuel-layer="gas-source:state" >/);
 assert.match(html,/data-fuel-layer="gas-power:power_supply" checked/);
});
test('missing secondary check remains missing',()=>{
 assert.equal(difference(rows[0],null),null);
 assert.ok(Math.abs(difference({total:2561.9},{total:2561.861})-.039)<.000001);
});
test('gas lines do not bridge missing reporting days',()=>{
 const html=plot(rows,[['total','Total','#123456']]);
 assert.equal((html.match(/<circle /g)||[]).length,3);
 assert.equal((html.match(/stroke-width="2.5"/g)||[]).length,1);
 assert.match(plot([],[]),/No verified reports/);
 assert.match(plot([{date:'2026-11-03',total:0}],[['total','Total','#123456']]),/0.0 MMCFD/);
});

test('multi-year gas history includes years on its axis',()=>{
 const html=plot([{date:'2020-01-12',total:3167.9},{date:'2026-11-04',total:2561.7}],[['total','Total','#123456']]);
 assert.match(html,/>2020-01<\/text>/);assert.match(html,/>2026-11<\/text>/);
});

test('all saved GTCL dates remain visible even when Petrobangla has no report',async()=>{
 const {html}=await rendered('?fuelWindow=all');
 assert.match(html,/All saved GTCL reports/);
 const data=require('../begd/fuel-data.json');
 for(const check of data.checks)assert.ok(html.includes(check.url));
});
