import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkForUpdates, installUpdate } from '@/lib/updater';
import {
  acquireUpdateLock,
  isUpdateInProgress,
  releaseUpdateLock,
  writeUpdateStatus,
} from '@/lib/updater/status';

/**
 * POST /api/admin/updates/install
 *
 * Install the latest available update.
 * This will download, extract, and restart the application.
 */
export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'FACILITY_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    if (await isUpdateInProgress()) {
      return NextResponse.json(
        { error: 'Update already in progress' },
        { status: 409 }
      );
    }

    const lockAcquired = await acquireUpdateLock();
    if (!lockAcquired) {
      return NextResponse.json(
        { error: 'Update already in progress' },
        { status: 409 }
      );
    }

    // Check for updates first
    const result = await checkForUpdates(true);

    if (!result.updateAvailable || !result.latest) {
      await releaseUpdateLock();
      return NextResponse.json({
        success: false,
        message: 'No update available',
      });
    }

    await writeUpdateStatus(
      { status: 'checking', progress: 0, message: 'Preparing update...' },
      { targetVersion: result.latest.version }
    );

    // Start update in background
    // Note: This is a simplified implementation
    // In production, you'd want to use a job queue
    installUpdate(result.latest, (progress) => {
      console.log(`Update progress: ${progress.status} - ${progress.message}`);
      void writeUpdateStatus(progress, { targetVersion: result.latest?.version })
        .catch((error) => console.error('Failed to write update status:', error));
    }).catch((error) => {
      console.error('Update failed:', error);
    });

    return NextResponse.json({
      success: true,
      message: `Installing update to version ${result.latest.version}. SeqDesk will attempt automatic restart.`,
      version: result.latest.version,
    });
  } catch (error) {
    console.error('Update installation failed:', error);
    await releaseUpdateLock();
    return NextResponse.json(
      { error: 'Failed to start update' },
      { status: 500 }
    );
  }
}
