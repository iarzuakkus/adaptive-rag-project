/**
 * Dosya: chat-events.js
 *
 * Görev:
 * - Chat sekmesindeki kullanıcı etkileşimlerini yönetir.
 * - Kullanıcı mesajını session-store.js içine kaydeder.
 * - Backend /chat endpoint'ine soruyu background.js üzerinden gönderir.
 * - Aktif sayfa bilgisini otomatik olarak backend'e yollar:
 *   page_url, page_title, scope, top_k.
 * - Assistant cevabını session-store.js içine kaydeder.
 * - Backend'den gelen son chunks bilgisini sayfa üzerinde highlight için geçici olarak saklar.
 * - LLM tarafından kaynak gösterme niyeti algılanırsa son cevabın ilk/en alakalı chunk'ını sayfada gösterir.
 * - Sohbet temizleme işlemini yönetir.
 *
 * Not:
 * - Session yapısı bozulmaz.
 * - addMessageToSession yine role + string content ile çağrılır.
 * - Chunk bilgileri şimdilik window.AdaptiveRagLastChatChunks içinde tutulur.
 * - Chat cevabına kaynak listesi veya URL eklenmez.
 * - Kaynaklar backend response içinde structured olarak kalır.
 */

(function () {
  if (window.AdaptiveRagChatEvents?.__moduleName === "chat-events") {
    return;
  }

  const BOUND_KEY = "data-rag-chat-events-bound";

  function autoResizeTextarea(element) {
    if (window.AdaptiveRagState?.autoResizeTextarea) {
      window.AdaptiveRagState.autoResizeTextarea(element);
      return;
    }

    if (!element) {
      return;
    }

    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 130)}px`;
  }

  function getChatElements() {
    return {
      messages: document.getElementById("ragChatMessages"),
      input: document.getElementById("ragChatInput"),
      sendBtn: document.getElementById("ragChatSendBtn"),
      clearBtn: document.getElementById("ragClearChatBtn")
    };
  }

  function scrollToBottom() {
    const messages = document.getElementById("ragChatMessages");

    if (messages) {
      messages.scrollTop = messages.scrollHeight;
    }
  }

  function setInputDisabled(isDisabled) {
    const { input, sendBtn } = getChatElements();

    if (input) {
      input.disabled = isDisabled;
    }

    if (sendBtn) {
      sendBtn.disabled = isDisabled;
      sendBtn.textContent = isDisabled ? "Bekle" : "Gönder";
    }
  }

  async function refreshIfPossible(refreshWidget) {
    if (typeof refreshWidget === "function") {
      await refreshWidget();
    }
  }

  async function addMessage(role, content) {
    try {
      if (!window.AdaptiveRagSessionStore?.addMessageToSession) {
        return null;
      }

      return await window.AdaptiveRagSessionStore.addMessageToSession(
        role,
        String(content || "")
      );
    } catch (error) {
      console.warn("[CHAT EVENTS] Mesaj kaydedilemedi:", error);
      return null;
    }
  }

  async function clearMessages() {
    try {
      if (window.AdaptiveRagSessionStore?.clearChatSession) {
        await window.AdaptiveRagSessionStore.clearChatSession();
      }

      clearLastChatHighlightData();

      return true;
    } catch (error) {
      console.warn("[CHAT EVENTS] Sohbet temizlenemedi:", error);
      return false;
    }
  }

  function getCurrentPageContext() {
    return {
      page_url: window.location.href,
      page_title: document.title,
      scope: "auto",
      top_k: 5
    };
  }

  function sendMessageToBackground(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const runtimeError = chrome.runtime.lastError;

          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }

          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function clearLastChatHighlightData() {
    window.AdaptiveRagLastChatChunks = [];
    window.AdaptiveRagLastChatResult = null;
  }

  function getResultChunks(result) {
    return Array.isArray(result?.chunks) ? result.chunks : [];
  }

  function getSavedChunks() {
    return Array.isArray(window.AdaptiveRagLastChatChunks)
      ? window.AdaptiveRagLastChatChunks
      : [];
  }

  function getPrimaryChunk(chunks) {
    if (!Array.isArray(chunks) || !chunks.length) {
      return null;
    }

    const primaryChunk = chunks.find((chunk) => {
      return chunk?.is_primary_chunk === true;
    });

    return primaryChunk || chunks[0];
  }

  function saveLastChatHighlightData(result, question, options = {}) {
    const preserveExistingChunks = options.preserveExistingChunks === true;
    const resultChunks = getResultChunks(result);
    const previousChunks = getSavedChunks();

    const chunks =
      preserveExistingChunks && resultChunks.length === 0
        ? previousChunks
        : resultChunks;

    window.AdaptiveRagLastChatChunks = chunks;

    window.AdaptiveRagLastChatResult = {
      question,
      answer: result?.answer || "",
      chunks,
      sources: Array.isArray(result?.sources) ? result.sources : [],
      actions: Array.isArray(result?.actions) ? result.actions : [],
      status: result?.status || "success",
      answerType: result?.answer_type || result?.answerType || "short",
      sourceCount:
        typeof result?.source_count === "number"
          ? result.source_count
          : 0,
      createdAt: new Date().toISOString()
    };

    console.log("[CHAT EVENTS] Son chat highlight verisi kaydedildi:", {
      chunkCount: chunks.length,
      preserveExistingChunks
    });

    window.dispatchEvent(
      new CustomEvent("adaptive-rag-last-chat-chunks-updated", {
        detail: {
          chunks,
          result: window.AdaptiveRagLastChatResult
        }
      })
    );
  }

  function getActionType(action) {
    return String(
      action?.type ||
      action?.action_type ||
      action?.name ||
      ""
    ).trim().toLowerCase();
  }

  function getIntentValue(result) {
    if (!result) {
      return "";
    }

    if (typeof result.intent === "string") {
      return result.intent.trim().toLowerCase();
    }

    if (typeof result.intent === "object" && result.intent !== null) {
      return String(result.intent.intent || "").trim().toLowerCase();
    }

    return "";
  }

  function isSourceNavigationResult(result) {
    const answerType = String(
      result?.answer_type ||
      result?.answerType ||
      ""
    ).trim().toLowerCase();

    const status = String(result?.status || "").trim().toLowerCase();
    const intent = getIntentValue(result);

    const navigationTypes = new Set([
      "source_navigation",
      "source_request",
      "show_source",
      "show_answer_source",
      "page_highlight",
      "highlight_source"
    ]);

    if (
      navigationTypes.has(answerType) ||
      navigationTypes.has(status) ||
      navigationTypes.has(intent)
    ) {
      return true;
    }

    const actions = Array.isArray(result?.actions) ? result.actions : [];

    return actions.some((action) => {
      const actionType = getActionType(action);

      return [
        "auto_highlight_page",
        "show_answer_source",
        "source_navigation",
        "highlight_answer_source"
      ].includes(actionType);
    });
  }

  async function highlightPrimaryChunkOnPage(chunks) {
    const primaryChunk = getPrimaryChunk(chunks);

    if (!primaryChunk) {
      return false;
    }

    const safeChunks = [primaryChunk];

    if (window.AdaptiveRagHighlightEvents?.highlightChunksOnPage) {
      return await window.AdaptiveRagHighlightEvents.highlightChunksOnPage(safeChunks);
    }

    window.dispatchEvent(
      new CustomEvent("adaptive-rag-highlight-page-chunks", {
        detail: {
          chunks: safeChunks
        }
      })
    );

    return true;
  }

  async function requestChatAnswer(question) {
    const pageContext = getCurrentPageContext();

    const payload = {
      question,
      page_url: pageContext.page_url,
      page_title: pageContext.page_title,
      scope: pageContext.scope,
      top_k: pageContext.top_k
    };

    console.log("[CHAT EVENTS] Background /chat payload:", payload);

    const response = await sendMessageToBackground({
      type: "CHAT_QUESTION",
      payload
    });

    console.log("[CHAT EVENTS] Background /chat response:", response);

    if (!response) {
      throw new Error("Background cevap döndürmedi.");
    }

    if (!response.success) {
      throw new Error(
        response.message || "Background üzerinden chat isteği başarısız oldu."
      );
    }

    return response.data;
  }

  function formatChatResult(result) {
    if (!result) {
      return "Backend cevap döndürmedi.";
    }

    if (result.status && result.status !== "success") {
      const answer = result.answer || "Cevap üretilirken bir sorun oluştu.";
      const errorText = result.error
        ? `\n\nTeknik hata:\n${result.error}`
        : "";

      return `${answer}${errorText}`;
    }

    return result.answer || "Cevap üretilemedi.";
  }

  function formatSourceNavigationAnswer(result) {
    const answer = String(result?.answer || "").trim();

    if (answer) {
      return answer;
    }

    return "Tabii, son cevabın geçtiği bölümü sayfada gösteriyorum.";
  }

  async function handleSourceNavigationResult(result, question, refreshWidget) {
    const resultChunks = getResultChunks(result);
    const previousChunks = getSavedChunks();

    const chunks = resultChunks.length > 0
      ? resultChunks
      : previousChunks;

    saveLastChatHighlightData(result, question, {
      preserveExistingChunks: true
    });

    await addMessage("assistant", formatSourceNavigationAnswer(result));
    await refreshIfPossible(refreshWidget);

    const highlighted = await highlightPrimaryChunkOnPage(chunks);

    if (!highlighted) {
      console.warn("[CHAT EVENTS] Kaynak yönlendirme için highlight başarısız.");
    }
  }

  async function handleNormalChatResult(result, question, refreshWidget) {
    const answer = formatChatResult(result);

    saveLastChatHighlightData(result, question);

    await addMessage("assistant", answer);
    await refreshIfPossible(refreshWidget);
  }

  async function handleSendMessage(refreshWidget) {
    const { input } = getChatElements();
    const question = input?.value?.trim();

    if (!question) {
      return;
    }

    input.value = "";
    autoResizeTextarea(input);
    setInputDisabled(true);

    try {
      await addMessage("user", question);
      await refreshIfPossible(refreshWidget);

      const result = await requestChatAnswer(question);

      if (isSourceNavigationResult(result)) {
        await handleSourceNavigationResult(result, question, refreshWidget);
      } else {
        await handleNormalChatResult(result, question, refreshWidget);
      }
    } catch (error) {
      console.error("[CHAT EVENTS] Backend chat hatası:", error);

      await addMessage(
        "assistant",
        `Backend chat isteği sırasında hata oluştu: ${error.message}`
      );

      await refreshIfPossible(refreshWidget);
    } finally {
      setInputDisabled(false);
      scrollToBottom();

      const newInput = document.getElementById("ragChatInput");

      if (newInput) {
        newInput.focus();
      }
    }
  }

  async function handleClearChat(refreshWidget) {
    await clearMessages();
    await refreshIfPossible(refreshWidget);
  }

  function bindChatEvents(refreshWidget) {
    const {
      input,
      sendBtn,
      clearBtn
    } = getChatElements();

    scrollToBottom();

    if (!input || !sendBtn) {
      console.warn("[CHAT EVENTS] Chat input veya gönder butonu bulunamadı.");
      return;
    }

    if (sendBtn.getAttribute(BOUND_KEY) === "true") {
      return;
    }

    sendBtn.addEventListener("click", async () => {
      await handleSendMessage(refreshWidget);
    });

    input.addEventListener("keydown", async (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        await handleSendMessage(refreshWidget);
      }
    });

    input.addEventListener("input", () => {
      autoResizeTextarea(input);
    });

    clearBtn?.addEventListener("click", async () => {
      await handleClearChat(refreshWidget);
    });

    sendBtn.setAttribute(BOUND_KEY, "true");
  }

  window.AdaptiveRagChatEvents = {
    __moduleName: "chat-events",

    bindChatEvents
  };
})();