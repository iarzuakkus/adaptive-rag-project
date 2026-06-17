/**
 * Dosya: notes-tab.js
 *
 * Görev:
 * - Notlar sekmesinin HTML içeriğini üretir.
 * - Genel özet notunu research-store.js üzerinden okur.
 * - Kullanıcının yazdığı notu research-store.js içine kaydeder.
 *
 * Not:
 * - Alıntılar, öneriler, PDF ve Word çıktısı şimdilik kaldırıldı.
 * - Bu dosya sadece Notlar sekmesinden sorumludur.
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

  function getResearchData() {
    if (window.AdaptiveRagState?.getResearchData) {
      return window.AdaptiveRagState.getResearchData();
    }

    if (window.AdaptiveRagStore?.getResearchData) {
      return window.AdaptiveRagStore.getResearchData();
    }

    return {
      pages: [],
      notes: {
        generalSummary: ""
      },
      timeline: []
    };
  }

  async function saveResearchData(data) {
    if (window.AdaptiveRagState?.saveResearchData) {
      return await window.AdaptiveRagState.saveResearchData(data);
    }

    if (window.AdaptiveRagStore?.saveResearchData) {
      return await window.AdaptiveRagStore.saveResearchData(data);
    }

    return data;
  }

  function renderNotesTab() {
    const data = getResearchData();
    const notes = data.notes || {};
    const generalSummary = notes.generalSummary || "";

    return `
      <div class="rag-notes-layout">
        <section class="rag-note-panel">
          <div class="rag-section-head compact">
            <div>
              <h3>Özet Not</h3>
              <p>Bu oturum için genel çalışma notunu burada tutabilirsin.</p>
            </div>
          </div>

          <textarea
            id="ragGeneralSummaryInput"
            class="rag-note-textarea"
            placeholder="Genel özet notunu buraya yaz..."
          >${escapeHtml(generalSummary)}</textarea>

          <button
            id="ragSaveSummaryBtn"
            class="rag-primary-btn"
            type="button"
          >
            Kaydet
          </button>

          <p class="rag-small-info">
            Oturum kapanınca bu not da temizlenir.
          </p>
        </section>
      </div>
    `;
  }

  function bindNotesEvents(renderActiveTab) {
    const saveButton = document.getElementById("ragSaveSummaryBtn");

    if (!saveButton) {
      return;
    }

    saveButton.addEventListener("click", async () => {
      const input = document.getElementById("ragGeneralSummaryInput");
      const data = getResearchData();

      const nextData = {
        ...data,
        notes: {
          ...(data.notes || {}),
          generalSummary: input?.value || ""
        }
      };

      saveButton.disabled = true;
      saveButton.textContent = "Kaydediliyor...";

      await saveResearchData(nextData);

      saveButton.textContent = "Kaydedildi";

      setTimeout(async () => {
        if (typeof renderActiveTab === "function") {
          await renderActiveTab();
        }
      }, 400);
    });
  }

  window.AdaptiveRagNotesTab = {
    __tabName: "notes-tab",

    renderNotesTab,
    bindNotesEvents
  };
})();