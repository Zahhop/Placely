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

  console.log("Loaded profile:", profile);
console.log("Loaded photo URL:", profile.profile_photo_url);

document.getElementById("profile_photo_preview").src = profile.profile_photo_url || "https://placehold.co/140x140";

if (profile.resume_url) {
  const fileName = profile.resume_url.split("/").pop();

  document.getElementById("resume_preview").style.display = "flex";
  document.getElementById("resume_file_name").textContent =
    decodeURIComponent(fileName);
}

console.log(
  "Image src after setting:",
  document.getElementById("profile_photo_preview").src
);

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

    
console.log("candidate-profile.js loaded");
console.log(document.getElementById("uploadPhotoBtn"));
console.log(document.getElementById("profile_photo_file"));

document.getElementById("uploadPhotoBtn").addEventListener("click", () => {
  document.getElementById("profile_photo_file").click();
});

document.getElementById("profile_photo_file").addEventListener("change", () => {
  const file = document.getElementById("profile_photo_file").files[0];

  if (file) {
    document.getElementById("profile_photo_preview").src =
      URL.createObjectURL(file);
  }
});

document.getElementById("resumeDrop").addEventListener("click", () => {
  document.getElementById("resume_file").click();
});

document.getElementById("resume_file").addEventListener("change", (e) => {
  const file = e.target.files[0];

  if (!file) return;

  document.getElementById("resume_preview").style.display = "flex";
  document.getElementById("resume_file_name").textContent = file.name;
});

let removeResume = false;

document.getElementById("remove_resume_btn").addEventListener("click", () => {
  removeResume = true;

  document.getElementById("resume_file").value = "";
  document.getElementById("resume_preview").style.display = "none";
  document.getElementById("resume_file_name").textContent = "";
});

const saveBtn = document.querySelector(".save-btn");

saveBtn.addEventListener("click", async (e) => {
  e.preventDefault();

  const { data: { user } } = await candidateSupabase.auth.getUser();


  let profilePhotoUrl = null;
let resumeUrl = null;

const photoFile = document.getElementById("profile_photo_file")?.files[0];
const resumeFile = document.getElementById("resume_file")?.files[0];

if (photoFile) {
  const photoPath = `${user.id}/${Date.now()}-${photoFile.name}`;

  const { error: photoError } = await candidateSupabase.storage
    .from("candidate_photos")
    .upload(photoPath, photoFile, {
      upsert: true
    });

  if (photoError) {
    console.error("Photo upload error:", photoError);
    alert("Error uploading profile photo: " + photoError.message);
    return;
  }

  const { data } = candidateSupabase.storage
    .from("candidate_photos")
    .getPublicUrl(photoPath);

  profilePhotoUrl = data.publicUrl;

  console.log("Generated photo URL:", profilePhotoUrl);
}

if (resumeFile) {
  const resumePath = `${user.id}/${Date.now()}-${resumeFile.name}`;

  const { error: resumeError } = await candidateSupabase.storage
    .from("candidate_resumes")
    .upload(resumePath, resumeFile, {
      upsert: true
    });

  if (resumeError) {
    console.error("Resume upload error:", resumeError);
    alert("Error uploading resume: " + resumeError.message);
    return;
  }

  const { data } = candidateSupabase.storage
    .from("candidate_resumes")
    .getPublicUrl(resumePath);

  resumeUrl = data.publicUrl;

}

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




    if (profilePhotoUrl) {
    updates.profile_photo_url = profilePhotoUrl;
    }

    if (resumeUrl) {
    updates.resume_url = resumeUrl;
    }

    if (removeResume) {
  updates.resume_url = null;
}


    console.log("Final updates object:", updates);


  const { error } = await candidateSupabase
  .from("candidate_profiles")
  .upsert({
    id: user.id,
    ...updates
  });


  if (error) {
    console.error("Save error:", error.message, error.details, error.hint, error);
    alert("Error saving profile: " + error.message);
    return;
  }

  alert("Candidate profile updated successfully!");
});