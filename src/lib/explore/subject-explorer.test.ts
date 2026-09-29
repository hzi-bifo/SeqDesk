import {expect,it} from 'vitest';
import {ReportBlockSchema} from './report-blocks';
it('preserves explorer settings and rejects executable extensions',()=>{
 const block={id:'subject',type:'subject',datasetId:'table',explorer:{version:1,label:'Device',subject:'device_id',time:'elapsed',panels:[{id:'signal',kind:'measurement',title:'Signal',column:'voltage',scope:'subject'}]}};
 expect(ReportBlockSchema.parse(block)).toEqual(block);
 expect(ReportBlockSchema.safeParse({...block,explorer:{...block.explorer,script:'alert(1)'}}).success).toBe(false);
 expect(ReportBlockSchema.safeParse({...block,explorer:{...block.explorer,version:2}}).success).toBe(false);
});
