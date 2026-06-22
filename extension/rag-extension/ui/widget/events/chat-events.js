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
 * - Sohbet temizleme işlemini yönetir.
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

      return await window.AdaptiveRagSessionStore.addMessageToSession(role, content);
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

  function buildSourcesText(sources) {
    if (!Array.isArray(sources) || sources.length === 0) {
      return "";
    }

    const seen = new Set();
    const lines = [];

    sources.forEach((source, index) => {
      const title =
        source.title ||
        source.page_title ||
        source.source_title ||
        `Kaynak ${index + 1}`;

      const url =
        source.url ||
        source.page_url ||
        source.source_url ||
        "";

      const key = `${title}__${url}`;

      if (seen.has(key)) {
        return;
      }

      seen.add(key);

      if (url) {
        lines.push(`- ${title}\n  ${url}`);
      } else {
        lines.push(`- ${title}`);
      }
    });

    if (lines.length === 0) {
      return "";
    }

    return `\n\nKullanılan kaynaklar:\n${lines.join("\n")}`;
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

    const sourcesText = buildSourcesText(result.sources || []);

    if (result.status && result.status !== "success") {
      const answer = result.answer || "Cevap üretilirken bir sorun oluştu.";
      const errorText = result.error
        ? `\n\nTeknik hata:\n${result.error}`
        : "";

      return `${answer}${errorText}${sourcesText}`;
    }

    const answer = result.answer || "Cevap üretilemedi.";

    return `${answer}${sourcesText}`;
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
      const answer = formatChatResult(result);

      await addMessage("assistant", answer);
      await refreshIfPossible(refreshWidget);
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