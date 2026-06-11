const conversations = document.querySelectorAll(".conversation");
const companyTitle = document.getElementById("chatCompany");
const roleTitle = document.getElementById("chatRole");

conversations.forEach(conversation => {
  conversation.addEventListener("click", () => {

    conversations.forEach(c =>
      c.classList.remove("active")
    );

    conversation.classList.add("active");

    companyTitle.textContent =
      conversation.dataset.company;

    roleTitle.textContent =
      conversation.dataset.role + " opportunity";
  });
});

const form = document.getElementById("messageForm");
const input = document.getElementById("messageInput");
const messages = document.getElementById("chatMessages");

form.addEventListener("submit", e => {
  e.preventDefault();

  const text = input.value.trim();

  if (!text) return;

  const row = document.createElement("div");
  row.className = "message-row sent";

  row.innerHTML = `
    <div class="message-bubble">
      ${text}
    </div>
  `;

  messages.appendChild(row);

  input.value = "";

  messages.scrollTop = messages.scrollHeight;
});