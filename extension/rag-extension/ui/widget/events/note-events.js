/**
 * Dosya: note-events.js
 *
 * Görev:
 * - Notlar sekmesindeki kullanıcı etkileşimlerini yönetir.
 * - Kaynak seçimi, kişisel not seçimi, kişisel not silme, not tipi seçimi,
 *   kişisel not kaydetme, not oluşturma, TXT dışa aktarma ve kayıtlı not işlemlerini bağlar.
 */

(function () {
  if (window.AdaptiveRagNoteEvents?.__moduleName === "note-events") {
    return;
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
      savedNotes: [],
      selectedNoteId: null
    };
  }

  async function rerender(renderActiveTab) {
    if (typeof renderActiveTab === "function") {
      await renderActiveTab();
    }
  }

  function createSafeFileName(title) {
    return String(title || "memorai-not")
      .toLowerCase()
      .replaceAll("ı", "i")
      .replaceAll("ğ", "g")
      .replaceAll("ü", "u")
      .replaceAll("ş", "s")
      .replaceAll("ö", "o")
      .replaceAll("ç", "c")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "memorai-not";
  }

  function downloadTxtFile(fileName, content) {
    const blob = new Blob([content], {
      type: "text/plain;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  function exportNoteAsTxt(noteId) {
    const store = getNotesStore();

    if (!store?.buildTxtContent || !store?.getNoteById) {
      return;
    }

    const note = store.getNoteById(noteId);
    const content = store.buildTxtContent(noteId);

    if (!note || !content) {
      return;
    }

    const fileName = `${createSafeFileName(note.title)}.txt`;

    downloadTxtFile(fileName, content);
  }

  function bindSourceEvents(renderActiveTab) {
    const store = getNotesStore();

    if (!store) return;

    document.querySelectorAll("[data-note-source-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const sourceId = button.getAttribute("data-note-source-id");

        store.toggleSource?.(sourceId);

        await rerender(renderActiveTab);
      });
    });

    document.getElementById("ragNoteSelectAllSourcesBtn")
      ?.addEventListener("click", async () => {
        store.selectAllSources?.();

        await rerender(renderActiveTab);
      });

    document.getElementById("ragNoteClearSourcesBtn")
      ?.addEventListener("click", async () => {
        store.clearSelectedSources?.();

        await rerender(renderActiveTab);
      });
  }

  function bindPersonalNoteEvents(renderActiveTab) {
    const store = getNotesStore();

    if (!store) return;

    document.querySelectorAll("[data-personal-note-select-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const noteId = button.getAttribute("data-personal-note-select-id");

        store.togglePersonalNote?.(noteId);

        await rerender(renderActiveTab);
      });
    });

    document.querySelectorAll("[data-personal-note-delete-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const noteId = button.getAttribute("data-personal-note-delete-id");
        const shouldDelete = window.confirm("Bu kişisel not silinsin mi?");

        if (!shouldDelete) return;

        store.deletePersonalNote?.(noteId);

        await rerender(renderActiveTab);
      });
    });

    document.getElementById("ragNoteSelectAllPersonalBtn")
      ?.addEventListener("click", async () => {
        store.selectAllPersonalNotes?.();

        await rerender(renderActiveTab);
      });

    document.getElementById("ragNoteClearPersonalBtn")
      ?.addEventListener("click", async () => {
        store.clearSelectedPersonalNotes?.();

        await rerender(renderActiveTab);
      });
  }

  function bindNoteTypeEvents(renderActiveTab) {
    const store = getNotesStore();

    if (!store) return;

    document.querySelectorAll("[data-note-type]").forEach((button) => {
      button.addEventListener("click", async () => {
        const noteType = button.getAttribute("data-note-type");

        store.setSelectedNoteType?.(noteType);

        await rerender(renderActiveTab);
      });
    });
  }

  function bindDraftEvents(renderActiveTab) {
    const store = getNotesStore();
    const input = document.getElementById("ragDraftNoteInput");
    const counter = document.getElementById("ragDraftNoteCounter");
    const saveButton = document.getElementById("ragSaveDraftNoteBtn");

    if (!store || !input) return;

    input.addEventListener("input", () => {
      const value = input.value || "";

      store.setDraftNote?.(value);

      if (counter) {
        counter.textContent = `${value.length} / 1000`;
      }
    });

    saveButton?.addEventListener("click", async () => {
      store.saveDraftNote?.();

      await rerender(renderActiveTab);
    });
  }

  function bindGenerateEvents(renderActiveTab) {
    const store = getNotesStore();
    const generateButton = document.getElementById("ragGenerateNoteBtn");

    if (!store || !generateButton) return;

    generateButton.addEventListener("click", async () => {
      store.generateMockNote?.();

      await rerender(renderActiveTab);

      setTimeout(async () => {
        await rerender(renderActiveTab);
      }, 500);
    });
  }

  function bindTxtExportEvents() {
    document.querySelectorAll('[data-note-action="txt"]').forEach((button) => {
      button.addEventListener("click", () => {
        const noteId = button.getAttribute("data-note-id");

        exportNoteAsTxt(noteId);
      });
    });

    document.getElementById("ragExportLatestNoteBtn")
      ?.addEventListener("click", () => {
        const state = getNotesState();
        const latestNote = Array.isArray(state.savedNotes)
          ? state.savedNotes[0]
          : null;

        if (!latestNote) return;

        exportNoteAsTxt(latestNote.id);
      });
  }

  function bindSavedNoteEvents(renderActiveTab) {
    const store = getNotesStore();

    if (!store) return;

    document.querySelectorAll("[data-note-action]").forEach((button) => {
      const action = button.getAttribute("data-note-action");

      if (action === "txt") {
        return;
      }

      button.addEventListener("click", async () => {
        const noteId = button.getAttribute("data-note-id");

        if (action === "detail") {
          store.setSelectedNote?.(noteId);

          await rerender(renderActiveTab);
          return;
        }

        if (action === "delete") {
          const shouldDelete = window.confirm("Bu not silinsin mi?");

          if (!shouldDelete) return;

          store.deleteNote?.(noteId);

          await rerender(renderActiveTab);
        }
      });
    });
  }

  function bindDetailEvents(renderActiveTab) {
    if (window.AdaptiveRagNoteDetail?.bindDetailEvents) {
      window.AdaptiveRagNoteDetail.bindDetailEvents(
        renderActiveTab,
        exportNoteAsTxt
      );
    }
  }

  function bindNotesEvents(renderActiveTab) {
    const store = getNotesStore();
    const selectedNote = store?.getSelectedNote ? store.getSelectedNote() : null;

    if (selectedNote) {
      bindDetailEvents(renderActiveTab);
      return;
    }

    bindSourceEvents(renderActiveTab);
    bindPersonalNoteEvents(renderActiveTab);
    bindNoteTypeEvents(renderActiveTab);
    bindDraftEvents(renderActiveTab);
    bindGenerateEvents(renderActiveTab);
    bindTxtExportEvents();
    bindSavedNoteEvents(renderActiveTab);
  }

  window.AdaptiveRagNoteEvents = {
    __moduleName: "note-events",

    bindNotesEvents,
    exportNoteAsTxt
  };
})();