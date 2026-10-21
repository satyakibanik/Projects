const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../begd/metric-methods.js'),'utf8');
function methods(){const window={};vm.runInNewContext(source,{window});return window.BEGDMetricMethods;}
const report={date:'2026-10-19',source_url:'https://erp.powergrid.gov.bd/web/files/download?location=5170.xlsx',summary:{unserved_mwh:822}};
test('unserved provenance distinguishes a published total from integrated chart readings',()=>{
 const html=methods().render('Energy not served',{report});
 for(const text of ['P1!K9','GWh','2 decimal places','not the gap','does not expose','2026-10-19','Original report'])assert.ok(html.includes(text),text);
 assert.match(methods().render('Energy not served',{report,curve:true}),/En-Curve!U8/);
});
test('trend provenance includes contributing zero values and omits missing days',()=>{
 const rows=[{...report,generation_mwh:0},{date:'2026-10-18',generation_mwh:null},{...report,date:'2026-10-17',generation_mwh:3000}];
 const html=methods().render('Total generation',{rows});
 assert.match(html,/2 contributing days/);assert.match(html,/Original report · 2026-10-19/);assert.doesNotMatch(html,/2026-10-18/);
 assert.match(html,/not zero-filled/);
});
test('requirement source list retains the per-day fallback basis',()=>{
 const html=methods().render('Total demand requirement',{rows:[{...report,demand_mwh:100,demand_basis:'P1 generation + reported energy not served'}]});
 assert.match(html,/En-Curve!U9; fallback P1!K8 \+ K9/);assert.match(html,/P1 generation \+ reported energy not served/);
});
test('legacy provenance does not claim modern summary cells',()=>{
 const legacy={...report,summary:{unserved_mwh:null},hourly:[{demand_mw:null}]};
 assert.match(methods().render('Energy generated',{report:legacy}),/P1!D12/);
 assert.doesNotMatch(methods().render('Energy not served',{report:legacy}),/P1!K9/);
});
test('source URLs are restricted to official HTTPS reports and text is escaped',()=>{
 const html=methods().render('Energy generated',{report:{date:'<img>',source_url:'javascript:alert(1)'}});
 assert.doesNotMatch(html,/<img>|javascript:/);assert.match(html,/&lt;img&gt;/);assert.match(html,/link unavailable/);
});
test('every headline metric call has methodology and trend helpers receive current rows',()=>{
 const api=methods(),app=fs.readFileSync(path.join(__dirname,'../begd/app.js'),'utf8');
 for(const m of app.matchAll(/metric\(['"]([^'"]+)['"]/g))assert.ok(api.definitions[m[1]],m[1]);
 const trends=fs.readFileSync(path.join(__dirname,'../begd/trends.js'),'utf8');
 for(const label of ['Total generation','Total demand requirement','Maximum reported load shedding','Total imports'])assert.ok(api.definitions[label]);
 assert.match(trends,/render\(label,\{rows\}\)/);
});
test('circuit flow provenance identifies the observed circuit, time, sign and workbook range',()=>{
 const html=methods().render('Largest listed circuit flow',{report:{...report,operations:{ewic:[{time:'17:00',gopalganj_aminbazar:-1338}]}}});
 for(const text of ['EWIC!B9:B34','F9:F34','Gopalganj–Aminbazar','17:00 BST','-1,338 MW','not the simultaneous sum','Download workbook'])assert.ok(html.includes(text),text);
});
