/**
 * Dosya: research-store.js
 *
 * Görev:
 * - Aktif Adaptive RAG oturumuna ait kaynak ve not verilerini saklar.
 * - Verileri sessionId bazlı chrome.storage.local içinde tutar.
 * - Bu dosya yeni session oluşturmaz.
 *
 * Tuttuğu veriler:
 * - Taranan sayfalar
 * - Sayfa chunk'ları
 * - Genel özet notu
 * - Timeline
 */

(function () {
  if (window.AdaptiveRagStore?.__storeName === "research-store") {
    return;
  }

  const RESEARCH_STORE_KEY = "adaptive_rag_research_data_by_session";

  let activeSessionIdCache = null;
  let researchCache = createEmptyResearchData();
  let isStoreReady = false;

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

  async function getAllResearchSessions() {
    const allData = await getStorageValue(RESEARCH_STORE_KEY, {});

    if (!allData || typeof allData !== "object" || Array.isArray(allData)) {
      return {};
    }

    return allData;
  }

  async function saveAllResearchSessions(allData) {
    return await setStorageValue(RESEARCH_STORE_KEY, allData);
  }

  /* -------------------- Temel Veri Yapısı -------------------- */

  function createEmptyResearchData() {
    return {
      pages: [],
      notes: {
        generalSummary: ""
      },
      timeline: []
    };
  }

  function normalizeResearchData(data) {
    const emptyData = createEmptyResearchData();

    if (!data || typeof data !== "object") {
      return emptyData;
    }

    return {
      pages: Array.isArray(data.pages) ? data.pages : [],

      notes: {
        generalSummary: data.notes?.generalSummary || ""
      },

      timeline: Array.isArray(data.timeline) ? data.timeline : []
    };
  }

  function createId(prefix = "item") {
    if (window.crypto?.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  /* -------------------- Session Bağlantısı -------------------- */

  async function getCurrentSessionId() {
    if (!window.AdaptiveRagSessionStore?.getActiveSessionId) {
      console.warn("[RESEARCH STORE] Session store bulunamadı.");
      return null;
    }

    return await window.AdaptiveRagSessionStore.getActiveSessionId();
  }

  async function initResearchSession(sessionId = null) {
    const targetSessionId = sessionId || await getCurrentSessionId();

    if (!targetSessionId) {
      activeSessionIdCache = null;
      researchCache = createEmptyResearchData();
      isStoreReady = false;

      return researchCache;
    }

    const allSessions = await getAllResearchSessions();

    activeSessionIdCache = targetSessionId;
    researchCache = normalizeResearchData(allSessions[targetSessionId]);
    isStoreReady = true;

    if (!allSessions[targetSessionId]) {
      allSessions[targetSessionId] = researchCache;
      await saveAllResearchSessions(allSessions);
    }

    return researchCache;
  }

  async function ensureResearchSession() {
    if (isStoreReady && activeSessionIdCache) {
      return researchCache;
    }

    return await initResearchSession();
  }

  function getResearchData() {
    return normalizeResearchData(researchCache);
  }

  async function saveResearchData(data, sessionId = null) {
    const targetSessionId = sessionId || activeSessionIdCache || await getCurrentSessionId();

    researchCache = normalizeResearchData(data);

    if (!targetSessionId) {
      activeSessionIdCache = null;
      isStoreReady = false;
      return researchCache;
    }

    const allSessions = await getAllResearchSessions();

    allSessions[targetSessionId] = researchCache;

    await saveAllResearchSessions(allSessions);

    activeSessionIdCache = targetSessionId;
    isStoreReady = true;

    return researchCache;
  }

  /* -------------------- Sayfa Kaydetme -------------------- */

  function normalizeChunks(chunks) {
    if (!Array.isArray(chunks)) {
      return [];
    }

    return chunks
      .map((chunk) => {
        if (typeof chunk === "string") {
          return {
            id: createId("chunk"),
            text: chunk
          };
        }

        return {
          id: chunk.id || createId("chunk"),
          text: chunk.text || chunk.content || ""
        };
      })
      .filter((chunk) => chunk.text.trim().length > 0);
  }

  function createPageSummary(page, chunks) {
    if (page.summary) {
      return page.summary;
    }

    if (page.preview) {
      return page.preview;
    }

    const firstChunkText = chunks[0]?.text || "";

    if (firstChunkText.length > 180) {
      return `${firstChunkText.slice(0, 180)}...`;
    }

    return firstChunkText;
  }

  async function addScannedPage(page = {}) {
    await ensureResearchSession();

    if (!activeSessionIdCache) {
      console.warn("[RESEARCH STORE] Aktif session yok. Sayfa kaydedilmedi.");
      return null;
    }

    const data = getResearchData();
    const scannedAt = new Date().toLocaleString("tr-TR");
    const chunks = normalizeChunks(page.chunks || page.blockChunks || []);

    const nextPage = {
      id: page.id || createId("page"),
      sessionId: activeSessionIdCache,
      title: page.title || document.title || "Başlıksız Sayfa",
      url: page.url || window.location.href || "",
      summary: createPageSummary(page, chunks),
      scannedAt,
      chunks
    };

    const existingIndex = data.pages.findIndex((item) => {
      return item.url === nextPage.url;
    });

    if (existingIndex !== -1) {
      const existingPage = data.pages[existingIndex];

      data.pages.splice(existingIndex, 1);

      data.pages.unshift({
        ...existingPage,
        ...nextPage,
        id: existingPage.id
      });

      data.timeline.unshift({
        id: createId("time"),
        type: "scan-update",
        title: `${nextPage.title} sayfası güncellendi`,
        time: scannedAt
      });

      await saveResearchData(data);

      return data.pages[0];
    }

    data.pages.unshift(nextPage);

    data.timeline.unshift({
      id: createId("time"),
      type: "scan",
      title: `${nextPage.title} sayfası tarandı`,
      time: scannedAt
    });

    await saveResearchData(data);

    return nextPage;
  }

  /* -------------------- Temizleme -------------------- */

  async function clearResearchSession(sessionId = null) {
    const targetSessionId = sessionId || activeSessionIdCache;

    researchCache = createEmptyResearchData();

    if (!targetSessionId) {
      activeSessionIdCache = null;
      isStoreReady = false;
      return true;
    }

    const allSessions = await getAllResearchSessions();

    delete allSessions[targetSessionId];

    await saveAllResearchSessions(allSessions);

    if (targetSessionId === activeSessionIdCache) {
      activeSessionIdCache = null;
      isStoreReady = false;
    }

    return true;
  }

  async function resetResearchSession(sessionId = null) {
    const targetSessionId = sessionId || activeSessionIdCache || await getCurrentSessionId();

    researchCache = createEmptyResearchData();

    if (!targetSessionId) {
      activeSessionIdCache = null;
      isStoreReady = false;
      return researchCache;
    }

    const allSessions = await getAllResearchSessions();

    allSessions[targetSessionId] = researchCache;

    await saveAllResearchSessions(allSessions);

    activeSessionIdCache = targetSessionId;
    isStoreReady = true;

    return researchCache;
  }

  /* -------------------- Dış API -------------------- */

  window.AdaptiveRagStore = {
    __storeName: "research-store",

    initResearchSession,
    ensureResearchSession,
    getResearchData,
    saveResearchData,
    addScannedPage,
    clearResearchSession,
    resetResearchSession
  };
})();