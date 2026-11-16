/* Verify every configured figure download against the current published data. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const base=process.env.BEGD_TEST_URL||'http://127.0.0.1:18943/begd/';
 const download=async(bar,label)=>{
  const event=page.waitForEvent('download',{timeout:120000});await bar.getByRole('button',{name:'Download PNG',exact:true}).click();
  let file;try{file=await event;}catch(error){const status=await bar.locator('.figure-download-status').innerText().catch(()=>'(no status)');throw new Error(label+' did not download within 120 seconds: '+status+' ('+error.message+')');}
  const data=fs.readFileSync(await file.path());
  assert.equal(data.subarray(1,4).toString(),'PNG',label+' PNG signature');assert.ok(data.length>10000,label+' PNG size');
  assert.ok(data.readUInt32BE(16)>=2400,label+' PNG width');await file.saveAs(path.join(os.tmpdir(),'begd-'+label+'.png'));
  assert.equal(await bar.locator('.figure-download-status').innerText(),'PNG downloaded.',label+' download status');
 };
 const downloadAll=async(label)=>{
  const actions=page.locator('#content .figure-actions'),count=await actions.count();assert.ok(count>0,label+' should expose downloadable figures');
  for(let index=0;index<count;index++)await download(actions.nth(index),label+'-'+index);
 };
 try{
  await page.goto(base+'#overview');await page.waitForFunction(()=>window.BEGDView?.started&&document.querySelector('.figure-actions'));
  await downloadAll('overview');
  if(await page.locator('#fuel-mix-style').count()){
   await page.locator('#fuel-mix-style').selectOption('ring');
   await download(page.locator('.fuel-export-actions .figure-actions').first(),'fuel-ring');
  }
  for(const tab of ['regions','plants','imports','substations','operations','en-curve','realtime','forecast','trends']){
   console.log('Exporting '+tab+' figures');
   await page.locator(`nav a[href="#${tab}"]`).click();
   const readiness={regions:['Regional data','.region-map-panel'],plants:['Power plants','.plant-map-panel'],imports:['Cross-border imports','.interactive-chart'],substations:['Substations','.vb-combined'],operations:['Operations detail','.ewic-flow-panel'],'en-curve':['Energy Curve','.en-curve-chart'],realtime:['Real time','.realtime-dispatch-plots'],forecast:['Forecast','.forecast-subplot'],trends:['Trends','.trends-chart']}[tab];
   await page.waitForFunction(({title,selector})=>document.querySelector('#title')?.textContent===title&&document.querySelector(selector),readiness);
   await page.locator('#content .figure-actions').first().waitFor();await page.waitForTimeout(350);
   if(tab==='plants'){
    // Reproduce the CSS Color 4 value behind html2canvas's unsupported-color error.
    await page.locator('.plant-map-panel').evaluate(node=>node.style.setProperty('outline-color','color(srgb 0.2 0.4 0.6)'));
   }
   await downloadAll(tab);
   if(tab==='regions'&&await page.locator('[data-regional-fuel="Coal"]').count()){
    await page.locator('[data-regional-fuel="Coal"]').click();await page.waitForTimeout(100);
    await download(page.locator('.regional-fuel-visual .figure-actions'),'regional-coal');
   }
  }
  for(const range of ['30','60','90','365']){
   await page.locator(`[data-trend-days="${range}"]`).click();
   await page.locator('[data-trend-layer="Maximum temperature"]').check();
   await page.locator('[data-temperature-unit="°F"]').click();
   await page.locator('[data-trend-unit="MW"][data-unit-chart="generation"]').click();
   await page.locator('[data-trend-unit="MW"][data-unit-chart="imports"]').click();
   await downloadAll('trends-'+range);
  }
  await page.locator('[data-trend-days="10y"]').click();await page.locator('.trends-heatmap').waitFor();
  await download(page.locator('.trends-heatmap').locator('xpath=ancestor::section[1]').locator('.figure-actions'),'trends-heatmap');
  assert.deepEqual(errors,[]);console.log('PASS: all configured overview, fuel, regional, plant, imports, substation, operations, En-Curve, realtime, forecast, trend-range, and heatmap figures downloaded as valid PNGs.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
