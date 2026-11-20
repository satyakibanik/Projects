const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const data=JSON.parse(fs.readFileSync(path.join(root,'begd/system-loss-data.json'),'utf8'));
function load(failure=false){
 const window={addEventListener(){}};
 const context={window,Date,Map,Set,fetch:async()=>({ok:!failure,json:async()=>data})};
 for(const name of ['system-loss.js','trends.js'])vm.runInNewContext(fs.readFileSync(path.join(root,'begd',name),'utf8'),context);
 return window;
}
test('annual source values retain fiscal years, missing NESCO values and published combined loss',async()=>{
 const window=load();await window.BEGDSystemLoss.load();
 const html=window.BEGDSystemLoss.panels(window.BEGDTrends.plot);
 for(const label of ['Annual transmission &amp; distribution loss','Annual utility system loss','2024-25','2001-02','NESCO','10.13','Reference snapshot saved'])assert.ok(html.includes(label),label);
 assert.doesNotMatch(html,/NaN|undefined|Infinity/);
 assert.match(html,/FY 2024-25 · Transmission &amp; distribution: 10.13 %/);
 assert.match(html,/FY 2001-02/);
 assert.match(html,/missing values remain gaps/);
});
test('tooltips show fiscal-year labels and percentages rather than invented daily readings',()=>{
 const window=load();const html=window.BEGDTrends.tooltipRows({rows:[{date:'2024-07-01',fiscal_year:'2024-25',v:10.13}],series:[{name:'Combined loss',value:r=>r.v}],unit:'%'},0);
 assert.match(html,/<strong>FY 2024-25<\/strong>/);assert.match(html,/10.13 %/);assert.doesNotMatch(html,/1 Jul/);
});
test('absent fiscal years break chart lines and missing values stay null',()=>{
 const window=load();const rows=window.BEGDSystemLoss.annualRows({data:[{fiscal_year:'2024-25',v:8},{fiscal_year:'2022-23',v:10}]});
 assert.equal(rows.length,3);assert.equal(rows[1].fiscal_year,'2023-24');assert.equal(rows[1].v,undefined);
 const html=window.BEGDTrends.plot(rows,[{name:'Loss',value:r=>r.v}],'Annual','%',false,{ticks:[{index:0,label:'2022-23',sparse:true}]});
 assert.match(html,/<path d="M[^L]*M/);assert.match(html,/>2022-23<\/text>/);
});
test('source fetch failure stays isolated from historical generation panels',async()=>{
 const window=load(true);await window.BEGDSystemLoss.load();
 assert.match(window.BEGDSystemLoss.panels(window.BEGDTrends.plot),/could not be loaded/);
 const trends=fs.readFileSync(path.join(root,'begd/trends.js'),'utf8');
 assert.match(trends,/historyPanels\(\)\)\+\(root.BEGDSystemLoss\?\.panels\(plot\)/);
 const index=fs.readFileSync(path.join(root,'begd/index.html'),'utf8');
 assert.ok(index.indexOf('src="system-loss.js')<index.indexOf('src="trends.js'));
});
