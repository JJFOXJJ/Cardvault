// Read a checklist from a CSV (or tab-separated) file for the admin's "Add a set" import.
// Accepts a header row with common names ("Card #", "Number", "Player", "Name", "Subset", "Insert"…)
// or no header at all (number, name, subset).

import type { ChecklistEntry } from "./checklist";
import { sameCollection } from "./collections";

/** Split CSV text into rows, handling quotes, escaped quotes and commas/newlines inside quotes. */
export function csvRows(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  const delim = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? "\t" : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

const NUM = /^(card\s*)?(#|no\.?|num(ber)?|card\s*(no|num(ber)?)|card_number|cardnumber|card)$/i;
const NAME = /^(name|player|player\s*name|player_name|character|subject|card\s*name|card_name|title|description)$/i;
const SUB = /^(subset|sub\s*set|insert|insert\s*set|parallel|series|variant|type|rarity|set\s*type)$/i;

/** Parse a checklist CSV. Returns the cards and any notes about what was skipped. */
export function parseChecklistCsv(text: string, opts: { setName?: string } = {}): { entries: ChecklistEntry[]; notes: string[] } {
  if (text.length > 2_000_000) throw new Error("That file is too big for a checklist (over 2 MB).");
  const rows = csvRows(text);
  if (!rows.length) throw new Error("The file is empty.");
  const head = rows[0].map((h) => h.toLowerCase());
  let iNum = head.findIndex((h) => NUM.test(h)), iName = head.findIndex((h) => NAME.test(h)), iSub = head.findIndex((h) => SUB.test(h));
  // A collection export (set_name, name, subject, card_number…): prefer the player/subject column.
  const iSubject = head.findIndex((h) => h === "subject");
  if (iSubject !== -1) iName = iSubject;
  const hasHeader = iNum !== -1 || iName !== -1;
  if (!hasHeader) { iNum = 0; iName = 1; iSub = rows[0].length > 2 ? 2 : -1; }
  if (iName === -1) iName = iNum === 0 ? 1 : 0;
  const notes: string[] = [];
  // Files covering several sets (e.g. a collection export): keep only the rows for this set.
  const iSet = hasHeader ? head.findIndex((h) => /^(set|set_name|set name|collection)$/.test(h)) : -1;
  let body = rows.slice(hasHeader ? 1 : 0);
  if (iSet !== -1 && opts.setName?.trim()) {
    const before = body.length;
    body = body.filter((r) => { const v = (r[iSet] ?? "").trim(); return !!v && (v.toLowerCase() === opts.setName!.trim().toLowerCase() || sameCollection(v, opts.setName!)); });
    if (body.length < before) notes.push(`Kept the ${body.length} row${body.length === 1 ? "" : "s"} for “${opts.setName.trim()}” (the file lists other sets too).`);
  }
  const seen = new Set<string>();
  const entries: ChecklistEntry[] = [];
  let skipped = 0, dupes = 0;
  for (const r of body) {
    const name = (r[iName] ?? "").trim();
    const number = iNum !== -1 ? (r[iNum] ?? "").replace(/^#/, "").trim() || null : null;
    if (!name || !/[A-Za-z]/.test(name)) { skipped++; continue; }
    const subset = iSub !== -1 ? (r[iSub] ?? "").trim() || null : null;
    const key = `${(number ?? "").toLowerCase()}|${(subset ?? "").toLowerCase()}|${number ? "" : name.toLowerCase()}`;
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);
    entries.push({ number, name: name.slice(0, 120), subset: subset?.slice(0, 60) ?? null });
  }
  if (!hasHeader) notes.push("No header row found — read the columns as number, name, subset.");
  if (skipped) notes.push(`${skipped} row${skipped === 1 ? "" : "s"} without a name skipped.`);
  if (dupes) notes.push(`${dupes} repeated card${dupes === 1 ? "" : "s"} skipped.`);
  if (!entries.length) throw new Error("Couldn't find any cards in that file. Use columns like “Number, Name” (and optionally “Subset”).");
  return { entries, notes };
}

/** Quick checks shown on the review screen: missing numbers in the run, numbers used twice, etc. */
export function checklistWarnings(entries: ChecklistEntry[]): string[] {
  const out: string[] = [];
  const base = entries.filter((e) => !e.subset && /^\d+$/.test(e.number ?? ""));
  const nums = base.map((e) => Number(e.number)).sort((a, b) => a - b);
  if (nums.length >= 10) {
    const missing: number[] = [];
    for (let n = nums[0]; n <= nums[nums.length - 1] && missing.length < 30; n++) if (!nums.includes(n)) missing.push(n);
    if (missing.length) out.push(`Numbers missing from the run ${nums[0]}–${nums[nums.length - 1]}: ${missing.slice(0, 15).join(", ")}${missing.length > 15 ? "…" : ""}`);
  }
  const count = new Map<string, number>();
  for (const e of entries) if (e.number) { const k = `${e.subset ?? ""}|${e.number}`; count.set(k, (count.get(k) ?? 0) + 1); }
  const twice = [...count.entries()].filter(([, n]) => n > 1).map(([k]) => k.split("|")[1]);
  if (twice.length) out.push(`Numbers used more than once: ${twice.slice(0, 10).join(", ")}`);
  const noNum = entries.filter((e) => !e.number).length;
  if (noNum) out.push(`${noNum} card${noNum === 1 ? " has" : "s have"} no number.`);
  return out;
}
