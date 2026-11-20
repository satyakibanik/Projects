/* Bangladesh wall clock and source timestamps; opening a tab never refreshes data age. */
(function(root){
 const zone='Asia/Dhaka';
 const dateFormat=new Intl.DateTimeFormat('en-GB',{timeZone:zone,day:'2-digit',month:'short',year:'numeric'});
 const timeFormat=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
 function timestamp(value){
  if(typeof value!=='string'||!value)return null;
  const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(value);
  // Require an explicit offset for instants, so browser timezone cannot change the result.
  if(!dateOnly&&!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value))return null;
  const date=new Date(dateOnly?value+'T12:00:00+06:00':value);
  if(!Number.isFinite(date.getTime()))return null;
  return dateFormat.format(date)+(dateOnly?' · time unavailable':', '+timeFormat.format(date)+' BST');
 }
 function tick(){
  const clock=document.querySelector('#bangladesh-clock');if(!clock)return;
  const now=new Date();clock.dateTime=now.toISOString();
  clock.textContent=dateFormat.format(now)+' · '+timeFormat.format(now)+' BST';
 }
 function set(view,sources){
  const active=location.hash.slice(1)||'overview';if(active!==view)return;
  const node=document.querySelector('#data-updated');if(!node)return;
  node.dataset.view=view;node.tabIndex=view==='realtime'?0:-1;
  node.textContent=sources.map(({label,value})=>label+': '+(timestamp(value)||'update time unavailable')).join(' · ');
 }
 function realtime(snapshot,chartUpdated){
  const times=[...(snapshot?.demand_hourly||[]),...(snapshot?.generation_hourly||[]),...(snapshot?.imports||[]).flatMap(route=>route.hourly||[])].map(row=>row.time).filter(time=>/^\d{2}:\d{2}$/.test(time)).sort();
  const day=snapshot?.today_date||snapshot?.date;
  const compact=value=>timestamp(value)?.replace(/:\d{2} BST$/,' BST');
  const reading=/^\d{4}-\d{2}-\d{2}$/.test(day||'')&&times.length?compact(day+'T'+times.at(-1)+':00+06:00'):'unavailable';
  const node=document.querySelector('#data-updated');if(location.hash!=='#realtime'||!node)return;
  node.dataset.view='realtime';node.tabIndex=0;
  node.title='ERP reading is the observation time in the displayed snapshot, not its posting time. ERP does not expose a posting timestamp. Chart updated is when this browser accepted the snapshot. Scroll horizontally for all timestamps.';
  node.textContent='ERP reading: '+reading+' · ERP posted: not exposed · ERP fetched: '+(compact(snapshot?.fetched_at||snapshot?.updated_at)||'unavailable')+' · Chart updated: '+(compact(chartUpdated)||'unavailable');
 }
 root.BEGDDataStatus={set,realtime,timestamp,tick};
 tick();root.setInterval(tick,1000);
 document.addEventListener('visibilitychange',tick);
 root.addEventListener('hashchange',()=>{const node=document.querySelector('#data-updated');if(node)node.textContent='Data updated: loading…';});
})(window);
