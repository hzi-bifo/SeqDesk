import { IntegrationAccessError } from './identity-error';

export type WriterRetentionGrant = { documentId: string; flowId: string; runId: string };
/** A service credential may only add one paper hold. No reads, removals or other mutations. */
export async function validateWriterRetentionRequest(request: Request, workspaceId: string, raw: unknown): Promise<WriterRetentionGrant> {
 const value=raw as Partial<WriterRetentionGrant> | null;
 const valid=(id: unknown): id is string=>typeof id==='string' && /^[A-Za-z0-9_-]{1,512}$/.test(id);
 if(!value || !valid(value.documentId) || !valid(value.flowId) || !valid(value.runId) || !valid(workspaceId)) throw new IntegrationAccessError(403,'Invalid Writer retention scope.');
 const url=new URL(request.url);
 if(request.method!=='POST' || url.search || url.pathname!==`/api/integration/v1/explore/flow-runs/${encodeURIComponent(value.runId)}/holds`) throw new IntegrationAccessError(403,'This credential can only retain its Writer run.');
 const rawBody=await request.clone().text();
 if(rawBody.length>4096)throw new IntegrationAccessError(403,'Invalid Writer retention request.');
 let body: unknown;try{body=JSON.parse(rawBody);}catch{throw new IntegrationAccessError(403,'Invalid Writer retention request.');}
 if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(key=>!['kind','key'].includes(key)) ||
  (body as {kind?:unknown}).kind!=='writer' || (body as {key?:unknown}).key!==`writer:${JSON.stringify([workspaceId,value.documentId])}`)
  throw new IntegrationAccessError(403,'The hold does not match its Writer paper.');
 return value as WriterRetentionGrant;
}
