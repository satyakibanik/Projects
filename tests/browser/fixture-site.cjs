const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const fixture=require('../fixtures/mobile-layers.cjs');
const report=fixture.report;
const days=Array.from({length:90},(_,i)=>({
  date:new Date(Date.UTC(2026,7,1+i)).toISOString().slice(0,10),
  generation_mwh:240000+i*100,demand_mwh:245000+i*100,unserved_mwh:500,
  shed_peak_mw:100+i,temperature_c:30+i%5,imports_mwh:30000+i*10,
  fuels:{Gas:100000,Coal:70000,HFO:25000,HSD:500,Hydro:10000,Solar:4000,Wind:500,Imports:30000},
  imports:[{name:'Route A',energy_mwh:30000+i*10}],report_id:report.report_id,
}));
const trends={end_date:days.at(-1).date,days};
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.geojson':'application/json','.png':'image/png'};
async function serve(route){
  const url=new URL(route.request().url());
  if(url.hostname!=='begd.test')return route.abort();
  const json=data=>route.fulfill({json:data});
  if(url.pathname==='/api/reports')return json({reports:[{id:report.report_id,date:report.date,operating_date:report.date,published_date:report.published_date}],complete:true});
  if(url.pathname==='/api/report')return json(report);
  if(url.pathname==='/api/current-day')return json(fixture.current_day);
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:404,json:{error:'Fixture has no comparison report'}});
  if(url.pathname.endsWith('/trends-data.json'))return json(trends);
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:'Missing fixture asset'});
  return route.fulfill({body:fs.readFileSync(file),contentType:mime[path.extname(file)]||'application/octet-stream'});
}

module.exports={serve,fixture};
