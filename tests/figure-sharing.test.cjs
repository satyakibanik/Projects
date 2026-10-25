const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function api(overrides={}){const window=overrides.window||{};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/figure-sharing.js'),'utf8'),{window,URL,document:{querySelector:()=>({addEventListener(){}}),querySelectorAll:()=>[]},MutationObserver:class{observe(){}},...overrides});return window.BEGDFigures;}
test('social links keep the exact view but never leak a local preview origin',()=>{
 const a=api(),url=a.shareURL('http://127.0.0.1:18943/begd/?v=2&date=2026-10-19&compare=2026-09-15#trends');
 assert.equal(url,'https://satyakibanik.github.io/Projects/begd/?v=2&date=2026-10-19&compare=2026-09-15#trends');
 const message='Bangladesh & energy + demand #বিদ্যুৎ';
 const x=new URL(a.socialURL(url,message));assert.equal(x.origin,'https://twitter.com');assert.equal(x.searchParams.get('text'),message);assert.equal(x.searchParams.get('url'),url);

});
test('PNG names cannot contain paths or unsafe punctuation and remain bounded',()=>{const a=api();assert.equal(a.filename('../Demand & generation / MW'),'begd-demand-generation-mw.png');assert.ok(a.filename('x'.repeat(1000)).length<105);});
test('dispatch export uses the main chart title instead of its load shedding subheading',()=>{
 const heading={textContent:'Demand, supply, & load shedding.'};
 const panel={querySelector:selector=>selector==='h2'?heading:null,querySelectorAll:()=>[],matches:()=>false};
 const target={closest:()=>panel,matches:selector=>selector.includes('.realtime-dispatch-plots'),querySelector:selector=>selector==='h2,h3'?{textContent:'Reported load shedding'}:null,querySelectorAll:()=>[]};
 assert.equal(api().describe(target).title,heading.textContent);
});

for(const [name,background,ink] of [['dark','rgb(12, 21, 32)','rgb(229, 237, 245)'],['light','rgb(255, 255, 255)','rgb(34, 60, 80)']]){
 test(`${name} PNG uses the active theme for the chart, title, notes and attribution`,async()=>{
  const fills=[],labels=[],style={backgroundColor:background,color:ink};
  const ctx={measureText:text=>({width:text.length*10}),scale(){},fillRect(...bounds){fills.push({color:this.fillStyle,bounds});},fillText(text){labels.push({text,color:this.fillStyle});},drawImage(){}};
  const canvas={getContext:()=>ctx,toBlob:callback=>callback('png')};
  const document={body:{},querySelector:()=>({addEventListener(){}}),querySelectorAll:()=>[],createElement:tag=>{assert.equal(tag,'canvas');return canvas;}};
  const window={html2canvas:async(target,options)=>{assert.equal(options.backgroundColor,background);style.color='changed during capture';return {width:2400,height:800};}};
  const a=api({window,document,getComputedStyle:()=>style});
  assert.equal(await a.exportPNG({isConnected:true,matches:()=>false},{title:'Demand and generation',context:'Operating date',footer:['Source note']}),'png');
  assert.equal(fills.length,1);assert.equal(fills[0].color,background);
  assert.deepEqual(fills[0].bounds,[0,0,canvas.width/2,canvas.height/2]);
  assert.deepEqual(labels.map(label=>label.text),['Demand and generation','Operating date','Source note','© Bangladesh Electric Grid Dashboard','https://satyakibanik.github.io/Projects/begd/']);
  assert.ok(labels.every(label=>label.color===ink));
 });
}
