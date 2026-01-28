/**
 * SeqDesk Auto-Update System
 */

export interface ReleaseInfo {
  version: string;
  channel: string;
  releaseDate: string;
  downloadUrl: string;
  checksum: string;
  releaseNotes: string;
  minNodeVersion: string;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latest: ReleaseInfo | null;
  error?: string;
}

export interface UpdateProgress {
  status: 'idle' | 'checking' | 'downloading' | 'extracting' | 'restarting' | 'error' | 'complete';
  progress: number; // 0-100
  message: string;
  error?: string;
}
