"use client";

import { useState } from "react";
import { api } from "./client";

export type TrackResult = { id: string; total: number; error?: string };

/** Start tracking a set: create it, find its checklist, then run the one price lookup. */
export function useTrackSet() {
  const [stage, setStage] = useState("");
  const [busy, setBusy] = useState(false);

  async function track(name: string): Promise<TrackResult | null> {
    setBusy(true);
    try {
      setStage("Setting up the set…");
      const { id } = await api<{ id: string }>("/api/sets", { method: "POST", body: JSON.stringify({ name, tracking: true }) });
      setStage("Finding the checklist… (usually 15–40 seconds)");
      let total = 0;
      try {
        total = (await api<{ total: number }>(`/api/sets/${id}/build`, { method: "POST", body: "{}" })).total;
      } catch (e) {
        return { id, total: 0, error: e instanceof Error ? e.message : "Couldn't find a checklist" };
      }
      setStage(`Found ${total} cards. Estimating values…`);
      await api(`/api/sets/${id}/price`, { method: "POST" }).catch(() => null); // values can be added later
      return { id, total };
    } catch (e) {
      return { id: "", total: 0, error: e instanceof Error ? e.message : "Couldn't start tracking" };
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  async function decline(name: string) {
    await api("/api/sets", { method: "POST", body: JSON.stringify({ name, tracking: false }) }).catch(() => null);
  }

  return { track, decline, stage, busy };
}
