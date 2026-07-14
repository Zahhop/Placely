const SUPABASE_URL = "https://ornxlspufzmvapdrwexc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_09DuqSFb7R6isk9CTq_O8g_er5TUkYt";
const PLACELY_AUTH_STORAGE_KEY = "placely-auth-session";
const PLACELY_AUTH_PERSISTENCE_KEY = "placely-auth-persistence";

window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
window.PLACELY_AUTH_STORAGE_KEY = PLACELY_AUTH_STORAGE_KEY;
window.PLACELY_AUTH_PERSISTENCE_KEY = PLACELY_AUTH_PERSISTENCE_KEY;
// Hiring Requests is intentionally disabled for Placely V1; infrastructure is preserved for future reactivation.
window.PLACELY_FEATURES = {
  hiringRequests: false
};

function createPlacelyStorageAdapter(storage) {
  return {
    getItem(key) {
      return storage.getItem(key);
    },
    setItem(key, value) {
      storage.setItem(key, value);
    },
    removeItem(key) {
      storage.removeItem(key);
    }
  };
}

function getPlacelyAuthStorage() {
  const persistence = localStorage.getItem(PLACELY_AUTH_PERSISTENCE_KEY);
  return persistence === "session" ? sessionStorage : localStorage;
}

function createPlacelySupabaseClient() {
  if (!window.supabase) return null;

  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storageKey: PLACELY_AUTH_STORAGE_KEY,
      storage: createPlacelyStorageAdapter(getPlacelyAuthStorage()),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}

window.createPlacelySupabaseClient = createPlacelySupabaseClient;

if (window.supabase && !window.placelySupabase) {
  window.placelySupabase = createPlacelySupabaseClient();
}

if (window.placelySupabase && !window.employerSupabase) {
  window.employerSupabase = window.placelySupabase;
}
