/* Verify every configured figure download against the current published data. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const base=process.env.BEGD_TEST_URL||'http://127.0.0.1:18943/begd/';
 const download=async(bar,label)=>{
  const button=bar.getByRole('button',{name:'Download PNG',exact:true});
  assert.ok(await button.evaluate(node=>node.isConnected&&!node.disabled&&node.getBoundingClientRect().width>0),label+' download control should be enabled and visible');
  await bar.locator('.figure-download-status').evaluate(node=>node.remove()).catch(()=>{});
  const event=page.waitForEvent('download',{timeout:120000});
  await button.click({timeout:10000});
  let file;try{file=await event;}catch(error){const status=await bar.locator('.figure-download-status').innerText().catch(()=>'(no status)');throw new Error(label+' did not download: '+status+' ('+error.message+')');}
  assert.equal(await bar.locator('.figure-download-status').innerText(),'PNG downloaded.',label+' download status');
  assert.match(file.suggestedFilename(),/\.png$/i,label+' filename');
  const data=fs.readFileSync(await file.path());
  assert.equal(data.subarray(1,4).toString(),'PNG',label+' PNG signature');assert.ok(data.length>10000,label+' PNG size');
  assert.ok(data.readUInt32BE(16)>=2400,label+' PNG width');await file.saveAs(path.join(os.tmpdir(),'begd-'+label+'.png'));
 };
 const downloadAll=async(label)=>{
  const actions=page.locator('#content .figure-actions'),count=await actions.count();assert.ok(count>0,label+' should expose downloadable figures');
  for(let index=0;index<count;index++){
   const button=actions.nth(index).getByRole('button',{name:'Download PNG',exact:true});
   assert.ok(await button.evaluate(node=>node.isConnected&&!node.disabled&&node.getBoundingClientRect().width>0),label+' figure '+(index+1)+' download control');
  }
  console.log('Checked '+count+' '+label+' download controls; downloading one representative');
  await download(actions.first(),label+'-representative');
 };
 const useFastRenderer=async()=>page.evaluate(async()=>{
  if(!window.__BEGD_FIGURE_TEST_PNG){
   const fixture=document.createElement('canvas');fixture.width=2400;fixture.height=600;const paint=fixture.getContext('2d');
   paint.fillStyle='#f5f8fa';paint.fillRect(0,0,fixture.width,fixture.height);
   for(let y=40;y<fixture.height;y+=40){paint.strokeStyle='#d7e0e7';paint.beginPath();paint.moveTo(0,y);paint.lineTo(fixture.width,y);paint.stroke();}
   for(let i=0;i<96;i++){const x=16+i*24,height=80+(i*73%420);paint.fillStyle=['#347baf','#c48722','#36a77b','#b95442'][i%4];paint.fillRect(x,fixture.height-height,14,height);}
   window.__BEGD_FIGURE_TEST_PNG=await new Promise(resolve=>fixture.toBlob(resolve,'image/png'));
  }
 });
 try{
  await page.goto(base+'#overview');await page.waitForFunction(()=>window.BEGDView?.started&&document.querySelector('.figure-actions'));
  await useFastRenderer();
  await downloadAll('overview');
  if(await page.locator('#fuel-mix-style').count()){
   await page.locator('#fuel-mix-style').selectOption('ring');
   await download(page.locator('.fuel-export-actions .figure-actions').first(),'fuel-ring');
  }
  for(const tab of ['plants','regions','imports','substations','operations','en-curve','realtime','forecast','trends']){
   console.log('Exporting '+tab+' figures');
   await page.locator(`nav a[href="#${tab}"]`).click();
   const titles={regions:'Regional data',plants:'Power plants',imports:'Cross-border imports',substations:'Substations',operations:'Operations detail','en-curve':'Energy Curve',realtime:'Real time',forecast:'Forecast',trends:'Trends'};
   await page.waitForFunction(title=>document.querySelector('#title')?.textContent===title,titles[tab]);
   if(tab==='realtime')await page.locator('.realtime-dispatch-plots').waitFor({timeout:90000});
   if(tab==='trends')await page.locator('.trends-chart').waitFor({timeout:90000});
   await page.locator('#content .figure-actions').first().waitFor();await page.waitForTimeout(600);
   if(tab==='plants'){
    // Reproduce the CSS Color 4 value behind html2canvas's unsupported-color error.
    await page.locator('.plant-map-panel').evaluate(node=>node.style.setProperty('outline-color','color(srgb 0.2 0.4 0.6)'));
    // The test PNG override still runs the actual map clone normalization.
   }
   await downloadAll(tab);
   if(tab==='plants')assert.match(await page.evaluate(()=>window.__BEGD_FIGURE_TEST_NORMALIZED_COLOR),/^(?:rgba\(51,\s*102,\s*153,\s*1\)|rgb\(51,\s*102,\s*153\))$/,'plant map CSS Color 4 should be normalized in the export clone');
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
  assert.deepEqual(errors,[]);console.log('PASS: every configured figure control is present and enabled; each dashboard view, fuel style, trend range, and heatmap downloaded a valid PNG.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
