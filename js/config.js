const SUPABASE_URL = "https://ornxlspufzmvapdrwexc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_09DuqSFb7R6isk9CTq_O8g_er5TUkYt";

window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

const IS_EMPLOYER_PAGE = window.location.pathname.includes("/employers/");

if (IS_EMPLOYER_PAGE && window.supabase && !window.employerSupabase) {
  window.employerSupabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );
}
