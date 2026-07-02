/**
 * Dosya: note-detail-events.js
 *
 * Görev:
 * - Not detay ekranındaki eventleri yönetir.
 * - Geri dönme, başlık güncelleme, TXT dışa aktarma ve not silme işlemlerini bağlar.
 */

(function () {
  if (window.AdaptiveRagNoteDetailEvents?.__moduleName === "note-detail-events") {
    return;
  }

  function getNotesStore() {
    return window.AdaptiveRagNotesStore || null;
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

    if (!store?.getNoteById || !store?.buildTxtContent) {
      console.warn("[NOTE DETAIL EVENTS] TXT aktarım için store hazır değil.");
      return;
    }

    const note = store.getNoteById(noteId);
    const content = store.buildTxtContent(noteId);

    if (!note || !content) {
      console.warn("[NOTE DETAIL EVENTS] Aktarılacak not bulunamadı.");
      return;
    }

    const fileName = `${createSafeFileName(note.title)}.txt`;

    downloadTxtFile(fileName, content);
  }

  function updateNoteTitle(noteId, title) {
    const store = getNotesStore();
    const nextTitle = String(title || "").trim();

    if (!store || !noteId || !nextTitle) {
      return false;
    }

    if (typeof store.updateNoteTitle === "function") {
      store.updateNoteTitle(noteId, nextTitle);
      return true;
    }

    if (typeof store.updateNote === "function") {
      store.updateNote(noteId, {
        title: nextTitle
      });
      return true;
    }

    console.warn("[NOTE DETAIL EVENTS] Başlık güncelleme fonksiyonu bulunamadı.");
    return false;
  }

  async function handleBack(renderActiveTab) {
    const store = getNotesStore();

    if (!store) {
      console.warn("[NOTE DETAIL EVENTS] Geri dönmek için store bulunamadı.");
      return;
    }

    store.clearSelectedNote?.();

    await rerender(renderActiveTab);
  }

  async function handleTitleSave(renderActiveTab) {
    const input = document.getElementById("ragNoteDetailTitleInput");
    const saveButton = document.getElementById("ragNoteDetailTitleSaveBtn");

    if (!input) {
      return;
    }

    const noteId =
      input.getAttribute("data-note-id") ||
      saveButton?.getAttribute("data-note-id");

    const title = input.value.trim();

    if (!noteId || !title) {
      return;
    }

    updateNoteTitle(noteId, title);

    await rerender(renderActiveTab);
  }

  async function handleDelete(noteId, renderActiveTab) {
    const store = getNotesStore();

    if (!store || !noteId) {
      return;
    }

    const shouldDelete = window.confirm("Bu not silinsin mi?");

    if (!shouldDelete) {
      return;
    }

    store.deleteNote?.(noteId);
    store.clearSelectedNote?.();

    await rerender(renderActiveTab);
  }

  function bindBackEvent(renderActiveTab) {
    const backButton = document.getElementById("ragBackToNotesBtn");

    backButton?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      await handleBack(renderActiveTab);
    });
  }

  function bindTitleEvents(renderActiveTab) {
    const input = document.getElementById("ragNoteDetailTitleInput");
    const saveButton = document.getElementById("ragNoteDetailTitleSaveBtn");

    saveButton?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      await handleTitleSave(renderActiveTab);
    });

    input?.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      await handleTitleSave(renderActiveTab);
    });
  }

  function bindActionEvents(renderActiveTab, customExportNoteAsTxt) {
    const actionButtons = document.querySelectorAll(
      "[data-note-detail-action], .rag-note-detail-card [data-note-action]"
    );

    actionButtons.forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const action =
          button.getAttribute("data-note-detail-action") ||
          button.getAttribute("data-note-action");

        const noteId =
          button.getAttribute("data-note-id") ||
          button.getAttribute("data-note-detail-id");

        if (!action || !noteId) {
          return;
        }

        if (action === "txt") {
          if (typeof customExportNoteAsTxt === "function") {
            customExportNoteAsTxt(noteId);
          } else {
            exportNoteAsTxt(noteId);
          }

          return;
        }

        if (action === "delete") {
          await handleDelete(noteId, renderActiveTab);
        }
      });
    });
  }

  function bindNoteDetailEvents(renderActiveTab, customExportNoteAsTxt) {
    bindBackEvent(renderActiveTab);
    bindTitleEvents(renderActiveTab);
    bindActionEvents(renderActiveTab, customExportNoteAsTxt);
  }

  window.AdaptiveRagNoteDetailEvents = {
    __moduleName: "note-detail-events",

    bindNoteDetailEvents,
    bindDetailEvents: bindNoteDetailEvents,
    exportNoteAsTxt
  };
})();