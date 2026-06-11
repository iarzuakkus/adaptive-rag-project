(function () {
  const RESEARCH_STORE_KEY = "adaptive_rag_research_store";

  const defaultResearchData = {
    pages: [
      {
        id: "page-1",
        title: "Adaptive RAG Nedir?",
        url: "https://example.com/adaptive-rag",
        summary:
          "Bu sayfa Adaptive RAG yaklaşımının kullanıcı davranışına göre bağlam oluşturmasını anlatıyor.",
        scannedAt: "2026-06-11 14:20",
        chunks: [
          {
            id: "chunk-1",
            text: "Adaptive RAG, kullanıcının okuma geçmişine göre en uygun içerik parçalarını getirir.",
            sourceSelector: "p:nth-of-type(2)"
          },
          {
            id: "chunk-2",
            text: "Sistem, embedding ve semantic search kullanarak bağlam üretir.",
            sourceSelector: "p:nth-of-type(4)"
          }
        ]
      }
    ],

    notes: {
      generalSummary:
        "Şu ana kadar taranan içerikler Adaptive RAG, Chrome eklentisi mimarisi, kaynaklı cevap üretimi ve not alma mantığı etrafında yoğunlaşıyor.",

      quotes: [
        {
          id: "quote-1",
          text: "Adaptive RAG, kullanıcının gezdiği sayfalardan kişisel bir bilgi deposu oluşturabilir.",
          sourceTitle: "Adaptive RAG Nedir?",
          sourceUrl: "https://example.com/adaptive-rag",
          createdAt: "2026-06-11 15:15"
        }
      ],

      recommendations: [
        {
          id: "rec-1",
          title: "IndexedDB üzerinde vector store yapısını güçlendir",
          reason:
            "Okuma geçmişi büyüdükçe local arama performansı ve metadata yönetimi önemli hale gelir."
        }
      ]
    },

    timeline: [
      {
        id: "time-1",
        type: "scan",
        title: "Adaptive RAG Nedir? sayfası tarandı",
        time: "2026-06-11 14:20"
      }
    ]
  };

  function getResearchData() {
    const savedData = localStorage.getItem(RESEARCH_STORE_KEY);

    if (!savedData) {
      saveResearchData(defaultResearchData);
      return defaultResearchData;
    }

    try {
      return JSON.parse(savedData);
    } catch (error) {
      console.error("Research store okunamadı:", error);
      saveResearchData(defaultResearchData);
      return defaultResearchData;
    }
  }

  function saveResearchData(data) {
    localStorage.setItem(RESEARCH_STORE_KEY, JSON.stringify(data));
  }

  function addScannedPage(page) {
    const data = getResearchData();

    const newPage = {
      id: `page-${Date.now()}`,
      title: page.title || "Başlıksız Sayfa",
      url: page.url || "",
      summary: page.summary || "Bu sayfa için henüz özet oluşturulmadı.",
      scannedAt: new Date().toLocaleString("tr-TR"),
      chunks: page.chunks || []
    };

    const existingPage = data.pages.find((item) => item.url === newPage.url);

    if (existingPage) {
      return existingPage;
    }

    data.pages.unshift(newPage);

    data.timeline.unshift({
      id: `time-${Date.now()}`,
      type: "scan",
      title: `${newPage.title} sayfası tarandı`,
      time: newPage.scannedAt
    });

    saveResearchData(data);
    return newPage;
  }

  window.AdaptiveRagStore = {
    getResearchData,
    saveResearchData,
    addScannedPage
  };
})();