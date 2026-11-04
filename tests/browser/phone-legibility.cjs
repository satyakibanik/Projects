// Responsive structure and typography across every dashboard view.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {serve,fixture}=require('./fixture-site.cjs');
const tabs=['realtime','trends','overview','en-curve','regions','plants','imports','substations','operations','forecast','news'];
(async()=>{
 const browser=await chromium.launch(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{});
 const output=process.env.BEGD_PHONE_AUDIT_OUTPUT;
 if(output)fs.mkdirSync(output,{recursive:true});
 const results=[];
 try{
  for(const width of [360,390,438])for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
   await context.route('**/*',route=>{
    if(new URL(route.request().url()).pathname==='/api/report')return route.fulfill({json:{...fixture.report,hourly:fixture.report.hourly.map((r,i)=>({...r,demand_mw:12500+i*150,generation_mw:12000+i*150}))}});
    if(new URL(route.request().url()).pathname.endsWith('/news-data.json'))return route.fulfill({json:{curated_on:'2026-01-15',window_days:30,event_labels:{grid:'Grid updates'},articles:[{id:'1',date:'2026-01-15',source:'BSS',event:'grid',language:'en',title:'Grid maintenance and electricity generation update',summary:'A representative news summary to verify wrapping and phone legibility.',url:'https://example.test/news'}]}});
    return serve(route);
   });
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   for(const tab of tabs){
    await page.goto(`https://begd.test/begd/index.html?v=2&date=2026-01-15#${tab}`);
    await page.waitForFunction(()=>window.BEGDView?.started&&document.querySelector('#content')?.textContent.trim()&&document.querySelector('#view-status').textContent!=='Restoring dashboard view…');
    if(tab==='news')await page.locator('.news-card').waitFor();
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const metrics=await page.evaluate(()=>{
     const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'};
     const labels=[...document.querySelectorAll('#content .legend label,#content .trends-legend label,#content .vb-legend button')].filter(visible);
     const clipped=labels.filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.textContent.trim());
     const small=labels.filter(e=>parseFloat(getComputedStyle(e.querySelector('[data-series-label]')||e).fontSize)<12).map(e=>e.textContent.trim());
     const cutAxes=[];
     for(const svg of document.querySelectorAll('#content svg.chart,#content svg.vb-chart'))for(const text of svg.querySelectorAll('text')){
      if(!visible(text))continue;
      const r=text.getBoundingClientRect();
      for(let p=svg.parentElement;p&&p.id!=='content';p=p.parentElement){
       const style=getComputedStyle(p),b=p.getBoundingClientRect();
       if(['hidden','auto','scroll','clip'].includes(style.overflowX)&&r.left<b.left-2){cutAxes.push(text.textContent);break}
      }
     }
     const axisOverlaps=[];
     for(const svg of document.querySelectorAll('#content svg.vb-chart')){
      const title=svg.querySelector('.vb-axis-title[transform]');if(!title)continue;
      const a=title.getBoundingClientRect();
      for(const tick of svg.querySelectorAll('.vb-axis[text-anchor="end"]')){
       const b=tick.getBoundingClientRect();
       if(Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1)axisOverlaps.push(tick.textContent);
      }
     }
     const overlappingTicks=[];
     for(const svg of document.querySelectorAll('#content svg.chart,#content svg.vb-chart')){
      const ticks=[...svg.querySelectorAll('text')].filter(e=>visible(e)&&/^\d{2}:\d{2}$/.test(e.textContent.trim())).map(e=>({text:e.textContent,r:e.getBoundingClientRect()})).sort((a,b)=>a.r.left-b.r.left);
      for(let i=1;i<ticks.length;i++)if(ticks[i-1].r.right>ticks[i].r.left+1&&Math.min(ticks[i-1].r.bottom,ticks[i].r.bottom)>Math.max(ticks[i-1].r.top,ticks[i].r.top)+1)overlappingTicks.push(ticks[i-1].text+' / '+ticks[i].text);
     }
     return {axisOverlaps,overlappingTicks,overflow:document.documentElement.scrollWidth>innerWidth+1,clipped,small,cutAxes:[...new Set(cutAxes)]};
    });
    results.push({width,theme,tab,...metrics});
    if(output){
     await page.screenshot({path:path.join(output,`${width}-${theme}-${tab}-top.png`)});
     const target=page.locator('#content .panel,#content .dispatch-main,#content .realtime-dispatch').first();
     if(await target.count()){await target.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${width}-${theme}-${tab}-content.png`)});}
    }
    console.log('AUDIT',JSON.stringify(results.at(-1)));
   }
   assert.deepEqual(errors,[],`${width} ${theme}: browser errors`);
   await context.close();
  }
  if(output)fs.writeFileSync(path.join(output,'metrics.json'),JSON.stringify(results,null,2));
  const issues=results.filter(r=>r.overflow||r.clipped.length||r.small.length||r.cutAxes.length||r.overlappingTicks.length||r.axisOverlaps.length);
  assert.deepEqual(issues,[],'Phone views must fit their viewport and retain readable, unclipped legends and axes');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
