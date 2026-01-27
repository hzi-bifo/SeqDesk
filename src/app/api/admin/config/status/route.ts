import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getEffectiveConfig } from '@/lib/config';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'FACILITY_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const resolved = await getEffectiveConfig();

    // Mask sensitive values
    const safeConfig = { ...resolved.config };
    if (safeConfig.ena?.password) {
      safeConfig.ena = { ...safeConfig.ena, password: '********' };
    }

    return NextResponse.json({
      config: safeConfig,
      sources: resolved.sources,
      filePath: resolved.filePath,
      loadedAt: resolved.loadedAt,
    });
  } catch (error) {
    console.error('Error loading config:', error);
    return NextResponse.json(
      { error: 'Failed to load configuration' },
      { status: 500 }
    );
  }
}
