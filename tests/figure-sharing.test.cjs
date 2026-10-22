const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function api(){const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/figure-sharing.js'),'utf8'),{window,URL,document:{querySelector:()=>({addEventListener(){}}),querySelectorAll:()=>[]},MutationObserver:class{observe(){}}});return window.BEGDFigures;}
test('social links keep the exact view but never leak a local preview origin',()=>{
 const a=api(),url=a.shareURL('http://127.0.0.1:18943/begd/?v=2&date=2026-10-19&compare=2026-09-15#trends');
 assert.equal(url,'https://satyakibanik.github.io/Projects/begd/?v=2&date=2026-10-19&compare=2026-09-15#trends');
 const message='Bangladesh & energy + demand #বিদ্যুৎ';
 const x=new URL(a.socialURL('x',url,message));assert.equal(x.origin,'https://twitter.com');assert.equal(x.searchParams.get('text'),message);assert.equal(x.searchParams.get('url'),url);
 const linkedin=new URL(a.socialURL('linkedin',url,message));assert.equal(linkedin.pathname,'/sharing/share-offsite/');assert.equal(linkedin.searchParams.get('url'),url);assert.equal(linkedin.searchParams.has('text'),false);
});
test('PNG names cannot contain paths or unsafe punctuation and remain bounded',()=>{const a=api();assert.equal(a.filename('../Demand & generation / MW'),'begd-demand-generation-mw.png');assert.ok(a.filename('x'.repeat(1000)).length<105);});
