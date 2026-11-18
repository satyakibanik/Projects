const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../begd/demand-trends.js');
const {seasonalSamples,persistence,demandPanels,sheddingPanel,bind}=globalThis.BEGDDemandTrends;

test('seasonal load-duration samples are ranked within the selected window',()=>{
  const rows=[
    {date:'2026-01-01',hourly_demand_mw:[200,100,null,0]},
    {date:'2026-01-02'},
    {date:'2026-06-01',hourly_demand_mw:[300,450]},
  ];
  const seasons=seasonalSamples(rows);
  assert.deepEqual(seasons.map(season=>[season.samples,season.expected]),[
    [[200,100,0],48],[[],0],[[450,300],24],[[],0],
  ]);
  const {hourly,duration}=demandPanels(rows,(ranks,series)=>{
    assert.deepEqual(series.map(line=>line.name),['Winter','Monsoon']);
    assert.equal(series[0].value(ranks[0]),200);
    assert.equal(series[0].value(ranks[100]),0);
    return '';
  });
  assert.match(hourly,/5 \/ 72 reported hours/);
  assert.match(hourly,/<canvas width="24" height="3"/);
  assert.match(duration,/Seasonal load-duration curves/);
});

test('persistence ranks positive snapshots and excludes missing readings',()=>{
  const rows=[
    {date:'2026-01-01',regional_shed_mw:{A:0,B:15,C:null,D:10},regional_demand_mw:{A:200,B:50,D:0}},
    {date:'2026-01-02',regional_shed_mw:{A:15,B:null,C:-1},regional_demand_mw:{A:100,B:0}},
    {date:'2026-01-03'},
  ];
  assert.deepEqual(persistence(rows,['A','B','C']),[
    {name:'B',observed:1,positive:1,share:100,demandShare:30},
    {name:'A',observed:2,positive:1,share:50,demandShare:5},
    {name:'C',observed:0,positive:0,share:null,demandShare:null},
  ]);
  const html=sheddingPanel(rows,['A','B','C','D']);
  assert.match(html,/<canvas width="4" height="3"/);
  assert.match(html,/>0%<\/span>/);
  assert.match(html,/>30%<\/span>/);

  assert.match(html,/<option value="purple" selected>Yellow to purple/);
  assert.match(html,/Load shed as % of regional demand/);

  const colors=[],opacity=[];
  const context={clearRect(){colors.length=0;opacity.length=0;},
    fillRect(){colors.push(this.fillStyle);opacity.push(this.globalAlpha);}};
  const events={};
  const canvas={width:4,height:3,getContext:()=>context,
    getBoundingClientRect:()=>({left:0,top:0,width:40,height:30}),
    addEventListener:(name,listener)=>{events[name]=listener;}};
  const legendEvents={};
  const gradient={getBoundingClientRect:()=>({left:0,width:100}),
    addEventListener:(name,listener)=>{legendEvents[name]=listener;}};
  const detail={};
  const crosshair={hidden:true,style:{setProperty(){}}};
  const section={dataset:{demandHeatmap:'regional'},querySelectorAll:()=>[],
    querySelector:selector=>({'canvas':canvas,'.demand-heatmap-detail':detail,'.demand-heatmap-crosshair':crosshair,'.demand-heatmap-gradient':gradient}[selector])};
  bind({querySelectorAll:()=>[section]});
  assert.notEqual(colors[1],colors[4]);
  events.pointermove({clientX:15,clientY:5});
  assert.match(detail.textContent,/30% of demand · 15 MW shed/);
  events.pointermove({clientX:5,clientY:15});
  assert.match(detail.textContent,/15% of demand · 15 MW shed/);
  events.pointermove({clientX:35,clientY:5});
  assert.match(detail.textContent,/10 MW shed · share unavailable/);
  legendEvents.pointermove({clientX:95});
  assert.equal(opacity[1],1);
  assert.ok(opacity[4]<1);
  assert.match(detail.textContent,/Highlighting 27–30%/);
  legendEvents.pointerleave();
  assert.ok(opacity.every(value=>value===1));
  assert.match(detail.textContent,/10 MW shed · share unavailable/);
});
