/**
 * Dosya: chat-tab.js
 *
 * Görev:
 * - Chat sekmesinin HTML içeriğini üretir.
 * - Chat mesajlarını session-store.js üzerinden okur.
 * - Mesajları ekrana basar.
 *
 * Not:
 * - Mesaj gönderme, backend isteği ve event yönetimi chat-events.js içindedir.
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

  function bindChatEvents(refreshWidget) {
    if (!window.AdaptiveRagChatEvents?.bindChatEvents) {
      console.warn("[CHAT TAB] chat-events.js yüklenmemiş veya bindChatEvents bulunamadı.");
      return;
    }

    window.AdaptiveRagChatEvents.bindChatEvents(refreshWidget);
  }

  window.AdaptiveRagChatTab = {
    __tabName: "chat-tab",

    renderChatTab,
    bindChatEvents
  };
})();