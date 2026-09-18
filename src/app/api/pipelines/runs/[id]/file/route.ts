import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { servePipelineRunFile } from '@/lib/pipelines/run-file-service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await servePipelineRunFile(request, await getServerSession(authOptions), (await params).id);
  } catch {
    return NextResponse.json({ error: 'Failed to load file' }, { status: 500 });
  }
}
