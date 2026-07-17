const employerMessagesSupabase = window.employerSupabase;

if (!employerMessagesSupabase) {
  console.error("Employer Supabase client was not initialized.");
}

const messagesLayout = document.getElementById("messagesLayout");
const conversationList = document.getElementById("conversationList");
const conversationSearch = document.getElementById("conversationSearch");
const inboxCount = document.getElementById("inboxCount");
const chatAvatar = document.getElementById("chatAvatar");
const chatEyebrow = document.getElementById("chatEyebrow");
const chatName = document.getElementById("chatName");
const chatSubtitle = document.getElementById("chatSubtitle");
const chatMessages = document.getElementById("chatMessages");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const sendMessageBtn = document.getElementById("sendMessageBtn");
const composerStatus = document.getElementById("composerStatus");
const chatActions = document.getElementById("chatActions");
const viewProfileBtn = document.getElementById("viewProfileBtn");
const viewApplicationBtn = document.getElementById("viewApplicationBtn");
const detailsBtn = document.getElementById("detailsBtn");
const messageDetailsDrawer = document.getElementById("messageDetailsDrawer");
const messageDrawerOverlay = document.getElementById("messageDrawerOverlay");
const closeMessageDrawerBtn = document.getElementById("closeMessageDrawerBtn");
const drawerTitle = document.getElementById("drawerTitle");
const candidateContextContent = document.getElementById("candidateContextContent");
const logoutBtn = document.getElementById("logoutBtn");
const toast = document.getElementById("toast");

let conversationsData = [];
let activeConversationId = null;
let activeRealtimeChannel = null;
let currentUser = null;
let openRequestToken = 0;
let activeMessages = [];
let isSendingMessage = false;

document.addEventListener("DOMContentLoaded", initMessages);

async function initMessages() {
  const user = await verifyEmployerAccess(employerMessagesSupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });

  if (!user) return;

  currentUser = user;
  setupEvents();
  setComposerEnabled(false);
  renderLoadingState();

  const route = getMessageRoute();

  if (route.candidateId) {
    const resolved = await resolveCandidateRoute(route);
    if (!resolved) {
      await loadConversations();
      renderConversationList(getFilteredConversations());
      showNoConversationState();
      return;
    }
  }

  await loadConversations();

  if (!activeConversationId && route.conversationId && conversationsData.some((item) => String(item.id) === String(route.conversationId))) {
    activeConversationId = route.conversationId;
  }

  if (!activeConversationId && conversationsData.length) {
    activeConversationId = conversationsData[0].id;
  }

  renderConversationList(getFilteredConversations());

  if (activeConversationId) {
    await openConversation(activeConversationId, { focusComposer: Boolean(route.candidateId) });
  } else {
    showNoConversationState();
  }
}

function setupEvents() {
  conversationSearch?.addEventListener("input", () => {
    renderConversationList(getFilteredConversations());
  });

  messageInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    messageForm?.requestSubmit();
  });

  messageInput?.addEventListener("input", updateSendAvailability);
  messageForm?.addEventListener("submit", sendMessage);

  viewProfileBtn?.addEventListener("click", () => {
    const conversation = getActiveConversation();
    if (!conversation?.candidateId) return;
    window.location.href = `find-candidates.html?candidate=${encodeURIComponent(conversation.candidateId)}`;
  });

  viewApplicationBtn?.addEventListener("click", () => {
    const conversation = getActiveConversation();
    const jobId = conversation?.application?.job_id || conversation?.jobId;
    window.location.href = jobId
      ? `employer-applicants.html?job=${encodeURIComponent(jobId)}`
      : "employer-applicants.html";
  });

  detailsBtn?.addEventListener("click", openDetailsDrawer);
  messageDrawerOverlay?.addEventListener("click", closeDetailsDrawer);
  closeMessageDrawerBtn?.addEventListener("click", closeDetailsDrawer);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && messageDetailsDrawer?.classList.contains("open")) {
      closeDetailsDrawer();
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    await employerMessagesSupabase.auth.signOut();
    window.location.href = "employer-login.html";
  });

  window.addEventListener("beforeunload", () => {
    if (activeRealtimeChannel) {
      employerMessagesSupabase.removeChannel(activeRealtimeChannel);
    }
  });
}

