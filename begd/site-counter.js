(() => {
  const display = document.getElementById('site-hit-count');
  if (!display) return;

  const counterUrl = 'https://countapi.mileshilliard.com/api/v1/hit/satyakib_github_io_begd_pageviews';
  fetch(counterUrl, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`Counter request failed: ${response.status}`);
      return response.json();
    })
    .then(({ value }) => {
      const count = Number(value);
      if (Number.isSafeInteger(count) && count >= 4700) {
        display.textContent = count.toLocaleString('en-US');
        display.dataset.loaded = 'true';
      }
    })
    .catch(() => {
      // Keep the seeded value visible if the counter service is unavailable.
    });
})();
