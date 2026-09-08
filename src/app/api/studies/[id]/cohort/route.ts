import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import { db } from "@/lib/db";
import { sequencingEntryScope } from "@/lib/sequencing/entry-access";

const cohortInput = z.object({ sampleId: z.string().min(1).max(200), role: z.enum(["unassigned", "case", "control", "reference"]).default("unassigned"), groupLabel: z.string().trim().max(120).nullable().optional() }).strict();
async function access(studyId: string, write = false) {
  const decision = decideCapability(await getServerSession(authOptions), write ? "samples.manage" : "studies.read");
  if (!decision.allowed || !decision.principal) return null;
  const installation = decision.grant?.scope === "installation";
  const study = await db.study.findFirst({ where: { id: studyId, ...(installation ? {} : { userId: decision.principal.id }), ...(write ? { submitted: false } : {}) }, select: { id: true } });
  return study ? { scope: sequencingEntryScope(decision.principal.id, installation) } : null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const grant = await access(id);
  if (!grant) return NextResponse.json({ error: "Study unavailable" }, { status: 404 });
  const members = await db.studySample.findMany({ where: { studyId: id, sample: grant.scope }, include: { sample: { select: { id: true, sampleId: true, sampleTitle: true, orderId: true } } }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ members });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const grant = await access(id, true);
  if (!grant) return NextResponse.json({ error: "Study unavailable or read-only" }, { status: 404 });
  const parsed = cohortInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid study membership" }, { status: 400 });
  const { sampleId, role, groupLabel } = parsed.data;
  // Scope both sides; linking a sample never grants ownership or file access.
  const sample = await db.sample.findFirst({ where: { id: sampleId, ...grant.scope }, select: { id: true } });
  if (!sample) return NextResponse.json({ error: "Sample unavailable" }, { status: 404 });
  const member = await db.studySample.upsert({ where: { studyId_sampleId: { studyId: id, sampleId } }, create: { studyId: id, sampleId, role, groupLabel }, update: { role, groupLabel } });
  return NextResponse.json({ member });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const grant = await access(id, true);
  if (!grant) return NextResponse.json({ error: "Study unavailable or read-only" }, { status: 404 });
  const sampleId = request.nextUrl.searchParams.get("sampleId");
  if (!sampleId) return NextResponse.json({ error: "Sample is required" }, { status: 400 });
  await db.studySample.deleteMany({ where: { studyId: id, sampleId, sample: grant.scope } });
  return NextResponse.json({ success: true });
}
