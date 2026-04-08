const scrapeBtn = document.getElementById("scrapeBtn");
const pdfBtn = document.getElementById("pdfBtn");
const askBtn = document.getElementById("askBtn");
const questionInput = document.getElementById("questionInput");
const output = document.getElementById("output");

function setOutput(text) {
  output.textContent = text;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs && tabs.length > 0 ? tabs[0] : null;
}

scrapeBtn.addEventListener("click", async () => {
  setOutput("Sayfa kazınıyor...");

  try {
    const tab = await getActiveTab();

    if (!tab || !tab.id) {
      setOutput("Aktif sekme bulunamadı.");
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_PAGE" }, async (response) => {
      if (chrome.runtime.lastError) {
        setOutput(`Hata: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (!response || !response.success) {
        setOutput("Sayfa verisi alınamadı.");
        return;
      }

      const rawData = response.data;
      const cleanedContent = cleanText(rawData.content);
      const chunks = chunkText(cleanedContent, 500);

      const payload = {
        title: rawData.title,
        url: rawData.url,
        content: cleanedContent,
        chunks
      };

      const result = await sendPageData(payload);

      setOutput(
        `Başlık: ${rawData.title}\n\n` +
        `URL: ${rawData.url}\n\n` +
        `Toplam karakter: ${cleanedContent.length}\n` +
        `Chunk sayısı: ${chunks.length}\n\n` +
        `Backend sonucu:\n${JSON.stringify(result, null, 2)}`
      );
    });
  } catch (error) {
    setOutput(`Beklenmeyen hata: ${error.message}`);
  }
});

pdfBtn.addEventListener("click", async () => {
  setOutput("PDF kontrol ediliyor...");

  try {
    const tab = await getActiveTab();

    if (!tab || !tab.id) {
      setOutput("Aktif sekme bulunamadı.");
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: "CHECK_PDF" }, async (response) => {
      if (chrome.runtime.lastError) {
        setOutput(`Hata: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (!response || !response.success) {
        setOutput("PDF kontrolü yapılamadı.");
        return;
      }

      if (!response.isPdf) {
        setOutput("Bu sekme PDF gibi görünmüyor.");
        return;
      }

      const result = await sendPdfUrl(response.url);

      setOutput(
        `PDF URL:\n${response.url}\n\n` +
        `Backend sonucu:\n${JSON.stringify(result, null, 2)}`
      );
    });
  } catch (error) {
    setOutput(`Beklenmeyen hata: ${error.message}`);
  }
});

askBtn.addEventListener("click", async () => {
  const question = questionInput.value.trim();

  if (!question) {
    setOutput("Lütfen bir soru yaz.");
    return;
  }

  setOutput("Soru backend'e gönderiliyor...");

  try {
    const result = await askQuestion(question);

    setOutput(
      `Soru:\n${question}\n\n` +
      `Cevap:\n${result.answer || "Cevap alınamadı."}\n\n` +
      `Detay:\n${JSON.stringify(result, null, 2)}`
    );
  } catch (error) {
    setOutput(`Beklenmeyen hata: ${error.message}`);
  }
});