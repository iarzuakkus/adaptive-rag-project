/**
 * Dosya: widget.js
 *
 * Görev:
 * - Sağ alttaki Adaptive RAG baloncuk launcher'ını oluşturur.
 * - Ana widget panelini açıp kapatır.
 * - Chat, Kaynaklar ve Notlar sekmeleri arasında geçişi yönetir.
 * - Chat mesajlarını session-store.js üzerinden saklar.
 * - Taranan kaynakları ve notları research-store.js üzerinden okur.
 *
 * Önemli:
 * - Widget panelini X ile kapatmak session'ı silmez.
 * - Launcher'a tıklayıp paneli kapatmak session'ı silmez.
 * - Session ve research verisi sayfa yenilense bile korunur.
 */

(function () {
  if (window.AdaptiveRagWidget?.__widgetName === "adaptive-rag-main-widget") {
    return;
  }

  const WIDGET_ID = "adaptive-rag-widget";
  const LAUNCHER_ID = "adaptive-rag-launcher";

  let activeTab = "chat";

  async function ensureSessionReady() {
    if (!window.AdaptiveRagSessionStore?.ensureActiveSession) {
      console.warn("[WIDGET] AdaptiveRagSessionStore bulunamadı.");
      return null;
    }

    return await window.AdaptiveRagSessionStore.ensureActiveSession();
  }

  async function ensureResearchReady() {
    if (!window.AdaptiveRagStore?.initResearchSession) {
      console.warn("[WIDGET] AdaptiveRagStore bulunamadı.");
      return null;
    }

    return await window.AdaptiveRagStore.initResearchSession();
  }

  async function prepareWidgetSession() {
    await ensureSessionReady();
    await ensureResearchReady();
  }

  async function createLauncher() {
    const existingLauncher = document.getElementById(LAUNCHER_ID);

    if (existingLauncher) {
      await prepareWidgetSession();
      return;
    }

    await prepareWidgetSession();

    const logoUrl = chrome.runtime.getURL("assets/logo.svg");

    const launcher = document.createElement("button");
    launcher.id = LAUNCHER_ID;
    launcher.className = "rag-launcher";
    launcher.type = "button";
    launcher.setAttribute("aria-label", "Adaptive RAG widget aç veya kapat");

    launcher.innerHTML = `
      <img
        src="${logoUrl}"
        alt="Adaptive RAG Logo"
        class="rag-launcher-logo"
      />
    `;

    document.body.appendChild(launcher);

    launcher.addEventListener("click", async () => {
      const existingWidget = document.getElementById(WIDGET_ID);

      if (existingWidget) {
        existingWidget.remove();
        return;
      }

      await createWidget();
    });
  }

  async function createWidget() {
    const existingWidget = document.getElementById(WIDGET_ID);

    if (existingWidget) {
      existingWidget.remove();
    }

    await prepareWidgetSession();

    const logoUrl = chrome.runtime.getURL("assets/logo.svg");

    const widget = document.createElement("section");
    widget.id = WIDGET_ID;
    widget.className = "rag-widget";
    widget.setAttribute("aria-label", "Adaptive RAG Panel");

    widget.innerHTML = `
      <div class="rag-window">
        <header class="rag-header">
          <div class="rag-brand">
            <div class="rag-brand-logo-wrap">
              <img src="${logoUrl}" alt="Adaptive RAG" class="rag-brand-logo" />
            </div>

            <div class="rag-brand-text">
              <strong>Adaptive RAG</strong>
              <span>Kişisel araştırma asistanı</span>
            </div>
          </div>

          <button id="ragWidgetClose" class="rag-close-btn" type="button" aria-label="Widget kapat">
            ×
          </button>
        </header>

        <nav class="rag-tabs" role="tablist">
          <button class="rag-tab active" type="button" data-tab="chat" role="tab" aria-selected="true">
            Chat
          </button>

          <button class="rag-tab" type="button" data-tab="sources" role="tab" aria-selected="false">
            Kaynaklar
          </button>

          <button class="rag-tab" type="button" data-tab="notes" role="tab" aria-selected="false">
            Notlar
          </button>
        </nav>

        <main id="ragWidgetBody" class="rag-body"></main>
      </div>
    `;

    document.body.appendChild(widget);

    bindWidgetEvents();
    await renderActiveTab();
  }

  function bindWidgetEvents() {
    document.getElementById("ragWidgetClose")?.addEventListener("click", () => {
      document.getElementById(WIDGET_ID)?.remove();
    });

    document.querySelectorAll(".rag-tab").forEach((tabButton) => {
      tabButton.addEventListener("click", async () => {
        activeTab = tabButton.dataset.tab || "chat";

        document.querySelectorAll(".rag-tab").forEach((button) => {
          const isActive = button.dataset.tab === activeTab;

          button.classList.toggle("active", isActive);
          button.setAttribute("aria-selected", String(isActive));
        });

        await renderActiveTab();
      });
    });
  }

  async function renderActiveTab() {
    const body = document.getElementById("ragWidgetBody");

    if (!body) {
      return;
    }

    if (activeTab === "chat") {
      body.innerHTML = await renderChatTab();
      bindChatEvents();
      return;
    }

    if (activeTab === "sources") {
      body.innerHTML = renderSourcesTab();
      bindSourceEvents();
      return;
    }

    if (activeTab === "notes") {
      body.innerHTML = renderNotesTab();
      bindNotesEvents();
    }
  }

  async function renderChatTab() {
    const messages = await window.AdaptiveRagSessionStore.getChatSession();

    const messagesHtml = messages.length
      ? messages.map(renderChatMessage).join("")
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

  function renderChatMessage(message) {
    const roleClass = message.role === "user" ? "user" : "assistant";
    const label = message.role === "user" ? "Sen" : "Adaptive RAG";

    return `
      <article class="rag-message ${roleClass}">
        <div class="rag-message-label">${escapeHtml(label)}</div>
        <div class="rag-message-content">${escapeHtml(message.content)}</div>
      </article>
    `;
  }

  function bindChatEvents() {
    const input = document.getElementById("ragChatInput");
    const sendBtn = document.getElementById("ragChatSendBtn");
    const clearBtn = document.getElementById("ragClearChatBtn");
    const messages = document.getElementById("ragChatMessages");

    if (messages) {
      messages.scrollTop = messages.scrollHeight;
    }

    sendBtn?.addEventListener("click", async () => {
      await handleSendMessage();
    });

    clearBtn?.addEventListener("click", async () => {
      const confirmed = confirm("Sohbet geçmişi temizlensin mi?");

      if (!confirmed) {
        return;
      }

      await window.AdaptiveRagSessionStore.clearChatSession();
      await renderActiveTab();
    });

    input?.addEventListener("keydown", async (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        await handleSendMessage();
      }
    });

    input?.addEventListener("input", () => {
      autoResizeTextarea(input);
    });
  }

  async function handleSendMessage() {
    const input = document.getElementById("ragChatInput");
    const sendBtn = document.getElementById("ragChatSendBtn");

    const question = input?.value?.trim();

    if (!question) {
      return;
    }

    input.value = "";
    autoResizeTextarea(input);

    await window.AdaptiveRagSessionStore.addMessageToSession("user", question);
    await renderActiveTab();

    setChatSendingState(true);

    try {
      const answer = await getAssistantAnswer(question);

      await window.AdaptiveRagSessionStore.addMessageToSession("assistant", answer);
      await renderActiveTab();
    } catch (error) {
      console.error("[WIDGET] Chat cevap hatası:", error);

      await window.AdaptiveRagSessionStore.addMessageToSession(
        "assistant",
        "Şu anda cevap alınamadı. Backend bağlantısı sonraki adımda eklenecek."
      );

      await renderActiveTab();
    } finally {
      if (sendBtn) {
        setChatSendingState(false);
      }
    }
  }

  async function getAssistantAnswer(question) {
    return `Test cevabı: "${question}" sorusu alındı. Bir sonraki adımda bu cevap backend RAG pipeline üzerinden üretilecek.`;
  }

  function setChatSendingState(isSending) {
    const input = document.getElementById("ragChatInput");
    const sendBtn = document.getElementById("ragChatSendBtn");

    if (input) {
      input.disabled = isSending;
    }

    if (sendBtn) {
      sendBtn.disabled = isSending;
      sendBtn.textContent = isSending ? "Bekle" : "Gönder";
    }
  }

  function renderSourcesTab() {
    const researchData = window.AdaptiveRagStore?.getResearchData?.() || {
      pages: [],
      timeline: [],
      notes: {
        quotes: [],
        recommendations: [],
        generalSummary: ""
      }
    };

    const pages = Array.isArray(researchData.pages) ? researchData.pages : [];
    const timeline = Array.isArray(researchData.timeline) ? researchData.timeline : [];

    const pagesHtml = pages.length
      ? pages.map(renderSourceCard).join("")
      : `
        <div class="rag-empty-state">
          <strong>Henüz taranan sayfa yok.</strong>
          <span>Sayfa taraması backend/scraping bağlantısından sonra burada listelenecek.</span>
        </div>
      `;

    const timelineHtml = timeline.length
      ? timeline.map(renderTimelineItem).join("")
      : `
        <div class="rag-mini-empty">
          Henüz zaman çizelgesi kaydı yok.
        </div>
      `;

    return `
      <div class="rag-sources-layout">
        <div class="rag-section-head">
          <div>
            <h3>Kaynaklar</h3>
            <p>Taranan sayfalar, kısa özetler ve kaynak parçaları burada görünür.</p>
          </div>

          <button id="ragMockScanBtn" class="rag-primary-btn small" type="button">
            Bu sayfayı ekle
          </button>
        </div>

        <div class="rag-source-list">
          ${pagesHtml}
        </div>

        <div class="rag-timeline-box">
          <div class="rag-subtitle">Zaman Çizelgesi</div>
          <div class="rag-timeline-list">
            ${timelineHtml}
          </div>
        </div>
      </div>
    `;
  }

  function renderSourceCard(page) {
    const chunks = Array.isArray(page.chunks) ? page.chunks : [];

    const chunksHtml = chunks.length
      ? chunks
          .map((chunk) => {
            return `
              <div class="rag-chunk-card">
                <p>${escapeHtml(trimText(chunk.text || chunk.content || "", 260))}</p>

                <div class="rag-chunk-actions">
                  <button
                    class="rag-link-btn rag-highlight-btn"
                    type="button"
                    data-url="${escapeHtml(page.url || "")}"
                    data-text="${escapeHtml(chunk.text || chunk.content || "")}"
                  >
                    Sayfadaki yeri göster
                  </button>

                  <button
                    class="rag-link-btn rag-add-quote-btn"
                    type="button"
                    data-page-id="${escapeHtml(page.id || "")}"
                    data-chunk-id="${escapeHtml(chunk.id || "")}"
                  >
                    Alıntı ekle
                  </button>
                </div>
              </div>
            `;
          })
          .join("")
      : `
        <div class="rag-mini-empty">
          Bu sayfa için chunk verisi yok.
        </div>
      `;

    return `
      <article class="rag-source-card">
        <button class="rag-source-card-head" type="button">
          <div>
            <strong>${escapeHtml(page.title || "Başlıksız Sayfa")}</strong>
            <span>${escapeHtml(page.scannedAt || "")}</span>
          </div>

          <span class="rag-source-arrow">⌄</span>
        </button>

        <div class="rag-source-card-body">
          <p class="rag-source-summary">
            ${escapeHtml(page.summary || "Bu kaynak için özet bulunmuyor.")}
          </p>

          <div class="rag-source-url">
            ${escapeHtml(page.url || "")}
          </div>

          <div class="rag-source-actions">
            <button
              class="rag-secondary-btn rag-open-source-btn"
              type="button"
              data-url="${escapeHtml(page.url || "")}"
            >
              Siteye git
            </button>
          </div>

          <div class="rag-chunks">
            <div class="rag-subtitle">Kaynak parçalar</div>
            ${chunksHtml}
          </div>
        </div>
      </article>
    `;
  }

  function renderTimelineItem(item) {
    return `
      <div class="rag-timeline-item">
        <div class="rag-timeline-dot"></div>
        <div>
          <strong>${escapeHtml(item.title || "İşlem")}</strong>
          <span>${escapeHtml(item.time || "")}</span>
        </div>
      </div>
    `;
  }

  function bindSourceEvents() {
    document.getElementById("ragMockScanBtn")?.addEventListener("click", async () => {
      const page = buildCurrentPageSnapshot();

      window.AdaptiveRagStore?.addScannedPage?.(page);
      await window.AdaptiveRagScanSettingsStore?.markUrlScanned?.(window.location.href);

      await renderActiveTab();
    });

    document.querySelectorAll(".rag-source-card-head").forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.closest(".rag-source-card");
        card?.classList.toggle("open");
      });
    });

    document.querySelectorAll(".rag-open-source-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const url = button.dataset.url;

        if (!url) {
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
      });
    });

    document.querySelectorAll(".rag-highlight-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const text = button.dataset.text || "";
        const url = button.dataset.url || "";

        handleHighlightRequest(url, text);
      });
    });

    document.querySelectorAll(".rag-add-quote-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const pageId = button.dataset.pageId;
        const chunkId = button.dataset.chunkId;

        await addQuoteFromChunk(pageId, chunkId);
        activeTab = "notes";
        syncActiveTabButtons();
        await renderActiveTab();
      });
    });
  }

  function buildCurrentPageSnapshot() {
    const paragraphs = Array.from(document.querySelectorAll("p"))
      .map((item) => item.innerText.trim())
      .filter((text) => text.length > 80)
      .slice(0, 6);

    const chunks = paragraphs.map((text, index) => {
      return {
        id: `chunk-current-${index + 1}`,
        text,
        sourceSelector: ""
      };
    });

    const summarySource = paragraphs.join(" ");

    return {
      title: document.title || "Başlıksız Sayfa",
      url: window.location.href,
      summary: summarySource
        ? trimText(summarySource, 260)
        : "Bu sayfa için kısa özet üretilecek.",
      chunks
    };
  }

  async function addQuoteFromChunk(pageId, chunkId) {
    const researchData = window.AdaptiveRagStore?.getResearchData?.();

    if (!researchData) {
      return;
    }

    const page = researchData.pages.find((item) => item.id === pageId);

    if (!page) {
      return;
    }

    const chunk = Array.isArray(page.chunks)
      ? page.chunks.find((item) => item.id === chunkId)
      : null;

    if (!chunk) {
      return;
    }

    const nextData = {
      ...researchData,
      notes: {
        ...researchData.notes,
        quotes: [
          {
            id: createId("quote"),
            text: chunk.text || chunk.content || "",
            sourceTitle: page.title || "",
            sourceUrl: page.url || "",
            createdAt: new Date().toLocaleString("tr-TR")
          },
          ...(Array.isArray(researchData.notes?.quotes) ? researchData.notes.quotes : [])
        ]
      },
      timeline: [
        {
          id: createId("time"),
          type: "quote",
          title: `${page.title || "Kaynak"} içinden alıntı kaydedildi`,
          time: new Date().toLocaleString("tr-TR")
        },
        ...(Array.isArray(researchData.timeline) ? researchData.timeline : [])
      ]
    };

    window.AdaptiveRagStore.saveResearchData(nextData);
  }

  function renderNotesTab() {
    const researchData = window.AdaptiveRagStore?.getResearchData?.() || {
      pages: [],
      timeline: [],
      notes: {
        generalSummary: "",
        quotes: [],
        recommendations: []
      }
    };

    const notes = researchData.notes || {};
    const quotes = Array.isArray(notes.quotes) ? notes.quotes : [];
    const recommendations = Array.isArray(notes.recommendations)
      ? notes.recommendations
      : [];

    const quotesHtml = quotes.length
      ? quotes.map(renderQuoteCard).join("")
      : `
        <div class="rag-mini-empty">
          Henüz alıntı eklenmedi.
        </div>
      `;

    const recommendationsHtml = recommendations.length
      ? recommendations.map(renderRecommendation).join("")
      : `
        <div class="rag-mini-empty">
          Okuma geçmişine göre öneriler burada görünecek.
        </div>
      `;

    return `
      <div class="rag-notes-layout">
        <section class="rag-note-panel">
          <div class="rag-section-head compact">
            <div>
              <h3>Özet Not</h3>
              <p>Taranan kaynaklardan genel toparlama ve çalışma notları.</p>
            </div>
          </div>

          <textarea
            id="ragGeneralSummaryInput"
            class="rag-note-textarea"
            placeholder="Genel özet notunu buraya yaz..."
          >${escapeHtml(notes.generalSummary || "")}</textarea>

          <button id="ragSaveSummaryBtn" class="rag-primary-btn" type="button">
            Özeti Kaydet
          </button>
        </section>

        <section class="rag-note-panel">
          <div class="rag-subtitle">Alıntılar</div>
          <div class="rag-quote-list">
            ${quotesHtml}
          </div>
        </section>

        <section class="rag-note-panel">
          <div class="rag-subtitle">Okuma Önerileri</div>
          <div class="rag-recommendation-list">
            ${recommendationsHtml}
          </div>
        </section>

        <section class="rag-note-panel">
          <div class="rag-subtitle">Dışa Aktar</div>

          <div class="rag-export-actions">
            <button class="rag-secondary-btn" type="button" disabled>
              PDF
            </button>

            <button class="rag-secondary-btn" type="button" disabled>
              Word
            </button>
          </div>

          <p class="rag-small-info">
            PDF ve Word çıktısı backend export endpointleri eklendiğinde aktif edilecek.
          </p>
        </section>
      </div>
    `;
  }

  function renderQuoteCard(quote) {
    return `
      <article class="rag-quote-card">
        <p>${escapeHtml(trimText(quote.text || "", 420))}</p>

        <div class="rag-quote-source">
          <strong>${escapeHtml(quote.sourceTitle || "Kaynak")}</strong>
          <span>${escapeHtml(quote.createdAt || "")}</span>
        </div>

        ${
          quote.sourceUrl
            ? `
              <button
                class="rag-link-btn rag-open-source-btn"
                type="button"
                data-url="${escapeHtml(quote.sourceUrl)}"
              >
                Kaynağa git
              </button>
            `
            : ""
        }
      </article>
    `;
  }

  function renderRecommendation(recommendation) {
    if (typeof recommendation === "string") {
      return `
        <div class="rag-recommendation-item">
          ${escapeHtml(recommendation)}
        </div>
      `;
    }

    return `
      <div class="rag-recommendation-item">
        ${escapeHtml(recommendation.title || recommendation.text || "Öneri")}
      </div>
    `;
  }

  function bindNotesEvents() {
    document.getElementById("ragSaveSummaryBtn")?.addEventListener("click", async () => {
      const input = document.getElementById("ragGeneralSummaryInput");
      const researchData = window.AdaptiveRagStore?.getResearchData?.();

      if (!researchData) {
        return;
      }

      const nextData = {
        ...researchData,
        notes: {
          ...researchData.notes,
          generalSummary: input?.value || ""
        },
        timeline: [
          {
            id: createId("time"),
            type: "summary",
            title: "Genel özet notu güncellendi",
            time: new Date().toLocaleString("tr-TR")
          },
          ...(Array.isArray(researchData.timeline) ? researchData.timeline : [])
        ]
      };

      window.AdaptiveRagStore.saveResearchData(nextData);
      await renderActiveTab();
    });

    document.querySelectorAll(".rag-open-source-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const url = button.dataset.url;

        if (!url) {
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
      });
    });
  }

  function handleHighlightRequest(url, text) {
    if (!text) {
      return;
    }

    if (url && url !== window.location.href) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    highlightTextOnCurrentPage(text);
  }

  function highlightTextOnCurrentPage(text) {
    const normalizedTarget = normalizeText(text).slice(0, 140);

    if (!normalizedTarget) {
      return;
    }

    const elements = Array.from(document.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6"));

    const targetElement = elements.find((element) => {
      return normalizeText(element.innerText).includes(normalizedTarget);
    });

    if (!targetElement) {
      alert("Bu metin mevcut sayfada bulunamadı.");
      return;
    }

    document.querySelectorAll(".adaptive-rag-highlighted-source").forEach((element) => {
      element.classList.remove("adaptive-rag-highlighted-source");
    });

    targetElement.classList.add("adaptive-rag-highlighted-source");
    targetElement.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });

    setTimeout(() => {
      targetElement.classList.remove("adaptive-rag-highlighted-source");
    }, 4500);
  }

  function syncActiveTabButtons() {
    document.querySelectorAll(".rag-tab").forEach((button) => {
      const isActive = button.dataset.tab === activeTab;

      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });
  }

  function autoResizeTextarea(element) {
    if (!element) {
      return;
    }

    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 130)}px`;
  }

  function createId(prefix = "item") {
    if (window.crypto && crypto.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function trimText(text, maxLength = 180) {
    const value = String(text || "").trim();

    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}...`;
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  window.showAdaptiveRagBubble = async function () {
    await createLauncher();
    return true;
  };

  window.hideAdaptiveRagBubble = async function () {
    document.getElementById(LAUNCHER_ID)?.remove();
    document.getElementById(WIDGET_ID)?.remove();
    return true;
  };

  window.closeAdaptiveRagWidget = function () {
    document.getElementById(WIDGET_ID)?.remove();
    return true;
  };

  window.AdaptiveRagWidget = {
    __widgetName: "adaptive-rag-main-widget",

    createLauncher,
    createWidget,
    renderActiveTab
  };

  createLauncher();
})();