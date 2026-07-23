const assert = require("node:assert/strict");

global.window = {};
require("../js/auth-utils.js");

function renderContactCards(candidate) {
  const visible = window.PlacelyAuth.getVisibleCandidateContact(candidate);
  return [
    visible.showEmail ? `<div class="detail-item"><span>Email</span>${candidate.email}</div>` : "",
    visible.showPhone ? `<div class="detail-item"><span>Phone</span>${candidate.phone}</div>` : ""
  ].join("");
}

const emailOnly = renderContactCards({
  shown_contact_method: "Email only",
  email: "candidate@example.com",
  phone: "555-0100"
});
assert.match(emailOnly, /Email/);
assert.doesNotMatch(emailOnly, /Phone/);
assert.doesNotMatch(emailOnly, /555-0100/);

const phoneOnly = renderContactCards({
  shown_contact_method: "phone",
  email: "candidate@example.com",
  phone: "555-0100"
});
assert.doesNotMatch(phoneOnly, /Email/);
assert.doesNotMatch(phoneOnly, /candidate@example.com/);
assert.match(phoneOnly, /Phone/);

const both = renderContactCards({
  shown_contact_method: "email_phone",
  email: "candidate@example.com",
  phone: "555-0100"
});
assert.match(both, /Email/);
assert.match(both, /Phone/);

const missingPreference = renderContactCards({
  email: "candidate@example.com",
  phone: "555-0100"
});
assert.match(missingPreference, /Email/);
assert.doesNotMatch(missingPreference, /Phone/);

const phoneFallback = renderContactCards({
  phone: "555-0100"
});
assert.doesNotMatch(phoneFallback, /Email/);
assert.match(phoneFallback, /Phone/);

assert.equal(window.PlacelyAuth.isCandidateOnboardingComplete({
  trade: "Electrician",
  experience: "3 years",
  bio: "Commercial apprentice",
  availability: "Immediately",
  contact_method: "Email",
  shown_contact_method: "Email and phone",
  onboarding_completed: true
}), true);

assert.equal(window.PlacelyAuth.isCandidateOnboardingComplete({
  trade: "Electrician",
  experience: "3 years",
  bio: "Commercial apprentice",
  availability: "Immediately",
  contact_method: "Email",
  shown_contact_method: "Email and phone",
  onboarding_completed: false
}), false);

assert.equal(window.PlacelyAuth.isCandidateOnboardingComplete({
  trade: "Electrician",
  experience: "3 years",
  bio: "Commercial apprentice",
  availability: "Immediately",
  contact_method: "Email",
  shown_contact_method: ""
}), false);

assert.equal(window.PlacelyAuth.formatCompensation("hourly", 20, 40), "$20–$40/hour");
assert.equal(window.PlacelyAuth.formatCompensation("annual", 50000, 80000), "$50,000–$80,000/year");
assert.equal(window.PlacelyAuth.formatCompensation("", "", "", "$25 - $40/hr"), "$25 - $40/hr");
assert.deepEqual(window.PlacelyAuth.buildCompensationPayload("hourly", "25", "40"), {
  valid: true,
  message: "",
  payload: {
    compensation_type: "hourly",
    compensation_min: 25,
    compensation_max: 40,
    pay_range: "$25–$40/hour"
  }
});
assert.equal(window.PlacelyAuth.buildCompensationPayload("annual", "50000", "80000").payload.pay_range, "$50,000–$80,000/year");
assert.equal(window.PlacelyAuth.validateCompensationValues("hourly", "40", "25").valid, false);
assert.equal(window.PlacelyAuth.validateCompensationValues("hourly", "$25", "40").valid, false);
assert.equal(window.PlacelyAuth.validateImageFile({ name: "photo.jpg", type: "image/jpeg", size: 1024 }, "candidatePhoto").valid, true);
assert.equal(window.PlacelyAuth.validateImageFile({ name: "photo.svg", type: "image/svg+xml", size: 1024 }, "candidatePhoto").valid, false);
assert.equal(window.PlacelyAuth.validateImageFile({ name: "photo.jpg", type: "image/png", size: 1024 }, "candidatePhoto").valid, false);
assert.equal(window.PlacelyAuth.validateImageFile({ name: "logo.webp", type: "image/webp", size: 3 * 1024 * 1024 }, "employerLogo").message, "Company logos must be smaller than 2 MB.");
assert.equal(window.PlacelyAuth.getCandidateAccessState({ candidate_access: true, subscription_status: "active" }).state, "active");
assert.equal(window.PlacelyAuth.getCandidateAccessState({ candidate_access: true, subscription_status: "trialing" }).state, "active");
assert.equal(window.PlacelyAuth.getCandidateAccessState({ candidate_access: false, subscription_status: "pending" }).state, "pending");
assert.equal(window.PlacelyAuth.getCandidateAccessState({ candidate_access: false, subscription_status: "unpaid" }).state, "denied");
assert.equal(window.PlacelyAuth.getCandidateAccessState({}, new Error("network")).state, "error");

assert.deepEqual(window.PlacelyAuth.getEmployerHiringRoles({
  hiring_roles: ["Electrician", "Welder"],
  hiring_role_other: "Solar Installer"
}), ["Electrician", "Welder", "Solar Installer"]);

assert.equal(window.PlacelyAuth.normalizeHiringTimeline("Ongoing Hiring"), "always_hiring");
assert.equal(window.PlacelyAuth.getHiringTimelineLabel("within_3_months"), "Within 3 months");

assert.equal(window.PlacelyAuth.isEmployerOnboardingComplete({
  company_location: "Calgary, AB",
  company_description: "Commercial electrical contractor",
  main_hiring_industry: "Electrical",
  employment_type: "Full-time",
  hiring_roles: ["Electrician"],
  compensation_type: "hourly",
  compensation_min: 20,
  compensation_max: 40,
  hiring_timeline: "within_2_weeks",
  candidate_qualities: "Safety-conscious",
  onboarding_completed: true
}), true);

assert.equal(window.PlacelyAuth.isEmployerOnboardingComplete({
  company_location: "Calgary, AB",
  company_description: "Commercial electrical contractor",
  main_hiring_industry: "Electrical",
  employment_type: "Full-time",
  hiring_needs: "Electricians",
  pay_range: "$25 - $40/hr",
  hiring_timeline: "Immediately",
  candidate_qualities: "Safety-conscious",
  onboarding_completed: true
}), true);

console.log("Candidate contact visibility checks passed.");
