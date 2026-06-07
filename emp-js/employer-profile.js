const employerSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

async function loadEmployerProfile() {
  const { data: { user } } = await employerSupabase.auth.getUser();

  if (!user) {
    window.location.href = "employer-login.html";
    return;
  }

  const { data: profile, error } = await employerSupabase
    .from("employer_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error) {
    console.error("Error loading profile:", error);
    return;
  }

  document.getElementById("company_name").value = profile.company_name || "";
  document.getElementById("industry").value = profile.industry || "";
  document.getElementById("company_email").value = profile.company_email || user.email || "";
  document.getElementById("contact_name").value = profile.contact_name || "";
  document.getElementById("phone").value = profile.phone || "";
  document.getElementById("company_website").value = profile.company_website || "";
  document.getElementById("company_location").value = profile.company_location || "";
  document.getElementById("company_description").value = profile.company_description || "";
//   document.getElementById("contact_name").value = profile.contact_name || "";
//   document.getElementById("hiring_needs").value = profile.hiring_needs || ""; 
  document.getElementById("employment_type").value = profile.employment_type || "";
  document.getElementById("pay_range").value = profile.pay_range || "";
  document.getElementById("hiring_timeline").value = profile.hiring_timeline || "";
  document.getElementById("candidate_qualities").value = profile.candidate_qualities || "";
  document.getElementById("main_hiring_industry").value = profile.main_hiring_industry || "";
}

loadEmployerProfile();


const form = document.getElementById("employerProfileForm");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const { data: { user } } = await employerSupabase.auth.getUser();

  const updates = { 
    company_name: document.getElementById("company_name").value,
    industry: document.getElementById("industry").value,
    main_hiring_industry: document.getElementById("main_hiring_industry").value,
    company_email: document.getElementById("company_email").value,
    contact_name: document.getElementById("contact_name").value,
    phone: document.getElementById("phone").value,
    company_website: document.getElementById("company_website").value,
    company_location: document.getElementById("company_location").value,
    company_description: document.getElementById("company_description").value,
    employment_type:document.getElementById("employment_type").value,
    pay_range:document.getElementById("pay_range").value,
    hiring_timeline:document.getElementById("hiring_timeline").value,
    candidate_qualities:document.getElementById("candidate_qualities").value
    };

  const { error } = await employerSupabase
    .from("employer_profiles")
    .update(updates)
    .eq("id", user.id);

  if (error) {
  console.error("Save error:", error.message, error.details, error.hint, error);
  alert("Error saving profile: " + error.message);
  return;
}

  alert("Profile updated successfully!");
});