function getMessageRoute() {
  const params = new URLSearchParams(window.location.search);
  return {
    candidateId: cleanParam(params.get("candidate_id")),
    conversationId: cleanParam(params.get("conversation_id") || params.get("conversation")),
    jobId: cleanParam(params.get("job_id")),
    applicationId: cleanParam(params.get("application_id"))
  };
}

async function resolveCandidateRoute(route) {
  if (!isRouteId(route.candidateId)) {
    showToast("Could not open this candidate conversation.", "error");
    return false;
  }

  const candidate = await fetchCandidateProfile(route.candidateId);
  if (!candidate) {
    showToast("Candidate profile could not be loaded.", "error");
    return false;
  }

  const application = await fetchEmployerApplication(route, candidate.id);
  const employerName = await fetchEmployerName();
  const existingConversation = await findConversationForCandidate(candidate.id);

  if (existingConversation) {
    activeConversationId = existingConversation.id;
    replaceRouteForConversation(existingConversation, route);
    return true;
  }

  const createdConversation = await createConversation({
    candidate,
    application,
    employerName,
    route
  });

  if (!createdConversation) return false;

  activeConversationId = createdConversation.id;
  replaceRouteForConversation(createdConversation, route);
  return true;
}

async function fetchCandidateProfile(candidateId) {
  const { data, error } = await employerMessagesSupabase
    .from("candidate_profiles")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();

  if (error) {
    console.error("Candidate load error:", error);
    return null;
  }

  return data;
}

async function fetchEmployerApplication(route, candidateId) {
  let query = employerMessagesSupabase
    .from("applications")
    .select("*")
    .eq("employer_id", currentUser.id)
    .eq("candidate_id", candidateId);

  if (route.applicationId) {
    query = query.eq("id", route.applicationId);
  } else if (route.jobId) {
    query = query.eq("job_id", route.jobId);
  } else {
    return null;
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Application context load error:", error);
    return null;
  }

  return data?.[0] || null;
}

async function fetchEmployerName() {
  const { data } = await employerMessagesSupabase
    .from("employer_profiles")
    .select("company_name")
    .eq("id", currentUser.id)
    .maybeSingle();

  return data?.company_name || "Employer";
}

async function findConversationForCandidate(candidateId) {
  const { data, error } = await employerMessagesSupabase
    .from("conversations")
    .select("*")
    .eq("employer_id", currentUser.id)
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Conversation lookup error:", error);
    showToast("Could not check for an existing conversation.", "error");
    return null;
  }

  return data?.[0] || null;
}

async function createConversation({ candidate, application, employerName, route }) {
  const candidateName = pickFirst(candidate.full_name, candidate.name, application?.candidate_name, "Candidate");
  const candidateRole = pickFirst(candidate.trade, candidate.role, application?.candidate_trade, "Trade not listed");
  const candidateLocation = pickFirst(candidate.location, application?.candidate_location, "Location not listed");

  const payload = {
    employer_id: currentUser.id,
    employer_name: employerName,
    candidate_id: candidate.id,
    candidate_name: candidateName,
    candidate_initials: getInitials(candidateName),
    candidate_role: candidateRole,
    candidate_location: candidateLocation,
    job_id: application?.job_id || route.jobId || null,
    job_title: application?.job_title || null,
    source: application ? "Application" : "Candidate Profile",
    status: "Active",
    response: "New"
  };

  const result = await insertWithSchemaFallback("conversations", payload);

  if (result.error) {
    console.error("Conversation create error:", result.error);
    showToast("Could not start this conversation.", "error");
    return null;
  }

  return result.data;
}

async function insertWithSchemaFallback(table, payload) {
  let candidatePayload = { ...payload };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await employerMessagesSupabase
      .from(table)
      .insert([candidatePayload])
      .select()
      .single();

    if (!error) return { data, error: null };

    const missingColumn = getMissingColumn(error);
    if (!missingColumn || !(missingColumn in candidatePayload)) {
      return { data: null, error };
    }

    delete candidatePayload[missingColumn];
  }

  return {
    data: null,
    error: new Error(`Could not insert ${table} after removing unsupported columns.`)
  };
}

