// Energy totals, hourly allocation and the requested history/legend/source-note defaults.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {serve,fixture}=require('./fixture-site.cjs');
const dates=['2026-10-31','2026-11-01','2026-11-02'];
const reports=dates.map((date,i)=>process.env.BEGD_ENERGY_REPORT_DIR?JSON.parse(fs.readFileSync(path.join(process.env.BEGD_ENERGY_REPORT_DIR,`begd-fixed-${5183+i}.json`),'utf8')):{...fixture.report,date,en_curve:{...fixture.report.en_curve,date}});
const date=dates.at(-1),station={id:'test-station',name:'Test station',voltage_class:'132 kV',last_date:date,latest:{load_mw:50,min_kv:130,max_kv:134},available_through:{load_mw:date,min_kv:date,max_kv:date}};
const parseNumber=text=>Number(text.replace(/,/g,''));
(async()=>{
 const browser=await chromium.launch(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{});
 try{
  for(const width of [390,1210])for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width,height:858},isMobile:width<800,hasTouch:width<800});
   await context.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/api/report')return route.fulfill({json:reports.find(r=>r.date===u.searchParams.get('date'))||reports.at(-1)});
    if(u.pathname==='/api/reports')return route.fulfill({json:{reports:reports.map((r,i)=>({id:String(5183+i),date:r.date,operating_date:r.date,published_date:r.date})),complete:true}});
    if(u.pathname.endsWith('/entity-history/index.json'))return route.fulfill({json:{version:1,end_date:date,plants:[],substations:[station]}});
    if(u.pathname.endsWith('/entity-history/substations/test-station.json'))return route.fulfill({json:{days:[{date,...station.latest}]}});
    return serve(route);
   });
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   for(const report of reports){
    await page.goto(`https://begd.test/begd/index.html?v=2&date=${report.date}#en-curve`);
    await page.locator('.energy-curve-table tfoot').waitFor();
    await page.waitForFunction(()=>document.querySelector('.en-curve-metrics .value')?.dataset.textRole==='metric');
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    const metrics=await page.locator('.en-curve-metrics .value').allTextContents();
    assert.equal(metrics.length,3);assert(metrics.every(s=>!s.includes('—')),'Published energy metrics must not be blank');
    if(process.env.BEGD_ENERGY_QA_OUTPUT&&report.date===dates[0]){
     fs.mkdirSync(process.env.BEGD_ENERGY_QA_OUTPUT,{recursive:true});
     await page.locator('.en-curve-metrics').screenshot({path:path.join(process.env.BEGD_ENERGY_QA_OUTPUT,`${width}-${theme}-energy-totals.png`)});
     await page.locator('.energy-curve-hourly').scrollIntoViewIfNeeded();
     await page.screenshot({path:path.join(process.env.BEGD_ENERGY_QA_OUTPUT,`${width}-${theme}-hourly-energy.png`)});
    }
    const totals=report.en_curve.totals,foot=page.locator('.energy-curve-table tfoot');
    assert(Math.abs(parseNumber(await foot.locator('.energy-curve-total').innerText())-totals.energy_generated_mwh)<.11,'Hourly generation reconciles with the source total');
    assert(Math.abs(parseNumber(await foot.locator('.energy-curve-shortage').innerText())-totals.energy_not_served_mwh)<.11,'Hourly shortage reconciles with the source total');
    assert(await page.locator('.energy-curve-table tbody tr td').evaluateAll(cells=>cells.some(e=>Number(e.textContent.replace(/,/g,''))>0)),'Hourly source values must not all be zero');
    await page.locator('[data-en-curve-table-mode="mw"]').click();
    await page.locator('.energy-curve-table').waitFor();
    assert(await page.locator('.energy-curve-table tbody tr td').evaluateAll(cells=>cells.some(e=>Number(e.textContent.replace(/,/g,''))>0)),'MW readings remain available');
   }
   await page.goto(`https://begd.test/begd/index.html?v=2&date=${date}#operations`);
   const panel=page.locator('.event-chronograph-panel');await panel.waitFor();
   await panel.locator('[data-event-view-select="lanes"]').click();
   await page.waitForFunction(()=>document.querySelector('.event-view-note')?.closest('.more-information'));
   const note=panel.locator('.event-view-note');assert.equal(await note.isVisible(),false,'Event explanation starts inside collapsed More information');
   await panel.locator(':scope > .more-information > summary').click();
   assert.equal(await note.isVisible(),true);assert.equal(await note.evaluate(e=>getComputedStyle(e).fontSize),'14px');
   const coordinates=page.locator('.ewic-flow-panel > .more-information .ewic-coordinate-notes');
   await coordinates.waitFor({state:'attached'});
   await page.locator('.ewic-location-map [data-ewic-circuit]').first().waitFor();
   assert.equal(await coordinates.isVisible(),false,'Coordinate sources are in collapsed More information');
   await page.goto('https://begd.test/begd/index.html?v=2#trends');
   const selected=page.locator('#substations-history [data-history-metric-choice="voltage_range"]');await selected.waitFor();
   assert.equal(await selected.getAttribute('aria-pressed'),'true','Substation history starts on voltage range');
   assert(await page.locator('.trends-legend img[src$="import-export.png"]').count()>0,'Imports fuel legends include their logo');
   assert.deepEqual(errors,[],`${width} ${theme} browser errors`);
   console.log('PASS energy data and notes',width,theme,dates.join(', '));
   await context.close();
  }
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
