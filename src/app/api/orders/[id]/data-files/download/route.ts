import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getResolvedDataBasePath } from "@/lib/files/data-base-path";
import { ensureWithinBase } from "@/lib/files/paths";
import { authorizeDataFiles, DataFilesError, getDataFilesInventory } from "@/lib/orders/data-files.server";
import { dataFilesErrorResponse } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const downloadSchema = z.union([
  z.object({ readId: z.string().min(1).max(200), mate: z.enum(["1", "2"]) }).strict(),
  z.object({ artifactId: z.string().min(1).max(200) }).strict(),
]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const access = await authorizeDataFiles(session, (await params).id);
    if (session?.user.isDemo) throw new DataFilesError(403, "Downloads are disabled in the public demo");
    const query = new URL(request.url).searchParams;
    const parsed = downloadSchema.safeParse(Object.fromEntries(query));
    if (!parsed.success) throw new DataFilesError(400, "Choose a read file or report to download");
    // Inventory applies ownership and facility publication filters. An ID does
    // not grant access to unreleased reads or internal facility reports.
    const inventory = await getDataFilesInventory(access);
    const target = parsed.data;
    const file = "readId" in target
      ? inventory.readSets.find(read => read.id === target.readId)?.files.find(file =>
          target.mate === "2" ? file.role === "R2" : file.role === "R1" || file.role === "single"
        )
      : inventory.artifacts.find(artifact => artifact.id === target.artifactId)?.file;
    if (!file?.exists) throw new DataFilesError(404, "File is not available for download");

    const { dataBasePath } = await getResolvedDataBasePath();
    if (!dataBasePath) throw new DataFilesError(400, "Server data storage is not configured");
    let absolute: string;
    try {
      const base = await fs.realpath(dataBasePath);
      absolute = await fs.realpath(ensureWithinBase(base, file.path));
      ensureWithinBase(base, absolute);
    } catch {
      throw new DataFilesError(404, "File is not available for download");
    }
    const handle = await fs.open(absolute, "r").catch(() => null);
    if (!handle) throw new DataFilesError(404, "File is not available for download");
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new DataFilesError(404, "File is not available for download");
      const filename = path.basename(file.name || file.path);
      const fallback = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "download";
      const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      const body = Readable.toWeb(handle.createReadStream({ autoClose: true })) as ReadableStream;
      return new Response(body, { headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
        "Content-Length": String(stat.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      } });
    } catch (error) {
      await handle.close();
      throw error;
    }
  } catch (error) {
    return dataFilesErrorResponse(error);
  }
}
