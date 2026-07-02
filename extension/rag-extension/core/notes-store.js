/**
 * Dosya: core/notes-store.js
 *
 * Görev:
 * - Notlar sekmesinin frontend state yapısını yönetir.
 * - Kaynak seçimi, kişisel not seçimi, not tipi ve oluşturulan notları tutar.
 * - Kişisel notları kaydedilmiş araştırma notlarından ayrı saklar.
 * - Backend bağlanmadan önce mock not üretimini destekler.
 * - Backend bağlandıktan sonra aynı state yapısı korunarak gerçek notlar kaydedilebilir.
 */

(function () {
  if (window.AdaptiveRagNotesStore?.__moduleName === "notes-store") {
    return;
  }

  const STORAGE_KEY = "memorai_notes_state_v2";

  const NOTE_TYPES = {
    research_note: {
      key: "research_note",
      label: "Genel",
      title: "Genel not",
      description: "Seçili kaynaklardan ve kişisel notlardan dengeli araştırma notu üretir.",
    },
    lecture_note: {
      key: "lecture_note",
      label: "Ders notu",
      title: "Ders notu",
      description: "Seçili içerikleri ders çalışmaya uygun başlık ve maddelerle düzenler.",
    },
    summary_note: {
      key: "summary_note",
      label: "Özet",
      title: "Özet",
      description: "Seçili içeriklerden kısa ve hızlı okunabilir özet çıkarır.",
    },
  };

  const DEFAULT_STATE = {
    availableSources: [],
    selectedSourceIds: [],
    personalNotes: [],
    selectedPersonalNoteIds: [],
    selectedNoteType: "research_note",
    draftNote: "",
    savedNotes: [],
    selectedNoteId: null,
    isGenerating: false,
    isSavingDraft: false,
    error: null,
    hydrated: false,
  };

  let state = clone(DEFAULT_STATE);
  let pendingGenerationTimer = null;

  const listeners = new Set();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function safeText(value, fallback = "") {
    if (typeof value !== "string") return fallback;
    return value.trim();
  }

  function getChromeStorage() {
    try {
      if (
        typeof chrome !== "undefined" &&
        chrome.storage &&
        chrome.storage.local
      ) {
        return chrome.storage.local;
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      const storage = getChromeStorage();

      if (!storage) {
        resolve(null);
        return;
      }

      try {
        storage.get([key], (result) => {
          if (chrome.runtime?.lastError) {
            resolve(null);
            return;
          }

          resolve(result?.[key] || null);
        });
      } catch (error) {
        resolve(null);
      }
    });
  }

  function storageSet(key, value) {
    return new Promise((resolve) => {
      const storage = getChromeStorage();

      if (!storage) {
        resolve(false);
        return;
      }

      try {
        storage.set({ [key]: value }, () => {
          if (chrome.runtime?.lastError) {
            resolve(false);
            return;
          }

          resolve(true);
        });
      } catch (error) {
        resolve(false);
      }
    });
  }

  function storageRemove(key) {
  return new Promise((resolve) => {
    const storage = getChromeStorage();

    if (!storage) {
      resolve(false);
      return;
    }

    try {
      storage.remove([key], () => {
        if (chrome.runtime?.lastError) {
          resolve(false);
          return;
        }

        resolve(true);
      });
    } catch (error) {
      resolve(false);
    }
  });
}

  function persistState() {
    const persistableState = {
      selectedSourceIds: state.selectedSourceIds,
      selectedPersonalNoteIds: state.selectedPersonalNoteIds,
      selectedNoteType: state.selectedNoteType,
      draftNote: state.draftNote,
      personalNotes: state.personalNotes,
      savedNotes: state.savedNotes,
    };

    storageSet(STORAGE_KEY, persistableState);
  }

  function notify() {
    listeners.forEach((listener) => {
      try {
        listener(getState());
      } catch (error) {
        console.warn("[NOTES STORE] Listener çalıştırılamadı:", error);
      }
    });
  }

  function setState(partialState, options = {}) {
    state = {
      ...state,
      ...partialState,
    };

    if (options.persist !== false) {
      persistState();
    }

    notify();
  }

  function getState() {
    return clone(state);
  }

  function normalizeMigratedPersonalNote(note, index = 0) {
    if (!note || typeof note !== "object") {
      return null;
    }

    const text = safeText(
      note.text ||
      note.body ||
      note.manualNote ||
      note.manual_note ||
      note.content?.shortSummary ||
      note.summary
    );

    if (!text) {
      return null;
    }

    const dateInfo = formatDateTime(note.createdAt || note.created_at);

    return {
      id: note.id || createId(`personal_note_${index + 1}`),
      title: note.title || `Kişisel not ${index + 1}`,
      text,
      summary: text.slice(0, 140),
      createdAt: note.createdAt || note.created_at || nowIso(),
      dateLabel: note.dateLabel || dateInfo.date,
      timeLabel: note.timeLabel || dateInfo.time,
    };
  }

  function isManualSavedNote(note) {
    return Boolean(
      note &&
      (
        note.isManual ||
        note.is_manual ||
        note.noteType === "manual_note" ||
        note.note_type === "manual_note"
      )
    );
  }

  function migrateManualSavedNotes(savedNotes, existingPersonalNotes) {
    const nextSavedNotes = [];
    const migratedPersonalNotes = [];

    if (Array.isArray(existingPersonalNotes)) {
      existingPersonalNotes.forEach((note, index) => {
        const normalized = normalizeMigratedPersonalNote(note, index);

        if (normalized) {
          migratedPersonalNotes.push(normalized);
        }
      });
    }

    if (Array.isArray(savedNotes)) {
      savedNotes.forEach((note, index) => {
        if (isManualSavedNote(note)) {
          const normalized = normalizeMigratedPersonalNote(note, index);

          if (normalized) {
            migratedPersonalNotes.push(normalized);
          }

          return;
        }

        nextSavedNotes.push(note);
      });
    }

    return {
      savedNotes: nextSavedNotes,
      personalNotes: removeDuplicatePersonalNotes(migratedPersonalNotes),
    };
  }

  function removeDuplicatePersonalNotes(notes) {
    const seen = new Set();
    const uniqueNotes = [];

    notes.forEach((note) => {
      const key = `${safeText(note.title)}::${safeText(note.text)}`;

      if (!key || seen.has(key)) {
        return;
      }

      seen.add(key);
      uniqueNotes.push(note);
    });

    return uniqueNotes;
  }

  async function hydrate() {
    const savedStateV2 = await storageGet(STORAGE_KEY);
    const savedStateV1 = savedStateV2 ? null : await storageGet("memorai_notes_state_v1");
    const savedState = savedStateV2 || savedStateV1;

    if (!savedState) {
      state.hydrated = true;
      notify();
      return getState();
    }

    const migrated = migrateManualSavedNotes(
      savedState.savedNotes,
      savedState.personalNotes
    );

    const personalNoteIds = new Set(migrated.personalNotes.map((note) => note.id));

    state = {
      ...state,
      selectedSourceIds: Array.isArray(savedState.selectedSourceIds)
        ? savedState.selectedSourceIds
        : state.selectedSourceIds,
      selectedPersonalNoteIds: Array.isArray(savedState.selectedPersonalNoteIds)
        ? savedState.selectedPersonalNoteIds.filter((id) => personalNoteIds.has(id))
        : [],
      selectedNoteType:
        savedState.selectedNoteType && NOTE_TYPES[savedState.selectedNoteType]
          ? savedState.selectedNoteType
          : state.selectedNoteType,
      draftNote:
        typeof savedState.draftNote === "string"
          ? savedState.draftNote
          : state.draftNote,
      personalNotes: migrated.personalNotes,
      savedNotes: migrated.savedNotes,
      hydrated: true,
    };

    persistState();
    notify();
    return getState();
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return function noop() {};
    }

    listeners.add(listener);

    return function unsubscribe() {
      listeners.delete(listener);
    };
  }

  function normalizeSource(rawSource, index = 0) {
    if (!rawSource || typeof rawSource !== "object") {
      return null;
    }

    const id =
      rawSource.id ||
      rawSource.source_id ||
      rawSource.sourceId ||
      rawSource.url ||
      `source_${index + 1}`;

    const title =
      rawSource.title ||
      rawSource.page_title ||
      rawSource.pageTitle ||
      rawSource.name ||
      rawSource.url ||
      `Kaynak ${index + 1}`;

    const url = rawSource.url || rawSource.page_url || rawSource.pageUrl || "";

    const chunkCount =
      rawSource.chunkCount ||
      rawSource.chunk_count ||
      rawSource.chunks ||
      rawSource.total_chunks ||
      0;

    const type =
      rawSource.type ||
      rawSource.source_type ||
      rawSource.kind ||
      detectSourceType(url);

    const scannedAt =
      rawSource.scannedAt ||
      rawSource.scanned_at ||
      rawSource.createdAt ||
      rawSource.created_at ||
      rawSource.date ||
      "";

    const scannedAtLabel =
      rawSource.scannedAtLabel ||
      rawSource.scanned_at_label ||
      formatDateLabel(scannedAt);

    const metaParts = [];

    if (type) metaParts.push(type);
    if (scannedAtLabel) metaParts.push(scannedAtLabel);
    if (chunkCount) metaParts.push(`${chunkCount} chunk`);

    return {
      id: String(id),
      title: String(title),
      url: String(url),
      type: String(type || "Web"),
      meta: metaParts.join(" • "),
      chunkCount: Number(chunkCount) || 0,
      scannedAtLabel,
      raw: rawSource,
    };
  }

  function detectSourceType(url) {
    if (!url || typeof url !== "string") return "Web";

    const lowerUrl = url.toLowerCase();

    if (lowerUrl.endsWith(".pdf") || lowerUrl.includes(".pdf")) {
      return "PDF";
    }

    if (lowerUrl.includes("medium.com")) {
      return "Makale";
    }

    if (lowerUrl.includes("wikipedia.org")) {
      return "Web";
    }

    return "Web";
  }

  function formatDateLabel(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return "Bugün tarandı";
    if (diffDays === 1) return "Dün tarandı";

    return date.toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function formatDateTime(value) {
    const date = value ? new Date(value) : new Date();

    if (Number.isNaN(date.getTime())) {
      return {
        date: "",
        time: "",
      };
    }

    return {
      date: date.toLocaleDateString("tr-TR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      time: date.toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  }

  function setAvailableSources(sources) {
    const normalizedSources = Array.isArray(sources)
      ? sources.map(normalizeSource).filter(Boolean)
      : [];

    const nextSourceIds = new Set(normalizedSources.map((source) => source.id));

    const selectedSourceIds = state.selectedSourceIds.filter((sourceId) =>
      nextSourceIds.has(sourceId)
    );

    setState({
      availableSources: normalizedSources,
      selectedSourceIds,
    });
  }

  function getAvailableSources() {
    return clone(state.availableSources || []);
  }

  function getSelectedSources() {
    const selectedSet = new Set(state.selectedSourceIds);

    return clone(
      state.availableSources.filter((source) => selectedSet.has(source.id))
    );
  }

  function isSourceSelected(sourceId) {
    return state.selectedSourceIds.includes(sourceId);
  }

  function toggleSource(sourceId) {
    if (!sourceId) return getState();

    const selectedSet = new Set(state.selectedSourceIds);

    if (selectedSet.has(sourceId)) {
      selectedSet.delete(sourceId);
    } else {
      selectedSet.add(sourceId);
    }

    setState({
      selectedSourceIds: Array.from(selectedSet),
      error: null,
    });

    return getState();
  }

  function selectAllSources() {
    setState({
      selectedSourceIds: state.availableSources.map((source) => source.id),
      error: null,
    });

    return getState();
  }

  function clearSelectedSources() {
    setState({
      selectedSourceIds: [],
    });

    return getState();
  }

  function getPersonalNotes() {
    return clone(state.personalNotes || []);
  }

  function getSelectedPersonalNotes() {
    const selectedSet = new Set(state.selectedPersonalNoteIds);

    return clone(
      state.personalNotes.filter((note) => selectedSet.has(note.id))
    );
  }

  function isPersonalNoteSelected(noteId) {
    return state.selectedPersonalNoteIds.includes(noteId);
  }

  function togglePersonalNote(noteId) {
    if (!noteId) return getState();

    const selectedSet = new Set(state.selectedPersonalNoteIds);

    if (selectedSet.has(noteId)) {
      selectedSet.delete(noteId);
    } else {
      selectedSet.add(noteId);
    }

    setState({
      selectedPersonalNoteIds: Array.from(selectedSet),
      error: null,
    });

    return getState();
  }

  function selectAllPersonalNotes() {
    setState({
      selectedPersonalNoteIds: state.personalNotes.map((note) => note.id),
      error: null,
    });

    return getState();
  }

  function clearSelectedPersonalNotes() {
    setState({
      selectedPersonalNoteIds: [],
    });

    return getState();
  }

  function deletePersonalNote(noteId) {
    if (!noteId) return getState();

    setState({
      personalNotes: state.personalNotes.filter((note) => note.id !== noteId),
      selectedPersonalNoteIds: state.selectedPersonalNoteIds.filter((id) => id !== noteId),
      error: null,
    });

    return getState();
  }

  function setSelectedNoteType(noteType) {
    if (!NOTE_TYPES[noteType]) {
      return getState();
    }

    setState({
      selectedNoteType: noteType,
      error: null,
    });

    return getState();
  }

  function setDraftNote(value) {
    setState({
      draftNote: typeof value === "string" ? value : "",
      error: null,
    });

    return getState();
  }

  function clearDraftNote() {
    setState({
      draftNote: "",
    });

    return getState();
  }

  function saveDraftNote() {
    const draftText = safeText(state.draftNote);

    if (!draftText) {
      setState({
        error: "Kaydetmek için önce kişisel not yazmalısın.",
      });

      return null;
    }

    const dateInfo = formatDateTime();

    const note = {
      id: createId("personal_note"),
      title: `Kişisel not ${state.personalNotes.length + 1}`,
      text: draftText,
      summary: draftText.slice(0, 140),
      createdAt: nowIso(),
      dateLabel: dateInfo.date,
      timeLabel: dateInfo.time,
    };

    setState({
      personalNotes: [note, ...state.personalNotes],
      selectedPersonalNoteIds: [note.id, ...state.selectedPersonalNoteIds],
      draftNote: "",
      error: null,
    });

    return clone(note);
  }

  function validateGenerateInput() {
    const hasSelectedSources = state.selectedSourceIds.length > 0;
    const hasSelectedPersonalNotes = state.selectedPersonalNoteIds.length > 0;

    if (!hasSelectedSources && !hasSelectedPersonalNotes) {
      return "Not oluşturmak için en az bir kaynak veya kişisel not seçmelisin.";
    }

    if (!NOTE_TYPES[state.selectedNoteType]) {
      return "Geçerli bir not tipi seçmelisin.";
    }

    return null;
  }

  function generateMockNote() {
    const validationError = validateGenerateInput();

    if (validationError) {
      setState({
        error: validationError,
      });

      return null;
    }

    setState({
      isGenerating: true,
      error: null,
    }, { persist: false });

    const selectedSources = getSelectedSources();
    const selectedPersonalNotes = getSelectedPersonalNotes();
    const noteType = NOTE_TYPES[state.selectedNoteType];
    const firstSource = selectedSources[0];
    const firstPersonalNote = selectedPersonalNotes[0];

    const sourceTitles = selectedSources.map((source) => source.title);
    const personalNoteTitles = selectedPersonalNotes.map((note) => note.title);
    const dateInfo = formatDateTime();

    const title = buildGeneratedTitle(
      noteType.key,
      firstSource?.title || firstPersonalNote?.title
    );

    const summary = buildGeneratedSummary(
      noteType.key,
      sourceTitles,
      personalNoteTitles
    );

    const note = {
      id: createId("generated_note"),
      title,
      summary,
      noteType: noteType.key,
      noteTypeLabel: noteType.title,
      sourceIds: selectedSources.map((source) => source.id),
      personalNoteIds: selectedPersonalNotes.map((personalNote) => personalNote.id),
      sourceCount: selectedSources.length,
      personalNoteCount: selectedPersonalNotes.length,
      inputCount: selectedSources.length + selectedPersonalNotes.length,
      sectionCount: 5,
      createdAt: nowIso(),
      dateLabel: dateInfo.date,
      timeLabel: dateInfo.time,
      content: {
        shortSummary: summary,
        sections: buildMockSections(noteType.key, sourceTitles, personalNoteTitles),
        insights: buildMockInsights(noteType.key, selectedPersonalNotes),
        sourceNotes: selectedSources.map((source) => ({
          sourceId: source.id,
          sourceTitle: source.title,
          sourceUrl: source.url,
          note: `${source.title} kaynağı, bu notun ilgili konu başlıklarını destekleyen temel içeriklerden biridir.`,
        })),
        personalNotes: selectedPersonalNotes.map((personalNote) => ({
          noteId: personalNote.id,
          title: personalNote.title,
          text: personalNote.text,
        })),
        conclusion:
          "Seçili kaynaklar ve kişisel notlar birlikte değerlendirildiğinde konuya dair düzenli, tekrar kullanılabilir ve dışa aktarılabilir bir araştırma notu oluşturulmuştur.",
      },
      manualNote: buildManualNoteText(selectedPersonalNotes),
      isManual: false,
    };

    if (pendingGenerationTimer) {
      clearTimeout(pendingGenerationTimer);
      pendingGenerationTimer = null;
    }

    pendingGenerationTimer = window.setTimeout(() => {
      pendingGenerationTimer = null;

      setState({
        savedNotes: [note, ...state.savedNotes],
        selectedNoteId: note.id,
        isGenerating: false,
        error: null,
    });
  }, 350);

    return clone(note);
  }

  function buildGeneratedTitle(noteType, baseTitle) {
    const titleBase = baseTitle || "Araştırma";

    if (noteType === "lecture_note") {
      return `${titleBase} ders notu`;
    }

    if (noteType === "summary_note") {
      return `${titleBase} özeti`;
    }

    return `${titleBase} araştırma notu`;
  }

  function buildGeneratedSummary(noteType, sourceTitles, personalNoteTitles) {
    const inputTitles = [
      ...sourceTitles,
      ...personalNoteTitles,
    ].slice(0, 4);

    const readableInputs = inputTitles.length
      ? inputTitles.join(", ")
      : "seçili içerikler";

    if (noteType === "lecture_note") {
      return `${readableInputs} kullanılarak ders notu formatında konu başlıkları, maddeler ve önemli çıkarımlarla düzenlenmiş bir not oluşturuldu.`;
    }

    if (noteType === "summary_note") {
      return `${readableInputs} kullanılarak kısa, net ve hızlı okunabilir bir özet hazırlandı.`;
    }

    return `${readableInputs} kullanılarak düzenli, başlıklandırılmış ve tekrar kullanılabilir bir araştırma notu oluşturuldu.`;
  }

  function buildMockSections(noteType, sourceTitles, personalNoteTitles) {
    const hasSources = sourceTitles.length > 0;
    const hasPersonalNotes = personalNoteTitles.length > 0;

    if (noteType === "summary_note") {
      return [
        {
          heading: "Kısa özet",
          bullets: [
            hasSources
              ? "Seçili kaynaklarda tekrar eden temel kavramlar bir araya getirildi."
              : "Seçili kişisel notlarda öne çıkan ana fikirler bir araya getirildi.",
            hasPersonalNotes
              ? "Kullanıcının kendi notları özetin yönünü belirleyen önemli bağlam olarak dahil edildi."
              : "Özet, seçili kaynaklardaki temel bilgilere göre hazırlandı.",
            "Konuya dair en önemli noktalar kısa maddeler halinde düzenlendi.",
          ],
        },
      ];
    }

    if (noteType === "lecture_note") {
      return [
        {
          heading: "Temel kavramlar",
          bullets: [
            "Seçili içeriklerde geçen ana kavramlar sadeleştirildi.",
            "Teknik ifadeler ders çalışma düzenine uygun hale getirildi.",
          ],
        },
        {
          heading: "Konu akışı",
          bullets: [
            "Bilgiler başlangıç, gelişme ve sonuç mantığıyla sıralandı.",
            hasPersonalNotes
              ? "Kişisel notlar, kaynaklardan gelen bilgilerle birlikte konu akışına dahil edildi."
              : "Seçili kaynaklar aynı konu akışı altında toplandı.",
          ],
        },
        {
          heading: "Tekrar için önemli noktalar",
          bullets: [
            "Öne çıkan kavramlar kısa maddeler halinde ayrıştırıldı.",
            "Sınav, sunum veya tekrar için kullanılabilecek çıkarımlar belirlendi.",
          ],
        },
      ];
    }

    return [
      {
        heading: "Araştırmanın genel çerçevesi",
        bullets: [
          hasSources
            ? "Seçili kaynaklar aynı araştırma konusu etrafında birlikte değerlendirildi."
            : "Seçili kişisel notlar araştırma konusu etrafında düzenlendi.",
          hasPersonalNotes
            ? "Kişisel notlar, oluşturulan notun ana bağlamlarından biri olarak dahil edildi."
            : "Kaynaklarda tekrar eden kavramlar ana konu başlıklarına ayrıldı.",
        ],
      },
      {
        heading: "Ana içerikler",
        bullets: [
          ...sourceTitles.slice(0, 4).map((title) => {
            return `${title} kaynağında öne çıkan bilgiler not yapısına dahil edildi.`;
          }),
          ...personalNoteTitles.slice(0, 4).map((title) => {
            return `${title} kişisel notu, oluşturulan notun kullanıcı bağlamını destekledi.`;
          }),
        ],
      },
      {
        heading: "Kaynak ve kişisel not bağlantısı",
        bullets: [
          "Benzer kavramlar birleştirildi, tekrar eden bilgiler sadeleştirildi.",
          "Kişisel notlar, kaynaklardan gelen bilgilerle birlikte daha anlamlı bir not yapısına dönüştürüldü.",
        ],
      },
    ];
  }

  function buildMockInsights(noteType, selectedPersonalNotes) {
    const hasPersonalNotes = selectedPersonalNotes.length > 0;

    if (noteType === "lecture_note") {
      return [
        "Ders notu formatında en faydalı çıktı, kavramların kısa açıklamalarla gruplanmasıdır.",
        hasPersonalNotes
          ? "Kişisel notların seçime dahil edilmesi, notu kullanıcının çalışma amacına daha uygun hale getirir."
          : "Seçili kaynakların birlikte kullanılması konu bütünlüğünü artırır.",
      ];
    }

    if (noteType === "summary_note") {
      return [
        "Özet not, hızlı tekrar ve genel fikir edinme için uygundur.",
        hasPersonalNotes
          ? "Kişisel notlar, özetin hangi noktaları vurgulayacağını belirleyen ek bağlam sağlar."
          : "Çok sayıda kaynak olduğunda kısa özet, ilk okuma yükünü azaltır.",
      ];
    }

    return [
      "Kaynak ve kişisel not seçimi, oluşturulan notun odağını doğrudan belirler.",
      "Birden fazla içerik kullanıldığında daha dengeli bir araştırma özeti çıkar.",
      "Notların kaynaklarla ve kişisel notlarla ilişkili tutulması daha sonra doğrulama yapmayı kolaylaştırır.",
    ];
  }

  function buildManualNoteText(personalNotes) {
    if (!Array.isArray(personalNotes) || !personalNotes.length) {
      return "";
    }

    return personalNotes
      .map((note, index) => {
        return `${index + 1}. ${note.title}\n${note.text}`;
      })
      .join("\n\n");
  }

  function addGeneratedNote(note) {
    if (!note || typeof note !== "object") {
      return null;
    }

    const dateInfo = formatDateTime(note.createdAt || note.created_at);

    const sourceIds = Array.isArray(note.sourceIds)
      ? note.sourceIds
      : Array.isArray(note.source_ids)
        ? note.source_ids
        : state.selectedSourceIds;

    const personalNoteIds = Array.isArray(note.personalNoteIds)
      ? note.personalNoteIds
      : Array.isArray(note.personal_note_ids)
        ? note.personal_note_ids
        : state.selectedPersonalNoteIds;

    const selectedPersonalNotes = getSelectedPersonalNotes();

    const normalizedNote = {
      id: note.id || createId("generated_note"),
      title: note.title || "Araştırma notu",
      summary: note.summary || note.content?.shortSummary || "",
      noteType: note.noteType || note.note_type || state.selectedNoteType,
      noteTypeLabel:
        note.noteTypeLabel ||
        note.note_type_label ||
        NOTE_TYPES[note.noteType || note.note_type || state.selectedNoteType]
          ?.title ||
        "Genel not",
      sourceIds,
      personalNoteIds,
      sourceCount:
        note.sourceCount ||
        note.source_count ||
        note.sources?.length ||
        sourceIds.length,
      personalNoteCount:
        note.personalNoteCount ||
        note.personal_note_count ||
        personalNoteIds.length,
      inputCount:
        note.inputCount ||
        note.input_count ||
        sourceIds.length + personalNoteIds.length,
      sectionCount:
        note.sectionCount ||
        note.section_count ||
        note.content?.sections?.length ||
        note.sections?.length ||
        0,
      createdAt: note.createdAt || note.created_at || nowIso(),
      dateLabel: note.dateLabel || dateInfo.date,
      timeLabel: note.timeLabel || dateInfo.time,
      content: normalizeNoteContent(note, selectedPersonalNotes),
      manualNote:
        note.manualNote ||
        note.manual_note ||
        buildManualNoteText(selectedPersonalNotes),
      isManual: false,
    };

    setState({
      savedNotes: [normalizedNote, ...state.savedNotes],
      selectedNoteId: normalizedNote.id,
      error: null,
    });

    return clone(normalizedNote);
  }

  function normalizeNoteContent(note, selectedPersonalNotes = []) {
    const content = note.content || {};

    return {
      shortSummary:
        content.shortSummary ||
        content.short_summary ||
        note.shortSummary ||
        note.short_summary ||
        note.summary ||
        "",
      sections:
        content.sections ||
        note.sections ||
        [],
      insights:
        content.insights ||
        note.insights ||
        note.importantInsights ||
        note.important_insights ||
        [],
      sourceNotes:
        content.sourceNotes ||
        content.source_notes ||
        note.sourceNotes ||
        note.source_notes ||
        [],
      personalNotes:
        content.personalNotes ||
        content.personal_notes ||
        note.personalNotes ||
        note.personal_notes ||
        selectedPersonalNotes.map((personalNote) => ({
          noteId: personalNote.id,
          title: personalNote.title,
          text: personalNote.text,
        })),
      conclusion:
        content.conclusion ||
        note.conclusion ||
        "",
    };
  }

  function deleteNote(noteId) {
    if (!noteId) return getState();

    const nextSavedNotes = state.savedNotes.filter((note) => note.id !== noteId);

    setState({
      savedNotes: nextSavedNotes,
      selectedNoteId:
        state.selectedNoteId === noteId ? null : state.selectedNoteId,
    });

    return getState();
  }

  function updateNoteTitle(noteId, title) {
    const nextTitle = safeText(title);

    if (!noteId || !nextTitle) {
      return getState();
    }

    const nextSavedNotes = state.savedNotes.map((note) => {
      if (note.id !== noteId) {
        return note;
      }

      return {
        ...note,
        title: nextTitle,
      };
    });

    setState({
      savedNotes: nextSavedNotes,
      error: null,
    });

    return getState();
  }

  function updateNote(noteId, patch) {
    if (!noteId || !patch || typeof patch !== "object") {
      return getState();
    }

    const nextSavedNotes = state.savedNotes.map((note) => {
      if (note.id !== noteId) {
        return note;
      }

      return {
        ...note,
        ...patch,
      };
    });

    setState({
      savedNotes: nextSavedNotes,
      error: null,
    });

    return getState();
  }

  function setSelectedNote(noteId) {
    const exists = state.savedNotes.some((note) => note.id === noteId);

    setState({
      selectedNoteId: exists ? noteId : null,
    }, { persist: false });

    return getState();
  }

  function clearSelectedNote() {
    setState({
      selectedNoteId: null,
    }, { persist: false });

    return getState();
  }

  function getSelectedNote() {
    if (!state.selectedNoteId) return null;

    const note = state.savedNotes.find((item) => item.id === state.selectedNoteId);

    return note ? clone(note) : null;
  }

  function getNoteById(noteId) {
    const note = state.savedNotes.find((item) => item.id === noteId);

    return note ? clone(note) : null;
  }

  function buildTxtContent(noteId) {
    const note = getNoteById(noteId);

    if (!note) {
      return "";
    }

    const lines = [];
    const title = note.title || "Araştırma notu";

    lines.push(title);
    lines.push("=".repeat(title.length));
    lines.push("");

    if (note.noteTypeLabel) {
      lines.push(`Not tipi: ${note.noteTypeLabel}`);
    }

    if (note.dateLabel || note.timeLabel) {
      lines.push(`Oluşturulma: ${[note.dateLabel, note.timeLabel].filter(Boolean).join(" • ")}`);
    }

    if (note.sourceCount) {
      lines.push(`Kullanılan kaynak sayısı: ${note.sourceCount}`);
    }

    if (note.personalNoteCount) {
      lines.push(`Kullanılan kişisel not sayısı: ${note.personalNoteCount}`);
    }

    lines.push("");

    const personalNotes = Array.isArray(note.content?.personalNotes)
      ? note.content.personalNotes
      : [];

    if (personalNotes.length || note.manualNote) {
      lines.push("KULLANICI NOTLARI");
      lines.push("");

      if (personalNotes.length) {
        personalNotes.forEach((personalNote, index) => {
          lines.push(`${index + 1}. ${personalNote.title || "Kişisel not"}`);
          lines.push(personalNote.text || "");
          lines.push("");
        });
      } else if (note.manualNote) {
        lines.push(note.manualNote);
        lines.push("");
      }
    }

    if (note.content?.shortSummary) {
      lines.push("KISA ÖZET");
      lines.push("");
      lines.push(note.content.shortSummary);
      lines.push("");
    }

    if (Array.isArray(note.content?.sections) && note.content.sections.length) {
      lines.push("ANA KONU BAŞLIKLARI");
      lines.push("");

      note.content.sections.forEach((section, index) => {
        lines.push(`${index + 1}. ${section.heading || "Başlık"}`);

        if (Array.isArray(section.bullets)) {
          section.bullets.forEach((bullet) => {
            lines.push(`- ${bullet}`);
          });
        }

        lines.push("");
      });
    }

    if (Array.isArray(note.content?.insights) && note.content.insights.length) {
      lines.push("ÖNEMLİ ÇIKARIMLAR");
      lines.push("");

      note.content.insights.forEach((insight) => {
        lines.push(`- ${insight}`);
      });

      lines.push("");
    }

    if (
      Array.isArray(note.content?.sourceNotes) &&
      note.content.sourceNotes.length
    ) {
      lines.push("KAYNAKLARLA İLİŞKİLİ NOTLAR");
      lines.push("");

      note.content.sourceNotes.forEach((sourceNote) => {
        lines.push(`- ${sourceNote.sourceTitle || "Kaynak"}: ${sourceNote.note || ""}`);

        if (sourceNote.sourceUrl) {
          lines.push(`  ${sourceNote.sourceUrl}`);
        }
      });

      lines.push("");
    }

    if (note.content?.conclusion) {
      lines.push("SONUÇ");
      lines.push("");
      lines.push(note.content.conclusion);
      lines.push("");
    }

    return lines.join("\n");
  }

  function cancelPendingGeneration() {
  if (!pendingGenerationTimer) {
    return;
  }

  clearTimeout(pendingGenerationTimer);
  pendingGenerationTimer = null;
}

function resetNotesState() {
  cancelPendingGeneration();

  state = {
    ...clone(DEFAULT_STATE),
    hydrated: true,
  };

  persistState();
  notify();

  return getState();
}

async function clearNotesSession() {
  cancelPendingGeneration();

  state = {
    ...clone(DEFAULT_STATE),
    hydrated: true,
  };

  /*
   * V2 anahtarı mevcut not state'idir.
   * V1 anahtarı da silinmelidir; aksi halde sonraki sayfa
   * yenilemesinde migration eski notları tekrar yükleyebilir.
   */
  await storageRemove(STORAGE_KEY);
  await storageRemove("memorai_notes_state_v1");

  notify();

  return getState();
}


  function getStats() {
    return {
      savedCount: state.savedNotes.length,
      personalCount: state.personalNotes.length,
      draftCount: safeText(state.draftNote) ? 1 : 0,
      sourceCount: state.availableSources.length,
      selectedSourceCount: state.selectedSourceIds.length,
      selectedPersonalNoteCount: state.selectedPersonalNoteIds.length,
    };
  }

  window.AdaptiveRagNotesStore = {
    __moduleName: "notes-store",

    NOTE_TYPES,

    hydrate,
    subscribe,
    getState,
    getStats,

    setAvailableSources,
    getAvailableSources,
    getSelectedSources,
    isSourceSelected,
    toggleSource,
    selectAllSources,
    clearSelectedSources,

    getPersonalNotes,
    getSelectedPersonalNotes,
    isPersonalNoteSelected,
    togglePersonalNote,
    selectAllPersonalNotes,
    clearSelectedPersonalNotes,
    deletePersonalNote,

    setSelectedNoteType,
    setDraftNote,
    clearDraftNote,
    saveDraftNote,

    generateMockNote,
    addGeneratedNote,
    deleteNote,
    updateNoteTitle,
    updateNote,

    setSelectedNote,
    clearSelectedNote,
    getSelectedNote,
    getNoteById,

    buildTxtContent,
    resetNotesState,
    clearNotesSession,
  };

  hydrate();
})();