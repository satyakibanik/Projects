/* Dates here are operating dates in Asia/Dhaka, never publication dates. */
function comparisonStyle(key) {
  const presets={yesterday:{color:'#a77cc1',dash:'7 5'},tomorrow:{color:'#54b9a4',dash:'2 4'},highest:{color:'#d2834b',dash:'8 3 2 3'}};
  if(presets[key])return presets[key];
  const date=key.replace(/^custom_/,''),hash=[...date].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);
  const palette=['#337cad','#ce6378','#41997e','#a88125','#9a77c6','#c8783b','#4d9ca9','#aa6d93','#678a36','#7b81c3','#b75a4f'];
  const dashes=['10 3','3 3','10 3 2 3','6 2 2 2','12 4 3 4','4 3 1 3','8 2 1 2 1 2','2 3 6 3','12 3 1 3','5 2 1 2 1 2','9 4 3 4','3 2 3 6'];
  return {color:palette[hash%palette.length],dash:dashes[hash%dashes.length]};
}
async function reportForOperatingDate(date) {
  if(!window.BEGDViewCodec.validDate(date))throw Error('Choose a valid operating date.');
  const response=await fetch('/api/report?date='+encodeURIComponent(date),{cache:'no-store'});
  if(!response.ok)throw Error('No archived report is available for operating date '+date+'.');
  const report=await response.json();
  if(report.date!==date)throw Error('The archived report does not match operating date '+date+'.');
  return report;
}
function renderCustomComparisons() {
  $('#custom-comparisons').innerHTML=[...customComparisons].map(([date,item])=>{
    const style=comparisonStyle(date);
    return `<li><span class="comparison-sample" style="color:${style.color}" aria-hidden="true"><svg viewBox="0 0 48 12"><path d="M0 6H48" stroke="currentColor" stroke-width="3" stroke-dasharray="${style.dash}"/></svg></span><span>Operating ${esc(date)}${item.report?' · published '+esc(item.report.published_date||'unavailable'):' · '+esc(item.error||'Loading…')}</span><button type="button" data-remove-comparison="${date}" aria-label="Remove comparison for operating date ${date}">Remove</button></li>`;
  }).join('');
}
async function addCustomComparison(date,{restoring=false}={}) {
  const status=$('#comparison-status');
  if(!window.BEGDViewCodec.validDate(date)){status.textContent='Choose a valid operating date (Bangladesh time).';return false;}
  if(customComparisons.has(date)||(!restoring&&Object.values(comparisonData).some(report=>report?.date===date))){status.textContent='Operating date '+date+' is already included in comparisons.';return false;}
  const item={report:null,error:null};customComparisons.set(date,item);renderCustomComparisons();
  status.textContent='Loading operating date '+date+'…';
  try {
    const report=await reportForOperatingDate(date);
    if(customComparisons.get(date)!==item)return false;
    item.report=report;status.textContent='Added operating date '+date+'.';
  }catch(error){if(customComparisons.get(date)!==item)return false;item.error=error.message;status.textContent=error.message;}
  renderCustomComparisons();render();
  window.BEGDView?.commit();
  return Boolean(item.report);
}
$('#add-comparison').addEventListener('click',()=>addCustomComparison($('#comparison-date').value));
$('#comparison-date').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addCustomComparison(event.target.value)}});
$('#custom-comparisons').addEventListener('click',event=>{
  const button=event.target.closest('[data-remove-comparison]');if(!button)return;
  customComparisons.delete(button.dataset.removeComparison);renderCustomComparisons();render();
  $('#comparison-date').focus();$('#comparison-status').textContent='Comparison removed.';
  window.BEGDView?.commit();
});
