import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import { db } from '../src/lib/db';

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/seqdesk_analysis_integration_local') throw new Error('Only the dedicated local Analysis database is allowed.');
  const dir = process.env.SEQDESK_LOCAL_ANALYSIS_DIR;
  if (!dir) throw new Error('Use the local Analysis launcher.');
  const collaboration = JSON.parse(await readFile(join(dir,'collaboration.json'),'utf8'));
  const connection = JSON.parse(await readFile(join(dir,'connection.json'),'utf8'));
  const user = await db.user.upsert({where:{email:'local-analysis@accounts.seqdesk.invalid'},update:{},create:{
    email:'local-analysis@accounts.seqdesk.invalid',password:await hash(randomBytes(48).toString('hex'),12),firstName:'Local Test',lastName:'User',
    role:'FACILITY_ADMIN',systemRole:'ADMIN',facilityWorkflowRole:'OPERATOR',isActive:true,isDemo:false}});
  const study = await db.study.upsert({where:{id:'local-analysis-study'},update:{},create:{id:'local-analysis-study',title:'Local integration study',userId:user.id}});
  const order = await db.order.upsert({where:{id:'local-analysis-order'},update:{},create:{id:'local-analysis-order',name:'Local checksum order',orderNumber:'LOCAL-ANALYSIS-001',userId:user.id}});
  const file = join(dir,'reads.fastq');
  await writeFile(file,'@S1\nACGTACGT\n+\nIIIIIIII\n');
  const sample = await db.sample.upsert({where:{id:'local-analysis-sample'},update:{},create:{id:'local-analysis-sample',sampleId:'S1',sampleTitle:'Local control',scientificName:'Escherichia coli',studyId:study.id,orderId:order.id}});
  await db.read.upsert({where:{id:'local-analysis-read'},update:{file1:file},create:{id:'local-analysis-read',sampleId:sample.id,file1:file,dataClass:'raw'}});
  await db.pipelineConfig.upsert({where:{pipelineId:'fastq-checksum'},update:{enabled:true},create:{pipelineId:'fastq-checksum',enabled:true}});
  await writeFile(join(dir,'compute.json'),JSON.stringify({installationId:connection.installationId,name:connection.name,collaborationOrigin:collaboration.url,
    secret:connection.secret,webOrigins:['http://127.0.0.1:5195'],accounts:[{workspaceId:collaboration.workspaceId,memberId:collaboration.memberId,userId:user.id}],provisionAccounts:false}),{mode:0o600});
  console.log('Local study, order, reads and explicit test-operator mapping ready. Existing runs retained.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.$disconnect());
