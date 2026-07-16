import { getStoredChats, upsertStoredChat, getStoredMessages, appendStoredMessage, deleteStoredChat } from "@/lib/utils/client-storage";

// ── Global invalidation ──
let _globalNotify: (() => void) | null = null;
export function notifyChatListChanged() { if (_globalNotify) _globalNotify(); }

export class MockConvexClient {
  private updateCallbacks: Array<() => void> = [];
  notifyAll() { for (const cb of this.updateCallbacks) cb(); }

  constructor() {
    _globalNotify = () => this.notifyAll();
  }
  setAuth(_fetchToken: unknown, onChange: (value: boolean) => void) { onChange(true); }

  watchQuery(_query: unknown, args?: Record<string, unknown>) {
    const w = { localQueryResult: () => {
      if (args && typeof args.id === "string" && args.id.length > 10) { const c = getStoredChats(); return c.find((x)=>x.id===args!.id)??null; }
      if (args && args.paginationOpts) { const c = getStoredChats(); return { page: c, isDone: true, continueCursor: "" }; }
      return undefined;
    }, onUpdate: (cb: () => void) => { this.updateCallbacks.push(cb); return () => { this.updateCallbacks = this.updateCallbacks.filter((c)=>c!==cb); }; } };
    return w;
  }

  watchPaginatedQuery(_query: unknown, args?: Record<string, unknown>) {
    const w = { localQueryResult: () => {
      if (typeof args === "string") return { page: [], isDone: true, continueCursor: "" };
      if (args && typeof args === "object" && "chatId" in args) { const m = getStoredMessages(args.chatId as string); return { page: m, isDone: true, continueCursor: "" }; }
      const c = getStoredChats(); return { page: c, isDone: true, continueCursor: "" };
    }, onUpdate: (cb: () => void) => { this.updateCallbacks.push(cb); return () => { this.updateCallbacks = this.updateCallbacks.filter((c)=>c!==cb); }; }, loadMore: () => {}, pageSize: 28 };
    return w;
  }

  async mutation(_mutation: unknown, args?: Record<string, unknown>) {
    if (!args) return {};
    if ("connectionName" in args && "osInfo" in args && !("id" in args) && !("chatId" in args)) { const wsUrl="ws://127.0.0.1:8000/connection/websocket"; const cid="desktop-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8); try { const r=await fetch("/api/sandbox/desktop-connect",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({connectionName:args.connectionName,osInfo:args.osInfo})}); if(r.ok){const d=await r.json();return{connectionId:d.connectionId||cid,centrifugoToken:d.centrifugoToken,centrifugoWsUrl:wsUrl}} } catch{} return{connectionId:cid,centrifugoToken:"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZXNrdG9wLXVzZXIiLCJleHAiOjk5OTk5OTk5OTl9.fallback",centrifugoWsUrl:wsUrl}; }
    if ("fileId" in args && typeof args.fileId === "string" && args.fileId.startsWith("local-") && !("id" in args) && !("chatId" in args)) { fetch("/api/local-file/upload",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileId:args.fileId})}).catch(()=>{}); try{const r=localStorage.getItem("hwai:local-files");if(r){const f=JSON.parse(r);const ff=f.filter((x:{fileId:string})=>x.fileId!==args!.fileId);localStorage.setItem("hwai:local-files",JSON.stringify(ff))} localStorage.removeItem("hwai:file:"+args.fileId)}catch{} return{}; }
    if ("id" in args && "title" in args && typeof args.id === "string") { upsertStoredChat({_id:args.id as string,id:args.id as string,title:(args.title as string)||"New Chat",update_time:Date.now(),user_id:args.userId as string|undefined}); this.notifyAll(); }
    if ("chatId" in args && "role" in args && "parts" in args) { appendStoredMessage(args.chatId as string,{_id:(args.id as string)||"",id:(args.id as string)||"",chatId:args.chatId as string,role:(args.role as "system"|"user"|"assistant")||"user",parts:(args.parts as unknown[])||[],content:args.content as string|undefined,update_time:Date.now(),model:args.model as string|undefined,mode:args.mode as string|undefined,finish_reason:args.finish_reason as string|undefined,usage:args.usage}); this.notifyAll(); }
    return {};
  }

  async action(_action: unknown, args?: Record<string, unknown>) {
    if (args && "fileId" in args && typeof args.fileId === "string" && args.fileId.startsWith("local-")) return { url: "/api/local-file/"+args.fileId };
    if (args && "fileIds" in args && Array.isArray(args.fileIds)) { const u: Record<string,string>={}; for(const f of args.fileIds){const s=f as string;if(s.startsWith("local-"))u[s]="/api/local-file/"+s} return u; }
    return {};
  }

  subscribeToConnectionState() { return () => {}; }
  clearAuth() {}
  async close() {}
  get connectionState() { return { connectionCount: 0, isConnected: false }; }
}

// ── Local mode mutation helpers ──
// Bypass Convex's useMutation for local-only mode.
// Convex validates args against schema — extra fields like _action are rejected.
// These helpers call the storage layer directly with proper args.
export function localDeleteChat(chatId: string): void {
  deleteStoredChat(chatId);
  notifyChatListChanged();
}

export function localRenameChat(chatId: string, newTitle: string): void {
  upsertStoredChat({ _id: chatId, id: chatId, title: newTitle, update_time: Date.now() });
  notifyChatListChanged();
}
