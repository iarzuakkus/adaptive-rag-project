const ADAPTIVE_RAG_SESSION_KEY = "adaptive_rag_global_chat_session";

async function getChatSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get([ADAPTIVE_RAG_SESSION_KEY], (result) => {
      const messages = result[ADAPTIVE_RAG_SESSION_KEY];

      if (!Array.isArray(messages)) {
        resolve([]);
        return;
      }

      resolve(messages);
    });
  });
}

async function saveChatSession(messages) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [ADAPTIVE_RAG_SESSION_KEY]: messages
      },
      () => resolve()
    );
  });
}

async function addMessageToSession(role, content) {
  const messages = await getChatSession();

  const newMessage = {
    id: crypto.randomUUID(),
    role,
    content,
    pageUrl: window.location.href,
    pageTitle: document.title,
    createdAt: new Date().toISOString()
  };

  messages.push(newMessage);

  await saveChatSession(messages);

  return messages;
}

async function clearChatSession() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([ADAPTIVE_RAG_SESSION_KEY], () => resolve());
  });
}

async function getLastMessages(limit = 12) {
  const messages = await getChatSession();

  return messages.slice(-limit);
}