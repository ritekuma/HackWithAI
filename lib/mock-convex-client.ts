import { getStoredChats, upsertStoredChat, getStoredMessages, appendStoredMessage, deleteStoredChat } from "@/lib/utils/client-storage";

export class MockConvexClient {
  private updateCallbacks: Array<() => void> = [];
  notifyAll() { for (const cb of this.updateCallbacks) cb(); }
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
    if ("connectionId" in args && Object.keys(args).length===1 && !("id" in args) && !("chatId" in args) && !("connectionName" in args) && !("fileId" in args)) { const n=String((_mutation as any)?.name||(_mutation as any)?._name||""); if(n.toLowerCase().includes("disconnect"))return{success:true}; return{ok:true,centrifugoToken:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsb2NhbC1kZXYtdXNlciIsImV4cCI6OTk5OTk5OTk5OX0.mock_refresh"}; }
    if ("fileId" in args && typeof args.fileId === "string" && args.fileId.startsWith("local-") && !("id" in args) && !("chatId" in args)) { fetch("/api/local-file/upload",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileId:args.fileId})}).catch(()=>{}); try{const r=localStorage.getItem("hwai:local-files");if(r){const f=JSON.parse(r);const ff=f.filter((x:{fileId:string})=>x.fileId!==args!.fileId);localStorage.setItem("hwai:local-files",JSON.stringify(ff))} localStorage.removeItem("hwai:file:"+args.fileId)}catch{} return{}; }
    if ("id" in args && "title" in args && typeof args.id === "string") { upsertStoredChat({_id:args.id as string,id:args.id as string,title:(args.title as string)||"New Chat",update_time:Date.now(),user_id:args.userId as string|undefined}); this.notifyAll(); }
    if ("chatId" in args && "role" in args && "parts" in args) { appendStoredMessage(args.chatId as string,{_id:(args.id as string)||"",id:(args.id as string)||"",chatId:args.chatId as string,role:(args.role as "system"|"user"|"assistant")||"user",parts:(args.parts as unknown[])||[],content:args.content as string|undefined,update_time:Date.now(),model:args.model as string|undefined,mode:args.mode as string|undefined,finish_reason:args.finish_reason as string|undefined,usage:args.usage}); this.notifyAll(); }
    if ("chatId" in args && typeof args.chatId === "string" && !("role" in args) && !("title" in args) && !("id" in args)) { deleteStoredChat(args.chatId as string); this.notifyAll(); }
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
