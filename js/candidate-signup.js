const placelySupabase = window.supabase.createClient(
SUPABASE_URL,
SUPABASE_ANON_KEY
);

const form = document.getElementById("candidateSignupForm");
const errorMessage = document.getElementById("errorMessage");

form.addEventListener("submit", async (e) => {
e.preventDefault();

errorMessage.style.display = "none";
errorMessage.textContent = "";

const firstName = document.getElementById("firstName").value.trim();
const lastName = document.getElementById("lastName").value.trim();
const phone = document.getElementById("phone").value.trim();
const city = document.getElementById("city").value.trim();
const postalCode = document.getElementById("postalCode").value.trim();
const email = document.getElementById("email").value.trim();
const password = document.getElementById("password").value;

const { data, error } = await placelySupabase.auth.signUp({
email,
password,
options: {
data: {
account_type: "candidate"
}
}
});

if (error) {
errorMessage.textContent = error.message;
errorMessage.style.display = "block";
return;
}

const userId = data.user?.id;

if (!userId) {
errorMessage.textContent =
"Account created. Please check your email to confirm your account.";
errorMessage.style.display = "block";
return;
}

const { error: profileError } = await placelySupabase
.from("profiles")
.insert({
id: userId,
email: email,
role: "candidate"
});

if (profileError) {
console.error("profiles insert failed:", profileError);
errorMessage.textContent =
"Profile insert failed: " + profileError.message;
errorMessage.style.display = "block";
return;
}

const { error: candidateProfileError } = await placelySupabase
.from("candidate_profiles")
.insert({
id: userId,
full_name: `${firstName} ${lastName}`,
phone: phone,
location: `${city}, ${postalCode}`
});

if (candidateProfileError) {
console.error(
"candidate_profiles insert failed:",
candidateProfileError
);
errorMessage.textContent =
"Candidate profile insert failed: " +
candidateProfileError.message;
errorMessage.style.display = "block";
return;
}

localStorage.setItem(
"candidate_basic_info",
JSON.stringify({
firstName,
lastName,
phone,
city,
postalCode,
email
})
);

window.location.href = "candidate-setup.html";
});
