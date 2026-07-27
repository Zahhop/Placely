(function redirectEditJobToJobsWorkspace() {
  const params = new URLSearchParams(window.location.search);
  const jobId = params.get("id") || params.get("job");
  const target = new URL("manage-jobs.html", window.location.href);

  if (jobId) {
    target.searchParams.set("view", "edit");
    target.searchParams.set("job", jobId);
  }

  const relativeTarget = `${target.pathname.split("/").pop()}${target.search}${target.hash}`;
  const continueLink = document.getElementById("continueLink");
  if (continueLink) continueLink.href = relativeTarget;

  window.location.replace(relativeTarget);
})();
