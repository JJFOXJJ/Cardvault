"use client";

import { useEffect } from "react";
import { clearAdded } from "@/lib/session-added";

/** Placed on the main screen: arriving there ends the current adding session. */
export default function ClearJustAdded() {
  useEffect(() => { clearAdded(); }, []);
  return null;
}
