import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    let version = '';
    try {
      const { stdout } = await execAsync('docker --version', { timeout: 8000 });
      version = stdout.trim();
    } catch {
      return NextResponse.json({
        available: false,
        daemonRunning: false,
        message: 'Docker CLI not found',
      });
    }

    try {
      await execAsync('docker info', { timeout: 8000 });
      return NextResponse.json({
        available: true,
        daemonRunning: true,
        version,
        message: 'Docker is available and the daemon is running.',
      });
    } catch {
      return NextResponse.json({
        available: true,
        daemonRunning: false,
        version,
        message: 'Docker is installed but the daemon is not running.',
      });
    }
  } catch (error) {
    console.error('[Docker Status] Error:', error);
    return NextResponse.json(
      { error: 'Failed to check Docker status' },
      { status: 500 }
    );
  }
}
