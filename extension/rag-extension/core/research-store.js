/**
 * Dosya: research-store.js
 *
 * Görev:
 * - Aktif araştırma oturumuna ait kaynak verilerini yönetir.
 * - Taranan sayfaları, chunk'ları, notları, alıntıları, önerileri ve zaman çizelgesini saklar.
 * - Verileri sessionId bazlı chrome.storage.local içinde tutar.
 * - Sayfa yenilense bile aktif sessionId devam ettiği sürece kaynaklar kaybolmaz.
 *
 * Önemli:
 * - Bu dosya session oluşturmaz.
 * - Session kimliği ve oturum yaşam döngüsü session-store.js tarafından yönetilir.
 * - Bu dosya sadece aktif sessionId'ye bağlı araştırma verilerini saklar.
 * - Sahte/mock veri içermez.
 */

(function () {
  const RESEARCH_STORE_KEY = "adaptive_rag_research_data_by_session";

  let activeSessionIdCache = null;
  let researchCache = createEmptyResearchData();
  let isStoreInitialized = false;

  /**
   * Aynı dosyanın tekrar inject edilmesini engeller.
   *
   * Popup.js widget dosyalarını tekrar inject edebilir.
   * Bu kontrol, store'un gereksiz yere yeniden tanımlanmasını azaltır.
   */
  if (window.AdaptiveRagStore?.__storeName === "session-based-research-store") {
    return;
  }

  /**
   * Boş araştırma verisi oluşturur.
   *
   * Bu yapı kesinlikle örnek veri içermez.
   * Kullanıcı hiçbir sayfa taramadıysa Kaynaklar sekmesi boş görünür.
   */
  function createEmptyResearchData() {
    return {
      pages: [],

      notes: {
        generalSummary: "",
        quotes: [],
        recommendations: []
      },

      timeline: []
    };
  }

  /**
   * Güvenli unique id üretir.
   */
  function createId(prefix = "item") {
    if (crypto?.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  /**
   * Storage okuma işlemini Promise formatına çevirir.
   */
  function getFromStorage(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key]);
      });
    });
  }

  /**
   * Storage yazma işlemini Promise formatına çevirir.
   */
  function setToStorage(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          [key]: value
        },
        () => resolve(value)
      );
    });
  }

  /**
   * Tüm sessionId'lere ait research verilerini getirir.
   */
  async function getAllResearchSessions() {
    const allData = await getFromStorage(RESEARCH_STORE_KEY);

    if (!allData || typeof allData !== "object" || Array.isArray(allData)) {
      return {};
    }

    return allData;
  }

  /**
   * Tüm sessionId'lere ait research verilerini kaydeder.
   */
  async function saveAllResearchSessions(allData) {
    return await setToStorage(RESEARCH_STORE_KEY, allData);
  }

  /**
   * Aktif sessionId değerini session-store.js üzerinden alır.
   *
   * Aktif oturum yoksa yeni aktif oturum başlatır.
   * Böylece research verisi her zaman bir sessionId altında tutulur.
   */
  async function getActiveSessionId() {
    if (!window.AdaptiveRagSessionStore?.ensureActiveSession) {
      console.warn("[RESEARCH STORE] AdaptiveRagSessionStore bulunamadı.");

      return null;
    }

    const session = await window.AdaptiveRagSessionStore.ensureActiveSession();

    return session?.id || null;
  }

  /**
   * Eksik veya bozuk research datasını güvenli formata dönüştürür.
   */
  function normalizeResearchData(data) {
    const emptyData = createEmptyResearchData();

    if (!data || typeof data !== "object") {
      return emptyData;
    }

    return {
      pages: Array.isArray(data.pages) ? data.pages : [],

      notes: {
        generalSummary: data.notes?.generalSummary || "",
        quotes: Array.isArray(data.notes?.quotes) ? data.notes.quotes : [],
        recommendations: Array.isArray(data.notes?.recommendations)
          ? data.notes.recommendations
          : []
      },

      timeline: Array.isArray(data.timeline) ? data.timeline : []
    };
  }

  /**
   * Aktif sessionId için research store'u başlatır.
   *
   * Eğer bu sessionId için daha önce veri varsa onu yükler.
   * Yoksa boş research data oluşturur.
   */
  async function initResearchSession(sessionId = null) {
    const targetSessionId = sessionId || await getActiveSessionId();

    if (!targetSessionId) {
      researchCache = createEmptyResearchData();
      activeSessionIdCache = null;
      isStoreInitialized = false;

      return researchCache;
    }

    const allSessions = await getAllResearchSessions();

    activeSessionIdCache = targetSessionId;
    researchCache = normalizeResearchData(allSessions[targetSessionId]);
    isStoreInitialized = true;

    if (!allSessions[targetSessionId]) {
      allSessions[targetSessionId] = researchCache;
      await saveAllResearchSessions(allSessions);
    }

    return researchCache;
  }

  /**
   * Store başlatılmadıysa güvenli şekilde başlatır.
   */
  async function ensureResearchSession() {
    if (isStoreInitialized && activeSessionIdCache) {
      return researchCache;
    }

    return await initResearchSession();
  }

  /**
   * Widget render tarafının kullandığı senkron getter.
   *
   * Not:
   * - Bu fonksiyon storage okumaz.
   * - Cache'teki güncel veriyi döndürür.
   * - Widget açılırken önce initResearchSession() çağrılmalıdır.
   */
  function getResearchData() {
    return normalizeResearchData(researchCache);
  }

  /**
   * Research verisini aktif sessionId altında kaydeder.
   *
   * Fonksiyon senkron gibi kullanılabilir.
   * Storage yazma işlemi arka planda async yapılır.
   */
  function saveResearchData(data) {
    researchCache = normalizeResearchData(data);
    isStoreInitialized = true;

    if (!activeSessionIdCache) {
      ensureResearchSession().then(() => saveResearchData(researchCache));
      return researchCache;
    }

    getAllResearchSessions().then((allSessions) => {
      allSessions[activeSessionIdCache] = researchCache;
      saveAllResearchSessions(allSessions);
    });

    return researchCache;
  }

  /**
   * Chunk verilerini Kaynaklar sekmesinin beklediği formata dönüştürür.
   */
  function normalizeChunks(chunks) {
    if (!Array.isArray(chunks)) {
      return [];
    }

    return chunks
      .map((chunk, index) => {
        if (typeof chunk === "string") {
          return {
            id: createId("chunk"),
            text: chunk,
            sourceSelector: ""
          };
        }

        return {
          id: chunk.id || createId("chunk"),
          text: chunk.text || chunk.content || "",
          sourceSelector:
            chunk.sourceSelector ||
            chunk.selector ||
            chunk.metadata?.sourceSelector ||
            ""
        };
      })
      .filter((chunk) => chunk.text.trim().length > 0);
  }

  /**
   * Sayfa özetini güvenli şekilde üretir.
   *
   * Backend özet döndürmediyse:
   * - page.summary
   * - page.preview
   * - ilk chunk metni
   * sırasıyla denenir.
   *
   * Hiçbiri yoksa boş string döner.
   */
  function getPageSummary(page, normalizedChunks) {
    if (page.summary) {
      return page.summary;
    }

    if (page.preview) {
      return page.preview;
    }

    if (normalizedChunks.length > 0) {
      const firstChunkText = normalizedChunks[0].text || "";

      if (firstChunkText.length > 180) {
        return `${firstChunkText.slice(0, 180)}...`;
      }

      return firstChunkText;
    }

    return "";
  }

  /**
   * Taranan sayfayı aktif araştırma oturumuna ekler.
   *
   * Aynı URL daha önce eklenmişse:
   * - Yeni kart oluşturmaz.
   * - Mevcut kartı günceller.
   * - Kartı listenin en üstüne taşır.
   */
  function addScannedPage(page) {
    if (!isStoreInitialized || !activeSessionIdCache) {
      ensureResearchSession().then(() => addScannedPage(page));

      return {
        id: createId("page"),
        title: page.title || document.title || "Başlıksız Sayfa",
        url: page.url || window.location.href || "",
        summary: page.summary || page.preview || "",
        scannedAt: new Date().toLocaleString("tr-TR"),
        chunks: []
      };
    }

    const data = getResearchData();
    const scannedAt = new Date().toLocaleString("tr-TR");
    const normalizedChunks = normalizeChunks(page.chunks || page.blockChunks || []);

    const newPage = {
      id: page.id || createId("page"),
      sessionId: activeSessionIdCache,
      title: page.title || document.title || "Başlıksız Sayfa",
      url: page.url || window.location.href || "",
      summary: getPageSummary(page, normalizedChunks),
      scannedAt,
      chunks: normalizedChunks
    };

    const existingPageIndex = data.pages.findIndex((item) => item.url === newPage.url);

    if (existingPageIndex !== -1) {
      const existingPage = data.pages[existingPageIndex];

      const updatedPage = {
        ...existingPage,
        ...newPage,
        id: existingPage.id,
        sessionId: activeSessionIdCache,
        scannedAt
      };

      data.pages.splice(existingPageIndex, 1);
      data.pages.unshift(updatedPage);

      data.timeline.unshift({
        id: createId("time"),
        sessionId: activeSessionIdCache,
        type: "scan-update",
        title: `${updatedPage.title} sayfası güncellendi`,
        time: scannedAt
      });

      saveResearchData(data);

      return updatedPage;
    }

    data.pages.unshift(newPage);

    data.timeline.unshift({
      id: createId("time"),
      sessionId: activeSessionIdCache,
      type: "scan",
      title: `${newPage.title} sayfası tarandı`,
      time: scannedAt
    });

    saveResearchData(data);

    return newPage;
  }

  /**
   * Aktif oturuma ait research verisini temizler.
   *
   * Baloncuk kapatılırken çağrılmalıdır.
   * Sadece aktif sessionId'nin verisini siler.
   */
  async function clearResearchSession(sessionId = null) {
    const targetSessionId =
      sessionId ||
      activeSessionIdCache ||
      await getActiveSessionId();

    if (!targetSessionId) {
      researchCache = createEmptyResearchData();
      activeSessionIdCache = null;
      isStoreInitialized = false;

      return true;
    }

    const allSessions = await getAllResearchSessions();

    delete allSessions[targetSessionId];

    await saveAllResearchSessions(allSessions);

    if (targetSessionId === activeSessionIdCache) {
      researchCache = createEmptyResearchData();
      activeSessionIdCache = null;
      isStoreInitialized = false;
    }

    return true;
  }

  /**
   * Aktif oturum için research verisini sıfırlar.
   *
   * Session devam eder ama kaynaklar/notlar/timeline boşaltılır.
   */
  async function resetResearchSession(sessionId = null) {
    const targetSessionId =
      sessionId ||
      activeSessionIdCache ||
      await getActiveSessionId();

    if (!targetSessionId) {
      return createEmptyResearchData();
    }

    const allSessions = await getAllResearchSessions();
    const emptyData = createEmptyResearchData();

    allSessions[targetSessionId] = emptyData;

    await saveAllResearchSessions(allSessions);

    activeSessionIdCache = targetSessionId;
    researchCache = emptyData;
    isStoreInitialized = true;

    return researchCache;
  }

  /**
   * Dışarı açılan research store API'si.
   */
  window.AdaptiveRagStore = {
    __storeName: "session-based-research-store",

    initResearchSession,
    ensureResearchSession,
    getResearchData,
    saveResearchData,
    addScannedPage,
    clearResearchSession,
    resetResearchSession
  };
})();