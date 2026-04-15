import { API_BASE_URL } from "./api";

function toWebSocketUrl(httpUrl) {
  if (httpUrl.startsWith("https://")) {
    return httpUrl.replace("https://", "wss://");
  }
  return httpUrl.replace("http://", "ws://");
}

export function connectRealtime(onMessage, accessToken) {
  const tokenQuery = accessToken ? `?access_token=${encodeURIComponent(accessToken)}` : "";
  const ws = new WebSocket(`${toWebSocketUrl(API_BASE_URL)}/ws/updates${tokenQuery}`);

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      onMessage(payload);
    } catch {
      // Ignore malformed socket payloads.
    }
  };

  return ws;
}
