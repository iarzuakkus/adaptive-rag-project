export function bindInputActions({
  inputEl,
  sendBtn,
  attachBtn,
  clearBtn,
  counterEl,
  onSend,
  onAttachPage,
  onClear
}) {
  if (inputEl && counterEl) {
    inputEl.addEventListener("input", () => {
      counterEl.textContent = `${inputEl.value.length} / 2000`;
    });

    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        onSend();
      }
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", onSend);
  }

  if (attachBtn) {
    attachBtn.addEventListener("click", onAttachPage);
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", onClear);
  }
}