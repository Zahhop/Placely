(function () {
  if (window.PlacelyCandidateApplications?.redirectLegacyApplyPage) {
    window.PlacelyCandidateApplications.redirectLegacyApplyPage({
      findJobsPath: "../public/find-jobs.html"
    });
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const jobId = params.get("job_id") || params.get("job") || params.get("id");
  const target = new URL("../public/find-jobs.html", window.location.href);
  target.searchParams.set("role", "candidate");
  if (jobId) {
    target.searchParams.set("job", jobId);
    target.searchParams.set("view", "apply");
  }

  window.location.replace(`${target.pathname}${target.search}${target.hash}`);
})();
