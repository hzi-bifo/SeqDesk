import { describe, expect, it } from 'vitest';
import { validateWriterRetentionRequest } from './writer-retention';
const grant={documentId:'paper-1',flowId:'flow-1',runId:'run-1'};
const key='writer:["workspace-1","paper-1"]';
function request(path='/api/integration/v1/explore/flow-runs/run-1/holds',method='POST',body:unknown={kind:'writer',key}){
 return new Request('https://compute.example'+path,{method,...(method==='GET'?{}:{body:JSON.stringify(body)})});
}
describe('Writer retention service credential scope',()=>{
 it('allows only its canonical paper hold and leaves the body readable',async()=>{const req=request();expect(await validateWriterRetentionRequest(req,'workspace-1',grant)).toEqual(grant);expect(await req.json()).toEqual({kind:'writer',key});});
 it.each([
  ['/api/integration/v1/explore/flow-runs/run-1','GET'],
  ['/api/integration/v1/explore/flow-runs/run-1/holds','DELETE'],
  ['/api/integration/v1/explore/flow-runs/other/holds','POST'],
  ['/api/integration/v1/explore/flow-runs/run-1/holds?x=1','POST'],
 ])('rejects another operation %s %s',async(path,method)=>{await expect(validateWriterRetentionRequest(request(path,method),'workspace-1',grant)).rejects.toThrow();});
 it.each([{kind:'check',key},{kind:'writer',key:'writer:["workspace-2","paper-1"]'},{kind:'writer',key:'writer:["workspace-1","other"]'},{kind:'writer',key,extra:true}])('rejects a foreign or expanded body',async body=>{await expect(validateWriterRetentionRequest(request(undefined,undefined,body),'workspace-1',grant)).rejects.toThrow();});
 it('rejects malformed grants',async()=>{for(const value of [null,{}, {...grant,runId:'../other'},{...grant,documentId:''}])await expect(validateWriterRetentionRequest(request(),'workspace-1',value)).rejects.toThrow();});
});
