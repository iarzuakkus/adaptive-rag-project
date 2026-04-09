export function createHeader() {
  const header = document.createElement("header");
  header.className = "header";

  header.innerHTML = `
    <div class="brand">
      <div class="logo-box" aria-hidden="true">
        <svg class="logo-svg" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3L19 7V17L12 21L5 17V7L12 3Z"
            fill="white"
            fill-opacity="0.95"
          />
          <path
            d="M9 10.5C9 8.84315 10.3431 7.5 12 7.5C13.6569 7.5 15 8.84315 15 10.5C15 12.1569 13.6569 13.5 12 13.5C10.3431 13.5 9 12.1569 9 10.5Z"
            fill="url(#innerGradient)"
          />
          <defs>
            <linearGradient id="innerGradient" x1="9" y1="7.5" x2="15" y2="13.5" gradientUnits="userSpaceOnUse">
              <stop stop-color="#ff001f" />
              <stop offset="1" stop-color="#eea7ff" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      <div class="brand-text">
        <h1 class="brand-title">Adaptive RAG</h1>
        <p class="brand-subtitle">Akıllı bağlam destekli asistan</p>
      </div>
    </div>

    <div class="header-actions">
      <button class="icon-btn" id="clear-chat-btn" title="Sohbeti temizle">×</button>
    </div>
  `;

  return header;
}