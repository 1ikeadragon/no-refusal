import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WebSocketLike } from "@getpaseo/client/internal/daemon-client-transport-types";
import WebSocket from "ws";

// The plugin SDK cannot change an existing agent's model yet, so model switches go
// through a second connection to this host's daemon, authenticated with the local
// credential the daemon writes for same-user clients such as the CLI.
let client: DaemonClient | null = null;
let connecting: Promise<DaemonClient> | null = null;

function paseoHome(): string {
  const home = process.env.PASEO_HOME ?? "~/.paseo";
  return home.startsWith("~") ? join(homedir(), home.slice(1)) : home;
}

function readHomeFile(name: string): string | null {
  try {
    return readFileSync(join(paseoHome(), name), "utf8");
  } catch {
    return null;
  }
}

function target(): { url: string; socketPath?: string } {
  const raw = readHomeFile("paseo.pid");
  const listen = raw ? (JSON.parse(raw) as { listen?: unknown }).listen : null;
  if (typeof listen !== "string" || !listen.trim()) {
    throw new Error("The Paseo daemon is not listening locally");
  }
  const value = listen.trim();
  if (value.startsWith("unix://") || value.startsWith("/")) {
    const socketPath = value.replace(/^unix:\/\//, "");
    return { url: `ws+unix://${socketPath}:/ws`, socketPath };
  }
  if (value.startsWith("pipe://") || value.startsWith("\\\\.\\pipe\\")) {
    return { url: "ws://localhost/ws", socketPath: value.replace(/^pipe:\/\//, "") };
  }
  const endpoint = value.replace(/^tcp:\/\//, "");
  return { url: `ws://${/^\d+$/.test(endpoint) ? `127.0.0.1:${endpoint}` : endpoint}/ws` };
}

export async function daemon(): Promise<DaemonClient> {
  if (client?.getConnectionState().status === "connected") return client;
  connecting ??= (async () => {
    await client?.close().catch(() => undefined);
    client = null;
    const { url, socketPath } = target();
    const next = new DaemonClient({
      url,
      clientId: "refusal-fallback",
      clientType: "cli",
      localCredential: () => readHomeFile("local-credential")?.trim() || undefined,
      // Node's built-in WebSocket cannot reach Unix sockets or named pipes.
      webSocketFactory: (wsUrl, options) =>
        new WebSocket(wsUrl, options?.protocols, {
          headers: options?.headers,
          ...(socketPath ? { socketPath } : {}),
        }) as unknown as WebSocketLike,
      reconnect: { enabled: false },
      connectTimeoutMs: 10_000,
    });
    await next.connect();
    client = next;
    return next;
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

export async function closeDaemon(): Promise<void> {
  const current = client;
  client = null;
  await current?.close().catch(() => undefined);
}
