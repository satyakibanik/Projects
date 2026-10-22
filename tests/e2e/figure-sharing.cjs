/* Run against a local preview containing current published live-data.js and trends-data.json. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const footers=[];
 const inventory=async view=>footers.push(...await page.evaluate(view=>[...document.querySelectorAll('[data-figure-actions]')].map(target=>({view,...window.BEGDFigures.describe(target)})),view));
 const ready=()=>page.waitForFunction(()=>window.BEGDView?.started&&document.querySelector('.figure-actions'));
 const base=process.env.BEGD_TEST_URL||'http://127.0.0.1:18943/begd/';
 const download=async(bar,label)=>{const event=page.waitForEvent('download');await bar.getByRole('button',{name:'Download PNG',exact:true}).click();const file=await event;const downloaded=await file.path();const data=fs.readFileSync(downloaded);assert.equal(data.subarray(1,4).toString(),'PNG');assert.ok(data.length>10000,label);await file.saveAs(path.join(os.tmpdir(),'begd-'+label+'.png'));};
 try{
  await page.goto(base+'#overview');await ready();await inventory('Overview');
  const published=await page.evaluate(()=>({date:document.querySelector('#report-date').value,generated:window.BEGD_STATIC_DATA.generated_at}));console.log('Published snapshot',published);
  let bar=page.locator('.figure-actions').first();await download(bar,'overview-export');
  await bar.getByRole('button',{name:'Copy figure',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.figure-actions [role=status]').textContent==='Figure copied.');
  assert.ok(await page.evaluate(async()=>{const items=await navigator.clipboard.read();return items.some(i=>i.types.includes('image/png'));}));
  await bar.getByRole('button',{name:'Share figure',exact:true}).click();const dialog=page.getByRole('dialog');assert.doesNotMatch(await dialog.locator('textarea').inputValue(),/@/);assert.match(await dialog.innerText(),/LinkedIn does not prefill/);await dialog.getByText('Text below this figure',{exact:true}).click();assert.match(await dialog.innerText(),/© Bangladesh Electric Grid Dashboard/);await dialog.locator('textarea').fill('My custom message & Bangladesh + energy');
  const x=new URL(await dialog.getByRole('link',{name:'Share to X',exact:true}).getAttribute('href'));assert.equal(x.searchParams.get('text'),'My custom message & Bangladesh + energy');assert.equal(new URL(x.searchParams.get('url')).origin,'https://satyakibanik.github.io');
  await dialog.getByRole('link',{name:'Share to LinkedIn',exact:true}).evaluate(a=>a.addEventListener('click',event=>event.preventDefault()));await dialog.getByRole('link',{name:'Share to LinkedIn',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.figure-share-dialog [role=status]').textContent.includes('Message copied'));assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/My custom message/);
  await dialog.getByRole('button',{name:'Copy message',exact:true}).click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/My custom message & Bangladesh \+ energy/);
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  await page.locator('#share-dashboard').click();assert.equal(await page.getByRole('dialog').getByRole('button',{name:'Download PNG',exact:true}).count(),0);await page.keyboard.press('Escape');
  // Existing render settings replace figure nodes and should attach one fresh toolbar each.
  await page.locator('#fuel-mix-style').selectOption('ring');await page.waitForSelector('.fuel-mix-ring');
  const assertCoverage=async()=>{assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#content svg:not(.series-swatch):not(.peak-icon),#content .fuel-mix-bar,#content .trends-heatmap')].filter(node=>!node.closest('.figure-actions')).filter(node=>!node.closest('[data-figure-actions]')).map(node=>node.outerHTML.slice(0,150))),[]);};
  await assertCoverage();await download(page.locator('.fuel-report-chart .figure-actions').first(),'fuel-ring');
  for(const tab of ['regions','plants','imports','substations','operations','en-curve','realtime','trends']){
   await page.locator(`nav a[href="#${tab}"]`).click();await page.waitForTimeout(700);await assertCoverage();
   await inventory(tab);
   const actions=page.locator('#content .figure-actions');for(let i=0;i<await actions.count();i++)await download(actions.nth(i),tab+'-'+i+'-export');
   if(tab==='regions'||tab==='plants'){const map=page.locator(tab==='regions'?'.region-map-panel':'.plant-map-panel');assert.equal(await map.getByRole('button',{name:'Copy figure',exact:true}).count(),0);assert.equal(await map.getByRole('button',{name:'Share figure',exact:true}).count(),0);}
   if(tab==='regions'){await page.locator('[data-regional-fuel=Coal]').click();await page.waitForSelector('.regional-fuel-svg');await download(page.locator('.regional-fuel-visual .figure-actions'),'regional-fuel-coal');}
  }
  for(const range of ['30','60','90','365']){
   await page.locator(`[data-trend-days="${range}"]`).click();await page.locator('[data-trend-layer="Maximum temperature"]').check();await page.locator('[data-temperature-unit="°F"]').click();await page.locator('[data-trend-unit="MW"][data-unit-chart="generation"]').click();await page.locator('[data-trend-unit="MW"][data-unit-chart="imports"]').click();await assertCoverage();assert.equal(await page.locator('.trends-generation-figure>.figure-actions').count(),1);assert.equal(await page.locator('.temperature-subplot .figure-actions').count(),0);await inventory('Trends '+range+'d / MW / °F');
   const plots=page.locator('#content .figure-actions');for(let i=0;i<await plots.count();i++)await download(plots.nth(i),`trends-${range}-${i}`);
  }
  await page.locator('[data-trend-days="10y"]').click();await inventory('Trends 10y');await page.waitForSelector('.trends-heatmap');await assertCoverage();await download(page.locator('.trends-heatmap').locator('..').locator('.figure-actions'),'heatmap-export');
  await page.locator('#theme-toggle').click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(os.tmpdir(),'begd-sharing-mobile-dark.png'),fullPage:true});await download(page.locator('.figure-actions').first(),'mobile-dark-export');
  await page.locator('#share-dashboard').click();await page.screenshot({path:path.join(os.tmpdir(),'begd-sharing-dialog.png')});await page.keyboard.press('Escape');
  fs.writeFileSync(path.join(os.tmpdir(),'begd-figure-footers.json'),JSON.stringify(footers,null,2));
  // Native file sharing receives a prepared PNG in the click gesture. Stub the OS sheet; do not contact a social service.
  const nativeContext=await browser.newContext();await nativeContext.addInitScript(()=>{Object.defineProperty(navigator,'canShare',{value:({files})=>files?.[0]?.type==='image/png'});Object.defineProperty(navigator,'share',{value:async payload=>{window.sharedFile={name:payload.files[0].name,type:payload.files[0].type,size:payload.files[0].size,text:payload.text};}});});
  const nativePage=await nativeContext.newPage();await nativePage.goto(base+'#overview');await nativePage.waitForSelector('.figure-actions');await nativePage.locator('.figure-actions').first().getByRole('button',{name:'Share figure',exact:true}).click();await nativePage.getByLabel('Custom message',{exact:true}).fill('Test image message');await nativePage.getByRole('button',{name:'Share image…',exact:true}).click();
  const shared=await nativePage.evaluate(()=>window.sharedFile);assert.equal(shared.type,'image/png');assert.ok(shared.size>10000);assert.match(shared.text,/Test image message/);assert.doesNotMatch(shared.text,/@/);await nativeContext.close();
  assert.deepEqual(errors,[]);console.log('Figure exports, image clipboard, share message/URLs, all-tab coverage, rerenders, 10y heatmap and mobile/dark checks passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
