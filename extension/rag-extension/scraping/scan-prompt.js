/**
 * Dosya: scan-prompt.js
 *
 * Görev:
 * - Manuel tarama modunda sağ yanda "Bu sayfayı tara?" kartını gösterir.
 * - Kart üzerindeki "Sayfayı tara" butonu ile content.js içindeki tarama akışını başlatır.
 * - Kart üzerindeki çarpı butonu ile kartı kapatır.
 */

(function () {
  if (window.AdaptiveRagScanPrompt?.__moduleName === "scan-prompt") {
    return;
  }

  const PROMPT_ID = "adaptive-rag-scan-prompt";
  const STYLE_ID = "adaptive-rag-scan-prompt-style";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;

    style.textContent = `
      #${PROMPT_ID} {
        position: fixed;
        right: 24px;
        top: 110px;
        width: 290px;
        z-index: 2147483646;
        border-radius: 18px;
        background: #ffffff;
        color: #161616;
        font-family: Arial, sans-serif;
        box-shadow: 0 18px 45px rgba(0, 0, 0, 0.18);
        border: 1px solid rgba(0, 0, 0, 0.08);
        overflow: hidden;
      }

      #${PROMPT_ID} * {
        box-sizing: border-box;
      }

      .rag-scan-prompt-inner {
        padding: 14px;
      }

      .rag-scan-prompt-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }

      .rag-scan-prompt-label {
        display: block;
        margin-bottom: 5px;
        font-size: 11px;
        font-weight: 700;
        color: #ff001f;
      }

      .rag-scan-prompt-title {
        margin: 0;
        font-size: 15px;
        font-weight: 800;
        line-height: 1.3;
      }

      .rag-scan-prompt-desc {
        margin: 8px 0 0;
        font-size: 12px;
        line-height: 1.45;
        color: #555;
      }

      .rag-scan-prompt-close {
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 9px;
        background: #f3f3f3;
        color: #333;
        font-size: 20px;
        cursor: pointer;
        flex-shrink: 0;
      }

      .rag-scan-prompt-close:hover {
        background: #eeeeee;
      }

      .rag-scan-prompt-actions {
        margin-top: 12px;
      }

      .rag-scan-prompt-scan {
        width: 100%;
        border: none;
        border-radius: 999px;
        padding: 10px 12px;
        font-size: 12px;
        font-weight: 800;
        color: #ffffff;
        background: linear-gradient(135deg, #ff001f 0%, #eea7ff 100%);
        cursor: pointer;
      }

      .rag-scan-prompt-scan:disabled {
        opacity: 0.65;
        cursor: not-allowed;
      }

      .rag-scan-prompt-status {
        margin-top: 9px;
        font-size: 11px;
        color: #666;
      }
    `;

    document.head.appendChild(style);
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getShortTitle() {
    const title = document.title || "Başlıksız sayfa";

    if (title.length <= 78) {
      return title;
    }

    return `${title.slice(0, 78)}...`;
  }

  function hideScanPrompt() {
    document.getElementById(PROMPT_ID)?.remove();
  }

  function showScanPrompt(options = {}) {
    const { onScan, onClose } = options;

    hideScanPrompt();
    injectStyles();

    const prompt = document.createElement("div");
    prompt.id = PROMPT_ID;

    prompt.innerHTML = `
      <div class="rag-scan-prompt-inner">
        <div class="rag-scan-prompt-top">
          <div>
            <span class="rag-scan-prompt-label">Adaptive RAG</span>

            <h3 class="rag-scan-prompt-title">
              Bu sayfayı tara?
            </h3>

            <p class="rag-scan-prompt-desc">
              ${escapeHtml(getShortTitle())} sayfasını araştırma hafızana ekleyebilirsin.
            </p>
          </div>

          <button
            type="button"
            class="rag-scan-prompt-close"
            id="ragScanPromptClose"
            aria-label="Tarama kartını kapat"
          >
            ×
          </button>
        </div>

        <div class="rag-scan-prompt-actions">
          <button
            type="button"
            class="rag-scan-prompt-scan"
            id="ragScanPromptScan"
          >
            Sayfayı tara
          </button>
        </div>

        <div class="rag-scan-prompt-status" id="ragScanPromptStatus">
          Elle tarama modu aktif.
        </div>
      </div>
    `;

    document.body.appendChild(prompt);

    document.getElementById("ragScanPromptClose")?.addEventListener("click", () => {
      hideScanPrompt();

      if (typeof onClose === "function") {
        onClose();
      }
    });

    document.getElementById("ragScanPromptScan")?.addEventListener("click", async () => {
      const scanButton = document.getElementById("ragScanPromptScan");
      const status = document.getElementById("ragScanPromptStatus");

      try {
        scanButton.disabled = true;
        scanButton.textContent = "Taranıyor...";

        if (status) {
          status.textContent = "Sayfa içeriği hazırlanıyor.";
        }

        if (typeof onScan === "function") {
          await onScan();
        }

        scanButton.textContent = "Tarandı";

        if (status) {
          status.textContent = "Sayfa araştırma hafızasına eklendi.";
        }

        setTimeout(() => {
          hideScanPrompt();
        }, 1000);
      } catch (error) {
        scanButton.disabled = false;
        scanButton.textContent = "Tekrar dene";

        if (status) {
          status.textContent = error.message || "Tarama sırasında hata oluştu.";
        }
      }
    });
  }

  window.AdaptiveRagScanPrompt = {
    __moduleName: "scan-prompt",

    showScanPrompt,
    hideScanPrompt
  };
})();