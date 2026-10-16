(function () {
  const bundle = window.BEGD_STATIC_DATA;
  const originalFetch = window.fetch.bind(window);
  const archiveBase = new URL("archive/", window.location.href);
  const reportMetadata = new Map((bundle?.reports || []).map(report => [String(report.id), report]));
  async function getReport(id) {
    if (!id) return null;
    id = String(id);
    if (bundle.reports_by_id[id]) return bundle.reports_by_id[id];
    if (!reportMetadata.has(id)) return null;
    const response = await originalFetch(new URL(`${encodeURIComponent(id)}.json`, archiveBase), { cache: "no-store" });
    if (!response.ok) return null;
    return response.json();
  }
  const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
  const failure = (message, status = 404) => jsonResponse({ error: message }, status);
  window.fetch = async function (input, options) {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
      return originalFetch(input, options);
    }
    if (!bundle) return failure("The hourly dashboard data bundle is unavailable.", 503);
    if (url.pathname === "/api/reports") {
      return jsonResponse({
        reports: bundle.reports, count: bundle.reports.length, complete: true,
        pages_loaded: 1, page_count: 1, updated_at: bundle.generated_at,
        error: null
      });
    }
    if (url.pathname === "/api/report") {
      const report = await getReport(url.searchParams.get("id"));
      return report ? jsonResponse(report) : failure("That report is not available in the archive.");
    }
    if (url.pathname === "/api/current-day") {
      return jsonResponse(bundle.current_day);
    }
    if (url.pathname === "/api/highest-generation") {
      return bundle.highest_generation ? jsonResponse(bundle.highest_generation) : failure("Highest-generation report is unavailable in this update.");
    }
    if (url.pathname === "/api/neighbor") {
      const current = await getReport(url.searchParams.get("id"));
      const offset = Number(url.searchParams.get("offset"));
      if (!current || ![-1, 1].includes(offset)) return failure("No adjacent report is available.");
      const target = new Date(`${current.date}T00:00:00Z`);
      target.setUTCDate(target.getUTCDate() + offset);
      const date = target.toISOString().slice(0, 10);
      const reportId = bundle.reports_by_operating_date[date];
      const report = reportId ? await getReport(reportId) : null;
      return report ? jsonResponse(report) : failure("No adjacent operating-day report is available.");
    }
    return failure("Unknown dashboard data endpoint.");
  };
  window.setTimeout(() => window.location.reload(), 60 * 60 * 1000);
})();
