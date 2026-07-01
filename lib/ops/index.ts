// ── Operations Center ──
// Single-pane-of-glass aggregating all subsystems.
// Queries Mission Engine, Memory, Orchestrator, MCP, Runtime, Redis, Centrifugo.

export interface OpsDashboard {
  timestamp: number;
  system: {
    status: "healthy" | "degraded" | "down";
    uptime: number;
    startTime: number;
  };
  health: {
    redis: boolean;
    centrifugo: boolean;
    convex: boolean;
    triggerdev: boolean;
    desktopWorker: boolean;
  };
  missions: {
    total: number;
    active: number;
    completed: number;
    failed: number;
    successRate: number;
    current?: Record<string, unknown>;
  };
  agents: {
    total: number;
    busy: number;
    idle: number;
    list: Record<string, unknown>[];
  };
  memory: {
    totalEntries: number;
    experiences: number;
    knowledge: number;
    cacheHitRate: number;
  };
  providers: {
    connected: number;
    list: Record<string, unknown>[];
  };
  mcp: {
    servers: number;
    connected: number;
    tools: number;
  };
  orchestration: {
    activeTasks: number;
    completedTasks: number;
    failedTasks: number;
    teamsAvailable: string[];
    agentsAvailable: string[];
  };
  security: {
    approvalRequests: number;
    deniedExecutions: number;
    blockedTools: number;
    authStatus: "ok" | "warning";
  };
}

export class OpsCenter {
  private startTime = Date.now();

  async getDashboard(): Promise<OpsDashboard> {
    const now = Date.now();

    const [missions, orchestration, memory, mcp, runtime] = await Promise.allSettled([
      this.fetch("http://localhost:3006/api/missions/metrics"),
      this.fetch("http://localhost:3006/api/orchestration"),
      this.fetch("http://localhost:3006/api/memory/stats"),
      this.fetch("http://localhost:3006/api/mcp/health"),
      this.fetch("http://localhost:3006/api/runtime/health"),
    ]);

    const missionData = this.value(missions, { totalMissions: 0, completed: 0, failed: 0, active: 0, successRate: 0 });
    const orchData = this.value(orchestration, { activeTasks: 0, completedTasks: 0, failedTasks: 0, teamsAvailable: [], agentsAvailable: [] });
    const memData = this.value(memory, { stats: { totalEntries: 0, byType: { experience: 0, knowledge: 0 }, cacheHitRate: 0 } });
    const mcpData = this.value(mcp, { manager: { servers: [], connectedServers: 0 }, totalTools: 0 });
    const runtimeData = this.value(runtime, { providers: [], status: "stopped" });

    const redisOk = await this.checkRedis();
    const centrifugoOk = await this.checkCentrifugo();

    return {
      timestamp: now,
      system: {
        status: runtimeData.status === "running" ? (redisOk && centrifugoOk ? "healthy" : "degraded") : "degraded",
        uptime: now - this.startTime,
        startTime: this.startTime,
      },
      health: {
        redis: redisOk,
        centrifugo: centrifugoOk,
        convex: false,
        triggerdev: false,
        desktopWorker: mcpData.manager.servers?.some((s: any) => s.id === "desktop-worker" && s.status === "connected") || false,
      },
      missions: {
        total: missionData.totalMissions || 0,
        active: missionData.active || 0,
        completed: missionData.completed || 0,
        failed: missionData.failed || 0,
        successRate: missionData.successRate || 0,
      },
      agents: {
        total: (orchData.agentsAvailable || []).length,
        busy: (orchData.activeTasks || 0) > 0 ? Math.min(orchData.activeTasks || 0, 3) : 0,
        idle: Math.max(0, (orchData.agentsAvailable || []).length - 3),
        list: (orchData.agentsAvailable || []).map((a: string) => ({ name: a, status: "idle" as const })),
      },
      memory: {
        totalEntries: memData.stats?.totalEntries || 0,
        experiences: memData.stats?.byType?.experience || 0,
        knowledge: memData.stats?.byType?.knowledge || 0,
        cacheHitRate: memData.stats?.cacheHitRate || 0,
      },
      providers: {
        connected: (runtimeData.providers || []).filter((p: any) => p.status === "connected").length,
        list: (runtimeData.providers || []).map((p: any) => ({
          name: p.name,
          status: p.status,
          models: (p.models || []).length,
        })),
      },
      mcp: {
        servers: (mcpData.manager?.servers || []).length,
        connected: mcpData.manager?.connectedServers || 0,
        tools: mcpData.totalTools || 0,
      },
      orchestration: {
        activeTasks: orchData.activeTasks || 0,
        completedTasks: orchData.completedTasks || 0,
        failedTasks: orchData.failedTasks || 0,
        teamsAvailable: orchData.teamsAvailable || [],
        agentsAvailable: orchData.agentsAvailable || [],
      },
      security: {
        approvalRequests: 0,
        deniedExecutions: 0,
        blockedTools: 0,
        authStatus: "ok",
      },
    };
  }

  private async fetch(url: string): Promise<any> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json();
    } catch { return null; }
  }

  private value<T>(result: PromiseSettledResult<T>, fallback: T): T {
    return result.status === "fulfilled" ? result.value : fallback;
  }

  private async checkRedis(): Promise<boolean> {
    try {
      const res = await this.fetch("http://localhost:3006/api/memory/health");
      return res?.redis === "connected" || res?.redis === "idle";
    } catch { return false; }
  }

  private async checkCentrifugo(): Promise<boolean> {
    try {
      const res = await fetch("http://127.0.0.1:8000/health", { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch { return false; }
  }
}
