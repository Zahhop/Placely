const steps = document.querySelectorAll(".form-step");
const sidebarSteps = document.querySelectorAll(".step-item");
const backBtn = document.getElementById("backBtn");
const nextBtn = document.getElementById("nextBtn");

let currentStep = 0;

function showStep(index) {
  steps.forEach((step, i) => {
    step.classList.toggle("active", i === index);
  });

  sidebarSteps.forEach((step, i) => {
    step.classList.toggle("active", i === index);
  });

  backBtn.style.display = index === 0 ? "none" : "inline-block";

  nextBtn.textContent =
    index === steps.length - 1
      ? "Finish & Go To Dashboard"
      : "Next";
}

nextBtn.addEventListener("click", () => {
  if (currentStep < steps.length - 1) {
    currentStep++;
    showStep(currentStep);
  } else {
    window.location.href = "employer-dashboard.html";
  }
});

backBtn.addEventListener("click", () => {
  if (currentStep > 0) {
    currentStep--;
    showStep(currentStep);
  }
});

sidebarSteps.forEach((step, index) => {
  step.addEventListener("click", () => {
    currentStep = index;
    showStep(currentStep);
  });
});

showStep(currentStep);