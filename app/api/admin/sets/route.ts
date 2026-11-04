import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { approve, getCatalogSet, merge, rename, setChecklist, setOverview, unapprove, updateDetails } from "@/lib/catalog";
import { checklistFromUrl, findChecklist, parsePasted } from "@/lib/checklist";

export const maxDuration = 300;

/** Admin: the set list overview, or one approved set's checklist (?id=). Set names and counts only — never cards. */
export async function GET(req: NextRequest) {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const s = await getCatalogSet(id);
    return s ? NextResponse.json({ set: s }) : jsonError("Set not found", 404);
  }
  return NextResponse.json(await setOverview());
}

type Body = {
  action?: "approve" | "merge" | "rename" | "details" | "unapprove" | "checklist";
  name?: string; names?: string[]; target?: string; id?: string;
  category?: string; year?: string; manufacturer?: string;
  mode?: "link" | "find" | "text"; url?: string; text?: string;
};

export async function POST(req: NextRequest) {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b?.action) return jsonError("Nothing to do");
  try {
    switch (b.action) {
      case "approve":
        return NextResponse.json({ name: await approve(b.name ?? "", { category: b.category ?? null, year: b.year ?? null, manufacturer: b.manufacturer ?? null }) });
      case "merge":
        if (!b.names?.length || !b.target) return jsonError("Choose the names to merge and the approved name");
        return NextResponse.json(await merge(b.names, b.target));
      case "rename":
        return NextResponse.json(await rename(b.id ?? "", b.name ?? ""));
      case "details":
        await updateDetails(b.id ?? "", b);
        return NextResponse.json({ ok: true });
      case "unapprove":
        await unapprove(b.id ?? "");
        return NextResponse.json({ ok: true });
      case "checklist": {
        const s = await getCatalogSet(b.id ?? "");
        if (!s) return jsonError("Set not found", 404);
        if (b.mode === "text") {
          const list = parsePasted(b.text ?? "");
          if (!list.length) return jsonError("Couldn't read any cards — one per line, like “192 Craig Ehlo”.");
          return NextResponse.json(await setChecklist(s.id, list, "pasted", null));
        }
        if (b.mode === "link") {
          const list = await checklistFromUrl(s.name, b.url ?? "", me.id);
          return NextResponse.json(await setChecklist(s.id, list, "link", b.url!.trim()));
        }
        if (b.mode === "find") {
          const f = await findChecklist(me.id, s.name, { search: true, force: true, skipApproved: true });
          if (!f || f.needsSearch) return jsonError("Couldn't find a checklist online for this set. Try a checklist link instead.", 404);
          return NextResponse.json({ ...(await setChecklist(s.id, f.list, f.source, f.url || null)), incomplete: !!f.incomplete });
        }
        return jsonError("Choose how to load the checklist");
      }
    }
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Something went wrong", 500);
  }
  return jsonError("Unknown action");
}
