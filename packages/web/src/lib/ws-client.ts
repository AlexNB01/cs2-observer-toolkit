import { useEffect, useRef, useState } from "react";
import type { ClientToServerMessage, ServerToClientMessage } from "@cs2hud/shared";

export interface HudSocketState {
  connected: boolean;
  lastMessage: ServerToClientMessage | null;
  send: (message: ClientToServerMessage) => void;
}

/**
 * Connects to the shared WS hub (see server/src/ws/hub.ts) and reconnects
 * with backoff on drop. Any page (admin, HUD, minimap, veto) can use this
 * to receive gsi_event / settings_updated / veto_updated pushes, and admin
 * pages can use `send` for things like trigger_preview.
 */
export function useHudSocket(onMessage?: (message: ServerToClientMessage) => void): HudSocketState {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<ServerToClientMessage | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        if (!cancelled) reconnectTimer = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket.close();
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerToClientMessage;
        setLastMessage(message);
        onMessageRef.current?.(message);
      };
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, []);

  function send(message: ClientToServerMessage) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }

  return { connected, lastMessage, send };
}
