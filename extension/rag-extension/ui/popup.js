import { WidgetController } from "./controllers/widget-controller.js";

document.addEventListener("DOMContentLoaded", () => {
  const appRoot = document.getElementById("app");

  if (!appRoot) {
    console.error("App root bulunamadı.");
    return;
  }

  const controller = new WidgetController(appRoot);
  controller.init();
});