// Fuel groups/icons, a single plant legend, and corrected regional/transfer readings.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {serve,fixture}=require('./fixture-site.cjs');
const fuels=['Gas','Coal','HFO','HSD','Hydro','Solar','Imports','Wind','Nuclear'];
const costs_bdt=Object.fromEntries(fuels.map((name,i)=>[name,name==='Nuclear'?0:(i+1)*1000]));
const costs={days:Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2026,9,1+i)).toISOString().slice(0,10),currency:'BDT',total_bdt:Object.values(costs_bdt).reduce((a,b)=>a+b,0),costs_bdt,generation_kwh:Object.fromEntries(fuels.map(name=>[name,name==='Nuclear'?0:1000]))}))};
const report=process.env.BEGD_P1_REPORT?JSON.parse(fs.readFileSync(process.env.BEGD_P1_REPORT,'utf8')):{...fixture.report,date:'2026-11-02',en_curve:{...fixture.report.en_curve,date:'2026-11-02'},regional_snapshot:{time:'19:30'},regions:[{...fixture.report.regions[0],name:'Dhaka',demand_mw:5910,shed_mw:2},{...fixture.report.regions[0],name:'Chattogram',demand_mw:1520,shed_mw:0}],operations:{...fixture.report.operations,east_west:{energy_east_to_west_kwh:0,energy_west_to_east_kwh:45199472.73}},plant_units:[{...fixture.report.plant_units[0],name:'Karnaphuli Hydro PP Unit-1,2,3,4, 5',fuel:'Hydro'},{...fixture.report.plant_units[0],name:'Karnaphuli Power Ltd.',fuel:'HFO'}]};
(async()=>{
 const browser=await chromium.launch(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{});
 try{for(const width of [390,1210])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:858},isMobile:width<800,hasTouch:width<800});
  await context.addInitScript(value=>localStorage.setItem('begd-theme',value),theme);
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.pathname==='/api/report')return route.fulfill({json:report});
   if(u.pathname.endsWith('/costs-data.json'))return route.fulfill({json:costs});
   return serve(route);
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://begd.test/begd/index.html?v=2#trends');
  const avg=page.locator('[data-trend-key="bpdb-unit-cost"]');await avg.waitFor();
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  const group=avg.locator('[data-trend-group]');await group.waitFor();
  await group.uncheck();assert(await avg.locator('[data-trend-layer]').evaluateAll(items=>items.every(e=>!e.checked)));
  await avg.locator('[data-trend-layer="Gas"]').check();assert.equal(await group.evaluate(e=>e.indeterminate),true);
  await group.check();assert(await avg.locator('[data-trend-layer]').evaluateAll(items=>items.every(e=>e.checked)));
  for(const key of ['bpdb-cost','bpdb-unit-cost','fuel-mix']){
   const chart=page.locator(`[data-trend-key="${key}"]`);
   for(const name of fuels.slice(0,key==='bpdb-cost'?9:8)){
    const label=chart.locator(`[data-trend-layer="${name}"]`).locator('..');
    assert.equal(await label.locator('img').count(),1,`${key} ${name} logo`);
   }
  }
  await page.waitForFunction(()=>[...document.querySelectorAll('.trends-legend img')].every(e=>e.complete&&e.naturalWidth>0));
  await page.goto('https://begd.test/begd/index.html?v=2#en-curve');
  const picker=page.locator('[data-cost-date-picker]');await picker.waitFor();await picker.selectOption(report.date);
  for(const [name,file] of [['Imports','import-export.png'],['Nuclear','nuclear-plant.png']])assert.equal(await page.locator(`[data-cost-row="${name}"] th img[src$="${file}"]`).count(),1);
  await page.goto('https://begd.test/begd/index.html?v=2#regions');
  const dhaka=page.locator('.region-card').filter({has:page.getByRole('heading',{name:'Dhaka',exact:true})});await dhaka.waitFor();
  assert.deepEqual(await dhaka.locator('.mini strong').allTextContents(),['5,910 MW','2 MW']);
  await page.goto('https://begd.test/begd/index.html?v=2#operations');
  await page.locator('.ewic-location-map').waitFor();
  const values=await page.locator('#content > .metrics .value').allTextContents();
  assert.match(values[2],/^0\s*MWh$/);assert.match(values[3],/45,199\.47\s*MWh/);
  await page.goto('https://begd.test/begd/index.html?v=2#plants');
  const buttons=page.locator('.plant-icon-key > button');await buttons.first().waitFor();
  assert.equal(await page.locator('.plant-slide-info .plant-category-key').count(),0,'Fuel types are listed once');
  assert(await buttons.count()>0);
  assert(await buttons.evaluateAll(items=>items.every(b=>b.querySelector('img')&&b.querySelector('i[style]'))),'Each plant fuel combines its icon and color');
  await buttons.first().click();assert.equal(await buttons.first().getAttribute('aria-pressed'),'true');
  await buttons.first().click();assert.equal(await buttons.first().getAttribute('aria-pressed'),'false');
  if(process.env.BEGD_FUEL_QA_OUTPUT){fs.mkdirSync(process.env.BEGD_FUEL_QA_OUTPUT,{recursive:true});await page.locator('.plant-icon-key').screenshot({path:path.join(process.env.BEGD_FUEL_QA_OUTPUT,`${width}-${theme}-plant-fuels.png`)});}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.deepEqual(errors,[]);console.log('PASS fuel logos, group controls, P1 readings and plant legend',width,theme);
  await context.close();
 }}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
