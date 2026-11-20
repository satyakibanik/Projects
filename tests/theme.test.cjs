const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../begd/theme.js'),'utf8');
function boot(saved,blocked=false){
 const root={dataset:{}},picker={value:'',addEventListener(k,fn){this[k]=fn}},events={},writes=[];
 const document={documentElement:root,getElementById:()=>picker,addEventListener:(k,fn)=>events[k]=fn};
 const localStorage={getItem(){if(blocked)throw Error('blocked');return saved},setItem(k,v){if(blocked)throw Error('blocked');writes.push([k,v])}};
 vm.runInNewContext(source,{document,localStorage});events.DOMContentLoaded();return {root,picker,writes};
}
test('theme defaults to light and each explicit selection survives a reload',()=>{
 const {root,picker,writes}=boot(null);
 assert.equal(root.dataset.theme,'light');
 assert.equal(picker.value,'light');
 for(const theme of ['solarized','dark','light']){
  picker.value=theme;picker.change();
  assert.equal(root.dataset.theme,theme);
  assert.equal(boot(theme).picker.value,theme);
 }
 assert.deepEqual(writes,['solarized','dark','light'].map(theme=>['begd-theme',theme]));
 assert.equal(boot('invalid').root.dataset.theme,'light');
});
test('theme remains usable when browser storage is unavailable',()=>{
 const {root,picker}=boot(null,true);
 picker.value='solarized';picker.change();assert.equal(root.dataset.theme,'solarized');
 picker.value='dark';picker.change();assert.equal(root.dataset.theme,'dark');
});
