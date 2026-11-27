// This site's own agent network, as the official runtime loaded it from this origin's
// published files. Read once the runtime is ready.
import { useEffect, useState } from "react";
import { loadRuntime } from "@/interop/runtime";
import { useUi } from "@/state/ui";

export interface OwnAgent { name: string; description: string; calls: string[]; isFront: boolean }
export interface OwnNetwork {
  name: string;
  url: string;
  origin: string;
  front: string;
  agents: OwnAgent[];
  actions: { name: string; effect: string; description: string }[];
  allowedPeers: string[];
  policy: string;
}

let cached: OwnNetwork | null = null;

export async function readOwnNetwork(): Promise<OwnNetwork | null> {
  if (cached) return cached;
  try {
    const { engine, base } = await loadRuntime();
    const network = engine.top.network;
    const front = network.findFrontMan();
    cached = {
      name: network.name,
      url: `${base}/${network.name}`,
      origin: window.location.origin,
      front,
      agents: (network.config.tools || []).map((agent: { name: string; function?: { description?: string }; tools?: unknown[] }) => ({
        name: agent.name,
        description: agent.function?.description || "",
        calls: (agent.tools || []).filter((tool): tool is string => typeof tool === "string"),
        isFront: agent.name === front,
      })),
      actions: engine.actions.catalog({ base: engine.top.base, network: network.name }).map((action: { name: string; effect: string; description?: string }) => ({ name: action.name, effect: action.effect, description: action.description || "" })),
      allowedPeers: engine.top.manifest.allowed_peers || [],
      policy: engine.top.manifest.peer_policy?.mode || "",
    };
    return cached;
  } catch {
    return null;
  }
}

export function useOwnNetwork(): OwnNetwork | null {
  const [own, setOwn] = useState<OwnNetwork | null>(cached);
  const state = useUi((ui) => ui.runtime.state);
  useEffect(() => {
    if (state !== "ready") return;
    let live = true;
    void readOwnNetwork().then((value) => { if (live) setOwn(value); });
    return () => { live = false; };
  }, [state]);
  return own;
}
