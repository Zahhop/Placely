const placelySupabase = window.employerSupabase;

if (!placelySupabase) {
  console.error("Employer Supabase client was not initialized.");
}

const form = document.getElementById("employerSignupForm");

form.addEventListener("submit", async function (e) {
  e.preventDefault();

  const companyName = document.getElementById("companyName").value;
  const contactName = document.getElementById("contactName").value;
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const phone = document.getElementById("phone").value;
  const industry = document.getElementById("industry").value;

  const { data, error } = await placelySupabase.auth.signUp({
    email: email,
    password: password
  });

  if (error) {
    alert(error.message);
    return;
  }

  const userId = data.user.id;

  const { error: profileError } = await placelySupabase
    .from("profiles")
    .insert([
      {
        id: userId,
        email: email,
        role: "employer"
      }
    ]);

  if (profileError) {
    alert(profileError.message);
    return;
  }

  const { error: employerError } = await placelySupabase
    .from("employer_profiles")
    .insert([
      {
        id: userId,
        company_name: companyName,
        contact_name: contactName,
        phone: phone,
        industry: industry,
        hiring_needs: ""
      }
    ]);

  if (employerError) {
    alert(employerError.message);
    return;
  }

  alert("Employer account created successfully!");
  window.location.href = "employer-setup.html";
});