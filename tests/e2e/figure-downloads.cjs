/* Batch-click every configured figure download against the current published data. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const base=process.env.BEGD_TEST_URL||'http://127.0.0.1:18943/begd/';let checkedDownloads=0,firstDownload;
 const useFastRenderer=async()=>page.evaluate(async()=>{
  if(!window.__BEGD_FIGURE_TEST_PNG){
   const fixture=document.createElement('canvas');fixture.width=2400;fixture.height=600;const paint=fixture.getContext('2d');
   paint.fillStyle='#f5f8fa';paint.fillRect(0,0,fixture.width,fixture.height);
   for(let y=40;y<fixture.height;y+=40){paint.strokeStyle='#d7e0e7';paint.beginPath();paint.moveTo(0,y);paint.lineTo(fixture.width,y);paint.stroke();}
   for(let i=0;i<96;i++){const x=16+i*24,height=80+(i*73%420);paint.fillStyle=['#347baf','#c48722','#36a77b','#b95442'][i%4];paint.fillRect(x,fixture.height-height,14,height);}
   window.__BEGD_FIGURE_TEST_PNG=await new Promise(resolve=>fixture.toBlob(resolve,'image/png'));
  }
 });
 const clickEveryFigure=async label=>{
  const bars=page.locator('#content .figure-actions'),count=await bars.count();assert.ok(count>0,label+' should expose downloadable figures');
  const controls=await bars.evaluateAll(elements=>elements.map(bar=>{
   bar.querySelector('.figure-download-status')?.remove();
   const button=bar.querySelector('button[aria-label="Download PNG"]'),bounds=button?.getBoundingClientRect();
   return {present:Boolean(button),enabled:Boolean(button&&!button.disabled),visible:Boolean(bounds?.width&&bounds?.height)};
  }));
  assert.ok(controls.every(item=>item.present&&item.enabled&&item.visible),label+' every figure should expose a visible, enabled Download PNG control');
  const before=checkedDownloads;
  for(let index=0;index<controls.length;index++){
   const bar=bars.nth(index),anchorCount=await page.evaluate(()=>window.__BEGD_PNG_DOWNLOAD_ANCHORS.length);
   const event=checkedDownloads===0?page.waitForEvent('download',{timeout:10000}):null;
   await bar.evaluate(element=>{
    const button=element.querySelector('button[aria-label="Download PNG"]');
    if(!button||button.disabled)throw new Error('Download button disappeared or became disabled');
    button.click();
   });
   if(event)firstDownload=await event;
   await page.waitForFunction(element=>element.querySelector('.figure-download-status')?.textContent&&!element.querySelector('button[aria-label="Download PNG"]')?.disabled,await bar.elementHandle());
   assert.equal(await bar.locator('.figure-download-status').innerText(),'PNG downloaded.',label+' figure '+(index+1)+' should report success');
   const anchor=await page.evaluate(count=>window.__BEGD_PNG_DOWNLOAD_ANCHORS[count],anchorCount);
   assert.ok(anchor&&/\.png$/i.test(anchor.filename)&&anchor.href.startsWith('blob:'),label+' figure '+(index+1)+' should invoke a PNG download link');
   checkedDownloads++;
  }
  assert.equal(checkedDownloads-before,controls.length,label+' every click should invoke the PNG download path');
  console.log('Checked '+controls.length+' '+label+' figure download actions');
 };
 try{
  await page.goto(base+'#overview');await page.waitForFunction(()=>window.BEGDView?.started&&document.querySelector('.figure-actions'));
  await page.evaluate(()=>{
   window.__BEGD_PNG_DOWNLOAD_ANCHORS=[];const original=HTMLAnchorElement.prototype.click;
   HTMLAnchorElement.prototype.click=function(){if(this.download)window.__BEGD_PNG_DOWNLOAD_ANCHORS.push({filename:this.download,href:this.href});return original.call(this);};
  });
  await useFastRenderer();await clickEveryFigure('overview');
  if(await page.locator('#fuel-mix-style').count()){
   await page.locator('#fuel-mix-style').selectOption('ring');await clickEveryFigure('fuel-ring');
  }
  for(const tab of ['plants','regions','imports','substations','operations','en-curve','realtime','forecast','trends']){
   await page.locator(`nav a[href="#${tab}"]`).click();
   const titles={regions:'Regional data',plants:'Power plants',imports:'Cross-border imports',substations:'Substations',operations:'Operations detail','en-curve':'Energy Curve',realtime:'Real time',forecast:'Forecast',trends:'Trends'};
   if(tab==='trends')await page.locator('[data-trend-days="30"]').waitFor({timeout:90000});
   else await page.waitForFunction(title=>document.querySelector('#title')?.textContent===title,titles[tab]);
   if(tab==='realtime')await page.locator('.realtime-dispatch-plots').waitFor({timeout:90000});
   await page.locator('#content .figure-actions').first().waitFor();
   if(tab==='plants'){
    // Reproduce the CSS Color 4 value behind html2canvas's unsupported-color error.
    await page.locator('.plant-map-panel').evaluate(node=>node.style.setProperty('outline-color','color(srgb 0.2 0.4 0.6)'));
   }
   await clickEveryFigure(tab);
   if(tab==='plants')assert.match(await page.evaluate(()=>window.__BEGD_FIGURE_TEST_NORMALIZED_COLOR),/^(?:rgba\(51,\s*102,\s*153,\s*1\)|rgb\(51,\s*102,\s*153\))$/,'plant map CSS Color 4 should be normalized in the export clone');
   if(tab==='regions'&&await page.locator('[data-regional-fuel="Coal"]').count()){
    await page.locator('[data-regional-fuel="Coal"]').click();await clickEveryFigure('regional-coal');
   }
  }
  for(const range of ['30','60','90','365']){
   await page.locator(`[data-trend-days="${range}"]`).click();
   await page.locator('[data-trend-layer="Maximum temperature"]').check();
   await page.locator('[data-temperature-unit="°F"]').click();
   await page.locator('[data-trend-unit="MW"][data-unit-chart="generation"]').click();
   await page.locator('[data-trend-unit="MW"][data-unit-chart="imports"]').click();
   await clickEveryFigure('trends-'+range);
  }
  await page.locator('[data-trend-days="10y"]').click();await page.locator('.trends-heatmap').waitFor();await clickEveryFigure('trends-10y');
  assert.ok(firstDownload,'at least one figure should trigger a download');
  const image=fs.readFileSync(await firstDownload.path());assert.equal(image.subarray(1,4).toString(),'PNG');assert.ok(image.readUInt32BE(16)>=2400);
  assert.deepEqual(errors,[]);console.log('PASS: '+checkedDownloads+' figure download clicks produced PNG downloads without page errors.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
