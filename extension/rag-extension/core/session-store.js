/**
 * Dosya: session-store.js
 *
 * Görev:
 * - Adaptive RAG için aktif kullanıcı oturumunu yönetir.
 * - Widget açıldığında aktif oturum başlatır.
 * - Sayfa yenilense bile aktif oturum bilgisini chrome.storage.local içinde korur.
 * - Chat mesajlarını aktif sessionId'ye bağlı şekilde saklar.
 *
 * Önemli:
 * - Bu dosya kaynak/kart verilerini tutmaz.
 * - Taranan sayfalar, notlar, alıntılar ve timeline verileri research-store.js içinde tutulur.
 * - Bu dosya sadece oturum kimliği, oturum durumu ve chat mesajlarını yönetir.
 */

(function () {
  const ACTIVE_SESSION_KEY = "adaptive_rag_active_session";
  const CHAT_MESSAGES_KEY = "adaptive_rag_chat_messages_by_session";

  /**
   * Aynı store tekrar inject edilirse yeniden tanımlanmasını engeller.
   */
  if (window.AdaptiveRagSessionStore?.__storeName === "session-store") {
    return;
  }

  /**
   * Güvenli unique id üretir.
   */
  function createId(prefix = "session") {
    if (window.crypto && crypto.randomUUID) {
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
   * Storage silme işlemini Promise formatına çevirir.
   */
  function removeFromStorage(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], () => resolve());
    });
  }

  /**
   * Yeni aktif oturum nesnesi oluşturur.
   *
   * Bu oturum:
   * - Sayfa yenilense bile storage içinde korunur.
   * - Kullanıcı açıkça oturumu bitirmediği sürece aktif kalır.
   */
  function createSession() {
    return {
      id: createId("session"),
      isActive: true,
      startedAt: new Date().toISOString(),
      endedAt: null,
      startPageUrl: window.location.href,
      startPageTitle: document.title,
      lastPageUrl: window.location.href,
      lastPageTitle: document.title
    };
  }

  /**
   * Aktif oturumu döndürür.
   * Eğer kayıt yoksa veya oturum aktif değilse null döner.
   */
  async function getActiveSession() {
    const session = await getFromStorage(ACTIVE_SESSION_KEY);

    if (!session || !session.isActive || !session.id) {
      return null;
    }

    return session;
  }

  /**
   * Aktif session id değerini döndürür.
   * Aktif oturum yoksa null döner.
   */
  async function getActiveSessionId() {
    const session = await getActiveSession();
    return session?.id || null;
  }

  /**
   * Yeni oturum başlatır.
   *
   * forceNew false ise:
   * - Aktif oturum zaten varsa onu döndürür.
   *
   * forceNew true ise:
   * - Eski aktif oturum yerine yeni oturum başlatır.
   */
  async function startSession(options = {}) {
    const { forceNew = false } = options;

    if (!forceNew) {
      const existingSession = await getActiveSession();

      if (existingSession) {
        return existingSession;
      }
    }

    const newSession = createSession();

    await setToStorage(ACTIVE_SESSION_KEY, newSession);

    return newSession;
  }

  /**
   * Aktif oturum varsa onu döndürür.
   * Yoksa yeni bir oturum başlatır.
   *
   * Widget açılırken veya veri kaydedilmeden önce kullanılmalıdır.
   */
  async function ensureActiveSession() {
    const existingSession = await getActiveSession();

    if (existingSession) {
      return existingSession;
    }

    return await startSession();
  }

  /**
   * Aktif oturumu günceller.
   *
   * Örneğin kullanıcı başka sayfaya geçtiğinde son sayfa bilgisi güncellenebilir.
   */
  async function updateActiveSession(updates = {}) {
    const session = await getActiveSession();

    if (!session) {
      return null;
    }

    const updatedSession = {
      ...session,
      ...updates,
      lastPageUrl: window.location.href,
      lastPageTitle: document.title
    };

    await setToStorage(ACTIVE_SESSION_KEY, updatedSession);

    return updatedSession;
  }

  /**
   * Aktif oturumu sonlandırır.
   *
   * Dikkat:
   * - Widget panelini kapatırken bunu çağırmayacağız.
   * - Çünkü sohbet ve kaynaklar kaybolmadan devam etmeli.
   * - Bu fonksiyon ileride "Oturumu Bitir" gibi ayrı bir işlem için kullanılabilir.
   */
  async function endActiveSession() {
    const session = await getActiveSession();

    if (!session) {
      return null;
    }

    const endedSession = {
      ...session,
      isActive: false,
      endedAt: new Date().toISOString()
    };

    await removeFromStorage(ACTIVE_SESSION_KEY);

    return endedSession;
  }

  /**
   * Tüm sessionId'lere göre tutulan chat mesajlarını döndürür.
   */
  async function getAllChatSessions() {
    const sessions = await getFromStorage(CHAT_MESSAGES_KEY);

    if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) {
      return {};
    }

    return sessions;
  }

  /**
   * Belirli bir sessionId için chat mesajlarını döndürür.
   * sessionId verilmezse aktif oturum kullanılır.
   */
  async function getChatSession(sessionId = null) {
    const activeSessionId = sessionId || await getActiveSessionId();

    if (!activeSessionId) {
      return [];
    }

    const allSessions = await getAllChatSessions();
    const messages = allSessions[activeSessionId];

    if (!Array.isArray(messages)) {
      return [];
    }

    return messages;
  }

  /**
   * Belirli bir sessionId için chat mesajlarını kaydeder.
   * sessionId verilmezse aktif oturum kullanılır.
   */
  async function saveChatSession(messages, sessionId = null) {
    const activeSessionId = sessionId || await getActiveSessionId();

    if (!activeSessionId) {
      return [];
    }

    const allSessions = await getAllChatSessions();

    allSessions[activeSessionId] = Array.isArray(messages) ? messages : [];

    await setToStorage(CHAT_MESSAGES_KEY, allSessions);

    return allSessions[activeSessionId];
  }

  /**
   * Aktif oturuma yeni chat mesajı ekler.
   *
   * Mesajlar sessionId ile saklanır.
   * Böylece farklı araştırma oturumları birbirine karışmaz.
   */
  async function addMessageToSession(role, content) {
    const session = await ensureActiveSession();
    const messages = await getChatSession(session.id);

    const newMessage = {
      id: createId("message"),
      sessionId: session.id,
      role,
      content,
      pageUrl: window.location.href,
      pageTitle: document.title,
      createdAt: new Date().toISOString()
    };

    messages.push(newMessage);

    await saveChatSession(messages, session.id);
    await updateActiveSession();

    return messages;
  }

  /**
   * Aktif oturuma ait son chat mesajlarını döndürür.
   */
  async function getLastMessages(limit = 12, sessionId = null) {
    const messages = await getChatSession(sessionId);

    return messages.slice(-limit);
  }

  /**
   * Belirli bir oturuma ait chat mesajlarını temizler.
   * sessionId verilmezse aktif oturumun mesajları temizlenir.
   */
  async function clearChatSession(sessionId = null) {
    const activeSessionId = sessionId || await getActiveSessionId();

    if (!activeSessionId) {
      return true;
    }

    const allSessions = await getAllChatSessions();

    delete allSessions[activeSessionId];

    await setToStorage(CHAT_MESSAGES_KEY, allSessions);

    return true;
  }

  /**
   * Aktif oturumun var olup olmadığını kontrol eder.
   */
  async function isSessionActive() {
    const session = await getActiveSession();
    return Boolean(session);
  }

  /**
   * Dışarı açılan Session Store API'si.
   */
  window.AdaptiveRagSessionStore = {
    __storeName: "session-store",

    startSession,
    ensureActiveSession,
    getActiveSession,
    getActiveSessionId,
    updateActiveSession,
    endActiveSession,
    isSessionActive,

    getChatSession,
    saveChatSession,
    addMessageToSession,
    clearChatSession,
    getLastMessages
  };
})();