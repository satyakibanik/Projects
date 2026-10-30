const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function load(){const window={};const context={window,Date,URL};for(const file of ['event-heatmap.js','operational-events.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd',file),'utf8'),context);return window.BEGDEventHeatmap}
const categories=[['trip','Tripped'],['restored','Restored'],['scheduled','Scheduled']];
const rows=[
 {date:'2026-10-01',category:'trip',outage_time:'07:59',restoration_time:'09:00',description:'Sylhet 225 MW CCPP GT Tripped'},
 {date:'2026-10-01',category:'trip',outage_time:'07:12',restoration_time:'—',description:'Grid 132/33kV S/S GT-2 Tripped'},
 {date:'2026-10-01',category:'restored',outage_time:'—',restoration_time:'08:10',description:'Line 132kV is restored.'},
 {date:'2026-10-02',category:'scheduled',outage_time:'—',restoration_time:'12:00',description:'Line 132kV Scheduled S/D'}
];
test('heatmap defaults match the requested settings and additional settings start collapsed',()=>{
 const s=load().defaults();assert.deepEqual(JSON.parse(JSON.stringify(s)),{asset:'',time:'action',date:'report',value:'count',extraOpen:false});
});
test('raw category/hour counts conserve timed entries and never infer an outage start',()=>{
 const api=load(),m=api.matrix(rows,2,api.defaults(),categories);
 assert.equal(m.observations.length,3);assert.equal(m.missing,1);assert.equal(m.rows[0].counts[7],2);assert.equal(m.rows[1].counts[8],1);
 assert.equal(m.rows.flatMap(r=>Array.from(r.counts)).reduce((a,b)=>a+b,0),3);
});
test('date hypothesis affects evidence dates, not category/hour totals',()=>{
 const api=load(),report=api.matrix(rows,2,api.defaults(),categories),rollover=api.matrix(rows,2,{...api.defaults(),date:'rollover'},categories);
 assert.equal(report.observations[0].assigned_date,'2026-10-01');assert.equal(rollover.observations[0].assigned_date,'2026-10-02');
 assert.equal(JSON.stringify(report.rows),JSON.stringify(rollover.rows));
 const midnight=api.timed({...rows[0],outage_time:'24:00'},{...api.defaults(),date:'rollover'});assert.equal(midnight.hour,0);assert.equal(midnight.assigned_date,'2026-10-02');
});
test('asset scope gives network wording priority over ambiguous GT names',()=>{
 const api=load();assert.equal(api.assetScope(rows[0]),'Generator');assert.equal(api.assetScope(rows[1]),'Network equipment');
 const m=api.matrix(rows,2,{...api.defaults(),asset:'Generator'},categories);assert.equal(m.observations.length,1);assert.equal(m.rows[0].counts[7],1);
});
test('start and restoration column choices retain their own missing-field denominators',()=>{
 const api=load();assert.equal(api.matrix(rows,2,{...api.defaults(),time:'start'},categories).observations.length,2);
 const restored=api.matrix(rows,2,{...api.defaults(),time:'restoration'},categories);assert.equal(restored.observations.length,3);assert.equal(restored.rows[2].counts[12],1);
});
test('rates include empty available days; percentages use category totals; unavailable is not zero',()=>{
 const api=load(),rate=api.matrix(rows,4,{...api.defaults(),value:'rate'},categories),share=api.matrix(rows,4,{...api.defaults(),value:'share'},categories);
 assert.equal(rate.rows[0].values[7],.5);assert.equal(share.rows[0].values[7],100);assert.equal(share.rows[2].values[7],0);
 assert.equal(api.matrix([],0,api.defaults(),categories).rows[0].values[7],null);
});
test('heatmap loads before the explorer and remains part of numeric-window integration',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../begd/index.html'),'utf8');assert.ok(html.indexOf('src="event-heatmap.js')<html.indexOf('src="operational-events.js'));
});
