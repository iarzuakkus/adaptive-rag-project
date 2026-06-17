/**
 * Dosya: chat-tab.js
 *
 * Görev:
 * - Chat sekmesinin HTML içeriğini üretir.
 * - Chat mesajlarını session-store.js üzerinden okur.
 * - Kullanıcı mesajını session-store.js içine kaydeder.
 * - Şimdilik backend yerine test cevabı üretir.
 */

(function () {
  if (window.AdaptiveRagChatTab?.__tabName === "chat-tab") {
    return;
  }

  function escapeHtml(text) {
    if (window.AdaptiveRagState?.escapeHtml) {
      return window.AdaptiveRagState.escapeHtml(text);
    }

    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

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

  async function getMessages() {
    try {
      if (!window.AdaptiveRagSessionStore?.getChatSession) {
        return [];
      }

      const messages = await window.AdaptiveRagSessionStore.getChatSession();

      return Array.isArray(messages) ? messages : [];
    } catch (error) {
      console.warn("[CHAT TAB] Mesajlar alınamadı:", error);
      return [];
    }
  }

  async function addMessage(role, content) {
    try {
      if (!window.AdaptiveRagSessionStore?.addMessageToSession) {
        return null;
      }

      return await window.AdaptiveRagSessionStore.addMessageToSession(role, content);
    } catch (error) {
      console.warn("[CHAT TAB] Mesaj kaydedilemedi:", error);
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
      console.warn("[CHAT TAB] Sohbet temizlenemedi:", error);
      return false;
    }
  }

  async function getAssistantAnswer(question) {
    return `Test cevabı: "${question}" sorusu alındı. Backend RAG bağlantısı sonraki adımda bağlanacak.`;
  }

  function renderMessage(message) {
    const role = message.role === "user" ? "user" : "assistant";
    const label = role === "user" ? "Sen" : "Adaptive RAG";

    return `
      <article class="rag-message ${role}">
        <div class="rag-message-label">${escapeHtml(label)}</div>
        <div class="rag-message-content">${escapeHtml(message.content)}</div>
      </article>
    `;
  }

  async function renderChatTab() {
    const messages = await getMessages();

    const messagesHtml = messages.length
      ? messages.map(renderMessage).join("")
      : `
        <div class="rag-empty-state">
          <strong>Henüz sohbet yok.</strong>
          <span>Bu sayfa veya taradığın kaynaklar hakkında soru sorabilirsin.</span>
        </div>
      `;

    return `
      <div class="rag-chat-layout">
        <div id="ragChatMessages" class="rag-chat-messages">
          ${messagesHtml}
        </div>

        <div class="rag-chat-input-area">
          <textarea
            id="ragChatInput"
            class="rag-chat-input"
            placeholder="Bu sayfa hakkında soru sor..."
            rows="1"
          ></textarea>

          <button id="ragChatSendBtn" class="rag-primary-btn" type="button">
            Gönder
          </button>
        </div>

        <button id="ragClearChatBtn" class="rag-ghost-btn" type="button">
          Sohbeti temizle
        </button>
      </div>
    `;
  }

  function scrollToBottom() {
    const messages = document.getElementById("ragChatMessages");

    if (messages) {
      messages.scrollTop = messages.scrollHeight;
    }
  }

  function setInputDisabled(isDisabled) {
    const input = document.getElementById("ragChatInput");
    const sendBtn = document.getElementById("ragChatSendBtn");

    if (input) {
      input.disabled = isDisabled;
    }

    if (sendBtn) {
      sendBtn.disabled = isDisabled;
      sendBtn.textContent = isDisabled ? "Bekle" : "Gönder";
    }
  }

  async function handleSendMessage(refreshWidget) {
    const input = document.getElementById("ragChatInput");
    const question = input?.value?.trim();

    if (!question) {
      return;
    }

    input.value = "";
    autoResizeTextarea(input);
    setInputDisabled(true);

    await addMessage("user", question);

    if (typeof refreshWidget === "function") {
      await refreshWidget();
    }

    const answer = await getAssistantAnswer(question);

    await addMessage("assistant", answer);

    if (typeof refreshWidget === "function") {
      await refreshWidget();
    }

    setInputDisabled(false);
  }

  function bindChatEvents(refreshWidget) {
    const input = document.getElementById("ragChatInput");
    const sendBtn = document.getElementById("ragChatSendBtn");
    const clearBtn = document.getElementById("ragClearChatBtn");

    scrollToBottom();

    sendBtn?.addEventListener("click", async () => {
      await handleSendMessage(refreshWidget);
    });

    input?.addEventListener("keydown", async (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        await handleSendMessage(refreshWidget);
      }
    });

    input?.addEventListener("input", () => {
      autoResizeTextarea(input);
    });

    clearBtn?.addEventListener("click", async () => {
      await clearMessages();

      if (typeof refreshWidget === "function") {
        await refreshWidget();
      }
    });
  }

  window.AdaptiveRagChatTab = {
    __tabName: "chat-tab",

    renderChatTab,
    bindChatEvents
  };
})();