function getMissingColumn(error) {
  const message = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
  const match = message.match(/'([^']+)' column|column '([^']+)'|Could not find the '([^']+)'/i);
  return match?.[1] || match?.[2] || match?.[3] || "";
}

async function loadConversations() {
  const { data, error } = await employerMessagesSupabase
    .from("conversations")
    .select("*")
    .eq("employer_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Load conversations error:", error);
    conversationsData = [];
    showToast("Could not load conversations.", "error");
    return;
  }

  const rows = data || [];
  const candidateIds = [...new Set(rows.map((conversation) => conversation.candidate_id).filter(Boolean))];
  const profilesById = await fetchCandidateProfiles(candidateIds);

  conversationsData = await Promise.all(rows.map(async (conversation) => {
    const profile = profilesById.get(String(conversation.candidate_id || "")) || {};
    const latest = await getLatestMessage(conversation.id);
    const unreadCount = await getUnreadCount(conversation.id);
    const application = await getConversationApplication(conversation);

    const name = pickFirst(profile.full_name, profile.name, conversation.candidate_name, application?.candidate_name, "Candidate");
    const role = pickFirst(profile.trade, profile.role, conversation.candidate_role, application?.candidate_trade, "Trade not listed");
    const location = pickFirst(profile.location, conversation.candidate_location, "Location not listed");

    return {
      id: conversation.id,
      candidateId: conversation.candidate_id,
      jobId: conversation.job_id || application?.job_id || "",
      name,
      initials: conversation.candidate_initials || getInitials(name),
      role,
      location,
      photoUrl: profile.profile_photo_url || conversation.candidate_photo_url || "",
      source: conversation.source || (application ? "Application" : "Candidate Profile"),
      status: conversation.status || application?.status || "Active",
      response: conversation.response || "New",
      createdAt: conversation.created_at,
      latestMessage: latest?.message || "",
      latestAt: latest?.created_at || conversation.updated_at || conversation.created_at,
      unreadCount,
      profile,
      application
    };
  }));

  conversationsData.sort(sortByLatestActivity);
}

async function fetchCandidateProfiles(candidateIds) {
  if (!candidateIds.length) return new Map();

  const { data, error } = await employerMessagesSupabase
    .from("candidate_profiles")
    .select("*")
    .in("id", candidateIds);

  if (error) {
    console.error("Candidate profiles batch load error:", error);
    return new Map();
  }

  return new Map((data || []).map((profile) => [String(profile.id), profile]));
}

async function getConversationApplication(conversation) {
  if (!conversation?.candidate_id) return null;

  let query = employerMessagesSupabase
    .from("applications")
    .select("*")
    .eq("employer_id", currentUser.id)
    .eq("candidate_id", conversation.candidate_id);

  if (conversation.job_id) {
    query = query.eq("job_id", conversation.job_id);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return null;
  return data?.[0] || null;
}

async function getLatestMessage(conversationId) {
  const { data, error } = await employerMessagesSupabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Latest message error:", error);
    return null;
  }

  return data?.[0] || null;
}

async function getUnreadCount(conversationId) {
  const { count, error } = await employerMessagesSupabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("employer_id", currentUser.id)
    .neq("sender_type", "employer")
    .eq("read_by_employer", false);

  if (error) {
    console.error("Unread count error:", error);
    return 0;
  }

  return count || 0;
}

