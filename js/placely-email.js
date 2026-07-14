(function () {
  const cooldowns = new Map();
  const defaultCooldownMs = 60_000;

  async function sendPlacelyEmail({
    supabaseClient,
    formType,
    payload,
    honeypot = "",
    cooldownKey = formType,
    cooldownMs = defaultCooldownMs
  }) {
    if (!supabaseClient) {
      throw new Error("Supabase client is not available.");
    }

    const now = Date.now();
    const lastSubmitted = cooldowns.get(cooldownKey) || 0;

    if (now - lastSubmitted < cooldownMs) {
      throw new Error("Please wait before submitting again.");
    }

    const body = {
      form_type: formType,
      payload,
      company_website: honeypot
    };

    const { data, error } = await supabaseClient.functions.invoke("send-placely-email", {
      body
    });

    if (error) {
      throw error;
    }

    cooldowns.set(cooldownKey, now);
    return data;
  }

  window.PlacelyEmail = {
    send: sendPlacelyEmail
  };
})();
