/**
 * Dosya: session-store.js
 *
 * Görev:
 * - Adaptive RAG oturumunu yönetir.
 * - Aktif session bilgisini chrome.storage.local içinde saklar.
 * - Chat mesajlarını sessionId bazlı tutar.
 *
 * Not:
 * - Kaynaklar, notlar ve özetler bu dosyada tutulmaz.
 * - Onlar research-store.js içinde yönetilir.
 */

(function () {
  if (window.AdaptiveRagSessionStore?.__storeName === "session-store") {
    return;
  }

  const ACTIVE_SESSION_KEY = "adaptive_rag_active_session";
  const CHAT_MESSAGES_KEY = "adaptive_rag_chat_messages_by_session";
  const SESSION_ENABLED_KEY = "adaptive_rag_session_enabled";

  /* -------------------- Storage Yardımcıları -------------------- */

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

  function removeStorageValue(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], () => {
        resolve(true);
      });
    });
  }

  /* -------------------- ID / Session -------------------- */

  function createId(prefix = "session") {
    if (window.crypto?.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function createSession() {
    return {
      id: createId("session"),
      startedAt: new Date().toISOString(),
      startPageUrl: window.location.href,
      startPageTitle: document.title,
      lastPageUrl: window.location.href,
      lastPageTitle: document.title
    };
  }

  async function getActiveSession() {
    const session = await getStorageValue(ACTIVE_SESSION_KEY, null);

    if (!session || !session.id) {
      return null;
    }

    return session;
  }

  async function getActiveSessionId() {
    const session = await getActiveSession();
    return session?.id || null;
  }

  async function startSession(options = {}) {
    const { forceNew = false } = options;

    if (!forceNew) {
      const existingSession = await getActiveSession();

      if (existingSession) {
        await setStorageValue(SESSION_ENABLED_KEY, true);
        return existingSession;
      }
    }

    const session = createSession();

    await setStorageValue(ACTIVE_SESSION_KEY, session);
    await setStorageValue(SESSION_ENABLED_KEY, true);

    return session;
  }

  async function ensureActiveSession() {
    const existingSession = await getActiveSession();

    if (existingSession) {
      await updateActiveSession();
      await setStorageValue(SESSION_ENABLED_KEY, true);
      return existingSession;
    }

    return await startSession();
  }

  async function updateActiveSession(updates = {}) {
    const session = await getActiveSession();

    if (!session) {
      return null;
    }

    const updatedSession = {
      ...session,
      ...updates,
      lastPageUrl: window.location.href,
      lastPageTitle: document.title,
      updatedAt: new Date().toISOString()
    };

    await setStorageValue(ACTIVE_SESSION_KEY, updatedSession);

    return updatedSession;
  }

  async function endActiveSession() {
    await removeStorageValue(ACTIVE_SESSION_KEY);
    await setStorageValue(SESSION_ENABLED_KEY, false);

    return true;
  }

  async function isSessionActive() {
    const session = await getActiveSession();
    return Boolean(session?.id);
  }

  /* -------------------- Chat Mesajları -------------------- */

  async function getAllChatSessions() {
    const allSessions = await getStorageValue(CHAT_MESSAGES_KEY, {});

    if (!allSessions || typeof allSessions !== "object" || Array.isArray(allSessions)) {
      return {};
    }

    return allSessions;
  }

  async function getChatSession(sessionId = null) {
    const targetSessionId = sessionId || await getActiveSessionId();

    if (!targetSessionId) {
      return [];
    }

    const allSessions = await getAllChatSessions();
    const messages = allSessions[targetSessionId];

    return Array.isArray(messages) ? messages : [];
  }

  async function saveChatSession(messages, sessionId = null) {
    const targetSessionId = sessionId || await getActiveSessionId();

    if (!targetSessionId) {
      return [];
    }

    const allSessions = await getAllChatSessions();

    allSessions[targetSessionId] = Array.isArray(messages) ? messages : [];

    await setStorageValue(CHAT_MESSAGES_KEY, allSessions);

    return allSessions[targetSessionId];
  }

  async function addMessageToSession(role, content) {
    const session = await ensureActiveSession();
    const messages = await getChatSession(session.id);

    const message = {
      id: createId("message"),
      sessionId: session.id,
      role: role === "user" ? "user" : "assistant",
      content: String(content || ""),
      pageUrl: window.location.href,
      pageTitle: document.title,
      createdAt: new Date().toISOString()
    };

    messages.push(message);

    await saveChatSession(messages, session.id);
    await updateActiveSession();

    return message;
  }

  async function clearChatSession(sessionId = null) {
    const targetSessionId = sessionId || await getActiveSessionId();

    if (!targetSessionId) {
      return true;
    }

    const allSessions = await getAllChatSessions();

    delete allSessions[targetSessionId];

    await setStorageValue(CHAT_MESSAGES_KEY, allSessions);

    return true;
  }

  async function getLastMessages(limit = 12, sessionId = null) {
    const messages = await getChatSession(sessionId);
    return messages.slice(-limit);
  }

  /* -------------------- Dış API -------------------- */

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