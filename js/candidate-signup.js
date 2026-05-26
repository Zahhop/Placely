const supabase = window.supabase.createClient(
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

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          phone: phone,
          city: city,
          postal_code: postalCode,
          account_type: "candidate"
        }
      }
    });

    if (error) {
      errorMessage.textContent = error.message;
      errorMessage.style.display = "block";
      return;
    }

    localStorage.setItem("candidate_basic_info", JSON.stringify({
      firstName,
      lastName,
      phone,
      city,
      postalCode,
      email
    }));

    window.location.href = "candidate-setup.html";
  });