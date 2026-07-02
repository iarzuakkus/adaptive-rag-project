/**
 * Dosya: note-events.js
 *
 * Görev:
 * - Notlar sekmesindeki kullanıcı etkileşimlerini yönetir.
 * - Kaynak seçimi, kişisel not seçimi ve not tipi seçimini bağlar.
 * - Kişisel notları frontend store'a ve backend vector store'a kaydeder.
 * - Kişisel not silindiğinde frontend ve backend kayıtlarını kaldırır.
 * - Seçilen kaynak ve kişisel notları backend'e gönderir.
 * - Backend tarafından üretilen notu notes-store içine kaydeder.
 * - TXT dışa aktarma ve kayıtlı not işlemlerini bağlar.
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
      selectedNoteId: null,
      selectedSourceIds: [],
      selectedPersonalNoteIds: [],
      selectedNoteType: "research_note",
      isGenerating: false
    };
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function safeText(value, fallback = "") {
    if (value === undefined || value === null) {
      return fallback;
    }

    return String(value).trim();
  }

  async function rerender(renderActiveTab) {
    if (typeof renderActiveTab === "function") {
      await renderActiveTab();
    }
  }

  function getDomainFromUrl(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function getActiveSessionId() {
    const sessionStore = window.AdaptiveRagSessionStore;

    if (!sessionStore) {
      return "";
    }

    try {
      const activeSession =
        sessionStore.getActiveSession?.() ||
        sessionStore.getSession?.() ||
        null;

      if (activeSession) {
        return safeText(
          activeSession.id ||
          activeSession.sessionId ||
          activeSession.session_id
        );
      }

      const sessionState = sessionStore.getState?.();

      return safeText(
        sessionState?.activeSession?.id ||
        sessionState?.activeSession?.sessionId ||
        sessionState?.activeSession?.session_id ||
        sessionState?.sessionId ||
        sessionState?.session_id
      );
    } catch (error) {
      console.warn(
        "[NOTE EVENTS] Session bilgisi okunamadı:",
        error
      );

      return "";
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(
              new Error(
                chrome.runtime.lastError.message ||
                "Background mesajı gönderilemedi."
              )
            );

            return;
          }

          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function ensureBackendActionSuccess(
    response,
    fallbackMessage
  ) {
    if (!response || response.success !== true) {
      throw new Error(
        response?.message ||
        response?.error ||
        fallbackMessage
      );
    }

    const backendResult = response.data;

    if (
      backendResult &&
      backendResult.success === false
    ) {
      throw new Error(
        backendResult.message ||
        backendResult.error ||
        fallbackMessage
      );
    }

    return backendResult || {};
  }

  function normalizeSourceForBackend(source) {
    const raw =
      source?.raw &&
      typeof source.raw === "object"
        ? source.raw
        : {};

    const url = safeText(
      raw.url ||
      raw.page_url ||
      raw.pageUrl ||
      source?.url
    );

    const summarySections = Array.isArray(
      raw.summary_sections
    )
      ? raw.summary_sections
      : Array.isArray(raw.summarySections)
        ? raw.summarySections
        : [];

    const chunks = Array.isArray(raw.chunks)
      ? raw.chunks
      : Array.isArray(raw.block_chunks)
        ? raw.block_chunks
        : Array.isArray(raw.blockChunks)
          ? raw.blockChunks
          : [];

    return {
      source_id: safeText(
        raw.source_id ||
        raw.sourceId ||
        raw.id ||
        source?.id
      ),

      title: safeText(
        raw.title ||
        raw.page_title ||
        raw.pageTitle ||
        source?.title ||
        "Başlıksız kaynak"
      ),

      url,

      domain: safeText(
        raw.domain ||
        getDomainFromUrl(url)
      ),

      summary: safeText(
        raw.summary
      ),

      short_summary: safeText(
        raw.short_summary ||
        raw.shortSummary
      ),

      long_summary: safeText(
        raw.long_summary ||
        raw.longSummary
      ),

      summary_sections: summarySections,
      chunks,

      source_type: safeText(
        raw.source_type ||
        raw.sourceType ||
        raw.type ||
        source?.type ||
        "web"
      ),

      scanned_at: safeText(
        raw.scanned_at ||
        raw.scannedAt ||
        raw.created_at ||
        raw.createdAt
      )
    };
  }

  function normalizePersonalNoteForBackend(note) {
    return {
      note_id: safeText(
        note?.note_id ||
        note?.noteId ||
        note?.id
      ),

      title: safeText(
        note?.title ||
        "Kişisel not"
      ),

      text: safeText(
        note?.text ||
        note?.body ||
        note?.content
      ),

      session_id: safeText(
        note?.session_id ||
        note?.sessionId ||
        getActiveSessionId()
      ),

      created_at: safeText(
        note?.created_at ||
        note?.createdAt
      )
    };
  }

  function buildGenerateNotePayload(store) {
    const selectedSources = safeArray(
      store.getSelectedSources?.()
    );

    const selectedPersonalNotes = safeArray(
      store.getSelectedPersonalNotes?.()
    );

    const state = store.getState?.() || {};

    const sources = selectedSources.map(
      normalizeSourceForBackend
    );

    const personalNotes = selectedPersonalNotes
      .map(normalizePersonalNoteForBackend)
      .filter((note) => note.text);

    return {
      note_type: safeText(
        state.selectedNoteType,
        "research_note"
      ),

      custom_title: "",
      language: "tr",

      sources,
      personal_notes: personalNotes,

      source_count: sources.length,
      personal_note_count: personalNotes.length,

      session_id: getActiveSessionId(),
      force: false
    };
  }

  function validateGeneratePayload(payload) {
    const hasSources =
      safeArray(payload.sources).length > 0;

    const hasPersonalNotes =
      safeArray(payload.personal_notes).length > 0;

    if (!hasSources && !hasPersonalNotes) {
      return (
        "Not oluşturmak için en az bir kaynak " +
        "veya kişisel not seçmelisin."
      );
    }

    const allowedTypes = new Set([
      "research_note",
      "lecture_note",
      "summary_note"
    ]);

    if (!allowedTypes.has(payload.note_type)) {
      return "Geçerli bir not tipi seçmelisin.";
    }

    return "";
  }

  function getBackendNoteResponse(response) {
    if (!response || response.success !== true) {
      throw new Error(
        response?.message ||
        response?.error ||
        "Not oluşturma isteği başarısız oldu."
      );
    }

    const backendResult = response.data;

    if (
      !backendResult ||
      backendResult.success !== true
    ) {
      throw new Error(
        backendResult?.message ||
        "Backend not oluşturamadı."
      );
    }

    const note =
      backendResult.note ||
      backendResult.data?.note;

    if (!note || typeof note !== "object") {
      throw new Error(
        "Backend geçerli bir not döndürmedi."
      );
    }

    return note;
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

    if (
      !store?.buildTxtContent ||
      !store?.getNoteById
    ) {
      return;
    }

    const note = store.getNoteById(noteId);
    const content = store.buildTxtContent(noteId);

    if (!note || !content) {
      return;
    }

    const fileName =
      `${createSafeFileName(note.title)}.txt`;

    downloadTxtFile(fileName, content);
  }

  function bindSourceEvents(renderActiveTab) {
    const store = getNotesStore();

    if (!store) return;

    document
      .querySelectorAll("[data-note-source-id]")
      .forEach((button) => {
        button.addEventListener("click", async () => {
          const sourceId = button.getAttribute(
            "data-note-source-id"
          );

          store.toggleSource?.(sourceId);

          await rerender(renderActiveTab);
        });
      });

    document
      .getElementById("ragNoteSelectAllSourcesBtn")
      ?.addEventListener("click", async () => {
        store.selectAllSources?.();

        await rerender(renderActiveTab);
      });

    document
      .getElementById("ragNoteClearSourcesBtn")
      ?.addEventListener("click", async () => {
        store.clearSelectedSources?.();

        await rerender(renderActiveTab);
      });
  }

  function bindPersonalNoteEvents(renderActiveTab) {
    const store = getNotesStore();

    if (!store) return;

    document
      .querySelectorAll(
        "[data-personal-note-select-id]"
      )
      .forEach((button) => {
        button.addEventListener("click", async () => {
          const noteId = button.getAttribute(
            "data-personal-note-select-id"
          );

          store.togglePersonalNote?.(noteId);

          await rerender(renderActiveTab);
        });
      });

    document
      .querySelectorAll(
        "[data-personal-note-delete-id]"
      )
      .forEach((button) => {
        button.addEventListener("click", async () => {
          const noteId = button.getAttribute(
            "data-personal-note-delete-id"
          );

          if (!noteId) {
            return;
          }

          const shouldDelete = window.confirm(
            "Bu kişisel not silinsin mi?"
          );

          if (!shouldDelete) {
            return;
          }

          button.disabled = true;
          button.setAttribute("aria-busy", "true");

          try {
            const response = await sendRuntimeMessage({
              type: "DELETE_PERSONAL_NOTE",
              noteId
            });

            ensureBackendActionSuccess(
              response,
              "Kişisel not vector hafızadan silinemedi."
            );

            store.deletePersonalNote?.(noteId);
          } catch (error) {
            console.error(
              "[NOTE EVENTS] Kişisel not silme hatası:",
              error
            );

            window.alert(
              error?.message ||
              "Kişisel not silinemedi."
            );
          } finally {
            button.disabled = false;
            button.removeAttribute("aria-busy");

            await rerender(renderActiveTab);
          }
        });
      });

    document
      .getElementById("ragNoteSelectAllPersonalBtn")
      ?.addEventListener("click", async () => {
        store.selectAllPersonalNotes?.();

        await rerender(renderActiveTab);
      });

    document
      .getElementById("ragNoteClearPersonalBtn")
      ?.addEventListener("click", async () => {
        store.clearSelectedPersonalNotes?.();

        await rerender(renderActiveTab);
      });
  }

  function bindNoteTypeEvents(renderActiveTab) {
    const store = getNotesStore();

    if (!store) return;

    document
      .querySelectorAll("[data-note-type]")
      .forEach((button) => {
        button.addEventListener("click", async () => {
          const noteType = button.getAttribute(
            "data-note-type"
          );

          store.setSelectedNoteType?.(noteType);

          await rerender(renderActiveTab);
        });
      });
  }

  function bindDraftEvents(renderActiveTab) {
    const store = getNotesStore();

    const input = document.getElementById(
      "ragDraftNoteInput"
    );

    const counter = document.getElementById(
      "ragDraftNoteCounter"
    );

    const saveButton = document.getElementById(
      "ragSaveDraftNoteBtn"
    );

    if (!store || !input) {
      return;
    }

    input.addEventListener("input", () => {
      const value = input.value || "";

      store.setDraftNote?.(value);

      if (counter) {
        counter.textContent =
          `${value.length} / 1000`;
      }
    });

    saveButton?.addEventListener(
      "click",
      async () => {
        if (saveButton.disabled) {
          return;
        }

        const savedPersonalNote =
          store.saveDraftNote?.();

        if (!savedPersonalNote) {
          await rerender(renderActiveTab);
          return;
        }

        saveButton.disabled = true;
        saveButton.setAttribute(
          "aria-busy",
          "true"
        );

        try {
          const payload =
            normalizePersonalNoteForBackend(
              savedPersonalNote
            );

          const response = await sendRuntimeMessage({
            type: "SAVE_PERSONAL_NOTE",
            payload
          });

          ensureBackendActionSuccess(
            response,
            "Kişisel not vector hafızaya kaydedilemedi."
          );

          console.log(
            "[NOTE EVENTS] Kişisel not vector hafızaya kaydedildi:",
            savedPersonalNote.id
          );
        } catch (error) {
          console.error(
            "[NOTE EVENTS] Kişisel not kaydetme hatası:",
            error
          );

          /*
           * Backend kaydı başarısız olursa local not geri alınır.
           * Kullanıcının yazdığı metin tekrar taslağa yerleştirilir.
           */
          store.deletePersonalNote?.(
            savedPersonalNote.id
          );

          store.setDraftNote?.(
            savedPersonalNote.text || ""
          );

          window.alert(
            error?.message ||
            "Kişisel not kaydedilemedi."
          );
        } finally {
          saveButton.disabled = false;
          saveButton.removeAttribute(
            "aria-busy"
          );

          await rerender(renderActiveTab);
        }
      }
    );
  }

  function bindGenerateEvents(renderActiveTab) {
    const store = getNotesStore();

    const generateButton = document.getElementById(
      "ragGenerateNoteBtn"
    );

    if (!store || !generateButton) return;

    generateButton.addEventListener(
      "click",
      async () => {
        const currentState = store.getState?.() || {};

        if (currentState.isGenerating) {
          return;
        }

        const payload =
          buildGenerateNotePayload(store);

        const validationError =
          validateGeneratePayload(payload);

        if (validationError) {
          store.finishNoteGeneration?.(
            validationError
          );

          await rerender(renderActiveTab);
          return;
        }

        const startResult =
          store.startNoteGeneration?.();

        if (startResult?.success === false) {
          await rerender(renderActiveTab);
          return;
        }

        generateButton.disabled = true;
        generateButton.setAttribute(
          "aria-busy",
          "true"
        );

        await rerender(renderActiveTab);

        try {
          const response = await sendRuntimeMessage({
            type: "GENERATE_NOTE",
            payload
          });

          const generatedNote =
            getBackendNoteResponse(response);

          const savedNote =
            store.addGeneratedNote?.(
              generatedNote
            );

          if (!savedNote) {
            throw new Error(
              "Üretilen not frontend hafızasına kaydedilemedi."
            );
          }

          store.finishNoteGeneration?.();
        } catch (error) {
          console.error(
            "[NOTE EVENTS] Not oluşturma hatası:",
            error
          );

          store.finishNoteGeneration?.(
            error?.message ||
            "Not oluşturulamadı."
          );
        } finally {
          generateButton.disabled = false;
          generateButton.removeAttribute(
            "aria-busy"
          );

          await rerender(renderActiveTab);
        }
      }
    );
  }

  function bindTxtExportEvents() {
    document
      .querySelectorAll('[data-note-action="txt"]')
      .forEach((button) => {
        button.addEventListener("click", () => {
          const noteId = button.getAttribute(
            "data-note-id"
          );

          exportNoteAsTxt(noteId);
        });
      });

    document
      .getElementById("ragExportLatestNoteBtn")
      ?.addEventListener("click", () => {
        const state = getNotesState();

        const latestNote =
          Array.isArray(state.savedNotes)
            ? state.savedNotes[0]
            : null;

        if (!latestNote) return;

        exportNoteAsTxt(latestNote.id);
      });
  }

  function bindSavedNoteEvents(renderActiveTab) {
    const store = getNotesStore();

    if (!store) return;

    document
      .querySelectorAll("[data-note-action]")
      .forEach((button) => {
        const action = button.getAttribute(
          "data-note-action"
        );

        if (action === "txt") {
          return;
        }

        button.addEventListener("click", async () => {
          const noteId = button.getAttribute(
            "data-note-id"
          );

          if (action === "detail") {
            store.setSelectedNote?.(noteId);

            await rerender(renderActiveTab);
            return;
          }

          if (action === "delete") {
            const shouldDelete = window.confirm(
              "Bu not silinsin mi?"
            );

            if (!shouldDelete) return;

            store.deleteNote?.(noteId);

            await rerender(renderActiveTab);
          }
        });
      });
  }

  function bindDetailEvents(renderActiveTab) {
    if (
      window.AdaptiveRagNoteDetail
        ?.bindDetailEvents
    ) {
      window.AdaptiveRagNoteDetail
        .bindDetailEvents(
          renderActiveTab,
          exportNoteAsTxt
        );
    }
  }

  function bindNotesEvents(renderActiveTab) {
    const store = getNotesStore();

    const selectedNote =
      store?.getSelectedNote
        ? store.getSelectedNote()
        : null;

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