function renderConversationList(list) {
  if (!conversationList) return;

  const unreadTotal = conversationsData.reduce((total, conversation) => total + (conversation.unreadCount || 0), 0);
  inboxCount.textContent = unreadTotal ? `${unreadTotal} unread` : String(conversationsData.length);
  conversationList.innerHTML = "";

  if (!list.length) {
    conversationList.innerHTML = `
      <div class="empty-list-state">
        <strong>${conversationsData.length ? "No matches" : "No conversations yet"}</strong>
        <p>${conversationsData.length ? "Try a different name, role, location, or message." : "Message a candidate from Applicants, Candidates, or Saved Talent."}</p>
      </div>
    `;
    return;
  }

  list.forEach((conversation) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `conversation-row${conversation.id === activeConversationId ? " active" : ""}${conversation.unreadCount ? " unread" : ""}`;
    row.innerHTML = `
      <span class="avatar">
        ${renderAvatar(conversation)}
      </span>
      <span class="conversation-copy">
        <span class="conversation-top">
          <strong>${escapeHTML(conversation.name)}</strong>
          <span>${escapeHTML(formatConversationTime(conversation.latestAt))}</span>
        </span>
        <span class="conversation-meta">${escapeHTML(conversation.role)}${conversation.location ? ` - ${escapeHTML(conversation.location)}` : ""}</span>
        <span class="conversation-preview">${escapeHTML(conversation.latestMessage || "No messages yet.")}</span>
      </span>
      ${conversation.unreadCount ? `<span class="unread-dot">${conversation.unreadCount}</span>` : ""}
    `;

    row.addEventListener("click", async () => {
      await openConversation(conversation.id, { focusComposer: false, updateUrl: true });
    });

    conversationList.appendChild(row);
  });
}

async function openConversation(id, options = {}) {
  const token = openRequestToken + 1;
  openRequestToken = token;
  const conversation = conversationsData.find((item) => String(item.id) === String(id));

  if (!conversation) {
    showNoConversationState();
    return;
  }

  activeConversationId = conversation.id;
  setConversationMode();
  renderConversationChrome(conversation);
  renderContext(conversation);
  renderThreadLoading();
  renderConversationList(getFilteredConversations());

  const messages = await loadMessages(conversation.id);
  if (token !== openRequestToken) return;

  activeMessages = messages;
  renderMessages(messages, conversation);
  await markConversationRead(conversation);
  conversation.unreadCount = 0;
  renderConversationList(getFilteredConversations());
  subscribeToMessages(conversation.id);

  if (options.updateUrl) {
    replaceRouteForConversation(conversation, {
      candidateId: conversation.candidateId,
      applicationId: conversation.application?.id,
      jobId: conversation.application?.job_id || conversation.jobId
    });
  }

  if (options.focusComposer) {
    setTimeout(() => messageInput?.focus(), 0);
  }
}

function renderConversationChrome(conversation) {
  chatAvatar.innerHTML = renderAvatar(conversation);
  chatEyebrow.textContent = conversation.application ? "Applicant conversation" : "Candidate conversation";
  chatName.textContent = conversation.name;
  chatSubtitle.textContent = [conversation.role, conversation.location].filter(Boolean).join(" - ");
}

