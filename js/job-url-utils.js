(function () {
  function slugifyJobPart(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72);
  }

  function getShortJobId(jobOrId) {
    const id = typeof jobOrId === "object" ? jobOrId?.id : jobOrId;
    return String(id || "").trim();
  }

  function buildJobSlug(job) {
    const title = slugifyJobPart(job?.job_title || job?.title || "job");
    const location = slugifyJobPart(job?.location || "");
    return [title, location].filter(Boolean).join("-") || "job";
  }

  function buildJobDetailUrl(job, options = {}) {
    const id = getShortJobId(job);
    const slug = buildJobSlug(job);
    const basePath = options.basePath || "job.html";
    const url = new URL(basePath, window.location.href);

    url.searchParams.set("id", id);
    url.searchParams.set("slug", slug);
    return `${url.pathname}${url.search}`;
  }

  function buildFindJobsUrl(job, options = {}) {
    const id = getShortJobId(job);
    const slug = buildJobSlug(job);
    const basePath = options.basePath || "find-jobs.html";
    const url = new URL(basePath, window.location.href);

    url.searchParams.set("role", "candidate");
    url.searchParams.set("job", id);
    url.searchParams.set("slug", slug);
    return `${url.pathname}${url.search}`;
  }

  function getJobIdFromLocation(search = window.location.search) {
    const params = new URLSearchParams(search);
    return params.get("job") || params.get("id") || "";
  }

  window.PlacelyJobUrls = {
    buildFindJobsUrl,
    buildJobDetailUrl,
    buildJobSlug,
    getJobIdFromLocation,
    slugifyJobPart
  };
})();
