const params = new URLSearchParams(window.location.search);
const role = params.get("role") || "candidate";

const backDashboardBtn = document.getElementById("backDashboardBtn");
const employerOnlyItems = document.querySelectorAll(".employer-only");

if (role === "employer") {
  backDashboardBtn.href = "../employers/employer-dashboard.html";

  employerOnlyItems.forEach((item) => {
    item.style.display = "inline-block";
  });

  document.querySelector(".manage-btn").href = "../employers/manage-jobs.html";
  document.querySelector(".post-btn").href = "../employers/post-job.html";
} else {
  backDashboardBtn.href = "../candidates/candidate-dashboard.html";

  employerOnlyItems.forEach((item) => {
    item.style.display = "none";
  });
}