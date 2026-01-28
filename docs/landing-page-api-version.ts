/**
 * API Route for SeqDesk Landing Page
 *
 * Copy this file to your landing page repo at:
 *   app/api/version/route.ts
 *
 * This provides version information for the installer and update checker.
 */

import { NextRequest, NextResponse } from 'next/server';

// Current release info - UPDATE THIS when releasing new versions
const CURRENT_RELEASE = {
  version: "0.1.5",
  releaseNotes: "Update system improvements: disk space check, update banner, rollback docs",
  downloadUrl: "https://hrvwvo4zhyhlyy73.public.blob.vercel-storage.com/releases/seqdesk-0.1.5.tar-cA23wrwMWXAOTdxcYFNyKVbhdParGV.gz",
  checksum: "f90bb581cfeb1ee2b3bf4f10f41aea522102f1f22879c23c189bc988b1ed4bf5",
  size: 28825767,
  releaseDate: "2026-01-28"
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const currentVersion = searchParams.get('current');

  // Check if update is available
  const updateAvailable = currentVersion ? currentVersion !== CURRENT_RELEASE.version : false;

  return NextResponse.json({
    updateAvailable,
    currentVersion: currentVersion || null,
    latest: CURRENT_RELEASE
  });
}
