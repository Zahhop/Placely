const savedSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const savedGrid = document.getElementById("savedTalentGrid");

async function loadSavedCandidates() {
  const { data: { user } } = await savedSupabase.auth.getUser();

  if (!user) {
    window.location.href = "employer-login.html";
    return;
  }

  const { data: savedRows, error: savedError } = await savedSupabase
    .from("saved_candidates")
    .select("candidate_id")
    .eq("employer_id", user.id);

  if (savedError) {
    console.error("Error loading saved rows:", savedError);
    return;
  }

  const candidateIds = savedRows.map(row => row.candidate_id);

  if (candidateIds.length === 0) {
    savedGrid.innerHTML = "<p>No saved candidates yet.</p>";
    return;
  }

  const { data: candidates, error: candidatesError } = await savedSupabase
    .from("candidate_profiles")
    .select("*")
    .in("id", candidateIds);

  if (candidatesError) {
    console.error("Error loading candidates:", candidatesError);
    return;
  }

  savedGrid.innerHTML = "";

  candidates.forEach((candidate) => {
    savedGrid.innerHTML += `
      <div class="talent-card">
        <div class="talent-top">
          <img src="${candidate.profile_photo_url || "https://placehold.co/60x60"}" class="avatar">

          <div>
            <h3>${candidate.full_name || "Unnamed Candidate"}</h3>
            <p>${candidate.trade || "No trade added"}</p>
          </div>
        </div>

        <div class="talent-details">
          <span>${candidate.location || "Location not added"}</span>
          <span>${candidate.experience || "Experience not added"}</span>
          <span>${candidate.availability || "Availability not added"}</span>
        </div>

        <p class="talent-bio">${candidate.bio || "No bio added yet."}</p>

        <div class="card-actions">
          <button>View Profile</button>
          <button class="secondary">Message</button>
          <button class="remove">Remove</button>
        </div>
      </div>
    `;
  });
}

loadSavedCandidates();