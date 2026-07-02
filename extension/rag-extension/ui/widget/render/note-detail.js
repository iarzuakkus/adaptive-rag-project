/**
 * Dosya: note-detail.js
 *
 * Görev:
 * - Not detay ekranının HTML içeriğini üretir.
 * - Event işlemlerini note-detail-events.js dosyasına bırakır.
 */

(function () {
  if (window.AdaptiveRagNoteDetail?.__moduleName === "note-detail") {
    return;
  }

  function escapeHtml(text) {
    if (window.AdaptiveRagState?.escapeHtml) {
      return window.AdaptiveRagState.escapeHtml(text);
    }

    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getIconUrl(fileName) {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
        return chrome.runtime.getURL(`icons/${fileName}`);
      }
    } catch (error) {
      return `../../icons/${fileName}`;
    }

    return `../../icons/${fileName}`;
  }

  function icon(fileName, className, alt) {
    const url = getIconUrl(fileName);

    return `
      <span
        class="${className || "rag-note-icon"} rag-mask-icon"
        style="--rag-icon-url: url('${escapeHtml(url)}');"
        role="img"
        aria-label="${escapeHtml(alt || "")}"
      ></span>
    `;
  }

  function getNoteIconName(note) {
    if (note?.noteType === "lecture_note") {
      return "note.svg";
    }

    if (note?.noteType === "summary_note") {
      return "file-text.svg";
    }

    return "note.svg";
  }

  function getPersonalNotes(note) {
    const content = note?.content || {};

    if (Array.isArray(content.personalNotes)) {
      return content.personalNotes;
    }

    if (Array.isArray(content.personal_notes)) {
      return content.personal_notes;
    }

    if (Array.isArray(note?.personalNotes)) {
      return note.personalNotes;
    }

    if (Array.isArray(note?.personal_notes)) {
      return note.personal_notes;
    }

    return [];
  }

  function getManualNote(note) {
    return String(
      note?.manualNote ||
      note?.manual_note ||
      note?.draftNote ||
      note?.userNote ||
      note?.personalNote ||
      ""
    ).trim();
  }

  function renderDetailSection(title, childrenHtml, extraClass = "") {
    if (!childrenHtml) return "";

    return `
      <section class="rag-note-detail-section ${escapeHtml(extraClass)}">
        <h4>${escapeHtml(title)}</h4>
        ${childrenHtml}
      </section>
    `;
  }

  function renderDetailBullets(items) {
    if (!Array.isArray(items) || !items.length) {
      return "";
    }

    return `
      <ul class="rag-note-detail-list">
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    `;
  }

  function renderDetailActionButton(action, noteId, iconName, label, extraClass = "") {
    return `
      <button
        class="rag-note-detail-icon-action ${escapeHtml(extraClass)}"
        type="button"
        title="${escapeHtml(label)}"
        aria-label="${escapeHtml(label)}"
        data-note-detail-action="${escapeHtml(action)}"
        data-note-id="${escapeHtml(noteId)}"
      >
        ${icon(iconName, "rag-note-detail-action-img", label)}
        <span>${escapeHtml(label)}</span>
      </button>
    `;
  }

  function renderTitleEditor(note) {
    return `
      <div class="rag-note-detail-title-edit">
        <input
          id="ragNoteDetailTitleInput"
          class="rag-note-detail-title-input"
          type="text"
          maxlength="90"
          value="${escapeHtml(note.title || "Araştırma notu")}"
          placeholder="Not başlığı"
          data-note-id="${escapeHtml(note.id)}"
        />

        <button
          id="ragNoteDetailTitleSaveBtn"
          class="rag-note-mini-action"
          type="button"
          data-note-id="${escapeHtml(note.id)}"
        >
          Kaydet
        </button>
      </div>
    `;
  }

  function renderPersonalNotesSection(note) {
    const personalNotes = getPersonalNotes(note);
    const manualNote = getManualNote(note);

    if (personalNotes.length) {
      return renderDetailSection(
        "Kişisel notlar",
        `
          <div class="rag-note-source-note-list">
            ${personalNotes
              .map((personalNote, index) => {
                return `
                  <div class="rag-note-source-note">
                    <strong>${escapeHtml(personalNote.title || `Kişisel not ${index + 1}`)}</strong>
                    <span>${escapeHtml(personalNote.text || personalNote.note || "")}</span>
                  </div>
                `;
              })
              .join("")}
          </div>
        `,
        "is-user-note"
      );
    }

    if (manualNote) {
      return renderDetailSection(
        "Kişisel notlar",
        `<p class="rag-note-detail-text">${escapeHtml(manualNote)}</p>`,
        "is-user-note"
      );
    }

    return renderDetailSection(
      "Kişisel notlar",
      `<p class="rag-note-detail-text rag-note-detail-empty-text">Bu not için kişisel not seçilmemiş.</p>`,
      "is-user-note"
    );
  }

  function renderSourceNotesSection(sourceNotes) {
    if (!Array.isArray(sourceNotes) || !sourceNotes.length) {
      return "";
    }

    return renderDetailSection(
      "Kaynaklarla ilişkili notlar",
      `
        <div class="rag-note-source-note-list">
          ${sourceNotes
            .map((sourceNote) => {
              return `
                <div class="rag-note-source-note">
                  <strong>${escapeHtml(sourceNote.sourceTitle || "Kaynak")}</strong>
                  <span>${escapeHtml(sourceNote.note || "")}</span>
                </div>
              `;
            })
            .join("")}
        </div>
      `
    );
  }

  function renderBottomActions(note) {
    return `
      <div class="rag-note-detail-bottom-actions">
        ${renderDetailActionButton(
          "txt",
          note.id,
          "file-text.svg",
          "Dışa aktar",
          "export"
        )}

        ${renderDetailActionButton(
          "delete",
          note.id,
          "rubbish.svg",
          "Sil",
          "danger"
        )}
      </div>
    `;
  }

  function renderNoteDetail(note) {
    const content = note.content || {};
    const sections = Array.isArray(content.sections) ? content.sections : [];
    const insights = Array.isArray(content.insights) ? content.insights : [];
    const sourceNotes = Array.isArray(content.sourceNotes)
      ? content.sourceNotes
      : [];

    return `
      <div class="rag-notes-layout">
        <section class="rag-notes-card rag-note-detail-card">
          <div class="rag-note-detail-top">
            <button
              id="ragBackToNotesBtn"
              class="rag-note-back-btn"
              type="button"
            >
              Geri
            </button>
          </div>

          <div class="rag-note-detail-title-row">
            <div class="rag-note-detail-icon">
              ${icon(getNoteIconName(note), "rag-note-detail-img", "Not")}
            </div>

            <div>
              <h3>${escapeHtml(note.title || "Araştırma notu")}</h3>

              <p>
                ${escapeHtml(note.noteTypeLabel || "Not")}
                ${
                  note.sourceCount
                    ? ` • ${escapeHtml(note.sourceCount)} kaynak`
                    : ""
                }
                ${
                  note.personalNoteCount
                    ? ` • ${escapeHtml(note.personalNoteCount)} kişisel not`
                    : ""
                }
                ${
                  note.dateLabel
                    ? ` • ${escapeHtml(note.dateLabel)}`
                    : ""
                }
              </p>
            </div>
          </div>

          ${renderTitleEditor(note)}

          ${renderPersonalNotesSection(note)}

          ${renderDetailSection(
            "Kısa özet",
            content.shortSummary
              ? `<p class="rag-note-detail-text">${escapeHtml(content.shortSummary)}</p>`
              : ""
          )}

          ${
            sections.length
              ? renderDetailSection(
                  "Ana konular",
                  sections
                    .map((section, index) => {
                      return `
                        <div class="rag-note-topic-block">
                          <h5>${index + 1}. ${escapeHtml(section.heading || "Başlık")}</h5>
                          ${renderDetailBullets(section.bullets)}
                        </div>
                      `;
                    })
                    .join("")
                )
              : ""
          }

          ${renderDetailSection(
            "Önemli çıkarımlar",
            renderDetailBullets(insights)
          )}

          ${renderSourceNotesSection(sourceNotes)}

          ${renderDetailSection(
            "Sonuç",
            content.conclusion
              ? `<p class="rag-note-detail-text">${escapeHtml(content.conclusion)}</p>`
              : ""
          )}

          ${renderBottomActions(note)}
        </section>
      </div>
    `;
  }

  function bindDetailEvents(renderActiveTab, exportNoteAsTxt) {
    if (window.AdaptiveRagNoteDetailEvents?.bindNoteDetailEvents) {
      window.AdaptiveRagNoteDetailEvents.bindNoteDetailEvents(
        renderActiveTab,
        exportNoteAsTxt
      );
      return;
    }

    console.warn("[NOTE DETAIL] note-detail-events.js yüklenmedi.");
  }

  window.AdaptiveRagNoteDetail = {
    __moduleName: "note-detail",

    renderNoteDetail,
    bindDetailEvents
  };
})();