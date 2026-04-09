import { UIState } from "../state/ui-state.js";
import { createPanel } from "../components/panel.js";
import { createMessageBubble } from "../components/response-area.js";
import { bindInputActions } from "../components/actions.js";
import { clearElement } from "../utils/dom.js";

export class WidgetController {
  constructor(root) {
    this.root = root;
    this.state = new UIState();

    this.panelRefs = null;
    this.elements = {};
  }

  init() {
    this.renderLayout();
    this.cacheElements();
    this.bindEvents();
    this.renderWelcomeMessage();
  }

  renderLayout() {
    const { panel } = createPanel();
    this.root.appendChild(panel);
  }

  cacheElements() {
    this.elements.responseArea = document.getElementById("response-area");
    this.elements.input = document.getElementById("prompt-input");
    this.elements.sendBtn = document.getElementById("send-btn");
    this.elements.attachBtn = document.getElementById("attach-page-btn");
    this.elements.clearBtn = document.getElementById("clear-chat-btn");
    this.elements.counter = document.getElementById("char-counter");
    this.elements.pageStatus = document.getElementById("page-status");
  }

  bindEvents() {
    bindInputActions({
      inputEl: this.elements.input,
      sendBtn: this.elements.sendBtn,
      attachBtn: this.elements.attachBtn,
      clearBtn: this.elements.clearBtn,
      counterEl: this.elements.counter,
      onSend: () => this.handleSend(),
      onAttachPage: () => this.handleAttachPage(),
      onClear: () => this.handleClear()
    });
  }

  renderWelcomeMessage() {
    this.addSystemMessage("Adaptive RAG hazır. İstersen mevcut sayfayı ekleyip soru sorabilirsin.");
  }

  addMessage(role, text) {
    this.state.addMessage(role, text);

    const bubble = createMessageBubble(role, text);
    this.elements.responseArea.appendChild(bubble);
    this.scrollToBottom();
  }

  addSystemMessage(text) {
    this.addMessage("system", text);
  }

  addUserMessage(text) {
    this.addMessage("user", text);
  }

  addAssistantMessage(text) {
    this.addMessage("assistant", text);
  }

  scrollToBottom() {
    this.elements.responseArea.scrollTop = this.elements.responseArea.scrollHeight;
  }

  async handleAttachPage() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "SCRAPE_PAGE" });

      if (!response?.success || !response?.data) {
        this.addSystemMessage("Sayfa içeriği alınamadı.");
        return;
      }

      this.state.setPageContextAttached(true);
      this.pageContext = response.data;

      this.elements.pageStatus.textContent = "Sayfa bağlamı eklendi";
      this.addSystemMessage(`Sayfa eklendi: ${response.data.title || "Başlıksız sayfa"}`);
    } catch (error) {
      console.error("Sayfa ekleme hatası:", error);
      this.addSystemMessage("Sayfa bağlamı eklenirken hata oluştu.");
    }
  }

  async handleSend() {
    const text = this.elements.input.value.trim();

    if (!text) return;

    this.addUserMessage(text);
    this.elements.input.value = "";
    this.elements.counter.textContent = "0 / 2000";

    if (this.state.pageContextAttached && this.pageContext) {
      this.addAssistantMessage(
        `Sorun alındı.\n\nBağlı sayfa: ${this.pageContext.title}\nURL: ${this.pageContext.url}\n\nBuradan sonra backend query endpointine bağlayacağız.`
      );
    } else {
      this.addAssistantMessage(
        "Sorun alındı. Şu an test arayüzündeyiz. İstersen önce Sayfayı ekle butonuyla mevcut sekmenin içeriğini bağlama ekleyebilirsin."
      );
    }
  }

  handleClear() {
    this.state.reset();
    this.pageContext = null;

    clearElement(this.elements.responseArea);
    this.elements.pageStatus.textContent = "Sayfa bağlamı eklenmedi";

    this.renderWelcomeMessage();
  }
}