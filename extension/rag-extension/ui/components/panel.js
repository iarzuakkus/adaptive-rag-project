import { createHeader } from "./header.js";
import { createResponseArea } from "./response-area.js";
import { createInputArea } from "./input-area.js";

export function createPanel() {
  const panel = document.createElement("main");
  panel.className = "panel";

  const header = createHeader();
  const responseArea = createResponseArea();
  const inputArea = createInputArea();

  panel.appendChild(header);
  panel.appendChild(responseArea);
  panel.appendChild(inputArea);

  return {
    panel,
    header,
    responseArea,
    inputArea
  };
}