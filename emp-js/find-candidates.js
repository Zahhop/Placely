const filterBtn = document.getElementById("filterBtn");
const filtersPanel = document.getElementById("filtersPanel");

filterBtn.addEventListener("click", () => {
  filtersPanel.classList.toggle("active");
});