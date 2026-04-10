import { WidgetController } from "./controllers/widget-controller.js";

function initializeApp() {
  const appRoot = document.getElementById("app");

  if (!appRoot) {
    console.error("App root bulunamadı.");
    return;
  }

  try {
    const controller = new WidgetController(appRoot);
    controller.init();
  } catch (error) {
    console.error("Uygulama başlatılırken hata oluştu:", error);
  }
}

document.addEventListener("DOMContentLoaded", initializeApp);