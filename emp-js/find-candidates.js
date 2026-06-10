const filterBtn = document.getElementById("filterBtn");
const filtersPanel = document.getElementById("filtersPanel");

filterBtn.addEventListener("click", () => {
  filtersPanel.classList.toggle("active");
});





const employerSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const candidatesGrid = document.getElementById("candidatesGrid");


let loadedCandidates = [];

async function loadCandidates() {
  const { data: candidates, error } = await employerSupabase
    .from("candidate_profiles")
    .select("*")
    .eq("profile_visible", true);

  if (error) {
    console.error("Error loading candidates:", error);
    return;
  }

  loadedCandidates = candidates;

  candidatesGrid.innerHTML = "";

  candidates.forEach((candidate) => {
    const skills = candidate.skills
      ? candidate.skills.split(",").map(skill => `<span>${skill.trim()}</span>`).join("")
      : "";

    const card = `
  <div class="candidate-card" data-id="${candidate.id}">
    <div class="candidate-top">
      <img
        src="${candidate.profile_photo_url || "https://placehold.co/60x60"}"
        class="avatar"
        alt="Candidate photo"
      />

      <div>
        <h3>${candidate.full_name || "Unnamed Candidate"}</h3>
        <p>${candidate.trade || "No trade added"}</p>
      </div>
    </div>

    <div class="candidate-info">
      <span>${candidate.location || "Location not added"}</span>
      <span>${candidate.experience || "Experience not added"}</span>
      <span>${candidate.availability || "Availability not added"}</span>
    </div>

    <p class="candidate-bio">
      ${candidate.bio || "No bio added yet."}
    </p>

    <div class="tag-row">
      ${(candidate.certifications || "")
        .split(",")
        .filter(Boolean)
        .map(item => `<span>${item.trim()}</span>`)
        .join("")}
    </div>

    <div class="card-actions">
  <button>View Profile</button>

  <button 
    class="secondary save-candidate-btn"
    data-id="${candidate.id}"
  >
    Save
  </button>
</div>
  </div>
`;

    candidatesGrid.innerHTML += card;
  });
}




loadCandidates();





// open candidate panel //


function openCandidatePanel(candidate) {
  document.getElementById("findPage").classList.add("panel-open");
  document.getElementById("candidateDetailPanel").classList.add("open");
  
 document.getElementById("candidateDetailContent").innerHTML = `
  <img src="${candidate.profile_photo_url || "https://placehold.co/120x120"}" class="detail-photo">

  <h2>${candidate.full_name || "Unnamed Candidate"}</h2>
  <h3>${candidate.trade || "No trade added"}</h3>

  <p class="candidate-bio">${candidate.bio || "No bio added yet."}</p>

  <div class="detail-info-grid">
    <div class="detail-item">
      <span>Location</span>
      <strong>${candidate.location || "Not added"}</strong>
    </div>

    <div class="detail-item">
      <span>Experience</span>
      <strong>${candidate.experience || "Not added"}</strong>
    </div>

    <div class="detail-item">
      <span>Availability</span>
      <strong>${candidate.availability || "Not added"}</strong>
    </div>

    <div class="detail-item">
      <span>Preferred Contact</span>
      <strong>${candidate.contact_method || "Not added"}</strong>
    </div>

    <div class="detail-item">
      <span>Email</span>
      <strong>${candidate.email || "Not added"}</strong>
    </div>

    <div class="detail-item">
      <span>Phone</span>
      <strong>${candidate.phone || "Not added"}</strong>
    </div>
  </div>
`;
}

document.getElementById("closePanelBtn").addEventListener("click", () => {
  document.getElementById("findPage").classList.remove("panel-open");
  document.getElementById("candidateDetailPanel").classList.remove("open");
});



async function saveCandidate(candidateId) {
  const { data: { user } } = await employerSupabase.auth.getUser();

  if (!user) {
    alert("Please log in first.");
    return;
  }

  const { error } = await employerSupabase
    .from("saved_candidates")
    .upsert({
      employer_id: user.id,
      candidate_id: candidateId
    });

  if (error) {
    console.error("Save candidate error:", error);
    alert("Error saving candidate: " + error.message);
    return;
  }

  alert("Candidate saved!");
}


candidatesGrid.addEventListener("click", (e) => {
  const saveBtn = e.target.closest(".save-candidate-btn");

  if (saveBtn) {
    e.stopPropagation();
    saveCandidate(saveBtn.dataset.id);
    return;
  }

  const card = e.target.closest(".candidate-card");
  if (!card) return;

  const candidateId = card.dataset.id;
  const candidate = loadedCandidates.find(c => c.id === candidateId);

  openCandidatePanel(candidate);
});