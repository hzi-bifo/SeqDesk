import {describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({find:vi.fn(),records:vi.fn(),artifacts:vi.fn(),path:vi.fn()}));
vi.mock("@/lib/db",()=>({db:{exploreFlow:{findUnique:mocks.find},exploreAnalysisRun:{findUnique:mocks.artifacts}}}));
vi.mock("./flow-runs",()=>({runRecords:mocks.records,planOf:()=>[{analysisId:"step",label:"Measurement"}],stepValues:(values:unknown)=>values||[]}));
vi.mock("./kits/loader",()=>({getKit:vi.fn()}));
vi.mock("./recipe",()=>({loadRecipe:vi.fn()}));
vi.mock("./storage",()=>({resolveContainedPath:mocks.path}));
import {artifactsIntact,flowValues,resolveValues} from "./values";
describe("Writer value source changes",()=>{
 it.each([["mg","µg",true],["mg",null,true],[null,"mg",true],["mg","mg",false]])("compares units %s → %s",async(oldUnit,newUnit,changed)=>{
  mocks.find.mockResolvedValue({id:"flow",name:"Analysis",targetKey:"project:p",currentRunId:"new"});
  mocks.records.mockImplementation(async(id:string)=>({run:{id,flowId:"flow",kind:"full",status:"completed",number:id==="old"?1:2},records:new Map([["step",{stepRunId:"result",status:"completed"}]]),stepRuns:new Map([["result",{results:[{key:"mass",label:"Mass",value:5,unit:id==="old"?oldUnit:newUnit}]}]])}));
  const result=await resolveValues(["labdesk://value/old/step/mass"],async()=>true);
  expect(result.unknown).toEqual([]);expect(result.values).toHaveLength(1);
  expect(result.values[0]).toMatchObject({value:5,unit:oldUnit,changed,currentValue:{value:5,unit:newUnit,runId:"new"}});
 });
});

describe("Writer value feed run eligibility",()=>{
 it.each(["trial-run","current"])("rejects trial run selected by %s",async(run)=>{
  mocks.find.mockResolvedValue({currentRunId:"trial-run"});
  mocks.records.mockResolvedValue({run:{id:"trial-run",flowId:"flow",kind:"trial",status:"completed"},records:new Map(),stepRuns:new Map()});
  await expect(flowValues("flow",{run})).rejects.toMatchObject({code:"invalid_request"});
  expect(await resolveValues(["labdesk://value/trial-run/step/mass"],async()=>true)).toEqual({values:[],unknown:["labdesk://value/trial-run/step/mass"]});
 });
 it("keeps completed full-run values available with raw units",async()=>{
  mocks.find.mockResolvedValue({currentRunId:"full-run"});
  mocks.records.mockResolvedValue({run:{id:"full-run",flowId:"flow",kind:"full",status:"completed",number:2},records:new Map([["step",{stepRunId:"result",status:"completed"}]]),stepRuns:new Map([["result",{results:[{key:"mass",label:"Mass",value:5,unit:"mg"}]}]])});
  expect((await flowValues("flow",{})).values[0]).toMatchObject({runId:"full-run",value:5,unit:"mg",verified:true});
 });
});

describe("Writer source-file verification",()=>{
 it("does not certify an output without a recorded checksum",async()=>{
  mocks.artifacts.mockResolvedValue({runFolder:"/run",artifacts:[{path:"result.csv",checksum:null}]});
  expect(await artifactsIntact("step-run")).toBe(false);
 });
 it("does not certify a missing run or unresolvable output",async()=>{
  mocks.artifacts.mockResolvedValue(null);expect(await artifactsIntact("missing")).toBe(false);
  mocks.artifacts.mockResolvedValue({runFolder:"/run",artifacts:[{path:"result.csv",checksum:"a".repeat(64)}]});
  mocks.path.mockRejectedValue(new Error("Missing output"));expect(await artifactsIntact("step-run")).toBe(false);
 });
 it("allows scalar-only steps with no file artifacts",async()=>{
  mocks.artifacts.mockResolvedValue({runFolder:"/run",artifacts:[]});expect(await artifactsIntact("scalar-step")).toBe(true);
 });
});
