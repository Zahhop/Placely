(function () {
  const fallbackProfile = {
    full_name: "Candidate Name",
    trade: "Trade / Job Title",
    location: "Location"
  };

  function getInitials(name) {
    return String(name || "PT")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "PT";
  }

  function getProfilePhoto(profile) {
    const value = profile?.profile_photo_url || profile?.avatar_url || "";
    return window.PlacelyAuth?.getPublicImageUrl?.(
      window.PlacelyAuth.client(),
      "candidate_photos",
      value
    ) || value;
  }

  function getCandidateTags(profile, limit = 5) {
    const tags = [];

    if (profile?.certifications) {
      tags.push(...String(profile.certifications).split(","));
    }

    if (profile?.skills) {
      tags.push(...String(profile.skills).split(","));
    }

    return tags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, limit);
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

  function renderAvatar(profile, className = "candidate-preview-photo") {
    const name = profile?.full_name || fallbackProfile.full_name;
    const photoUrl = getProfilePhoto(profile);

    if (photoUrl) {
      return `<img src="${escapeAttribute(photoUrl)}" class="${escapeAttribute(className)}" alt="${escapeAttribute(name)} profile photo" />`;
    }

    return `<div class="${escapeAttribute(className)} initials" aria-hidden="true">${escapeHTML(getInitials(name))}</div>`;
  }

  function getResumeStatus(profile) {
    return profile?.resume_path || profile?.resume_url ? "Resume uploaded" : "No resume uploaded";
  }

  function renderDetailItem(label, value) {
    return `
      <div class="detail-item">
        <span>${escapeHTML(label)}</span>
        <strong>${escapeHTML(value)}</strong>
      </div>
    `;
  }

  function renderContactItems(profile) {
    const contact = window.PlacelyAuth?.getVisibleCandidateContact(profile) || { showEmail: false, showPhone: false };

    return [
      contact.showEmail ? renderDetailItem("Email", profile.email || "Locked / not added") : "",
      contact.showPhone ? renderDetailItem("Phone", profile.phone || "Locked / not added") : ""
    ].join("");
  }

  function buildDetailHTML(profileInput) {
    const profile = { ...fallbackProfile, ...(profileInput || {}) };
    const tags = getCandidateTags(profile, 10);
    const tagHTML = tags.length
      ? tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join("")
      : "<span>No skills added</span>";

    return `
      <div class="candidate-preview-modal-header">
        ${renderAvatar(profile, "candidate-preview-detail-photo")}
        <div>
          <h2 class="detail-name">${escapeHTML(profile.full_name || "Candidate Name")}</h2>
          <div class="detail-trade">${escapeHTML(profile.trade || "No trade added")}</div>
          <p class="candidate-preview-location">${escapeHTML(profile.location || "Location not added")}</p>
        </div>
      </div>

      <p class="detail-bio">${escapeHTML(profile.bio || "No bio added yet.")}</p>

      <div class="detail-info-grid">
        ${renderDetailItem("Location", profile.location || "Not added")}
        ${renderDetailItem("Experience", profile.experience || "Not added")}
        ${renderDetailItem("Availability", profile.availability || "Not added")}
        ${renderDetailItem("Resume", getResumeStatus(profile))}
        ${renderDetailItem("Preferred Contact", profile.contact_method || "Not added")}
        ${renderContactItems(profile)}
      </div>

      <div class="detail-section">
        <h4>Skills & Certifications</h4>
        <div class="tag-row">${tagHTML}</div>
      </div>
    `;
  }

  function ensureModal() {
    let modal = document.getElementById("candidatePreviewModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "candidatePreviewModal";
    modal.className = "candidate-preview-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="candidate-preview-backdrop" data-preview-close></div>
      <section class="candidate-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="candidatePreviewTitle">
        <button type="button" class="candidate-preview-close" data-preview-close aria-label="Close preview">&times;</button>
        <div class="candidate-preview-label">Employer Preview</div>
        <h2 id="candidatePreviewTitle">How employers see you</h2>
        <div id="candidatePreviewContent" class="candidate-preview-content"></div>
        <footer class="candidate-preview-footer">
          <button type="button" class="secondary-btn" data-preview-close>Close</button>
          <button type="button" class="primary-btn" id="candidatePreviewEditBtn">Edit Profile</button>
        </footer>
      </section>
    `;

    document.body.appendChild(modal);

    modal.querySelectorAll("[data-preview-close]").forEach((button) => {
      button.addEventListener("click", closeModal);
    });

    modal.querySelector("#candidatePreviewEditBtn")?.addEventListener("click", () => {
      closeModal();
      if (!window.location.pathname.endsWith("/candidate-profile.html")) {
        window.location.href = "candidate-profile.html";
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal.classList.contains("open")) {
        closeModal();
      }
    });

    return modal;
  }

  function openModal(profile) {
    const modal = ensureModal();
    const content = modal.querySelector("#candidatePreviewContent");

    if (content) {
      content.innerHTML = buildDetailHTML(profile);
    }

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("preview-modal-open");
  }

  function closeModal() {
    const modal = document.getElementById("candidatePreviewModal");
    if (!modal) return;

    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("preview-modal-open");
  }

  window.CandidateProfilePreview = {
    escapeHTML,
    getCandidateTags,
    getInitials,
    getProfilePhoto,
    renderAvatar,
    openModal,
    closeModal
  };
})();
