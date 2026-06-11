(function () {
  function renderChatTab() {
    return `
      <section class="rag-section">
        <div class="rag-chat-placeholder">
          <h3>Sayfa bazlı soru-cevap</h3>
          <p>
            Burada kullanıcı taranan sayfalar üzerinden soru soracak.
            Sonraki aşamada bu alan backend RAG pipeline ile bağlanacak.
          </p>
        </div>

        <div class="rag-answer-card">
          <span class="rag-small-label">Örnek kaynaklı cevap</span>

          <p>
            Adaptive RAG, taranan sayfalardan alınan chunk'ları kullanarak
            kullanıcının sorusuna bağlamlı cevap üretir.
          </p>

          <div class="rag-answer-actions">
            <button>Nota dönüştür</button>
            <button>Alıntı yap</button>
          </div>
        </div>

        <div class="rag-chat-input">
          <input type="text" placeholder="Bu sayfa hakkında soru sor..." />
          <button>Gönder</button>
        </div>
      </section>
    `;
  }

  window.AdaptiveRagChatTab = {
    renderChatTab
  };
})();