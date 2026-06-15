/**
 * Dosya: scan-prompt.js
 *
 * Görev:
 * - Sayfaya girildiğinde sağ yandan çıkan küçük tarama öneri kartını oluşturur.
 * - Kullanıcıya “Bu sayfayı tara?” seçeneği sunar.
 * - Tik butonu ile taramayı başlatır.
 * - Çarpı butonu ile öneri kartını kapatır.
 *
 * Not:
 * - Bu kart ana widget değildir.
 * - Sadece sayfa tarama önerisi için küçük ve bağımsız bir UI bileşenidir.
 */

(function () {
  const SCAN_PROMPT_ID = "adaptive-rag-scan-prompt";
  const SCAN_PROMPT_STYLE_ID = "adaptive-rag-scan-prompt-style";

  /**
   * Tarama öneri kartı için gerekli CSS'i sayfaya ekler.
   */
  function injectScanPromptStyles() {
    if (document.getElementById(SCAN_PROMPT_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = SCAN_PROMPT_STYLE_ID;

    style.textContent = `
      #${SCAN_PROMPT_ID} {
        position: fixed;
        right: 24px;
        top: 110px;
        width: 292px;
        z-index: 999998;
        border-radius: 18px;
        overflow: hidden;
        color: #ffffff;
        font-family: Inter, Arial, sans-serif;
        background:
          radial-gradient(circle at top left, rgba(255, 0, 31, 0.28), transparent 38%),
          radial-gradient(circle at bottom right, rgba(238, 167, 255, 0.24), transparent 38%),
          linear-gradient(145deg, #09090d 0%, #14141c 100%);
        border: 1px solid rgba(238, 167, 255, 0.28);
        box-shadow:
          0 20px 60px rgba(0, 0, 0, 0.45),
          0 0 28px rgba(255, 0, 31, 0.14),
          0 0 30px rgba(238, 167, 255, 0.12);
        animation: adaptiveRagPromptIn 0.25s ease;
      }

      @keyframes adaptiveRagPromptIn {
        from {
          opacity: 0;
          transform: translateX(20px);
        }

        to {
          opacity: 1;
          transform: translateX(0);
        }
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

      .rag-scan-prompt-kicker {
        display: block;
        margin-bottom: 4px;
        font-size: 11px;
        font-weight: 800;
        color: #eea7ff;
      }

      .rag-scan-prompt-title {
        margin: 0;
        font-size: 15px;
        font-weight: 850;
        line-height: 1.25;
        color: #ffffff;
      }

      .rag-scan-prompt-desc {
        margin: 8px 0 0;
        font-size: 12px;
        line-height: 1.45;
        color: rgba(255, 255, 255, 0.68);
      }

      .rag-scan-prompt-close {
        width: 30px;
        height: 30px;
        border: 1px solid rgba(238, 167, 255, 0.22);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.06);
        color: #ffffff;
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
        flex-shrink: 0;
      }

      .rag-scan-prompt-close:hover {
        background: rgba(255, 0, 31, 0.18);
      }

      .rag-scan-prompt-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }

      .rag-scan-prompt-scan {
        flex: 1;
        border: none;
        border-radius: 999px;
        padding: 9px 12px;
        font-size: 12px;
        font-weight: 850;
        color: #ffffff;
        background: linear-gradient(135deg, #ff001f 0%, #eea7ff 100%);
        box-shadow:
          0 10px 24px rgba(255, 0, 31, 0.22),
          0 0 18px rgba(238, 167, 255, 0.14);
        cursor: pointer;
      }

      .rag-scan-prompt-scan:hover {
        filter: brightness(1.06);
      }

      .rag-scan-prompt-status {
        margin-top: 10px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.62);
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Sayfa başlığını küçük kart içinde taşmayacak şekilde kısaltır.
   */
  function getShortPageTitle() {
    const title = document.title || "Başlıksız sayfa";

    if (title.length <= 80) {
      return title;
    }

    return `${title.slice(0, 80)}...`;
  }

  /**
   * Tarama öneri kartını sayfaya ekler.
   */
  function showScanPrompt({ onScan, onClose }) {
    const existingPrompt = document.getElementById(SCAN_PROMPT_ID);

    if (existingPrompt) {
      existingPrompt.remove();
    }

    injectScanPromptStyles();

    const prompt = document.createElement("div");
    prompt.id = SCAN_PROMPT_ID;

    prompt.innerHTML = `
      <div class="rag-scan-prompt-inner">
        <div class="rag-scan-prompt-top">
          <div>
            <span class="rag-scan-prompt-kicker">Adaptive RAG</span>
            <h3 class="rag-scan-prompt-title">Bu sayfayı tara?</h3>
            <p class="rag-scan-prompt-desc">
              ${getShortPageTitle()} sayfasını araştırma hafızana ekleyebilirsin.
            </p>
          </div>

          <button
            type="button"
            class="rag-scan-prompt-close"
            id="ragScanPromptClose"
            aria-label="Tarama önerisini kapat"
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
      prompt.remove();

      if (typeof onClose === "function") {
        onClose();
      }
    });

    document.getElementById("ragScanPromptScan")?.addEventListener("click", async () => {
      const scanButton = document.getElementById("ragScanPromptScan");
      const status = document.getElementById("ragScanPromptStatus");

      scanButton.disabled = true;
      scanButton.textContent = "Taranıyor...";
      status.textContent = "Sayfa içeriği hazırlanıyor.";

      try {
        if (typeof onScan === "function") {
          await onScan();
        }

        scanButton.textContent = "Tarandı";
        status.textContent = "Sayfa başarıyla araştırma hafızasına eklendi.";

        setTimeout(() => {
          prompt.remove();
        }, 1200);
      } catch (error) {
        scanButton.disabled = false;
        scanButton.textContent = "Tekrar dene";
        status.textContent = error.message || "Tarama sırasında hata oluştu.";
      }
    });
  }

  /**
   * Tarama öneri kartını dışarıdan kapatmak için kullanılır.
   */
  function hideScanPrompt() {
    document.getElementById(SCAN_PROMPT_ID)?.remove();
  }

  window.AdaptiveRagScanPrompt = {
    showScanPrompt,
    hideScanPrompt
  };
})();