export function createLauncher() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hidden";
  button.id = "rag-launcher";
  button.textContent = "Open";

  return button;
}