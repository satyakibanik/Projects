/* Local preview with current published snapshots. Social navigation is stubbed; nothing is posted. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
 await context.addInitScript(()=>{window.popupRecords=[];window.open=()=>{const record={created:performance.now(),closed:false,document:{body:{style:{}}}};record.location={replace:url=>{record.url=url;record.navigated=performance.now();}};record.close=()=>{record.closed=true;};window.popupRecords.push(record);return record;};});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=process.env.BEGD_TEST_URL||'http://127.0.0.1:18943/begd/';
 const ready=()=>page.waitForFunction(()=>window.BEGDView?.started&&document.querySelector('.figure-actions'));
 const download=async(bar,label)=>{const event=page.waitForEvent('download');await bar.getByRole('button',{name:'Download PNG',exact:true}).click();const file=await event,data=fs.readFileSync(await file.path());assert.equal(data.subarray(1,4).toString(),'PNG');assert.ok(data.length>10000,label);await file.saveAs(path.join(os.tmpdir(),'begd-'+label+'.png'));};
 const coverage=async()=>assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#content svg:not(.series-swatch):not(.peak-icon),#content .fuel-mix-bar,#content .trends-heatmap')].filter(n=>!n.closest('.figure-actions')&&!n.closest('[data-figure-actions]')).map(n=>n.outerHTML.slice(0,100))),[]);
 const header=async()=>{assert.equal(await page.locator('header #share-dashboard').count(),1);assert.equal(await page.locator('main #share-dashboard').count(),0);const boxes=await page.evaluate(()=>{const b=document.querySelector('.brand').getBoundingClientRect(),t=document.querySelector('#theme-toggle').getBoundingClientRect();return {brand:b.y+b.height/2,theme:t.y+t.height/2,overflow:document.documentElement.scrollWidth>innerWidth};});assert.ok(Math.abs(boxes.brand-boxes.theme)<3);assert.equal(boxes.overflow,false);};
 try{
  await page.goto(base+'#overview');await ready();await header();await coverage();
  let bar=page.locator('.figure-actions').first();assert.equal(await bar.innerText(),'');assert.equal(await bar.locator('button svg').count(),3);assert.equal(await bar.locator('..').locator('h2').count(),1);
  await download(bar,'icon-overview');
  await bar.getByRole('button',{name:'Copy figure',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#figure-action-status').textContent==='PNG copied to your clipboard.');
  assert.ok(await page.evaluate(async()=>(await navigator.clipboard.read()).some(i=>i.types.includes('image/png'))));
  await bar.getByRole('button',{name:'Share figure on X',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#figure-action-status').textContent.includes('Opening X in 2.5 seconds'));
  assert.equal(await page.evaluate(()=>window.popupRecords.at(-1).url),undefined);
  await page.waitForFunction(()=>window.popupRecords.at(-1).url);const record=await page.evaluate(()=>window.popupRecords.at(-1));assert.ok(record.navigated-record.created>=2500);assert.equal(new URL(record.url).hostname,'twitter.com');assert.doesNotMatch(new URL(record.url).searchParams.get('text'),/@/);
  // A failed clipboard copy closes the reserved tab and never claims success or opens X.
  await page.evaluate(()=>{window.originalWrite=navigator.clipboard.write.bind(navigator.clipboard);navigator.clipboard.write=()=>Promise.reject(new Error('Clipboard denied'));});
  await bar.getByRole('button',{name:'Share figure on X',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#figure-action-status').textContent.includes('X was not opened'));assert.equal(await page.evaluate(()=>window.popupRecords.at(-1).closed),true);assert.equal(await page.evaluate(()=>window.popupRecords.at(-1).url),undefined);await page.evaluate(()=>navigator.clipboard.write=window.originalWrite);
  // Popup-blocked browsers retain a manual X link after the same successful copy/delay.
  await page.evaluate(()=>{window.open=()=>null;});await bar.getByRole('button',{name:'Share figure on X',exact:true}).click();await page.locator('#figure-action-status a').waitFor();assert.equal(await page.locator('#figure-action-status a').innerText(),'Open X');
  await page.locator('#share-dashboard').click();const dialog=page.getByRole('dialog');assert.equal(await dialog.getByRole('button',{name:/Share image|LinkedIn/}).count(),0);await dialog.getByLabel('Custom message').fill('Bangladesh energy & grid');assert.equal(new URL(await dialog.getByRole('link',{name:'Share dashboard on X'}).getAttribute('href')).searchParams.get('text'),'Bangladesh energy & grid');await page.keyboard.press('Escape');
  await page.locator('#fuel-mix-style').selectOption('ring');await coverage();await download(page.locator('.fuel-report-chart .figure-actions').first(),'icon-ring');
  for(const tab of ['regions','plants','imports','substations','operations','en-curve','realtime','trends']){
   await page.locator(`nav a[href="#${tab}"]`).click();await page.waitForTimeout(400);await header();await coverage();
   if(tab==='regions'||tab==='plants'){const map=page.locator(tab==='regions'?'.region-map-panel':'.plant-map-panel');assert.equal(await map.getByRole('button',{name:'Copy figure',exact:true}).count(),0);assert.equal(await map.getByRole('button',{name:'Share figure on X',exact:true}).count(),0);}
   const actions=page.locator('#content .figure-actions');for(let i=0;i<await actions.count();i++)await download(actions.nth(i),tab+'-'+i+'-icons');
   if(tab==='regions'){await page.locator('[data-regional-fuel=Coal]').click();await page.waitForTimeout(100);assert.equal(await page.locator('.regional-fuel-visual .figure-actions').count(),1);await download(page.locator('.regional-fuel-visual .figure-actions'),'regional-coal-icons');}
  }
  for(const range of ['30','60','90','365']){
   await page.locator(`[data-trend-days="${range}"]`).click();await page.locator('[data-trend-layer="Maximum temperature"]').check();await page.locator('[data-temperature-unit="°F"]').click();await page.locator('[data-trend-unit="MW"][data-unit-chart="generation"]').click();await page.locator('[data-trend-unit="MW"][data-unit-chart="imports"]').click();await coverage();
   const plots=page.locator('#content .figure-actions');for(let i=0;i<await plots.count();i++)await download(plots.nth(i),`trends-${range}-${i}-icons`);
  }
  await page.locator('[data-trend-days="10y"]').click();await page.waitForSelector('.trends-heatmap');await coverage();await download(page.locator('.trends-heatmap').locator('xpath=ancestor::section[1]').locator('.figure-actions'),'heatmap-icons');
  for(const width of [1064,390]){await page.setViewportSize({width,height:858});await header();await page.screenshot({path:path.join(os.tmpdir(),`begd-icon-layout-${width}.png`),fullPage:true});}
  await page.locator('#theme-toggle').click();await header();await download(page.locator('#content .figure-actions').first(),'mobile-dark-icons');await page.screenshot({path:path.join(os.tmpdir(),'begd-icon-mobile-dark.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: title-row icons, aligned global header, PNG clipboard, delayed X handoff, copy-denied and popup-blocked fallbacks, all figure/Trends exports, mobile/dark layouts.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
