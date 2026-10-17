const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../begd/theme.js'),'utf8');
function boot(saved,blocked=false){
 const root={dataset:{}},button={attrs:{},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,fn){this[k]=fn}},events={},writes=[];
 const document={documentElement:root,getElementById:()=>button,addEventListener:(k,fn)=>events[k]=fn};
 const localStorage={getItem(){if(blocked)throw Error('blocked');return saved},setItem(k,v){if(blocked)throw Error('blocked');writes.push([k,v])}};
 vm.runInNewContext(source,{document,localStorage});events.DOMContentLoaded();return {root,button,writes};
}
test('theme defaults to light, toggles accessibly, and remembers an explicit choice',()=>{
 const {root,button,writes}=boot(null);assert.equal(root.dataset.theme,'light');assert.equal(button.attrs['aria-pressed'],'false');
 button.click();assert.equal(root.dataset.theme,'dark');assert.equal(button.attrs['aria-label'],'Switch to light mode');assert.equal(button.attrs['aria-pressed'],'true');assert.deepEqual(writes,[['begd-theme','dark']]);
 assert.equal(boot('dark').root.dataset.theme,'dark');assert.equal(boot('invalid').root.dataset.theme,'light');
 button.click();assert.equal(root.dataset.theme,'light');assert.equal(button.attrs['aria-label'],'Switch to dark mode');
});
test('theme remains usable when browser storage is unavailable',()=>{
 const {root,button}=boot(null,true);assert.equal(root.dataset.theme,'light');button.click();assert.equal(root.dataset.theme,'dark');button.click();assert.equal(root.dataset.theme,'light');
});
