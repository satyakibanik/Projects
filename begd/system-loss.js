/* Annual fiscal-year evidence, independent of daily operating reports. */
(function(root){
  const SOURCE='https://powerdivision.gov.bd/pages/static-pages/694032ba35ce18e1c056155a';
  const GRID=[['TRANSMISSION & DISTRIBUTION','Transmission & distribution','#366474'],['DISTRIBUTION','Distribution','#c48722'],['TRANSMISSION','Transmission','#ba477b']];
  const UTILITIES=['BPDB','REB','DPDC','DESCO','WZPDCO','NESCO'].map((name,i)=>[name,name,['#4e79a7','#b07aa1','#d88931','#59a14f','#087e8b','#e15759'][i]]);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let bundle=null,pending=null,failed=false;
  function annualRows(data){
    const rows=(data?.data||[]).map(row=>({...row,date:row.fiscal_year.slice(0,4)+'-07-01'})).sort((a,b)=>a.date.localeCompare(b.date));
    if(!rows.length)return [];
    const byYear=new Map(rows.map(row=>[Number(row.fiscal_year.slice(0,4)),row]));
    // Keep absent fiscal years as gaps rather than drawing across them.
    const start=Number(rows[0].fiscal_year.slice(0,4)),end=Number(rows.at(-1).fiscal_year.slice(0,4));
    return Array.from({length:end-start+1},(_,i)=>byYear.get(start+i)||{date:(start+i)+'-07-01',fiscal_year:(start+i)+'-'+String((start+i+1)%100).padStart(2,'0')});
  }
  async function load(){
    if(bundle)return;
    if(!pending)pending=fetch('system-loss-data.json',{cache:'no-cache'}).then(response=>{
      if(!response.ok)throw Error('System-loss data unavailable');return response.json();
    }).then(data=>{
      if(data.version!==1||data.source!==SOURCE||!Array.isArray(data.data)||data.data.some(row=>!/^\d{4}-\d{2,4}$/.test(row.fiscal_year)))throw Error('Invalid system-loss data');
      bundle=data;failed=false;
    }).catch(()=>{failed=true}).finally(()=>{pending=null});
    await pending;
  }
  function panels(plot){
    const rows=annualRows(bundle);
    const source=`<a href="${SOURCE}" target="_blank" rel="noopener">Power Division · system loss</a>`;
    if(!rows.length)return `<section class="panel full system-loss-panel"><div class="panel-head"><div><h2>Annual system loss</h2><p>Power Division · fiscal-year percentages</p></div></div><p class="empty">${failed?'System-loss data could not be loaded.':pending?'Loading annual system loss…':'No annual system-loss values are available.'}</p><p class="note">Source: ${source}.</p></section>`;
    const coverage=`FY ${rows[0].fiscal_year} – ${rows.at(-1).fiscal_year}`;
    const fetched=(bundle.fetched_at||bundle.snapshot_at)?new Date(bundle.fetched_at||bundle.snapshot_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Dhaka'}):'unavailable';
    const note=`<p class="note">Source: ${source} (Power Cell). Full available annual record · ${coverage}. Fiscal-year percentages; missing values remain gaps. Combined loss is the published value. ${bundle.fetched_at?'Fetched':'Reference snapshot saved'} ${escape(fetched)} · source checked every 30 days.${bundle.status==='stale'?' The latest source check failed; showing the last successful snapshot.':''}</p>`;
    const options={ticks:rows.map((row,index)=>({index,label:row.fiscal_year,sparse:index%6===0||index===rows.length-1})).filter(tick=>tick.index===rows.length-1||(tick.index%3===0&&tick.index<=rows.length-4))};
    const chart=(title,definitions,key)=>{
      const series=definitions.map(([field,name,color])=>({name,color,value:row=>typeof row[field]==='number'&&Number.isFinite(row[field])?row[field]:null}));
      return `<section class="panel full system-loss-panel"><div class="panel-head"><div><h2>${title}</h2><p>${coverage} · annual system loss · %</p></div></div>${plot(rows,series,title,'%',false,{...options,key})}${note}</section>`;
    };
    const table=`<details class="system-loss-values"><summary>Annual source values (%)</summary><div class="table-wrap" tabindex="0" role="region" aria-label="Annual system-loss source values"><table><thead><tr><th scope="col">Fiscal year</th>${[...GRID,...UTILITIES].map(([,name])=>`<th scope="col">${escape(name)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${row.fiscal_year}</th>${[...GRID,...UTILITIES].map(([key])=>`<td>${row[key]==null?'—':Number(row[key]).toFixed(2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
    return chart('Annual transmission & distribution loss',GRID,'system-loss-grid')+chart('Annual utility system loss',UTILITIES,'system-loss-utilities')+table;
  }
  root.BEGDSystemLoss={load,panels,annualRows};
})(window);
