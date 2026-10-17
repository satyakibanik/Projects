/* Light is the default; only an explicit saved choice enables dark mode. */
(function(){
 const root=document.documentElement,storageKey='begd-theme';
 let theme='light';
 try{if(localStorage.getItem(storageKey)==='dark')theme='dark'}catch{}
 root.dataset.theme=theme;
 document.addEventListener('DOMContentLoaded',()=>{
  const button=document.getElementById('theme-toggle');
  const update=()=>{
   const dark=root.dataset.theme==='dark';
   button.setAttribute('aria-pressed',String(dark));
   button.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
   button.textContent=dark?'☀ Light':'☾ Dark';
  };
  update();
  button.addEventListener('click',()=>{
   root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';
   try{localStorage.setItem(storageKey,root.dataset.theme)}catch{}
   update();
  });
 });
})();
