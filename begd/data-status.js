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
  node.textContent=sources.map(({label,value})=>label+': '+(timestamp(value)||'update time unavailable')).join(' · ');
 }
 root.BEGDDataStatus={set,timestamp,tick};
 tick();root.setInterval(tick,1000);
 document.addEventListener('visibilitychange',tick);
 root.addEventListener('hashchange',()=>{const node=document.querySelector('#data-updated');if(node)node.textContent='Data updated: loading…';});
})(window);
