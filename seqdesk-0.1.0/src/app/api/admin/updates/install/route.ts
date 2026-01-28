import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkForUpdates, installUpdate } from '@/lib/updater';

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
    // Check for updates first
    const result = await checkForUpdates(true);

    if (!result.updateAvailable || !result.latest) {
      return NextResponse.json({
        success: false,
        message: 'No update available',
      });
    }

    // Start update in background
    // Note: This is a simplified implementation
    // In production, you'd want to use a job queue
    installUpdate(result.latest, (progress) => {
      console.log(`Update progress: ${progress.status} - ${progress.message}`);
    }).catch((error) => {
      console.error('Update failed:', error);
    });

    return NextResponse.json({
      success: true,
      message: `Installing update to version ${result.latest.version}. The application will restart automatically.`,
      version: result.latest.version,
    });
  } catch (error) {
    console.error('Update installation failed:', error);
    return NextResponse.json(
      { error: 'Failed to start update' },
      { status: 500 }
    );
  }
}
