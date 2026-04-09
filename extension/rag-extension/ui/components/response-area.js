import { createElement } from "../utils/dom.js";

export function createResponseArea() {
  const container = document.createElement("section");
  container.className = "response-area";
  container.id = "response-area";

  return container;
}

export function createMessageBubble(role, text) {
  const bubble = createElement("div", `message ${role}`, text);
  return bubble;
}