/**
 * A short-lived link to one pipeline output file (the MultiQC report), for a browser tab of its own. The web app's
 * CSP rightly forbids framing a blob: document, and a top-level tab cannot send the proxy's bearer header, so the
 * app asks for this link (authenticated, through the proxy) and opens it: Compute serves the one file under a
 * sandbox CSP, on its own origin, without cookies or sign-in. The link names one run and one file and expires.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const PIPELINE_FILE_LINK_TTL_MS = 5 * 60 * 1000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`pipeline-file:${payload}`).digest('base64url');
}

export function pipelineFileToken(secret: string, runId: string, artifactId: string, now = Date.now(), ttlMs = PIPELINE_FILE_LINK_TTL_MS): string {
  if (!ID.test(runId) || !ID.test(artifactId)) throw new Error('Invalid run or file.');
  const payload = `${runId}.${artifactId}.${now + ttlMs}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function readPipelineFileToken(secret: string, token: string, now = Date.now()): { runId: string; artifactId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [runId, artifactId, expires, signature] = parts;
  if (!ID.test(runId) || !ID.test(artifactId) || !/^\d{1,16}$/.test(expires) || Number(expires) <= now) return null;
  const expected = sign(secret, `${runId}.${artifactId}.${expires}`);
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  return { runId, artifactId };
}

/** Reports (MultiQC) keep settings in localStorage, which throws in a sandboxed (opaque-origin) page: an in-memory stand-in. */
export const SANDBOX_STORAGE_SHIM = `<script>(function(){function S(){var m={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null},get length(){return Object.keys(m).length}}}
try{window.localStorage.getItem('x')}catch(e){Object.defineProperty(window,'localStorage',{value:S(),configurable:true});Object.defineProperty(window,'sessionStorage',{value:S(),configurable:true})}})();</script>`;

export function withStorageShim(html: string): string {
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => head + SANDBOX_STORAGE_SHIM) : SANDBOX_STORAGE_SHIM + html;
}

/** The policy an output file is served under: its own scripts may run, in an opaque origin, reaching nothing. */
export const PIPELINE_FILE_CSP = "sandbox allow-scripts allow-popups; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:";
