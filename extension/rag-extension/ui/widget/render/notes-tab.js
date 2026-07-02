/**
 * Dosya: notes-tab.js
 *
 * Görev:
 * - Notlar sekmesinin HTML içeriğini üretir.
 * - Kaynak seçimi, kişisel not seçimi, not tipi ve kaydedilmiş notlar arayüzünü çizer.
 * - Kişisel notlar, kaydedilmiş araştırma notlarından ayrı tutulur.
 * - Event işlemlerini note-events.js dosyasına devreder.
 * - Not detay ekranını note-detail.js dosyasına devreder.
 */

(function () {
  if (window.AdaptiveRagNotesTab?.__tabName === "notes-tab") {
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

  function getResearchData() {
    if (window.AdaptiveRagState?.getResearchData) {
      return window.AdaptiveRagState.getResearchData();
    }

    if (window.AdaptiveRagStore?.getResearchData) {
      return window.AdaptiveRagStore.getResearchData();
    }

    return {
      pages: [],
      sources: [],
      notes: {},
      timeline: []
    };
  }

  function getNotesStore() {
    return window.AdaptiveRagNotesStore || null;
  }

  function getNotesState() {
    const store = getNotesStore();

    if (store?.getState) {
      return store.getState();
    }

    return {
      availableSources: [],
      selectedSourceIds: [],
      personalNotes: [],
      selectedPersonalNoteIds: [],
      selectedNoteType: "research_note",
      draftNote: "",
      savedNotes: [],
      selectedNoteId: null,
      isGenerating: false,
      error: null
    };
  }

  function getNoteTypes() {
    const store = getNotesStore();

    return store?.NOTE_TYPES || {
      research_note: {
        key: "research_note",
        label: "Genel",
        title: "Genel not"
      },
      lecture_note: {
        key: "lecture_note",
        label: "Ders notu",
        title: "Ders notu"
      },
      summary_note: {
        key: "summary_note",
        label: "Özet",
        title: "Özet"
      }
    };
  }

  function syncSourcesFromResearchData() {
    const store = getNotesStore();

    if (!store?.setAvailableSources) {
      return;
    }

    const data = getResearchData();

    const sourceLikeItems = [
      ...(Array.isArray(data.pages) ? data.pages : []),
      ...(Array.isArray(data.sources) ? data.sources : [])
    ];

    if (sourceLikeItems.length > 0) {
      store.setAvailableSources(sourceLikeItems);
    }
  }

  function getStats(state) {
    const store = getNotesStore();

    if (store?.getStats) {
      return store.getStats();
    }

    return {
      savedCount: Array.isArray(state.savedNotes) ? state.savedNotes.length : 0,
      personalCount: Array.isArray(state.personalNotes) ? state.personalNotes.length : 0,
      sourceCount: Array.isArray(state.availableSources) ? state.availableSources.length : 0,
      selectedSourceCount: Array.isArray(state.selectedSourceIds) ? state.selectedSourceIds.length : 0,
      selectedPersonalNoteCount: Array.isArray(state.selectedPersonalNoteIds)
        ? state.selectedPersonalNoteIds.length
        : 0
    };
  }

  function isSelectedSource(state, sourceId) {
    return Array.isArray(state.selectedSourceIds)
      ? state.selectedSourceIds.includes(sourceId)
      : false;
  }

  function isSelectedPersonalNote(state, noteId) {
    return Array.isArray(state.selectedPersonalNoteIds)
      ? state.selectedPersonalNoteIds.includes(noteId)
      : false;
  }

  function getSourceIconName(source) {
    const type = String(source?.type || "").toLowerCase();
    const url = String(source?.url || "").toLowerCase();

    if (type.includes("pdf") || url.includes(".pdf")) {
      return "file-pdf.svg";
    }

    if (type.includes("makale") || type.includes("article")) {
      return "file-text.svg";
    }

    return "source.svg";
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

  function renderStatCard(iconName, value, label) {
    return `
      <div class="rag-note-stat">
        <div class="rag-note-stat-icon">
          ${icon(iconName, "rag-note-stat-img", label)}
        </div>

        <div class="rag-note-stat-copy">
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(label)}</span>
        </div>
      </div>
    `;
  }

  function renderNoteCenter(state) {
    const stats = getStats(state);

    return `
      <section class="rag-notes-card rag-note-center-card">
        <h3 class="rag-notes-card-title">Not merkezi</h3>

        <div class="rag-note-stats-grid">
          ${renderStatCard("note.svg", stats.savedCount || 0, "Kayıtlı Not")}
          ${renderStatCard("personal-note.svg", stats.personalCount || 0, "Kişisel Not")}
          ${renderStatCard("source.svg", stats.sourceCount || 0, "Kaynak")}
        </div>
      </section>
    `;
  }

  function renderSourceRow(source, state) {
    const selected = isSelectedSource(state, source.id);
    const sourceIcon = getSourceIconName(source);

    return `
      <button
        class="rag-note-source-row ${selected ? "is-selected" : ""}"
        type="button"
        data-note-source-id="${escapeHtml(source.id)}"
      >
        <span class="rag-note-check ${selected ? "checked" : ""}">
          ${selected ? icon("check.svg", "rag-note-check-icon", "Seçili") : ""}
        </span>

        <span class="rag-note-source-main">
          <span class="rag-note-source-title">
            ${escapeHtml(source.title)}
          </span>

          <span class="rag-note-source-meta">
            ${escapeHtml(source.meta || source.scannedAtLabel || "Kaynak")}
          </span>
        </span>

        <span class="rag-note-source-type-icon">
          ${icon(sourceIcon, "rag-note-source-img", source.type || "Kaynak")}
        </span>
      </button>
    `;
  }

  function renderSourceList(state) {
    const sources = Array.isArray(state.availableSources)
      ? state.availableSources
      : [];

    if (!sources.length) {
      return `
        <div class="rag-note-empty-source">
          <strong>Henüz kaynak yok</strong>
          <span>Not oluşturmak için önce bir sayfa taramalısın.</span>
        </div>
      `;
    }

    return `
      <div class="rag-note-source-list">
        ${sources.map((source) => renderSourceRow(source, state)).join("")}
      </div>
    `;
  }

  function renderPersonalNoteRow(note, state) {
    const selected = isSelectedPersonalNote(state, note.id);
    const title = note.title || "Kişisel not";
    const text = note.text || note.summary || "";

    return `
      <div class="rag-note-personal-row ${selected ? "is-selected" : ""}">
        <button
          class="rag-note-personal-select"
          type="button"
          data-personal-note-select-id="${escapeHtml(note.id)}"
        >
          <span class="rag-note-check ${selected ? "checked" : ""}">
            ${selected ? icon("check.svg", "rag-note-check-icon", "Seçili") : ""}
          </span>

          <span class="rag-note-source-main">
            <span class="rag-note-source-title">
              ${escapeHtml(title)}
            </span>

            <span class="rag-note-source-meta">
              ${escapeHtml(text)}
            </span>
          </span>
        </button>

        <button
          class="rag-note-personal-delete"
          type="button"
          title="Kişisel notu sil"
          aria-label="Kişisel notu sil"
          data-personal-note-delete-id="${escapeHtml(note.id)}"
        >
          ${icon("rubbish.svg", "rag-note-personal-delete-img", "Sil")}
        </button>
      </div>
    `;
  }

  function renderPersonalNoteList(state) {
    const personalNotes = Array.isArray(state.personalNotes)
      ? state.personalNotes
      : [];

    if (!personalNotes.length) {
      return `
        <div class="rag-note-empty-source">
          <strong>Henüz kişisel not yok</strong>
          <span>Kişisel not ekle alanından not kaydedince burada seçilebilir.</span>
        </div>
      `;
    }

    return `
      <div class="rag-note-personal-list">
        ${personalNotes.map((note) => renderPersonalNoteRow(note, state)).join("")}
      </div>
    `;
  }

  function renderNoteTypeButton(type, state) {
    const selected = state.selectedNoteType === type.key;

    return `
      <button
        class="rag-note-type-btn ${selected ? "is-active" : ""}"
        type="button"
        data-note-type="${escapeHtml(type.key)}"
      >
        <span>${escapeHtml(type.label)}</span>
      </button>
    `;
  }

  function renderSourceNoteCreator(state) {
    const noteTypes = Object.values(getNoteTypes());

    const selectedSourceCount = Array.isArray(state.selectedSourceIds)
      ? state.selectedSourceIds.length
      : 0;

    const selectedPersonalNoteCount = Array.isArray(state.selectedPersonalNoteIds)
      ? state.selectedPersonalNoteIds.length
      : 0;

    const totalSelectedCount = selectedSourceCount + selectedPersonalNoteCount;
    const isGenerateDisabled = totalSelectedCount === 0 || Boolean(state.isGenerating);

    return `
      <section class="rag-notes-card rag-note-create-card">
        <div class="rag-note-create-head">
          <div>
            <h3 class="rag-notes-card-title">İçerik seç ve not oluştur</h3>
            <p class="rag-notes-card-desc">
              Kaynaklardan ve kişisel notlarından seçim yaparak yeni not oluştur.
            </p>
          </div>
        </div>

        <div class="rag-note-create-grid">
          <div class="rag-note-source-panel">
            <div class="rag-note-panel-head">
              <h4>Kaynaklar</h4>

              <div class="rag-note-source-actions">
                <button
                  id="ragNoteSelectAllSourcesBtn"
                  class="rag-note-mini-action"
                  type="button"
                >
                  Tümünü seç
                </button>

                <button
                  id="ragNoteClearSourcesBtn"
                  class="rag-note-mini-action"
                  type="button"
                >
                  Temizle
                </button>
              </div>
            </div>

            ${renderSourceList(state)}
          </div>

          <div class="rag-note-personal-panel">
            <div class="rag-note-panel-head">
              <h4>Kişisel notlar</h4>

              <div class="rag-note-source-actions">
                <button
                  id="ragNoteSelectAllPersonalBtn"
                  class="rag-note-mini-action"
                  type="button"
                >
                  Tümünü seç
                </button>

                <button
                  id="ragNoteClearPersonalBtn"
                  class="rag-note-mini-action"
                  type="button"
                >
                  Temizle
                </button>
              </div>
            </div>

            ${renderPersonalNoteList(state)}
          </div>

          <div class="rag-note-action-panel">
            <div class="rag-note-panel-head vertical">
              <h4>Not tipi</h4>

              <span class="rag-note-selected-count">
                ${escapeHtml(selectedSourceCount)} kaynak • ${escapeHtml(selectedPersonalNoteCount)} Kişisel Not
              </span>
            </div>

            <div class="rag-note-type-list">
              ${noteTypes.map((type) => renderNoteTypeButton(type, state)).join("")}
            </div>

            <button
              id="ragGenerateNoteBtn"
              class="rag-note-generate-btn"
              type="button"
              ${isGenerateDisabled ? "disabled" : ""}
            >
              <span class="rag-note-generate-icon">
                ${icon("recommendation.svg", "rag-note-btn-icon", "Not oluştur")}
              </span>

              <span>
                ${state.isGenerating ? "Not oluşturuluyor..." : "Not oluştur"}
              </span>
            </button>

            <button
              id="ragExportLatestNoteBtn"
              class="rag-note-export-btn"
              type="button"
              ${!state.savedNotes?.length ? "disabled" : ""}
            >
              ${icon("file-text.svg", "rag-note-btn-icon", "Dışa aktar")}
              <span>Dışa aktar</span>
            </button>
          </div>
        </div>
      </section>
    `;
  }

  function renderDraftNote(state) {
    const draftNote = state.draftNote || "";
    const count = draftNote.length;

    return `
      <section class="rag-notes-card rag-note-draft-card">
        <div class="rag-note-draft-head">
          <div>
            <h3 class="rag-notes-card-title">Kişisel not ekle</h3>
            <p class="rag-notes-card-desc">
              Buraya yazdığın not ayrı kaydedilir. Sonra kaynaklarla birlikte seçip yeni not oluşturabilirsin.
            </p>
          </div>

          <div class="rag-note-draft-icon">
            ${icon("personal-note.svg", "rag-note-card-img", "Kişisel not")}
          </div>
        </div>

        <div class="rag-note-draft-input-row">
          <textarea
            id="ragDraftNoteInput"
            class="rag-note-draft-textarea"
            maxlength="1000"
            placeholder="Kişisel notunu buraya yaz..."
          >${escapeHtml(draftNote)}</textarea>

          <button
            id="ragSaveDraftNoteBtn"
            class="rag-note-save-btn"
            type="button"
          >
            ${icon("save.svg", "rag-note-btn-icon", "Kaydet")}
            <span>Kaydet</span>
          </button>
        </div>

        <div class="rag-note-draft-footer">
          <span id="ragDraftNoteCounter">${escapeHtml(count)} / 1000</span>
        </div>
      </section>
    `;
  }

  function renderSavedNoteItem(note) {
    const title = note.title || "Araştırma notu";
    const summary = note.summary || note.content?.shortSummary || "";
    const sourceCount = Number(note.sourceCount || 0);
    const personalNoteCount = Number(note.personalNoteCount || 0);
    const sectionCount = Number(note.sectionCount || note.content?.sections?.length || 0);

    return `
      <article class="rag-saved-note-item">
        <div class="rag-saved-note-mark"></div>

        <div class="rag-saved-note-icon">
          ${icon(getNoteIconName(note), "rag-saved-note-img", "Not")}
        </div>

        <div class="rag-saved-note-content">
          <h4>${escapeHtml(title)}</h4>

          <p>${escapeHtml(summary)}</p>

          <div class="rag-saved-note-meta">
            <span>
              ${icon("clock.svg", "rag-note-meta-icon", "Tarih")}
              ${escapeHtml(note.dateLabel || "")}
            </span>

            <span>${escapeHtml(note.timeLabel || "")}</span>

            ${sourceCount ? `<span>${escapeHtml(sourceCount)} kaynak</span>` : ""}
            ${personalNoteCount ? `<span>${escapeHtml(personalNoteCount)} kişisel not</span>` : ""}
            ${sectionCount ? `<span>${escapeHtml(sectionCount)} başlık</span>` : ""}
          </div>
        </div>

        <div class="rag-saved-note-actions">
          <button
            class="rag-saved-note-action"
            type="button"
            data-note-action="detail"
            data-note-id="${escapeHtml(note.id)}"
          >
            ${icon("external-link.svg", "rag-saved-note-action-img", "Detay")}
            <span>Detay</span>
          </button>

          <button
            class="rag-saved-note-action accent"
            type="button"
            data-note-action="txt"
            data-note-id="${escapeHtml(note.id)}"
          >
            ${icon("file-text.svg", "rag-saved-note-action-img", "TXT")}
            <span>TXT</span>
          </button>

          <button
            class="rag-saved-note-action danger"
            type="button"
            data-note-action="delete"
            data-note-id="${escapeHtml(note.id)}"
          >
            ${icon("rubbish.svg", "rag-saved-note-action-img", "Sil")}
            <span>Sil</span>
          </button>
        </div>
      </article>
    `;
  }

  function renderSavedNotes(state) {
    const savedNotes = Array.isArray(state.savedNotes) ? state.savedNotes : [];

    return `
      <section class="rag-notes-card rag-saved-notes-card">
        <div class="rag-saved-notes-head">
          <h3 class="rag-notes-card-title">Kaydedilmiş notlar</h3>
          ${savedNotes.length ? `<span class="rag-note-muted-link">En yeni</span>` : ""}
        </div>

        ${
          savedNotes.length
            ? `
              <div class="rag-saved-notes-list">
                ${savedNotes.map(renderSavedNoteItem).join("")}
              </div>
            `
            : `
              <div class="rag-note-empty-state">
                <div class="rag-note-empty-icon">
                  ${icon("note.svg", "rag-note-empty-img", "Not")}
                </div>

                <strong>Henüz kaydedilmiş not yok</strong>
                <span>
                  Kaynak veya kişisel not seçip not oluşturduğunda burada görünecek.
                </span>
              </div>
            `
        }
      </section>
    `;
  }

  function renderInfoStrip() {
    return `
      <section class="rag-note-info-strip">
        <div class="rag-note-info-icon">
          ${icon("info.svg", "rag-note-info-img", "Bilgi")}
        </div>

        <div>
          <strong>Kişisel notlar kaydedilmiş notlardan ayrı tutulur.</strong>
          <span>Yeni not oluştururken kaynakları ve kişisel notları birlikte seçebilirsin.</span>
        </div>
      </section>
    `;
  }

  function renderError(state) {
    if (!state.error) {
      return "";
    }

    return `
      <div class="rag-note-error">
        ${escapeHtml(state.error)}
      </div>
    `;
  }

  function renderNotesTab() {
    syncSourcesFromResearchData();

    const state = getNotesState();
    const store = getNotesStore();
    const selectedNote = store?.getSelectedNote ? store.getSelectedNote() : null;

    if (selectedNote) {
      if (window.AdaptiveRagNoteDetail?.renderNoteDetail) {
        return window.AdaptiveRagNoteDetail.renderNoteDetail(selectedNote);
      }

      return `
        <div class="rag-notes-layout">
          <div class="rag-note-error">
            note-detail.js yüklenmedi.
          </div>
        </div>
      `;
    }

    return `
      <div class="rag-notes-layout">
        ${renderNoteCenter(state)}
        ${renderError(state)}
        ${renderSourceNoteCreator(state)}
        ${renderDraftNote(state)}
        ${renderSavedNotes(state)}
        ${renderInfoStrip()}
      </div>
    `;
  }

  function bindNotesEvents(renderActiveTab) {
    if (window.AdaptiveRagNoteEvents?.bindNotesEvents) {
      window.AdaptiveRagNoteEvents.bindNotesEvents(renderActiveTab);
      return;
    }

    console.warn("[NOTES TAB] note-events.js yüklenmedi.");
  }

  window.AdaptiveRagNotesTab = {
    __tabName: "notes-tab",

    renderNotesTab,
    bindNotesEvents
  };
})();