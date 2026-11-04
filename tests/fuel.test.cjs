const {test}=require('node:test');
const assert=require('node:assert/strict');
const {selectRows,difference,plot}=require('../begd/fuel.js');
const rows=[{date:'2026-10-01',total:10},{date:'2026-10-03',total:20},{date:'2026-10-04',total:30}];
test('fuel ranges use calendar days, not report count, and never borrow future data',()=>{
 assert.deepEqual(selectRows(rows,'2026-10-03','2').map(r=>r.date),['2026-10-03']);
 assert.equal(selectRows(rows,'2026-10-03','all').length,2);
 assert.equal(selectRows(rows,'2026-10-04','365').length,3);
 assert.equal(selectRows(rows,'2026-09-30','7').length,0);
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
