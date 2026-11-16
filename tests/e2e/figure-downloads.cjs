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
  const data=fs.readFileSync(await file.path());
  assert.equal(data.subarray(1,4).toString(),'PNG',label+' PNG signature');assert.ok(data.length>10000,label+' PNG size');
  assert.ok(data.readUInt32BE(16)>=2400,label+' PNG width');await file.saveAs(path.join(os.tmpdir(),'begd-'+label+'.png'));
 };
 const downloadAll=async(label)=>{
  const actions=page.locator('#content .figure-actions'),count=await actions.count();assert.ok(count>0,label+' should expose downloadable figures');
  for(let index=0;index<count;index++){console.log('Downloading '+label+' figure '+(index+1)+' of '+count);await download(actions.nth(index),label+'-'+index);}
 };
 const useFastRenderer=async()=>page.evaluate(()=>{
  window.__begdRealHtml2canvas ||= window.html2canvas;
  window.html2canvas=async(target,options={})=>{
   if(target.matches('.plant-map-panel')&&!window.__begdMapColorChecked){
    const cloneDoc=document.implementation.createHTMLDocument(''),clone=target.cloneNode(true);cloneDoc.body.append(clone);
    options.onclone?.(cloneDoc,clone);
    const normalized=clone.style.getPropertyValue('outline-color');
    if(!/^rgba\(51,\s*102,\s*153,\s*1\)$/.test(normalized))throw Error('CSS Color 4 value was not normalized to its expected RGB color in the plant map export clone: '+normalized);
    window.__begdMapColorChecked=true;
   }
   const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=480;
   const context=canvas.getContext('2d');context.fillStyle='#f5f8fa';context.fillRect(0,0,canvas.width,canvas.height);
   for(let y=40;y<canvas.height;y+=40){context.strokeStyle='#d7e0e7';context.beginPath();context.moveTo(0,y);context.lineTo(canvas.width,y);context.stroke();}
   for(let i=0;i<48;i++){const x=16+i*24,height=80+(i*73%300);context.fillStyle=['#347baf','#c48722','#36a77b','#b95442'][i%4];context.fillRect(x,canvas.height-height,14,height);}
   return canvas;
  };
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
    // Exercise the real clone-normalization callback for the reported map
    // failure, then use the fast renderer to keep every button check quick.
   }
   await downloadAll(tab);
   if(tab==='plants')assert.equal(await page.evaluate(()=>window.__begdMapColorChecked),true,'plant map CSS Color 4 should be normalized in the export clone');
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
