const candidateSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

async function loadCandidateProfile() {
  const { data: { user } } = await candidateSupabase.auth.getUser();

  if (!user) {
    window.location.href = "candidate-login.html";
    return;
  }

  const { data: profile, error } = await candidateSupabase
    .from("candidate_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error) {
    console.error("Error loading candidate profile:", error);
    return;
  }

  document.getElementById("full_name").value = profile.full_name || "";
  document.getElementById("trade").value = profile.trade || "";
  document.getElementById("location").value = profile.location || "";
  document.getElementById("bio").value = profile.bio || "";
  document.getElementById("experience").value = profile.experience || "";
  document.getElementById("skills").value = profile.skills || "";
  document.getElementById("certifications").value = profile.certifications || "";
  document.getElementById("availability").value = profile.availability || "";
  document.getElementById("email").value = profile.email || user.email || "";
  document.getElementById("phone").value = profile.phone || "";
  document.getElementById("contact_method").value = profile.contact_method || "";
  document.getElementById("profile_visible").checked = profile.profile_visible ?? true;
}

loadCandidateProfile();

const saveBtn = document.querySelector(".save-btn");

saveBtn.addEventListener("click", async (e) => {
  e.preventDefault();

  const { data: { user } } = await candidateSupabase.auth.getUser();

  const updates = {
    full_name: document.getElementById("full_name").value,
    trade: document.getElementById("trade").value,
    location: document.getElementById("location").value,
    bio: document.getElementById("bio").value,
    experience: document.getElementById("experience").value,
    skills: document.getElementById("skills").value,
    certifications: document.getElementById("certifications").value,
    availability: document.getElementById("availability").value,
    email: document.getElementById("email").value,
    phone: document.getElementById("phone").value,
    contact_method: document.getElementById("contact_method").value,
    profile_visible: document.getElementById("profile_visible").checked
  };

  const { error } = await candidateSupabase
    .from("candidate_profiles")
    .update(updates)
    .eq("id", user.id);

  if (error) {
    console.error("Save error:", error.message, error.details, error.hint, error);
    alert("Error saving profile: " + error.message);
    return;
  }

  alert("Candidate profile updated successfully!");
});