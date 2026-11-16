(() => {
  const display = document.getElementById('site-hit-count');
  if (!display) return;

  const callbackName = 'begdUpdateSiteHits';
  const request = document.createElement('script');
  window[callbackName] = ({ value } = {}) => {
    if (Number.isSafeInteger(value) && value >= 4700) {
      display.textContent = value.toLocaleString('en-US');
      display.dataset.loaded = 'true';
    }
    delete window[callbackName];
    request.remove();
  };
  request.onerror = () => {
    delete window[callbackName];
    request.remove();
  };
  request.src = `https://counterapi.com/api/satyakibanik.github.io/view/begd-visits?startNumber=4700&callback=${callbackName}`;
  document.head.append(request);
})();
