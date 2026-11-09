import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { listPokemonSets, pokemonSetChecklist, pokemonDisplayName } from "@/lib/pokemon";
import { setTokens } from "@/lib/collections";
import { addSet, catalog } from "@/lib/catalog";
import { checklistFromUrl, findChecklist, type ChecklistEntry } from "@/lib/checklist";
import { checklistWarnings, parseChecklistCsv } from "@/lib/importer";

export const maxDuration = 300;

/** Admin only: the Pokémon set catalogue, with which sets are already on the approved list. */
export async function GET() {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  const [{ sets, source }, cat] = await Promise.all([listPokemonSets(), catalog()]);
  const have = new Map(cat.sets.map((s) => [s.name.toLowerCase(), s.checklist.length]));
  return NextResponse.json({
    source,
    sets: sets.map((s) => {
      const name = pokemonDisplayName(s.name);
      return { ...s, displayName: name, added: have.has(name.toLowerCase()), cardsSaved: have.get(name.toLowerCase()) ?? 0 };
    }),
  });
}

type Body = {
  action?: "pokemon" | "preview" | "save";
  id?: string; source?: "pokemontcg" | "tcgdex";              // pokemon
  mode?: "link" | "csv" | "web"; url?: string; csv?: string; // preview
  name?: string; category?: string; year?: string; manufacturer?: string;
  entries?: ChecklistEntry[]; checklistSource?: string;      // save
};

export async function POST(req: NextRequest) {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b?.action) return jsonError("Nothing to do");
  try {
    // Pokémon: picking a set loads its full checklist (with official pictures and prices) and saves it.
    if (b.action === "pokemon") {
      const p = await pokemonSetChecklist(b.id ?? "", b.source === "tcgdex" ? "tcgdex" : "pokemontcg");
      if (!p) return jsonError("Couldn't load that set from the Pokémon card databases right now — try again in a minute.", 502);
      // "Pokémon Base", not "Base" — so it can't be confused with other cards. A specific plain name is kept as an alias.
      const r = await addSet({ name: pokemonDisplayName(p.name), category: "Pokémon", year: p.year, manufacturer: "Pokémon", entries: p.entries, source: "pokemon", url: p.url,
        aliases: setTokens(p.name).length >= 2 ? [p.name] : [] });
      return NextResponse.json(r);
    }

    // Other sets: read a link or a CSV and return the list to check — nothing is saved yet.
    if (b.action === "preview") {
      const name = b.name?.trim();
      if (!name) return jsonError("Type the set's name first.");
      let entries: ChecklistEntry[] = [], notes: string[] = [];
      if (b.mode === "csv") ({ entries, notes } = parseChecklistCsv(b.csv ?? "", { setName: name }));
      else if (b.mode === "link") entries = await checklistFromUrl(name, b.url ?? "", me.id);
      else if (b.mode === "web") {
        // Last resort: search the web (up to 2 searches). Shown for review like any import.
        const f = await findChecklist(me.id, name, { search: true, force: true, skipApproved: true });
        if (!f || f.needsSearch || !f.list.length) return jsonError("The web search didn't find a checklist for this set. Try a checklist link or a CSV.", 404);
        entries = f.list;
        notes = ["Found by web search (last resort) — check it carefully before saving.", ...(f.incomplete ? ["It may be incomplete."] : [])];
      } else return jsonError("Choose a link or a CSV file.");
      return NextResponse.json({ entries, notes, warnings: checklistWarnings(entries) });
    }

    // Save the checked list: approved set list + shared library; everyone tracking the set is updated.
    if (b.action === "save") {
      if (!Array.isArray(b.entries) || !b.entries.length) return jsonError("The checklist is empty.");
      const source = ["link", "csv", "web", "pasted"].includes(b.checklistSource ?? "") ? b.checklistSource! : "csv";
      return NextResponse.json(await addSet({ name: b.name ?? "", category: b.category, year: b.year, manufacturer: b.manufacturer, entries: b.entries, source, url: b.url ?? null }));
    }
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Something went wrong", 400);
  }
  return jsonError("Unknown action");
}
