const placelySupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const form = document.getElementById("candidateLoginForm");
const errorMessage = document.getElementById("errorMessage");

function showError(message) {
  if (!errorMessage) {
    alert(message);
    return;
  }

  errorMessage.textContent = message;
  errorMessage.style.display = "block";
}

form.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (errorMessage) {
    errorMessage.textContent = "";
    errorMessage.style.display = "none";
  }

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { data, error } = await placelySupabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    showError(error.message);
    return;
  }

  const userId = data.user.id;

  const { data: profile, error: profileError } = await placelySupabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    showError("Profile not found.");
    return;
  }

  if (profile.role !== "candidate") {
    await placelySupabase.auth.signOut();
    showError("This login is for candidate accounts only.");
    return;
  }

  window.location.href = "candidate-dashboard.html";
});