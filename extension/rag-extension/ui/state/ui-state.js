export class UIState {
  constructor() {
    this.messages = [];
    this.isLoading = false;
    this.pageContextAttached = false;
  }

  addMessage(role, text) {
    this.messages.push({
      id: crypto.randomUUID(),
      role,
      text,
      createdAt: Date.now()
    });
  }

  setLoading(value) {
    this.isLoading = Boolean(value);
  }

  setPageContextAttached(value) {
    this.pageContextAttached = Boolean(value);
  }

  reset() {
    this.messages = [];
    this.isLoading = false;
    this.pageContextAttached = false;
  }
}