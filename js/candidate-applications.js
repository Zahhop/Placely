 const applications = JSON.parse(localStorage.getItem("placely_applications")) || [];

  const applicationsList = document.getElementById("applications_list");

  document.getElementById("applied_count").textContent = applications.length;
  document.getElementById("interviewing_count").textContent = "0";
  document.getElementById("offers_count").textContent = "0";
  document.getElementById("followups_count").textContent = applications.length;

  if (!applications.length) {
    applicationsList.innerHTML = `
      <div class="empty-state">
        <strong>No applications yet</strong>
        <p>When you apply to jobs, your applications will appear here.</p>
        <a href="find-jobs.html?role=candidate">Browse Jobs</a>
      </div>
    `;
  } else {
    applicationsList.innerHTML = applications.map(job => `
      <article class="application-card">
        <div>
          <h3>${job.title}</h3>
          <p>${job.company} · ${job.location} · ${job.type} · ${job.pay}</p>
          <div class="tags">
            <span>Submitted</span>
            <span>Follow up soon</span>
          </div>
        </div>

        <div class="status-pill">Applied</div>
      </article>
    `).join("");
  }