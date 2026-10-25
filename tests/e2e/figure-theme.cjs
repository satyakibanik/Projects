/* Run against a local preview containing report snapshots and Trends data. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto((process.env.BEGD_TEST_URL||'http://127.0.0.1:18943/begd/')+'#overview');
  await page.waitForFunction(()=>window.BEGDView?.started&&document.querySelector('.figure-actions'));
  let total=0;
  for(const theme of ['dark','light']){
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   for(const tab of ['overview','regions','plants','imports','substations','operations','en-curve','forecast','realtime','trends']){
    await page.locator(`nav a[href="#${tab}"]`).click();
    if(tab==='trends')await page.waitForSelector('.trends-chart');
    await page.waitForTimeout(150);
    const outputs=await page.evaluate(async({theme,tab})=>{
     const targets=[...document.querySelectorAll('#content [data-figure-actions]')],results=[];
     for(const target of targets){
      const blob=await window.BEGDFigures.exportPNG(target),bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
      const expected=theme==='dark'?[12,21,32,255]:[255,255,255,255];
      for(const y of [0,20,canvas.height-20,canvas.height-1]){
       const row=ctx.getImageData(0,y,canvas.width,1).data;
       for(let x=0;x<canvas.width;x++)for(let c=0;c<4;c++)if(row[x*4+c]!==expected[c])throw Error(`${theme} ${tab} ${target.className.baseVal||target.className}: band pixel ${x},${y}: ${Array.from(row.slice(x*4,x*4+4))}`);
      }
      const result={type:typeof target.className==='string'?target.className:target.className.baseVal,width:canvas.width,height:canvas.height};
      if(theme==='dark'&&tab==='overview'&&results.length===0)result.png=canvas.toDataURL().split(',')[1];
      results.push(result);bitmap.close();
     }
     return results;
    },{theme,tab});
    for(const out of outputs)if(out.png){fs.writeFileSync(path.join(os.tmpdir(),'begd-dark-png-fixed.png'),Buffer.from(out.png,'base64'));delete out.png;}
    total+=outputs.length;console.log(theme,tab,outputs.length,'PNGs passed');
   }
  }
  assert.ok(total>=40,`Expected chart coverage, got ${total}`);assert.deepEqual(errors,[]);console.log('PASS',total,'PNG exports with uniform theme-colored top and bottom bands');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
