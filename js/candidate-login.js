const placelySupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const form = document.getElementById("candidateLoginForm");

form.addEventListener("submit", async function (e) {
  e.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { data, error } = await placelySupabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    alert(error.message);
    return;
  }

  const userId = data.user.id;

  const { data: profile, error: profileError } = await placelySupabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (profileError) {
    console.error(profileError);
    alert("Login worked, but your profile role could not be checked.");
    return;
  }

  if (profile.role !== "candidate") {
    await placelySupabase.auth.signOut();
    alert("This login is for candidate accounts only.");
    return;
  }

  window.location.href = "candidate-dashboard.html";
});