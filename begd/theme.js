/* Apply the saved theme before the dashboard renders. */
(function(){
 const root=document.documentElement,storageKey='begd-theme';
 const themes=['light','dark','solarized'];
 let theme='light';
 try{
  const saved=localStorage.getItem(storageKey);
  if(themes.includes(saved))theme=saved;
 }catch{}
 root.dataset.theme=theme;
 document.addEventListener('DOMContentLoaded',()=>{
  const picker=document.getElementById('theme-toggle');
  picker.value=root.dataset.theme;
  picker.addEventListener('change',()=>{
   if(!themes.includes(picker.value))return;
   root.dataset.theme=picker.value;
   try{localStorage.setItem(storageKey,picker.value)}catch{}
  });
 });
})();
