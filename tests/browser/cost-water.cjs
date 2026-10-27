// Offline browser regressions for dated costs and expanded hourly hydro detail.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {serve,fixture}=require('./fixture-site.cjs');
const report={...fixture.report,date:'2026-10-26',published_date:'2026-10-27',
 plant_units:[
  {name:'Karnaphuli Hydro PP Unit-1,2,3,4, 5',fuel:'Hydro',producer:'PDB',region:'Chattogram',status:'running',installed_capacity_mw:230,present_capacity_mw:230,peak_generation_mw:40,energy_mwh:720,hourly:[{time:'00:00',mw:20},{time:'01:00',mw:30},{time:'02:00',mw:40}]},
  {name:'Karnaphuli Power Ltd.',fuel:'HFO',producer:'IPP',status:'running',hourly:[{time:'00:00',mw:80}]}
 ],water_level:{source_range:'GenLog!FG13:FG37',hourly:[{time:'00:00',level_ft_msl:102.13},{time:'01:00',level_ft_msl:null},{time:'02:00',level_ft_msl:102.05}]}};
const cost=date=>({date,currency:'BDT',total_bdt:60000000,costs_bdt:{Gas:10000000,Coal:50000000,Oil:0},generation_kwh:{Gas:2000000,Coal:10000000},source_label:'Production Cost (Tk.)'});
(async()=>{
 const browser=await chromium.launch(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{});
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
   await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/report')return route.fulfill({json:report});
    if(url.pathname==='/api/reports')return route.fulfill({json:{reports:[{id:report.report_id,published_date:report.published_date}],complete:true}});
    if(url.pathname.endsWith('/costs-data.json'))return route.fulfill({json:{days:[cost('2026-10-24'),cost('2026-10-25')]}});
    return serve(route);
   });
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto('https://begd.test/begd/index.html#en-curve');
   const picker=page.locator('[data-cost-date-picker]');await picker.waitFor();
   assert.equal(await picker.inputValue(),'2026-10-25');
   assert.match(await page.locator('.bpdb-cost-date-controls').innerText(),/energy curve above remains on 26 Oct 2026/);
   await picker.selectOption('2026-10-24');await page.getByRole('button',{name:'Sort by Cost (BDT)',exact:true}).click();
   assert.equal(await picker.inputValue(),'2026-10-24');assert.equal(await page.locator('#report-date').inputValue(),'2026-10-26');
   assert.match(await page.locator('.bpdb-cost-panel').innerText(),/24 Oct 2026/);
   await page.locator('nav a[href="#plants"]').click();
   await page.locator('[data-filter="name"]').fill('Karnaphuli Hydro');await page.locator('.plant-row').click();
   const axis=page.locator('.chart-secondary-axis'),water=page.locator('[data-toggle-series="water_level_ft_msl"]');
   await axis.waitFor();assert.match(await axis.getAttribute('aria-label'),/right axis \(ft MSL\)/);
   assert.match(await page.locator('.plant-water-note').innerText(),/2\/24 hourly readings/);
   const ticks=()=>page.locator('.plant-output-chart [data-tick-label]').allTextContents();const baseline=await ticks();
   await water.uncheck();assert.equal(await axis.count(),0);assert.deepEqual(await ticks(),baseline);
   await water.check();await axis.waitFor();assert.deepEqual(await ticks(),baseline);
   await page.locator('.plant-output-chart [data-point="0"]').focus();
   assert.match(await page.locator('.plant-output-chart .chart-tooltip').innerText(),/102.13 ft MSL/);
   assert.match(await page.locator('.plant-output-chart .chart-tooltip').innerText(),/20 MW/);
   const fit=await page.evaluate(()=>{
    const scroller=document.querySelector('.plant-table-wrap').getBoundingClientRect(),chart=document.querySelector('.plant-output-chart').getBoundingClientRect();
    return chart.left>=scroller.left&&chart.right<=scroller.right&&chart.top>=scroller.top&&chart.bottom<=scroller.bottom;
   });assert(fit,'Expanded plant chart is clipped by its table');
   await page.locator('[data-filter="name"]').fill('Karnaphuli Power');await page.locator('.plant-row').click();assert.equal(await axis.count(),0);assert.equal(await water.count(),0);
   assert.deepEqual(errors,[]);await context.close();console.log('PASS costs and hydro detail',width);
  }
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
