const employerMessagesSupabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const conversationsData = [
  {
    id: "jordan",
    name: "Jordan Taylor",
    initials: "JT",
    role: "Electrical Apprentice",
    location: "Calgary, AB",
    time: "10:42 AM",
    source: "Saved Talent",
    status: "Active",
    response: "Same day",
    nextStep: "Schedule a quick call",
    nextText: "Confirm availability, wage expectations, and preferred start date.",
    messages: [
      { type: "received", text: "Hi, I saw your company was hiring electrical apprentices. I’d be interested in learning more.", time: "10:20 AM" },
      { type: "sent", text: "Thanks for reaching out, Jordan. We have a commercial project starting next week in Calgary.", time: "10:29 AM" },
      { type: "received", text: "That sounds good. I’m available after 3 PM today if you want to chat.", time: "10:42 AM" }
    ]
  },
  {
    id: "maya",
    name: "Maya Robinson",
    initials: "MR",
    role: "Journeyman Welder",
    location: "Edmonton, AB",
    time: "Yesterday",
    source: "Candidate Network",
    status: "Follow-up",
    response: "1 day",
    nextStep: "Confirm rotation fit",
    nextText: "Ask about camp work, tickets, shutdown experience, and ideal start date.",
    messages: [
      { type: "sent", text: "Hi Maya, your welding background looks like a strong fit for our shutdown role.", time: "9:18 AM" },
      { type: "received", text: "Thanks for reaching out. I’m open to rotation work depending on the schedule and rate.", time: "Yesterday" }
    ]
  },
  {
    id: "chris",
    name: "Chris Smith",
    initials: "CS",
    role: "General Labourer",
    location: "Fort McMurray, AB",
    time: "Mon",
    source: "Applicant",
    status: "Needs review",
    response: "2 days",
    nextStep: "Review job fit",
    nextText: "Confirm site experience, transportation, safety tickets, and availability.",
    messages: [
      { type: "received", text: "I’d be open to rotation work depending on the project details.", time: "Mon" },
      { type: "sent", text: "Thanks Chris. I’ll review your profile and follow up with a few details.", time: "Mon" }
    ]
  }
];

const conversationList = document.getElementById("conversationList");
const conversationSearch = document.getElementById("conversationSearch");
const inboxCount = document.getElementById("inboxCount");

const chatAvatar = document.getElementById("chatAvatar");
const chatName = document.getElementById("chatName");
const chatSubtitle = document.getElementById("chatSubtitle");
const chatMessages = document.getElementById("chatMessages");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");

const detailName = document.getElementById("detailName");
const detailRole = document.getElementById("detailRole");
const detailStatus = document.getElementById("detailStatus");
const detailSource = document.getElementById("detailSource");
const detailResponse = document.getElementById("detailResponse");
const nextStepTitle = document.getElementById("nextStepTitle");
const nextStepText = document.getElementById("nextStepText");

const viewProfileBtn = document.getElementById("viewProfileBtn");
const logoutBtn = document.getElementById("logoutBtn");

let activeConversationId = conversationsData[0].id;

document.addEventListener("DOMContentLoaded", initMessages);

async function initMessages() {
  setupAuth();
  renderConversationList(conversationsData);
  openConversation(activeConversationId);
  setupEvents();
}

async function setupAuth() {
  const {
    data: { user }
  } = await employerMessagesSupabase.auth.getUser();

  if (!user) {
    window.location.href = "employer-login.html";
  }
}

function setupEvents() {
  conversationSearch.addEventListener("input", () => {
    const query = conversationSearch.value.toLowerCase().trim();

    const filtered = conversationsData.filter((conversation) => {
      return [
        conversation.name,
        conversation.role,
        conversation.location,
        conversation.source
      ].join(" ").toLowerCase().includes(query);
    });

    renderConversationList(filtered);
  });

  messageForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = messageInput.value.trim();
    if (!text) return;

    const conversation = conversationsData.find((item) => item.id === activeConversationId);

    conversation.messages.push({
      type: "sent",
      text,
      time: "Now"
    });

    conversation.time = "Now";

    messageInput.value = "";

    renderConversationList(conversationsData);
    openConversation(activeConversationId);
  });

  viewProfileBtn.addEventListener("click", () => {
    window.location.href = "find-candidates.html";
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await employerMessagesSupabase.auth.signOut();
      window.location.href = "employer-login.html";
    });
  }
}

function renderConversationList(list) {
  conversationList.innerHTML = "";
  inboxCount.textContent = conversationsData.length;

  list.forEach((conversation) => {
    const latest = conversation.messages[conversation.messages.length - 1];

    const row = document.createElement("div");
    row.className = `conversation ${conversation.id === activeConversationId ? "active" : ""}`;

    row.innerHTML = `
      <div class="avatar">${escapeHTML(conversation.initials)}</div>

      <div class="conversation-info">
        <div class="conversation-top">
          <h3>${escapeHTML(conversation.name)}</h3>
          <span>${escapeHTML(conversation.time)}</span>
        </div>

        <p>${escapeHTML(latest.text)}</p>
      </div>
    `;

    row.addEventListener("click", () => {
      activeConversationId = conversation.id;
      renderConversationList(conversationsData);
      openConversation(activeConversationId);
    });

    conversationList.appendChild(row);
  });
}

function openConversation(id) {
  const conversation = conversationsData.find((item) => item.id === id);
  if (!conversation) return;

  chatAvatar.textContent = conversation.initials;
  chatName.textContent = conversation.name;
  chatSubtitle.textContent = `${conversation.role} • ${conversation.location}`;

  detailName.textContent = conversation.name;
  detailRole.textContent = conversation.role;
  detailStatus.textContent = conversation.status;
  detailSource.textContent = conversation.source;
  detailResponse.textContent = conversation.response;
  nextStepTitle.textContent = conversation.nextStep;
  nextStepText.textContent = conversation.nextText;

  chatMessages.innerHTML = "";

  conversation.messages.forEach((message) => {
    const bubble = document.createElement("div");
    bubble.className = `message ${message.type}`;

    bubble.innerHTML = `
      ${escapeHTML(message.text)}
      <span>${escapeHTML(message.time)}</span>
    `;

    chatMessages.appendChild(bubble);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}