function renderContext(conversation) {
  const profile = conversation.profile || {};
  const application = conversation.application || {};
  const overviewRows = [
    ["Source", conversation.source],
    ["Experience", pickFirst(profile.experience_level, profile.years_experience, profile.experience, "")],
    ["Availability", pickFirst(profile.availability, application.availability, "")],
    ["Email", pickFirst(profile.email, application.candidate_email, "")],
    ["Phone", pickFirst(profile.phone, profile.phone_number, application.candidate_phone, "")]
  ].filter(([, value]) => value);

  const skills = normalizeList(pickFirst(profile.skills, profile.skill_tags, ""));
  const certifications = normalizeList(pickFirst(profile.certifications, profile.tickets, ""));
  const applicationRows = [
    ["Applied role", pickFirst(application.job_title, conversation.jobTitle, "")],
    ["Application status", application.status],
    ["Applied", formatFullDate(application.created_at || application.submitted_at)],
    ["Application ID", application.id]
  ].filter(([, value]) => value);

  if (drawerTitle) drawerTitle.textContent = conversation.name;
  candidateContextContent.innerHTML = `
    <div class="detail-head">
      <div class="avatar large">
        ${renderAvatar(conversation)}
      </div>
      <div>
        <h2>${escapeHTML(conversation.name)}</h2>
        <p class="detail-trade">${escapeHTML([conversation.role, conversation.location].filter(Boolean).join(" - "))}</p>
      </div>
    </div>

    <div class="detail-section">
      <h3>Overview</h3>
      <div class="detail-grid">
        ${overviewRows.map(([label, value]) => renderContextRow(label, value)).join("")}
      </div>
    </div>

    ${applicationRows.length ? `
      <div class="detail-section">
        <h3>Application</h3>
        <div class="timeline-grid">
          ${applicationRows.map(([label, value]) => renderContextRow(label, value)).join("")}
        </div>
      </div>
    ` : ""}

    ${(skills.length || certifications.length || profile.resume_path || profile.resume_url) ? `
      <div class="detail-section">
        <h3>Profile</h3>
        <div class="detail-grid">
          ${skills.length ? renderContextRow("Skills", skills.join(", ")) : ""}
          ${certifications.length ? renderContextRow("Certifications", certifications.join(", ")) : ""}
          ${(profile.resume_path || profile.resume_url) ? renderContextRow("Resume", "Available") : ""}
        </div>
      </div>
    ` : ""}

    <div class="detail-section">
      <h3>Conversation</h3>
      <p class="detail-message">${escapeHTML(conversation.latestMessage || "No messages have been sent yet.")}</p>
    </div>

    <div class="detail-section">
      <h3>Actions</h3>
      <div class="drawer-actions">
        <button type="button" class="drawer-action primary" data-drawer-action="profile">View Full Profile</button>
        ${applicationRows.length ? `<button type="button" class="drawer-action" data-drawer-action="application">View Application</button>` : ""}
      </div>
    </div>
  `;

  candidateContextContent.querySelector("[data-drawer-action='profile']")?.addEventListener("click", () => {
    if (!conversation.candidateId) return;
    window.location.href = `find-candidates.html?candidate=${encodeURIComponent(conversation.candidateId)}`;
  });

  candidateContextContent.querySelector("[data-drawer-action='application']")?.addEventListener("click", () => {
    const jobId = conversation.application?.job_id || conversation.jobId;
    window.location.href = jobId
      ? `employer-applicants.html?job=${encodeURIComponent(jobId)}`
      : "employer-applicants.html";
  });

  const hasApplicationLink = Boolean(conversation.application?.id || conversation.jobId);
  viewApplicationBtn.disabled = !hasApplicationLink;
  viewApplicationBtn.hidden = !hasApplicationLink;
  viewProfileBtn.disabled = !conversation.candidateId;
  detailsBtn.disabled = false;
}

function renderContextRow(label, value) {
  return `
    <div class="detail-row">
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(value)}</strong>
    </div>
  `;
}

async function loadMessages(conversationId) {
  const { data, error } = await employerMessagesSupabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Load messages error:", error);
    chatMessages.innerHTML = `
      <div class="empty-message">
        <h3>Could not load messages</h3>
        <p>Refresh the page and try again.</p>
      </div>
    `;
    return [];
  }

  return (data || []).reverse();
}

