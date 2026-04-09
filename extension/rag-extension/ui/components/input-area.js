export function createInputArea() {
  const wrapper = document.createElement("section");
  wrapper.className = "input-wrapper";

  wrapper.innerHTML = `
    <div class="input-topbar">
      <span class="input-label">Sorunu yaz</span>
      <span class="counter" id="char-counter">0 / 2000</span>
    </div>

    <textarea
      id="prompt-input"
      class="input-box"
      placeholder="Bu sayfa hakkında soru sor veya içeriği özetle..."
      maxlength="2000"
    ></textarea>

    <div class="action-row">
      <div class="action-group">
        <button id="attach-page-btn" class="secondary-btn" type="button">Sayfayı ekle</button>
      </div>

      <div class="action-group">
        <button id="send-btn" class="primary-btn" type="button">Gönder</button>
      </div>
    </div>

    <div class="status-bar">
      <span class="badge">
        <span class="dot"></span>
        Hazır
      </span>
      <span id="page-status">Sayfa bağlamı eklenmedi</span>
    </div>
  `;

  return wrapper;
}