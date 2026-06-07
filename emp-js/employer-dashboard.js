    const placelySupabase = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );

    async function loadEmployerDashboard() {
      const { data: { user }, error: userError } = await placelySupabase.auth.getUser();

     // if (userError || !user) {
       // window.location.href = "employer-login.html";
       // return;
      //}

      const { data: profile, error: profileError } = await placelySupabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profileError || !profile || profile.role !== "employer") {
        await placelySupabase.auth.signOut();
        window.location.href = "employer-login.html";
        return;
      }

      const { data: employerProfile, error: employerError } = await placelySupabase
        .from("employer_profiles")
        .select("company_name, company_email, contact_name, phone, industry, hiring_needs")
        .eq("id", user.id)
        .single();

      

      if (employerError || !employerProfile) {
        document.getElementById("companyName").textContent = "Not completed";
        document.getElementById("contactName").textContent = "Not completed";
        document.getElementById("industry").textContent = "Not completed";
        document.getElementById("phone").textContent = "Not completed";
        document.getElementById("hiringNeeds").textContent = "No employer profile found yet.";
        return;
      }

      document.getElementById("userEmail").textContent = employerProfile.company_email || user.email || "Not available";

      document.getElementById("companyNameTitle").textContent = employerProfile.company_name || "Employer";
      document.getElementById("companyName").textContent = employerProfile.company_name || "Not completed";
      document.getElementById("contactName").textContent = employerProfile.contact_name || "Not completed";
      document.getElementById("industry").textContent = employerProfile.industry || "Not completed";
      document.getElementById("phone").textContent = employerProfile.phone || "Not completed";
      document.getElementById("hiringNeeds").textContent = employerProfile.hiring_needs || "No hiring needs added yet.";
    }

    document.getElementById("logoutBtn").addEventListener("click", async function () {
      await placelySupabase.auth.signOut();
      window.location.href = "../public/login.html";
    });

    loadEmployerDashboard();