function renderMessages(messages, conversation) {
  chatMessages.innerHTML = "";

  if (!messages.length) {
    chatMessages.innerHTML = `
      <div class="empty-message">
        <h3>No messages yet</h3>
        <p>Send the first message to ${escapeHTML(conversation.name)}.</p>
      </div>
    `;
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return;
  }

  let previousDate = "";
  messages.forEach((message) => {
    const dateLabel = formatDateSeparator(message.created_at);
    if (dateLabel !== previousDate) {
      previousDate = dateLabel;
      const separator = document.createElement("div");
      separator.className = "date-separator";
      separator.textContent = dateLabel;
      chatMessages.appendChild(separator);
    }

    appendMessageBubble(message);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendMessageBubble(message) {
  const bubble = document.createElement("div");
  const isSent = message.sender_type === "employer";
  bubble.className = `message ${isSent ? "sent" : "received"}${message.pending ? " pending" : ""}`;
  bubble.dataset.messageId = message.id || "";
  bubble.innerHTML = `
    <div class="bubble-text">${escapeHTML(message.message)}</div>
    <span>${escapeHTML(formatMessageTime(message.created_at))}</span>
  `;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function markConversationRead(conversation) {
  const { error } = await employerMessagesSupabase
    .from("messages")
    .update({ read_by_employer: true })
    .eq("conversation_id", conversation.id)
    .eq("employer_id", currentUser.id)
    .neq("sender_type", "employer");

  if (error) {
    console.error("Mark read error:", error);
  }
}

async function sendMessage(event) {
  event.preventDefault();

  const conversation = getActiveConversation();
  const text = messageInput.value.trim();
  if (!conversation || !text || isSendingMessage) return;

  setSendingState(true);
  const tempMessage = {
    id: `temp-${Date.now()}`,
    conversation_id: conversation.id,
    sender_type: "employer",
    message: text,
    created_at: new Date().toISOString(),
    pending: true
  };

  if (!activeMessages.length) chatMessages.innerHTML = "";
  activeMessages.push(tempMessage);
  appendMessageBubble(tempMessage);

  const payload = {
    conversation_id: conversation.id,
    sender_type: "employer",
    message: text,
    employer_id: currentUser.id,
    candidate_id: conversation.candidateId,
    candidate_name: conversation.name,
    candidate_role: conversation.role,
    read_by_employer: true,
    read_by_candidate: false
  };

  const result = await insertWithSchemaFallback("messages", payload);
  setSendingState(false);

  if (result.error) {
    console.error("Message send error:", result.error);
    activeMessages = activeMessages.filter((message) => message.id !== tempMessage.id);
    await openConversation(conversation.id);
    showToast("Message could not be sent.", "error");
    messageInput.focus();
    return;
  }

  messageInput.value = "";
  updateSendAvailability();
  activeMessages = activeMessages.map((message) => message.id === tempMessage.id ? result.data : message);
  conversation.latestMessage = result.data?.message || text;
  conversation.latestAt = result.data?.created_at || tempMessage.created_at;
  conversationsData.sort(sortByLatestActivity);
  renderConversationList(getFilteredConversations());

  const pendingBubble = chatMessages.querySelector(`[data-message-id="${tempMessage.id}"]`);
  if (pendingBubble) {
    pendingBubble.dataset.messageId = result.data?.id || "";
    pendingBubble.classList.remove("pending");
  }
}

function subscribeToMessages(conversationId) {
  if (activeRealtimeChannel) {
    employerMessagesSupabase.removeChannel(activeRealtimeChannel);
  }

  activeRealtimeChannel = employerMessagesSupabase
    .channel(`employer-messages-${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`
      },
      async (payload) => {
        const message = payload.new;
        if (!message || activeMessages.some((item) => String(item.id) === String(message.id))) return;

        const pendingMatch = activeMessages.find((item) => (
          item.pending &&
          item.sender_type === message.sender_type &&
          item.message === message.message
        ));

        if (pendingMatch) {
          const pendingId = pendingMatch.id;
          Object.assign(pendingMatch, message, { pending: false });
          const pendingBubble = chatMessages.querySelector(`[data-message-id="${pendingId}"]`);
          if (pendingBubble) {
            pendingBubble.dataset.messageId = message.id || "";
            pendingBubble.classList.remove("pending");
          }
          return;
        }

        activeMessages.push(message);
        if (chatMessages.querySelector(".empty-message")) chatMessages.innerHTML = "";
        appendMessageBubble(message);

        const conversation = getActiveConversation();
        if (conversation) {
          conversation.latestMessage = message.message || conversation.latestMessage;
          conversation.latestAt = message.created_at || conversation.latestAt;
          await markConversationRead(conversation);
          renderConversationList(getFilteredConversations());
        }
      }
    )
    .subscribe();
}

function showNoConversationState() {
  activeConversationId = null;
  setComposerEnabled(false);
  closeDetailsDrawer();

  if (activeRealtimeChannel) {
    employerMessagesSupabase.removeChannel(activeRealtimeChannel);
    activeRealtimeChannel = null;
  }

  chatAvatar.innerHTML = "";
  chatEyebrow.textContent = "Select a conversation";
  chatName.textContent = "No conversation selected";
  chatSubtitle.textContent = "Choose a candidate from your inbox or start from Applicants, Candidates, or Saved Talent.";
  viewApplicationBtn.disabled = true;
  viewApplicationBtn.hidden = true;
  viewProfileBtn.disabled = true;
  detailsBtn.disabled = true;
  if (drawerTitle) drawerTitle.textContent = "Candidate profile";
  candidateContextContent.innerHTML = `
    <div class="empty-state compact-empty">
      <div class="empty-icon">PT</div>
      <h3>Select a conversation</h3>
      <p>Candidate profile and application details will appear here.</p>
    </div>
  `;
  chatMessages.innerHTML = `
    <div class="empty-message">
      <h3>No conversations yet</h3>
      <p>Message a candidate from Applicants, Candidates, or Saved Talent to start your employer inbox.</p>
      <div class="empty-actions">
        <a href="find-candidates.html" class="primary-link">Find Candidates</a>
        <a href="employer-applicants.html" class="secondary-link">Applicants</a>
      </div>
    </div>
  `;
}

function setConversationMode() {
  messagesLayout.classList.remove("empty");
  chatActions.classList.remove("disabled-area");
  setComposerEnabled(true);
}

function setComposerEnabled(enabled) {
  if (messageInput) messageInput.disabled = !enabled;
  updateSendAvailability();
  if (composerStatus) {
    composerStatus.textContent = "";
  }
}

function setSendingState(isSending) {
  isSendingMessage = isSending;
  if (messageInput) messageInput.disabled = isSending;
  if (sendMessageBtn) {
    sendMessageBtn.disabled = isSending || !messageInput?.value.trim();
    sendMessageBtn.textContent = isSending ? "Sending" : "Send";
  }
  if (composerStatus) {
    composerStatus.textContent = isSending ? "Sending message..." : "";
  }
}

function updateSendAvailability() {
  if (!sendMessageBtn) return;

  const canSend = Boolean(activeConversationId && messageInput?.value.trim() && !isSendingMessage && !messageInput.disabled);
  sendMessageBtn.disabled = !canSend;
}

function openDetailsDrawer() {
  const conversation = getActiveConversation();
  if (!conversation || !messageDetailsDrawer) return;

  renderContext(conversation);
  messageDetailsDrawer.classList.add("open");
  messageDetailsDrawer.setAttribute("aria-hidden", "false");
  closeMessageDrawerBtn?.focus();
}

function closeDetailsDrawer() {
  if (!messageDetailsDrawer) return;

  messageDetailsDrawer.classList.remove("open");
  messageDetailsDrawer.setAttribute("aria-hidden", "true");
}

function renderLoadingState() {
  conversationList.innerHTML = `
    <div class="empty-list-state">
      <strong>Loading conversations</strong>
      <p>Checking your candidate inbox.</p>
    </div>
  `;
  renderThreadLoading();
}

function renderThreadLoading() {
  chatMessages.innerHTML = `
    <div class="empty-message">
      <h3>Loading thread</h3>
      <p>Getting the latest candidate messages.</p>
    </div>
  `;
}

function renderAvatar(conversation) {
  if (conversation.photoUrl) {
    return `<img src="${escapeAttribute(conversation.photoUrl)}" alt="">`;
  }

  return escapeHTML(conversation.initials || getInitials(conversation.name));
}

function replaceRouteForConversation(conversation, route) {
  const params = new URLSearchParams();
  params.set("candidate_id", conversation.candidate_id || conversation.candidateId || route.candidateId);
  params.set("conversation_id", conversation.id);

  const applicationId = route.applicationId || conversation.application?.id;
  const jobId = route.jobId || conversation.application?.job_id || conversation.job_id || conversation.jobId;

  if (applicationId) params.set("application_id", applicationId);
  if (jobId) params.set("job_id", jobId);

  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}

function getActiveConversation() {
  return conversationsData.find((item) => String(item.id) === String(activeConversationId));
}

function sortByLatestActivity(a, b) {
  return new Date(b.latestAt || b.createdAt || 0) - new Date(a.latestAt || a.createdAt || 0);
}

function cleanParam(value) {
  const trimmed = String(value || "").trim();
  return trimmed || "";
}

function isRouteId(value) {
  return /^[a-zA-Z0-9_-]{8,}$/.test(String(value || ""));
}

function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatConversationTime(value) {
  if (!value) return "";

  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatMessageTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateSeparator(value) {
  if (!value) return "";

  const date = new Date(value);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === now.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric"
  });
}

function formatFullDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function showToast(message, type = "info") {
  if (!toast) return;

  toast.textContent = message;
  toast.className = `toast show ${type}`;

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.className = "toast";
  }, 3200);
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHTML(value).replaceAll("`", "&#096;");
}

function getInitials(name) {
  const initials = String(name || "PT")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "PT";
}
