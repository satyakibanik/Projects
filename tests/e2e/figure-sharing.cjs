/* Run against a local preview containing current published live-data.js and trends-data.json. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const ready=()=>page.waitForFunction(()=>window.BEGDView?.started&&document.querySelector('.figure-actions'));
 const base=process.env.BEGD_TEST_URL||'http://127.0.0.1:18943/begd/';
 const download=async(bar,label)=>{const event=page.waitForEvent('download');await bar.getByRole('button',{name:'Download PNG',exact:true}).click();const file=await event;const downloaded=await file.path();const data=fs.readFileSync(downloaded);assert.equal(data.subarray(1,4).toString(),'PNG');assert.ok(data.length>10000,label);await file.saveAs(path.join(os.tmpdir(),'begd-'+label+'.png'));};
 try{
  await page.goto(base+'#overview');await ready();
  const published=await page.evaluate(()=>({date:document.querySelector('#report-date').value,generated:window.BEGD_STATIC_DATA.generated_at}));console.log('Published snapshot',published);
  let bar=page.locator('.figure-actions').first();await download(bar,'overview-export');
  await bar.getByRole('button',{name:'Copy figure',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.figure-actions [role=status]').textContent==='Figure copied.');
  assert.ok(await page.evaluate(async()=>{const items=await navigator.clipboard.read();return items.some(i=>i.types.includes('image/png'));}));
  await bar.getByRole('button',{name:'Share figure',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.locator('textarea').fill('My custom message & Bangladesh + energy');
  const x=new URL(await dialog.getByRole('link',{name:'Share to X',exact:true}).getAttribute('href'));assert.equal(x.searchParams.get('text'),'My custom message & Bangladesh + energy');assert.equal(new URL(x.searchParams.get('url')).origin,'https://satyakibanik.github.io');
  await dialog.getByRole('button',{name:'Copy message',exact:true}).click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/My custom message & Bangladesh \+ energy/);
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  await page.locator('#share-dashboard').click();assert.equal(await page.getByRole('dialog').getByRole('button',{name:'Download PNG',exact:true}).count(),0);await page.keyboard.press('Escape');
  // Existing render settings replace figure nodes and should attach one fresh toolbar each.
  await page.locator('#fuel-mix-style').selectOption('ring');await page.waitForSelector('.fuel-mix-ring');
  const assertCoverage=async()=>{assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#content svg:not(.series-swatch):not(.peak-icon),#content .fuel-mix-bar,#content .trends-heatmap')].filter(node=>!node.closest('.figure-actions')).filter(node=>!node.closest('[data-figure-actions]')).map(node=>node.outerHTML.slice(0,150))),[]);};
  await assertCoverage();await download(page.locator('.fuel-report-chart .figure-actions').first(),'fuel-ring');
  for(const tab of ['regions','plants','imports','substations','operations','en-curve','realtime','trends']){
   await page.locator(`nav a[href="#${tab}"]`).click();await page.waitForTimeout(700);await assertCoverage();
   const actions=page.locator('.figure-actions');if(await actions.count())await download(actions.first(),tab+'-export');
  }
  await page.locator('[data-trend-days="10y"]').click();await page.waitForSelector('.trends-heatmap');await assertCoverage();await download(page.locator('.trends-heatmap').locator('..').locator('.figure-actions'),'heatmap-export');
  await page.locator('#theme-toggle').click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(os.tmpdir(),'begd-sharing-mobile-dark.png'),fullPage:true});await download(page.locator('.figure-actions').first(),'mobile-dark-export');
  await page.locator('#share-dashboard').click();await page.screenshot({path:path.join(os.tmpdir(),'begd-sharing-dialog.png')});await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);console.log('Figure exports, image clipboard, share message/URLs, all-tab coverage, rerenders, 10y heatmap and mobile/dark checks passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
