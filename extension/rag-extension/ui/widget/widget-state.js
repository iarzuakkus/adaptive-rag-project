/**
 * Dosya: widget-state.js
 *
 * Görev:
 * - Widget genel durumunu tutar.
 * - Aktif tab bilgisini yönetir.
 * - Oturum açık/kapalı bilgisini storage ile senkron tutar.
 * - Session, research ve notes store işlemleri için ortak yardımcılar sağlar.
 */

(function () {
  if (window.AdaptiveRagState?.__stateName === "widget-state") {
    return;
  }

  const SESSION_ENABLED_KEY = "adaptive_rag_session_enabled";

  const state = {
    activeTab: "chat",
    isSessionActive: false
  };

  /* -------------------- Storage -------------------- */

  function getStorageValue(key, defaultValue = null) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] ?? defaultValue);
      });
    });
  }

  function setStorageValue(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => {
        resolve(value);
      });
    });
  }

  /* -------------------- Tab State -------------------- */

  function getActiveTab() {
    return state.activeTab;
  }

  function setActiveTab(tabName) {
    const allowedTabs = ["chat", "sources", "notes"];

    state.activeTab = allowedTabs.includes(tabName)
      ? tabName
      : "chat";

    return state.activeTab;
  }

  /* -------------------- Session State -------------------- */

  function isSessionActive() {
    return Boolean(state.isSessionActive);
  }

  function setSessionActive(value) {
    state.isSessionActive = Boolean(value);
    return state.isSessionActive;
  }

  async function loadSessionState() {
    const savedValue = await getStorageValue(
      SESSION_ENABLED_KEY,
      false
    );

    state.isSessionActive = Boolean(savedValue);

    return state.isSessionActive;
  }

  async function saveSessionState(value) {
    state.isSessionActive = Boolean(value);

    await setStorageValue(
      SESSION_ENABLED_KEY,
      state.isSessionActive
    );

    return state.isSessionActive;
  }

  async function prepareSession() {
    try {
      if (!window.AdaptiveRagSessionStore?.ensureActiveSession) {
        console.warn(
          "[WIDGET STATE] Session store bulunamadı."
        );

        return false;
      }

      const session =
        await window.AdaptiveRagSessionStore.ensureActiveSession();

      if (!session?.id) {
        return false;
      }

      if (window.AdaptiveRagStore?.initResearchSession) {
        await window.AdaptiveRagStore.initResearchSession(
          session.id
        );
      }

      await saveSessionState(true);

      return true;
    } catch (error) {
      console.warn(
        "[WIDGET STATE] Oturum hazırlanamadı:",
        error
      );

      await saveSessionState(false);

      return false;
    }
  }

  async function clearSessionData() {
    let activeSessionId = null;

    /*
     * Session ID, session kapatılmadan önce alınmalıdır.
     * endActiveSession çalıştıktan sonra bu ID artık bulunamaz.
     */
    try {
      if (
        window.AdaptiveRagSessionStore?.getActiveSessionId
      ) {
        activeSessionId =
          await window.AdaptiveRagSessionStore.getActiveSessionId();
      }
    } catch (error) {
      console.warn(
        "[WIDGET STATE] Aktif session id alınamadı:",
        error
      );
    }

    /*
     * Notlar:
     * - Kişisel notlar
     * - Kaydedilmiş notlar
     * - Seçili kaynaklar
     * - Seçili kişisel notlar
     * - Taslak metin
     * - Açık detay ekranı
     * - Bekleyen mock üretim işlemi
     */
    try {
      if (
        window.AdaptiveRagNotesStore?.clearNotesSession
      ) {
        await window.AdaptiveRagNotesStore.clearNotesSession();
      } else if (
        window.AdaptiveRagNotesStore?.resetNotesState
      ) {
        window.AdaptiveRagNotesStore.resetNotesState();
      }
    } catch (error) {
      console.warn(
        "[WIDGET STATE] Not verileri temizlenemedi:",
        error
      );
    }

    /*
     * Taranmış sayfalar ve research verileri.
     */
    try {
      if (
        window.AdaptiveRagStore?.clearResearchSession
      ) {
        await window.AdaptiveRagStore.clearResearchSession(
          activeSessionId
        );
      }
    } catch (error) {
      console.warn(
        "[WIDGET STATE] Research verisi temizlenemedi:",
        error
      );
    }

    /*
     * Aktif session'a ait chat mesajları.
     */
    try {
      if (
        window.AdaptiveRagSessionStore?.clearChatSession
      ) {
        await window.AdaptiveRagSessionStore.clearChatSession(
          activeSessionId
        );
      }
    } catch (error) {
      console.warn(
        "[WIDGET STATE] Chat verisi temizlenemedi:",
        error
      );
    }

    /*
     * Önerilerin geçici frontend state'i.
     */
    try {
      if (
        window.AdaptiveRagRecommendationStore?.clearState
      ) {
        await Promise.resolve(
          window.AdaptiveRagRecommendationStore.clearState({
            render: false
          })
        );
      }
    } catch (error) {
      console.warn(
        "[WIDGET STATE] Öneri verileri temizlenemedi:",
        error
      );
    }

    /*
     * Son chat cevabına ait geçici highlight verileri.
     */
    window.AdaptiveRagLastChatChunks = [];
    window.AdaptiveRagLastChatResult = null;

    /*
     * Session en son kapatılır.
     */
    try {
      if (
        window.AdaptiveRagSessionStore?.endActiveSession
      ) {
        await window.AdaptiveRagSessionStore.endActiveSession();
      }
    } catch (error) {
      console.warn(
        "[WIDGET STATE] Aktif session sonlandırılamadı:",
        error
      );
    }

    state.activeTab = "chat";

    await saveSessionState(false);

    window.dispatchEvent(
      new CustomEvent("adaptive-rag-session-cleared")
    );

    return true;
  }

  /* -------------------- Research Helpers -------------------- */

  function getResearchData() {
    try {
      if (
        window.AdaptiveRagStore?.getResearchData
      ) {
        return window.AdaptiveRagStore.getResearchData();
      }
    } catch (error) {
      console.warn(
        "[WIDGET STATE] Research verisi alınamadı:",
        error
      );
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
    try {
      if (
        window.AdaptiveRagStore?.saveResearchData
      ) {
        return await window.AdaptiveRagStore.saveResearchData(
          data
        );
      }
    } catch (error) {
      console.warn(
        "[WIDGET STATE] Research verisi kaydedilemedi:",
        error
      );
    }

    return data;
  }

  /* -------------------- UI Helpers -------------------- */

  function getLogoUrl() {
    try {
      return chrome.runtime.getURL("assets/logo.svg");
    } catch {
      return "";
    }
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function trimText(text, maxLength = 180) {
    const value = String(text || "").trim();

    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}...`;
  }

  function autoResizeTextarea(element) {
    if (!element) {
      return;
    }

    element.style.height = "auto";
    element.style.height =
      `${Math.min(element.scrollHeight, 130)}px`;
  }

  window.AdaptiveRagState = {
    __stateName: "widget-state",

    getStorageValue,
    setStorageValue,

    getActiveTab,
    setActiveTab,

    isSessionActive,
    setSessionActive,
    loadSessionState,
    saveSessionState,
    prepareSession,
    clearSessionData,

    getResearchData,
    saveResearchData,

    getLogoUrl,
    escapeHtml,
    trimText,
    autoResizeTextarea
  };
})();