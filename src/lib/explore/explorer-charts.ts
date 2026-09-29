/** Pure chart contract shared with the analysis service's HTML exporter. */
export type ExplorerRow = Record<string, unknown>;
export type ExplorerPanel = {id:string;kind:'timeline'|'measurement'|'composition'|'table';title:string;column?:string;columns?:string[];scope:'subject'|'cohort';events?:{column:string;label:string;value:string}[];aggregation?:'mean'|'pooled';measure?:'ra'|'reads';top?:number;spacing?:'actual'|'equal'};
export type ExplorerConfig = {version:1;label:string;subject:string;time:string;sample?:string;group?:string;taxon?:string;count?:string;panels:ExplorerPanel[]};
const num=(value:unknown)=>value===null||value===undefined||String(value).trim()===''||!Number.isFinite(Number(value))?null:Number(value);
const txt=(v:unknown)=>v==null?'':String(v);
const colors=['#2a78d6','#01a773','#c78600','#4a3aa7','#dc7099','#eb6834','#6c8794','#807060','#667744','#9c8eae'];
export function explorerCharts(rows:ExplorerRow[],config:ExplorerConfig,panel:ExplorerPanel,focusTaxon?:string):{title:string;data:Record<string,unknown>[];layout:Record<string,unknown>}[]{
 const points=rows.filter(r=>num(r[config.time])!==null);
 const base={xaxis:{title:{text:config.time}},margin:{l:64,r:16,t:16,b:65}};
 if(panel.kind==='table')return [];
 if(panel.kind==='measurement'&&(!panel.column||!points.some(row=>num(row[panel.column!])!==null)))return [];
 if(panel.kind!=='composition'){
  const groups=[...new Set(points.map(r=>txt(r[config.group||''])||'Observations'))];
  const data:Record<string,unknown>[]=groups.map((group,i)=>{
   const unique=[...new Map(points.filter(r=>(txt(r[config.group||''])||'Observations')===group).map(r=>{
    const p={subject:txt(r[config.subject]),sample:txt(r[config.sample||'']),day:num(r[config.time]),value:panel.column?num(r[panel.column]):null};return [JSON.stringify(p),p];})).values()].sort((a,b)=>a.day!-b.day!);
   return {type:'scatter',mode:'markers',name:group,x:unique.map(p=>p.day),y:unique.map(p=>panel.kind==='timeline'?group:p.value),text:unique.map(p=>`${p.subject} · ${p.sample}`),marker:{color:colors[i%colors.length],size:8},connectgaps:false};
  });
  for(const event of panel.events??[]){const days=[...new Set(points.filter(r=>txt(r[event.column]).toLowerCase()===event.value.toLowerCase()).map(r=>num(r[config.time])))].sort((a,b)=>a!-b!);data.push({type:'scatter',mode:'markers',name:event.label,x:days,y:days.map(()=>event.label),marker:{symbol:'square',color:'#555b57',size:9}});}
  return [{title:panel.title,data,layout:{...base,yaxis:{title:{text:panel.kind==='timeline'?'Observed events':panel.column}},legend:{orientation:'h'}}}];
 }
 if(!config.sample||!config.taxon||!config.count)return [];
 const libraries=new Map<string,{day:number;group:string;taxa:Map<string,number>}>();
 for(const row of points){const sample=txt(row[config.sample]),taxon=txt(row[config.taxon]),count=num(row[config.count]);if(!sample||!taxon||count===null||count<0)continue;const day=num(row[config.time])!,group=txt(row[config.group||''])||'Observations';const key=JSON.stringify([row[config.subject],sample,day,group]);if(!libraries.has(key))libraries.set(key,{day,group,taxa:new Map()});const p=libraries.get(key)!;p.taxa.set(taxon,(p.taxa.get(taxon)??0)+count);}
 const daily=new Map<string,{day:number;group:string;n:number;total:number;reads:Map<string,number>;ra:Map<string,number>}>();
 for(const library of libraries.values()){const total=[...library.taxa.values()].reduce((a,b)=>a+b,0);if(!total)continue;const key=JSON.stringify([library.day,library.group]);if(!daily.has(key))daily.set(key,{day:library.day,group:library.group,n:0,total:0,reads:new Map(),ra:new Map()});const p=daily.get(key)!;p.n++;p.total+=total;for(const [taxon,count]of library.taxa){p.reads.set(taxon,(p.reads.get(taxon)??0)+count);p.ra.set(taxon,(p.ra.get(taxon)??0)+100*count/total);}}
 const profiles=[...daily.values()];for(const p of profiles)for(const t of p.ra.keys())p.ra.set(t,panel.aggregation==='pooled'?100*p.reads.get(t)!/p.total:p.ra.get(t)!/p.n);
 const scores=new Map<string,number>();for(const p of profiles)for(const [t,n]of p.ra)scores.set(t,(scores.get(t)??0)+n);
 const ranked=[...scores.keys()].sort((a,b)=>scores.get(b)!-scores.get(a)!||a.localeCompare(b)),top=ranked.slice(0,panel.top??10);if(focusTaxon&&ranked.includes(focusTaxon)&&!top.includes(focusTaxon))top.push(focusTaxon);const omitted=ranked.filter(t=>!top.includes(t));
 const days=[...new Set(profiles.map(p=>p.day))].sort((a,b)=>a-b),groups=[...new Set(profiles.map(p=>p.group))].sort();const gap=days.length>1?Math.min(...days.slice(1).map((d,i)=>d-days[i])):1;
 return groups.map(group=>({title:`${panel.title} · ${group}`,data:[...top,...(omitted.length?['Other']:[])].map((taxon,i)=>({type:'bar',name:taxon,x:panel.spacing==='equal'?days.map(String):days,width:panel.spacing==='equal'?undefined:gap*.7,marker:{color:taxon==='Other'?'#bcc2bb':colors[i%colors.length]},y:days.map(day=>{const p=profiles.find(p=>p.group===group&&p.day===day);if(!p)return null;const values=panel.measure==='reads'?p.reads:p.ra;return taxon==='Other'?omitted.reduce((n,t)=>n+(values.get(t)??0),0):values.get(taxon)??0;})})),layout:{...base,barmode:'stack',xaxis:{title:{text:config.time},type:panel.spacing==='equal'?'category':'linear',tickvals:panel.spacing==='equal'?days.map(String):days,ticktext:days.map(d=>`D${d}`)},yaxis:{title:{text:panel.measure==='reads'?'Retained reads':'Relative abundance (%)'},...(panel.measure==='reads'?{rangemode:'tozero'}:{range:[0,100]})},legend:{orientation:'h'}}}));
}
export function explorerTableRows(rows:ExplorerRow[],columns:string[]){return [...new Map(rows.map(row=>[JSON.stringify(columns.map(c=>row[c]??null)),row])).values()];}
