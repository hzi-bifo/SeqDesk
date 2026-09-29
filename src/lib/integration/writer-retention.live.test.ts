import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const database=process.env.SEQDESK_FLOW_DATABASE_URL;
vi.mock('@/lib/db',async()=>{const {PrismaClient}=await import('@prisma/client');return {db:new PrismaClient({datasourceUrl:process.env.SEQDESK_FLOW_DATABASE_URL||'postgresql://invalid@127.0.0.1:1/none'})};});
import {db} from '@/lib/db';
import {integrationSession} from './identity';
import {handleFlowRequest} from './explore-flow';
import type {IntegrationConfig} from './config';

const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
describe.skipIf(!database)('Writer retention across the real collaboration backend and Compute database',()=>{
 it('redeems a scoped backend credential and retains the exact paper/run without a browser',async()=>{
  const url=new URL(database!);
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!/flow/.test(url.pathname)||!/(test|check)/.test(url.pathname))throw Error('Use a disposable local flow test database');
  const directory=await mkdtemp(join(tmpdir(),'writer-retention-live-')),file=join(directory,'fixture.json');
  let config:IntegrationConfig|null=null,userId='',flowId='',projectId='';
  let child:ReturnType<typeof spawn>|undefined,exit:Promise<number|null>|undefined;
  let output='';const errors:string[]=[];
  const server=createServer(async(req,res)=>{
   try{
    if(req.url==='/api/integration/v1/info'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({apiVersion:1,installationId:'writer-live-compute',capabilities:['writer.retention-holds']}));return;}
    if(!config)throw Error('Compute test is not ready');
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const request=new NextRequest(`http://127.0.0.1${req.url}`,{method:req.method,headers:req.headers as Record<string,string>,body:Buffer.concat(chunks).toString()});
    const session=await integrationSession(request,config);
    const response=await handleFlowRequest({request,session,segments:request.nextUrl.pathname.split('/').slice(5),json:(body,status=200)=>Response.json(body,{status})});
    if(!response)throw Error('Unexpected Compute route');
    res.statusCode=response.status;res.setHeader('Content-Type','application/json');res.end(await response.text());
   }catch(error){errors.push(error instanceof Error?error.message:String(error));res.statusCode=500;res.end('{"error":"retention test failed"}');}
  });
  try{
   await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
   const address=server.address();if(!address||typeof address==='string')throw Error('No listener');
   const user=await db.user.create({data:{email:`writer-retention-${randomUUID()}@example.invalid`,password:'!disabled',firstName:'Writer',lastName:'Test',role:'RESEARCHER',systemRole:'MEMBER',facilityWorkflowRole:'REQUESTER',isActive:true,isDemo:false}});userId=user.id;
   const project=await db.exploreProject.create({data:{name:'Retention test',ownerId:user.id}});projectId=project.id;
   const flow=await db.exploreFlow.create({data:{name:'Retention test',targetKey:`project:${project.id}`,createdById:user.id}});flowId=flow.id;
   const run=await db.exploreFlowRun.create({data:{flowId:flow.id,number:1,kind:'full',status:'completed',startedById:user.id,plan:[]}});
   const secret=randomBytes(32).toString('hex');
   child=spawn('go',['test','./internal/api','-run','^TestWriterRetentionLiveFixture$','-count=1','-timeout','110s'],{cwd:process.env.SEQDESK_RETENTION_BACKEND||resolve(process.cwd(),'../labdesk-sync'),detached:true,env:{...process.env,WRITER_RETENTION_FIXTURE:file,WRITER_RETENTION_COMPUTE_ORIGIN:`http://127.0.0.1:${address.port}`,WRITER_RETENTION_SECRET:secret,WRITER_RETENTION_FLOW:flow.id,WRITER_RETENTION_RUN:run.id},stdio:['ignore','pipe','pipe']});
   child.stdout!.on('data',data=>{output+=String(data)});child.stderr!.on('data',data=>{output+=String(data)});exit=new Promise((resolve,reject)=>{child!.once('error',reject);child!.once('exit',resolve)});
   let fixture:{origin:string;workspaceId:string;memberId:string;documentId:string}|undefined;
   const deadline=Date.now()+45000;
   while(Date.now()<deadline&&!fixture){try{fixture=JSON.parse(await readFile(file,'utf8'));}catch{if(child.exitCode!==null)throw Error(output);await pause(100);}}
   if(!fixture)throw Error('Backend fixture did not start: '+output);
   config={installationId:'writer-live-compute',name:'Compute test',secret,collaborationOrigin:fixture.origin,webOrigins:['http://127.0.0.1'],accounts:[{workspaceId:fixture.workspaceId,memberId:fixture.memberId,userId}]};
   await writeFile(file+'.start','ready');
   const key=`writer:${JSON.stringify([fixture.workspaceId,fixture.documentId])}`;
   let held=false;const until=Date.now()+15000;
   while(Date.now()<until&&!held){held=!!await db.exploreRunHold.findUnique({where:{flowRunId_kind_key:{flowRunId:run.id,kind:'writer',key}}});if(!held)await pause(100);}
   expect(errors).toEqual([]);expect(held).toBe(true);
   const holds=await db.exploreRunHold.findMany({where:{flowRunId:run.id}});expect(holds).toHaveLength(1);expect(holds[0]).toMatchObject({kind:'writer',key,createdById:user.id,memberId:fixture.memberId});
   await writeFile(file+'.done','done');expect(await exit).toBe(0);
  }finally{
   await writeFile(file+'.done','done').catch(()=>{});
   if(child&&child.exitCode===null){try{process.kill(-child.pid!,'SIGTERM')}catch{child.kill('SIGTERM')}}
   await new Promise<void>(resolve=>server.close(()=>resolve()));
   if(flowId)await db.exploreFlow.deleteMany({where:{id:flowId}});if(projectId)await db.exploreProject.deleteMany({where:{id:projectId}});if(userId)await db.user.deleteMany({where:{id:userId}});
   await db.$disconnect();await rm(directory,{recursive:true,force:true});
  }
 },90000);
});
