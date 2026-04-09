export function createElement(tag, className = "", content = "") {
  const el = document.createElement(tag);

  if (className) {
    el.className = className;
  }

  if (content) {
    el.textContent = content;
  }

  return el;
}

export function clearElement(element) {
  if (!element) return;
  element.innerHTML = "";
}