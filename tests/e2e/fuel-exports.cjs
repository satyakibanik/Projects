/* Preview requires published report data. Set BEGD_TEST_URL and optionally BEGD_BROWSER_EXECUTABLE. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{})});
 try{
  const width=Number(process.env.BEGD_FIGURE_WIDTH||1440);
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto((process.env.BEGD_TEST_URL||'http://127.0.0.1:18943/begd/')+'#overview',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.fuel-report-chart[data-figure-actions]');
  for(const theme of ['light','dark'])for(const style of ['bar','pie','ring']){
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   await page.locator('#fuel-mix-style').selectOption(style);
   const download=page.waitForEvent('download');
   await page.locator('.fuel-export-actions').getByRole('button',{name:'Download PNG',exact:true}).first().click();
   const file=await download,filename=path.join(os.tmpdir(),`begd-fuel-${style}-${theme}-${width}.png`);await file.saveAs(filename);
   const data=fs.readFileSync(filename);assert.equal(data.subarray(1,4).toString(),'PNG');
   const pixels=await page.evaluate(async({encoded,theme,style})=>{
    const target=document.querySelector('.fuel-report-chart');
    const palette=[...target.querySelectorAll('.fuel-mix-segment')].filter(node=>Number(node.dataset.share)>=.001).map(node=>{
     const computed=getComputedStyle(node),rgb=(style==='ring'?computed.stroke:style==='pie'?computed.fill:computed.backgroundColor).match(/\d+/g).slice(0,3).map(Number);
     return {fuel:node.dataset.fuel,rgb,count:0};
    });
    const image=new Image();image.src='data:image/png;base64,'+encoded;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    const values=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    for(let i=0;i<values.length;i+=4)for(const color of palette)if(color.rgb.every((v,c)=>v===values[i+c]))color.count++;
    const expected=theme==='dark'?[12,21,32,255]:[255,255,255,255];
    for(const y of [0,20,canvas.height-20,canvas.height-1]){
     const row=ctx.getImageData(0,y,canvas.width,1).data;
     for(let x=0;x<canvas.width;x++)if(!expected.every((v,c)=>v===row[x*4+c]))throw Error('Incorrect PNG background');
    }
    return palette;
   },{encoded:data.toString('base64'),theme,style});
   assert.ok(pixels.length>=2,'Expected multiple fuel segments');
   for(const color of pixels)assert.ok(color.count>50,`${theme} ${style}: missing ${color.fuel} pixels (${color.count})`);
   console.log('PASS',theme,style,pixels.map(color=>color.fuel+': '+color.count+' pixels').join(', '));
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
