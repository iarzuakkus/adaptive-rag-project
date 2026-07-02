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
 * - Backend'den gelen son chunks bilgisini sayfa üzerinde highlight için geçici olarak saklar.
 * - LLM tarafından kaynak gösterme niyeti algılanırsa son cevabın ilk/en alakalı chunk'ını sayfada gösterir.
 * - LLM tarafından öneri isteği algılanırsa Kaynaklar / Öneriler alanına yönlendirir ve öneri üretimini tetikler.
 * - LLM tarafından not oluşturma isteği algılanırsa oluşturulan notu notes-store içine kaydeder ve Notlar sekmesini açar.
 * - Sohbet temizleme işlemini yönetir.
 *
 * Not:
 * - Session yapısı bozulmaz.
 * - addMessageToSession yine role + string content ile çağrılır.
 * - Chunk bilgileri şimdilik window.AdaptiveRagLastChatChunks içinde tutulur.
 * - Chat cevabına kaynak listesi veya URL eklenmez.
 * - Kaynaklar backend response içinde structured olarak kalır.
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

  function wait(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
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

      return await window.AdaptiveRagSessionStore.addMessageToSession(
        role,
        String(content || "")
      );
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

      clearLastChatHighlightData();

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

  function clearLastChatHighlightData() {
    window.AdaptiveRagLastChatChunks = [];
    window.AdaptiveRagLastChatResult = null;
  }

  function getResultChunks(result) {
    return Array.isArray(result?.chunks) ? result.chunks : [];
  }

  function getResultActions(result) {
    return Array.isArray(result?.actions) ? result.actions : [];
  }

  function getSavedChunks() {
    return Array.isArray(window.AdaptiveRagLastChatChunks)
      ? window.AdaptiveRagLastChatChunks
      : [];
  }

  function getPrimaryChunk(chunks) {
    if (!Array.isArray(chunks) || !chunks.length) {
      return null;
    }

    const primaryChunk = chunks.find((chunk) => {
      return chunk?.is_primary_chunk === true;
    });

    return primaryChunk || chunks[0];
  }

  function saveLastChatHighlightData(result, question, options = {}) {
    const preserveExistingChunks = options.preserveExistingChunks === true;
    const resultChunks = getResultChunks(result);
    const previousChunks = getSavedChunks();

    const chunks =
      preserveExistingChunks && resultChunks.length === 0
        ? previousChunks
        : resultChunks;

    window.AdaptiveRagLastChatChunks = chunks;

    window.AdaptiveRagLastChatResult = {
      question,
      answer: result?.answer || "",
      chunks,
      sources: Array.isArray(result?.sources) ? result.sources : [],
      actions: getResultActions(result),
      status: result?.status || "success",
      answerType: result?.answer_type || result?.answerType || "short",
      sourceCount:
        typeof result?.source_count === "number"
          ? result.source_count
          : 0,
      createdAt: new Date().toISOString()
    };

    console.log("[CHAT EVENTS] Son chat highlight verisi kaydedildi:", {
      chunkCount: chunks.length,
      preserveExistingChunks
    });

    window.dispatchEvent(
      new CustomEvent("adaptive-rag-last-chat-chunks-updated", {
        detail: {
          chunks,
          result: window.AdaptiveRagLastChatResult
        }
      })
    );
  }

  function getActionType(action) {
    return String(
      action?.type ||
      action?.action_type ||
      action?.name ||
      ""
    ).trim().toLowerCase();
  }

  function getIntentValue(result) {
    if (!result) {
      return "";
    }

    if (typeof result.intent === "string") {
      return result.intent.trim().toLowerCase();
    }

    if (typeof result.intent === "object" && result.intent !== null) {
      return String(result.intent.intent || "").trim().toLowerCase();
    }

    return "";
  }

  function getAnswerType(result) {
    return String(
      result?.answer_type ||
      result?.answerType ||
      ""
    ).trim().toLowerCase();
  }

  function isSourceNavigationResult(result) {
    const answerType = getAnswerType(result);
    const status = String(result?.status || "").trim().toLowerCase();
    const intent = getIntentValue(result);

    const navigationTypes = new Set([
      "source_navigation",
      "source_request",
      "show_source",
      "show_answer_source",
      "page_highlight",
      "highlight_source"
    ]);

    if (
      navigationTypes.has(answerType) ||
      navigationTypes.has(status) ||
      navigationTypes.has(intent)
    ) {
      return true;
    }

    const actions = getResultActions(result);

    return actions.some((action) => {
      const actionType = getActionType(action);

      return [
        "auto_highlight_page",
        "show_answer_source",
        "source_navigation",
        "highlight_answer_source"
      ].includes(actionType);
    });
  }

  function getRecommendationAction(result) {
    const actions = getResultActions(result);

    return (
      actions.find((action) => {
        return getActionType(action) === "generate_recommendations";
      }) || null
    );
  }

  function getNoteGenerationAction(result) {
    const actions = getResultActions(result);

    return (
      actions.find((action) => {
        return getActionType(action) === "save_generated_note";
      }) || null
    );
  }

  function isNoteGenerationRequestResult(result) {
    const answerType = getAnswerType(result);
    const intent = getIntentValue(result);

    if (
      answerType === "note_generation_request" ||
      intent === "note_generation_request"
    ) {
      return true;
    }

    return Boolean(getNoteGenerationAction(result));
  }

  function isRecommendationRequestResult(result) {
    const answerType = getAnswerType(result);
    const intent = getIntentValue(result);

    if (
      answerType === "recommendation_request" ||
      intent === "recommendation_request"
    ) {
      return true;
    }

    return Boolean(getRecommendationAction(result));
  }

  async function highlightPrimaryChunkOnPage(chunks) {
    const primaryChunk = getPrimaryChunk(chunks);

    if (!primaryChunk) {
      return false;
    }

    const safeChunks = [primaryChunk];

    if (window.AdaptiveRagHighlightEvents?.highlightChunksOnPage) {
      return await window.AdaptiveRagHighlightEvents.highlightChunksOnPage(
        safeChunks
      );
    }

    window.dispatchEvent(
      new CustomEvent("adaptive-rag-highlight-page-chunks", {
        detail: {
          chunks: safeChunks
        }
      })
    );

    return true;
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
        response.message ||
        "Background üzerinden chat isteği başarısız oldu."
      );
    }

    return response.data;
  }

  function formatChatResult(result) {
    if (!result) {
      return "Backend cevap döndürmedi.";
    }

    if (result.status && result.status !== "success") {
      const answer =
        result.answer ||
        "Cevap üretilirken bir sorun oluştu.";

      const errorText = result.error
        ? `\n\nTeknik hata:\n${result.error}`
        : "";

      return `${answer}${errorText}`;
    }

    return result.answer || "Cevap üretilemedi.";
  }

  function formatSourceNavigationAnswer(result) {
    const answer = String(result?.answer || "").trim();

    if (answer) {
      return answer;
    }

    return "Tabii, son cevabın geçtiği bölümü sayfada gösteriyorum.";
  }

  function normalizeText(text) {
    return String(text || "").trim().toLowerCase();
  }

  function clickFirstExistingSelector(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);

      if (element && typeof element.click === "function") {
        element.click();
        return true;
      }
    }

    return false;
  }

  function clickButtonByText(possibleTexts) {
    const normalizedTargets = possibleTexts
      .map(normalizeText)
      .filter(Boolean);

    const candidates = Array.from(
      document.querySelectorAll(
        "button, [role='tab'], [data-tab], [data-rag-tab], [data-subtab]"
      )
    );

    const matched = candidates.find((element) => {
      const text = normalizeText(element.textContent);

      return normalizedTargets.some((target) => {
        return text === target || text.includes(target);
      });
    });

    if (matched && typeof matched.click === "function") {
      matched.click();
      return true;
    }

    return false;
  }

  async function openSourcesArea() {
    window.dispatchEvent(
      new CustomEvent("adaptive-rag-open-widget-tab", {
        detail: {
          tab: "sources"
        }
      })
    );

    const clicked = clickFirstExistingSelector([
      "#ragSourcesTabBtn",
      "#ragTabSources",
      "#ragSourcesTab",
      "[data-rag-tab='sources']",
      "[data-tab='sources']",
      "[data-tab-id='sources']",
      "[data-target='sources']",
      "[aria-controls='ragSourcesPanel']",
      ".rag-tab-sources"
    ]);

    if (!clicked) {
      clickButtonByText(["Kaynaklar"]);
    }

    await wait(100);
  }

  async function openRecommendationsArea() {
    await openSourcesArea();

    window.dispatchEvent(
      new CustomEvent("adaptive-rag-open-sources-subtab", {
        detail: {
          subtab: "recommendations"
        }
      })
    );

    const clicked = clickFirstExistingSelector([
      "#ragRecommendationsTabBtn",
      "#ragSourcesRecommendationsTab",
      "#ragSourceRecommendationsTab",
      "#ragRecommendationsSubtab",
      "[data-rag-source-subtab='recommendations']",
      "[data-source-subtab='recommendations']",
      "[data-rag-subtab='recommendations']",
      "[data-subtab='recommendations']",
      "[data-tab='recommendations']",
      "[aria-controls='ragRecommendationsPanel']",
      ".rag-source-tab-recommendations"
    ]);

    if (!clicked) {
      clickButtonByText(["Öneriler", "Oneriler"]);
    }

    await wait(100);
  }

  async function openNotesArea() {
    window.dispatchEvent(
      new CustomEvent("adaptive-rag-open-widget-tab", {
        detail: {
          tab: "notes"
        }
      })
    );

    const clicked = clickFirstExistingSelector([
      "#ragNotesTabBtn",
      "#ragTabNotes",
      "#ragNotesTab",
      "[data-rag-tab='notes']",
      "[data-tab='notes']",
      "[data-tab-id='notes']",
      "[data-target='notes']",
      "[aria-controls='ragNotesPanel']",
      ".rag-tab-notes"
    ]);

    if (!clicked) {
      clickButtonByText(["Notlar"]);
    }

    await wait(100);
  }

  function getActionBoolean(
    action,
    camelKey,
    snakeKey,
    defaultValue = true
  ) {
    if (!action || typeof action !== "object") {
      return defaultValue;
    }

    if (Object.prototype.hasOwnProperty.call(action, camelKey)) {
      return action[camelKey] !== false;
    }

    if (Object.prototype.hasOwnProperty.call(action, snakeKey)) {
      return action[snakeKey] !== false;
    }

    return defaultValue;
  }

  function getActionMode(action) {
    const rawMode = String(
      action?.mode ||
      action?.generation_mode ||
      action?.generationMode ||
      "refresh"
    ).trim().toLowerCase();

    if (rawMode === "expand") {
      return "expand";
    }

    return "refresh";
  }

  function normalizeRecommendations(rawRecommendations) {
    if (!Array.isArray(rawRecommendations)) {
      return [];
    }

    return rawRecommendations
      .filter((item) => item && typeof item === "object")
      .map((item, index) => {
        return {
          title: String(
            item.title ||
            item.name ||
            item.query ||
            item.topic ||
            `Öneri ${index + 1}`
          ).trim(),

          reason: String(
            item.reason ||
            item.description ||
            item.summary ||
            item.snippet ||
            item.explanation ||
            ""
          ).trim()
        };
      })
      .filter((item) => item.title);
  }

  function getRecommendationsFromResult(result) {
    if (Array.isArray(result?.recommendations)) {
      return normalizeRecommendations(
        result.recommendations
      );
    }

    if (Array.isArray(result?.data?.recommendations)) {
      return normalizeRecommendations(
        result.data.recommendations
      );
    }

    if (Array.isArray(result?.state?.recommendations)) {
      return normalizeRecommendations(
        result.state.recommendations
      );
    }

    const recommendationEvents =
      window.AdaptiveRagRecommendationEvents;

    if (recommendationEvents?.getState) {
      const state = recommendationEvents.getState();

      if (Array.isArray(state?.recommendations)) {
        return normalizeRecommendations(
          state.recommendations
        );
      }
    }

    return [];
  }

  function formatRecommendationsForChat(recommendations) {
    const safeRecommendations =
      normalizeRecommendations(recommendations);

    if (!safeRecommendations.length) {
      return (
        "Öneri üretimi başlatıldı. " +
        "Sonuçları Kaynaklar > Öneriler bölümünde görebilirsin."
      );
    }

    const visibleRecommendations =
      safeRecommendations.slice(0, 5);

    const lines = visibleRecommendations.map(
      (item, index) => {
        const reason = item.reason
          ? `\n   ${item.reason}`
          : "";

        return `${index + 1}. ${item.title}${reason}`;
      }
    );

    return (
      "Kaynaklarına göre öneriler hazırlandı. " +
      "Kaynaklar > Öneriler kısmına da yönlendirdim.\n\n" +
      lines.join("\n\n")
    );
  }

  async function runRecommendationAction(action) {
    const recommendationEvents =
      window.AdaptiveRagRecommendationEvents;

    if (
      !recommendationEvents ||
      typeof recommendationEvents
        .generateRecommendationsAfterSourceChange !== "function"
    ) {
      console.warn(
        "[CHAT EVENTS] RecommendationEvents modülü bulunamadı."
      );

      return null;
    }

    const mode = getActionMode(action);

    return await recommendationEvents
      .generateRecommendationsAfterSourceChange({
        reason: String(
          action?.reason ||
          "chat_natural_language_request"
        ).trim(),

        mode,
        generationMode: mode,
        focusCurrentPage: false,
        preserveIfEmpty: true,

        skipAutoCooldown: getActionBoolean(
          action,
          "skipAutoCooldown",
          "skip_auto_cooldown",
          true
        ),

        forceReloadSources: getActionBoolean(
          action,
          "forceReloadSources",
          "force_reload_sources",
          true
        )
      });
  }

  async function handleSourceNavigationResult(
    result,
    question,
    refreshWidget
  ) {
    const resultChunks = getResultChunks(result);
    const previousChunks = getSavedChunks();

    const chunks =
      resultChunks.length > 0
        ? resultChunks
        : previousChunks;

    saveLastChatHighlightData(result, question, {
      preserveExistingChunks: true
    });

    await addMessage(
      "assistant",
      formatSourceNavigationAnswer(result)
    );

    await refreshIfPossible(refreshWidget);

    const highlighted =
      await highlightPrimaryChunkOnPage(chunks);

    if (!highlighted) {
      console.warn(
        "[CHAT EVENTS] Kaynak yönlendirme için highlight başarısız."
      );
    }
  }

  async function handleRecommendationRequestResult(
    result,
    question,
    refreshWidget
  ) {
    const answer = formatChatResult(result);
    const action = getRecommendationAction(result) || {};

    saveLastChatHighlightData(result, question, {
      preserveExistingChunks: true
    });

    await addMessage("assistant", answer);
    await refreshIfPossible(refreshWidget);

    if (
      getActionBoolean(
        action,
        "openPanel",
        "open_panel",
        true
      )
    ) {
      await openRecommendationsArea();
    } else {
      await openSourcesArea();
    }

    const recommendationResult =
      await runRecommendationAction(action);

    await refreshIfPossible(refreshWidget);

    if (
      getActionBoolean(
        action,
        "openPanel",
        "open_panel",
        true
      )
    ) {
      await openRecommendationsArea();
    } else {
      await openSourcesArea();
    }

    if (
      getActionBoolean(
        action,
        "showInChat",
        "show_in_chat",
        true
      )
    ) {
      const recommendations =
        getRecommendationsFromResult(
          recommendationResult
        );

      await addMessage(
        "assistant",
        formatRecommendationsForChat(
          recommendations
        )
      );

      await refreshIfPossible(refreshWidget);

      if (
        getActionBoolean(
          action,
          "openPanel",
          "open_panel",
          true
        )
      ) {
        await openRecommendationsArea();
      }
    }
  }

  async function handleNoteGenerationRequestResult(
    result,
    question,
    refreshWidget
  ) {
    const action = getNoteGenerationAction(result);

    if (!action || !action.note) {
      throw new Error(
        "Backend oluşturulan not verisini döndürmedi."
      );
    }

    const notesStore =
      window.AdaptiveRagNotesStore;

    if (
      !notesStore ||
      typeof notesStore.addGeneratedNote !== "function"
    ) {
      throw new Error(
        "Notlar hafızası yüklenmedi."
      );
    }

    const savedNote = await Promise.resolve(
      notesStore.addGeneratedNote(
        action.note
      )
    );

    if (!savedNote) {
      throw new Error(
        "Oluşturulan not Notlar sekmesine kaydedilemedi."
      );
    }

    saveLastChatHighlightData(
      result,
      question
    );

    if (
      getActionBoolean(
        action,
        "showInChat",
        "show_in_chat",
        true
      )
    ) {
      await addMessage(
        "assistant",
        formatChatResult(result)
      );
    }

    window.dispatchEvent(
      new CustomEvent(
        "adaptive-rag-notes-updated",
        {
          detail: {
            note: savedNote,
            source: "chat"
          }
        }
      )
    );

    await refreshIfPossible(refreshWidget);

    if (
      getActionBoolean(
        action,
        "openPanel",
        "open_panel",
        true
      )
    ) {
      await openNotesArea();
    }
  }

  async function handleNormalChatResult(
    result,
    question,
    refreshWidget
  ) {
    const answer = formatChatResult(result);

    saveLastChatHighlightData(
      result,
      question
    );

    await addMessage(
      "assistant",
      answer
    );

    await refreshIfPossible(
      refreshWidget
    );
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
      await addMessage(
        "user",
        question
      );

      await refreshIfPossible(
        refreshWidget
      );

      const result =
        await requestChatAnswer(question);

      if (isSourceNavigationResult(result)) {
        await handleSourceNavigationResult(
          result,
          question,
          refreshWidget
        );
      } else if (
        isRecommendationRequestResult(result)
      ) {
        await handleRecommendationRequestResult(
          result,
          question,
          refreshWidget
        );
      } else if (
        isNoteGenerationRequestResult(result)
      ) {
        await handleNoteGenerationRequestResult(
          result,
          question,
          refreshWidget
        );
      } else {
        await handleNormalChatResult(
          result,
          question,
          refreshWidget
        );
      }
    } catch (error) {
      console.error(
        "[CHAT EVENTS] Backend chat hatası:",
        error
      );

      await addMessage(
        "assistant",
        `Backend chat isteği sırasında hata oluştu: ${error.message}`
      );

      await refreshIfPossible(
        refreshWidget
      );
    } finally {
      setInputDisabled(false);
      scrollToBottom();

      const newInput =
        document.getElementById(
          "ragChatInput"
        );

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
      console.warn(
        "[CHAT EVENTS] Chat input veya gönder butonu bulunamadı."
      );

      return;
    }

    if (
      sendBtn.getAttribute(BOUND_KEY) === "true"
    ) {
      return;
    }

    sendBtn.addEventListener(
      "click",
      async () => {
        await handleSendMessage(
          refreshWidget
        );
      }
    );

    input.addEventListener(
      "keydown",
      async (event) => {
        if (
          event.key === "Enter" &&
          !event.shiftKey
        ) {
          event.preventDefault();

          await handleSendMessage(
            refreshWidget
          );
        }
      }
    );

    input.addEventListener(
      "input",
      () => {
        autoResizeTextarea(input);
      }
    );

    clearBtn?.addEventListener(
      "click",
      async () => {
        await handleClearChat(
          refreshWidget
        );
      }
    );

    sendBtn.setAttribute(
      BOUND_KEY,
      "true"
    );
  }

  window.AdaptiveRagChatEvents = {
    __moduleName: "chat-events",

    bindChatEvents
  };
})();