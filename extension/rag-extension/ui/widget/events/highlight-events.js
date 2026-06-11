(function () {
  function bindHighlightEvents() {
    document.querySelectorAll(".rag-highlight-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const selector = button.dataset.selector;

        if (!selector) {
          alert("Bu chunk için kaynak seçici bilgisi yok.");
          return;
        }

        const targetElement = document.querySelector(selector);

        if (!targetElement) {
          alert("Bu kaynak bölümü mevcut sayfada bulunamadı.");
          return;
        }

        targetElement.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });

        targetElement.classList.add("rag-highlighted-source");

        setTimeout(() => {
          targetElement.classList.remove("rag-highlighted-source");
        }, 2500);
      });
    });
  }

  window.AdaptiveRagHighlightEvents = {
    bindHighlightEvents
  };
})();