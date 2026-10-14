import { contextBridge, ipcRenderer } from "electron";

/**
 * Pont entre l'interface et le système : uniquement ces fonctions, rien
 * d'autre (contextIsolation + sandbox). Les types côté interface sont dans
 * `src/lib/bridge.ts`.
 */
contextBridge.exposeInMainWorld("klyra", {
  agents: {
    list: () => ipcRenderer.invoke("agents:list"),
    write: (name: string, content: string, expectedModifiedAt: number | null) =>
      ipcRenderer.invoke("agents:write", name, content, expectedModifiedAt),
    create: (name: string, content: string) => ipcRenderer.invoke("agents:create", name, content),
    installTeam: (templates: { name: string; content: string }[]) => ipcRenderer.invoke("agents:install", templates),
    history: (name: string) => ipcRenderer.invoke("agents:history", name),
    readVersion: (name: string, id: string) => ipcRenderer.invoke("agents:version", name, id),
    readMeta: () => ipcRenderer.invoke("agents:meta:read"),
    writeMeta: (meta: unknown) => ipcRenderer.invoke("agents:meta:write", meta),
    reveal: (name: string) => ipcRenderer.invoke("agents:reveal", name),
    onChange: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("agents:changed", listener);
      return () => ipcRenderer.removeListener("agents:changed", listener);
    },
  },
  claude: {
    status: () => ipcRenderer.invoke("claude:status"),
    run: (requestId: string, agent: string, prompt: string) => ipcRenderer.invoke("claude:run", requestId, agent, prompt),
    cancel: (requestId: string) => ipcRenderer.invoke("claude:cancel", requestId),
  },
});
