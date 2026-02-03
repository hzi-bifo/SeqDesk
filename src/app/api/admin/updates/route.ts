import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkForUpdates, getCurrentVersion, getInstalledVersion } from '@/lib/updater';

/**
 * GET /api/admin/updates
 *
 * Check for available updates.
 * Returns current version and latest available version.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'FACILITY_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === 'true';

  try {
    const result = await checkForUpdates(force);
    const runningVersion = getCurrentVersion();
    const installedVersion = await getInstalledVersion();

    return NextResponse.json({
      currentVersion: runningVersion,
      runningVersion,
      installedVersion,
      restartRequired: installedVersion !== runningVersion,
      updateAvailable: result.updateAvailable,
      latest: result.latest,
      error: result.error,
    });
  } catch (error) {
    console.error('Update check failed:', error);
    return NextResponse.json(
      { error: 'Failed to check for updates' },
      { status: 500 }
    );
  }
}
