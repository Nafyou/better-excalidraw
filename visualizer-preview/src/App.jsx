import { useState, useEffect, useRef, useMemo, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════════════
   TRACE SCHEMA — the contract between AI-generated tracers and the UI
   
   {
     viz:   { type:"tree", nodes:[{id,val,left,right}] },
     code:  ["python line 1", "line 2", ...],
     steps: [{
       activeLines: [3,4],          // 0-indexed
       label:  "check",             // category
       detail: "Human description",
       highlights: [{id:0, style:"active"|"visiting"|"path"|"checking"|"found"|"backtrack"}],
       variables: {
         "name": { value, type:"number"|"array"|"string"|"null", changed:bool, annotation?:string, highlight?:number }
       }
     }],
     target: number
   }
   ═══════════════════════════════════════════════════════════════════════ */

// ─── Presets ───────────────────────────────────────────────────────────
const PRESETS = [
  { name: "Cross-path", target: 6, nodes: [
    {id:0,val:1,left:1,right:2},{id:1,val:2,left:3,right:4},
    {id:2,val:3,left:null,right:5},{id:3,val:1,left:null,right:null},
    {id:4,val:1,left:null,right:null},{id:5,val:2,left:null,right:null},
  ]},
  { name: "All threes", target: 6, nodes: [
    {id:0,val:3,left:1,right:2},{id:1,val:3,left:3,right:4},
    {id:2,val:3,left:5,right:null},{id:3,val:3,left:null,right:null},
    {id:4,val:3,left:null,right:null},{id:5,val:3,left:null,right:null},
  ]},
  { name: "Negatives", target: 0, nodes: [
    {id:0,val:1,left:1,right:2},{id:1,val:-1,left:3,right:null},
    {id:2,val:-1,left:null,right:4},{id:3,val:1,left:null,right:null},
    {id:4,val:1,left:null,right:null},
  ]},
];

const CODE_LINES = [
  "def get_downward_sums(node, curr_sum=0):",
  "    '''All downward path sums from node'''",
  "    if node is None: return []",
  "    s = curr_sum + node.val",
  "    return [s]",
  "         + get_downward_sums(node.left, s)",
  "         + get_downward_sums(node.right, s)",
  "",
  "def count_all_paths(node, S):",
  "    if node is None: return",
  "",
  "    left_sums  = get_downward_sums(node.left)",
  "    right_sums = get_downward_sums(node.right)",
  "",
  "    # Single node",
  "    if node.val == S: total += 1",
  "",
  "    # Downward through left",
  "    for ls in left_sums:",
  "        if node.val + ls == S: total += 1",
  "",
  "    # Downward through right",
  "    for rs in right_sums:",
  "        if node.val + rs == S: total += 1",
  "",
  "    # Cross-paths: left ↔ node ↔ right",
  "    for ls in left_sums:",
  "        for rs in right_sums:",
  "            if ls + node.val + rs == S:",
  "                total += 1",
  "",
  "    count_all_paths(node.left, S)",
  "    count_all_paths(node.right, S)",
];

// ─── Built-in tracer ──────────────────────────────────────────────────
function generateTrace(nodes, target) {
  const steps = [];
  let total = 0;
  const gn = id => id !== null ? nodes.find(n => n.id === id) : null;

  function downSums(nodeId, cs) {
    if (nodeId === null) return [];
    const n = gn(nodeId), s = cs + n.val;
    return [{sum:s, nid:nodeId}, ...downSums(n.left, s), ...downSums(n.right, s)];
  }

  function vars(nodeVal, ls, rs, extras) {
    const v = {};
    v["node.val"] = {value: nodeVal, type:"number", changed:false};
    v["left_sums"] = ls === null
      ? {value:null, type:"null", changed:false, annotation:"not yet computed"}
      : {value:ls.map(x=>x.sum), type:"array", changed:false};
    v["right_sums"] = rs === null
      ? {value:null, type:"null", changed:false, annotation:"not yet computed"}
      : {value:rs.map(x=>x.sum), type:"array", changed:false};
    v["total"] = {value:total, type:"number", changed:false};
    if (extras) Object.assign(v, extras);
    return v;
  }

  function push(al, label, detail, hl, variables) {
    steps.push({activeLines:al, label, detail, highlights:hl||[], variables:variables||{}});
  }

  function process(nodeId) {
    if (nodeId === null) {
      push([8,9], "null-check", "Node is null — return", [], {"total":{value:total,type:"number",changed:false}});
      return;
    }
    const node = gn(nodeId);

    // Visit
    const v0 = vars(node.val, null, null);
    v0["node.val"].changed = true;
    push([8,9], "visit", `Visit node ${node.val} — treating as LCA / bend point`,
      [{id:nodeId, style:"active"}], v0);

    // Collect left sums step by step
    const leftRaw = downSums(node.left, 0);
    for (let i = 0; i < leftRaw.length; i++) {
      const partial = leftRaw.slice(0, i+1);
      const vn = gn(leftRaw[i].nid);
      const v = vars(node.val, partial, null);
      v["left_sums"].changed = true;
      v["left_sums"].annotation = `building… (${i+1}/${leftRaw.length})`;
      push([0,1,2,3,4,5,6], "collect-left",
        `get_downward_sums → node ${vn.val}: sum = ${leftRaw[i].sum}`,
        [{id:nodeId, style:"active"}, {id:leftRaw[i].nid, style:"checking"},
         ...partial.map(p=>({id:p.nid, style:"visiting"}))], v);
    }
    if (leftRaw.length > 0) {
      const v = vars(node.val, leftRaw, null);
      v["left_sums"].changed = true;
      v["left_sums"].annotation = `✓ ${leftRaw.length} sum(s) from left subtree`;
      push([11], "collect-done", `left_sums = [${leftRaw.map(x=>x.sum).join(", ")}]`,
        [{id:nodeId, style:"active"}, ...leftRaw.map(x=>({id:x.nid, style:"path"}))], v);
    } else {
      const v = vars(node.val, [], null);
      v["left_sums"].changed = true;
      v["left_sums"].annotation = "no left child";
      push([11], "collect-done", `left_sums = []  (no left subtree)`,
        [{id:nodeId, style:"active"}], v);
    }

    // Collect right sums step by step
    const rightRaw = downSums(node.right, 0);
    for (let i = 0; i < rightRaw.length; i++) {
      const partial = rightRaw.slice(0, i+1);
      const vn = gn(rightRaw[i].nid);
      const v = vars(node.val, leftRaw, partial);
      v["right_sums"].changed = true;
      v["right_sums"].annotation = `building… (${i+1}/${rightRaw.length})`;
      push([0,1,2,3,4,5,6], "collect-right",
        `get_downward_sums → node ${vn.val}: sum = ${rightRaw[i].sum}`,
        [{id:nodeId, style:"active"}, {id:rightRaw[i].nid, style:"checking"},
         ...partial.map(p=>({id:p.nid, style:"visiting"}))], v);
    }
    if (rightRaw.length > 0) {
      const v = vars(node.val, leftRaw, rightRaw);
      v["right_sums"].changed = true;
      v["right_sums"].annotation = `✓ ${rightRaw.length} sum(s) from right subtree`;
      push([12], "collect-done", `right_sums = [${rightRaw.map(x=>x.sum).join(", ")}]`,
        [{id:nodeId, style:"active"}, ...rightRaw.map(x=>({id:x.nid, style:"path"}))], v);
    } else {
      const v = vars(node.val, leftRaw, []);
      v["right_sums"].changed = true;
      v["right_sums"].annotation = "no right child";
      push([12], "collect-done", `right_sums = []  (no right subtree)`,
        [{id:nodeId, style:"active"}], v);
    }

    // Single node check
    const vSingle = vars(node.val, leftRaw, rightRaw);
    if (node.val === target) {
      total++;
      vSingle["total"] = {value:total, type:"number", changed:true};
      push([14,15], "found", `Node ${node.val} alone = ${target}! total → ${total}`,
        [{id:nodeId, style:"found"}], vSingle);
    } else {
      vSingle["current_check"] = {value:`${node.val} ≠ ${target}`, type:"string", changed:true};
      push([14,15], "check", `Node alone: ${node.val} ≠ ${target}`,
        [{id:nodeId, style:"active"}], vSingle);
    }

    // Left downward checks
    const lsVals = leftRaw.map(x=>x.sum);
    for (let i = 0; i < leftRaw.length; i++) {
      const sum = node.val + lsVals[i], m = sum === target;
      if (m) total++;
      const v = vars(node.val, leftRaw, rightRaw, {
        "current_check": {value:`${node.val} + ${lsVals[i]} = ${sum}`, type:"string", changed:true},
      });
      v["left_sums"].highlight = i;
      if (m) v["total"] = {value:total, type:"number", changed:true};
      push([17,18,19], m?"found":"check",
        `node(${node.val}) + left_sum(${lsVals[i]}) = ${sum}${m?" ✓":""}`,
        [{id:nodeId, style:m?"found":"active"}, {id:leftRaw[i].nid, style:m?"found":"checking"}], v);
    }

    // Right downward checks
    const rsVals = rightRaw.map(x=>x.sum);
    for (let i = 0; i < rightRaw.length; i++) {
      const sum = node.val + rsVals[i], m = sum === target;
      if (m) total++;
      const v = vars(node.val, leftRaw, rightRaw, {
        "current_check": {value:`${node.val} + ${rsVals[i]} = ${sum}`, type:"string", changed:true},
      });
      v["right_sums"].highlight = i;
      if (m) v["total"] = {value:total, type:"number", changed:true};
      push([21,22,23], m?"found":"check",
        `node(${node.val}) + right_sum(${rsVals[i]}) = ${sum}${m?" ✓":""}`,
        [{id:nodeId, style:m?"found":"active"}, {id:rightRaw[i].nid, style:m?"found":"checking"}], v);
    }

    // Cross-path checks
    if (leftRaw.length > 0 && rightRaw.length > 0) {
      push([24,25], "cross-start", `Checking cross-paths bending through node ${node.val}`,
        [{id:nodeId, style:"active"}], vars(node.val, leftRaw, rightRaw));

      for (let i = 0; i < leftRaw.length; i++) {
        for (let j = 0; j < rightRaw.length; j++) {
          const sum = lsVals[i] + node.val + rsVals[j], m = sum === target;
          if (m) total++;
          const v = vars(node.val, leftRaw, rightRaw, {
            "current_check": {value:`${lsVals[i]} + ${node.val} + ${rsVals[j]} = ${sum}`, type:"string", changed:true},
          });
          v["left_sums"].highlight = i;
          v["right_sums"].highlight = j;
          if (m) v["total"] = {value:total, type:"number", changed:true};
          push([25,26,27,28], m?"found-cross":"check-cross",
            `↕ left(${lsVals[i]}) + node(${node.val}) + right(${rsVals[j]}) = ${sum}${m?" ✓":""}`,
            [{id:nodeId, style:m?"found":"active"},
             {id:leftRaw[i].nid, style:m?"found":"checking"},
             {id:rightRaw[j].nid, style:m?"found":"checking"}], v);
        }
      }
    }

    // Recurse
    push([30], "recurse", `Recurse left of ${node.val}`, [{id:nodeId, style:"active"}],
      {"node.val":{value:node.val,type:"number",changed:false}, "total":{value:total,type:"number",changed:false}});
    process(node.left);

    push([31], "recurse", `Recurse right of ${node.val}`, [{id:nodeId, style:"active"}],
      {"node.val":{value:node.val,type:"number",changed:false}, "total":{value:total,type:"number",changed:false}});
    process(node.right);
  }

  push([], "start", `Finding all paths (any direction) summing to ${target}`, [],
    {"target":{value:target,type:"number",changed:false}, "total":{value:0,type:"number",changed:false}});
  process(0);
  push([], "done", `Complete! Found ${total} path(s) summing to ${target}`, [],
    {"total":{value:total,type:"number",changed:false}});

  return { viz:{type:"tree", nodes}, code:CODE_LINES, steps, target };
}

// ─── Layout ────────────────────────────────────────────────────────────
function layoutTree(nodes) {
  const pos = {};
  const gn = id => nodes.find(n=>n.id===id);
  function lay(id, d, l, r) {
    if (id===null) return;
    const x=(l+r)/2; pos[id]={x,y:d,val:gn(id).val};
    lay(gn(id).left, d+1, l, x); lay(gn(id).right, d+1, x, r);
  }
  lay(0, 0, 0, 1);
  return pos;
}
function getEdges(nodes) {
  const e=[];
  nodes.forEach(n=>{if(n.left!==null)e.push([n.id,n.left]);if(n.right!==null)e.push([n.id,n.right]);});
  return e;
}
function treeDepth(nodes, id=0) {
  const n=nodes.find(x=>x.id===id); if(!n) return 0;
  return 1+Math.max(n.left!==null?treeDepth(nodes,n.left):0, n.right!==null?treeDepth(nodes,n.right):0);
}

// ─── Style map ─────────────────────────────────────────────────────────
const S_COLORS = {
  active:"#60a5fa", visiting:"#818cf8", path:"#38bdf8",
  checking:"#fbbf24", found:"#4ade80", backtrack:"#fb7185",
};
const L_COLORS = {
  start:"#64748b", done:"#4ade80", visit:"#60a5fa", "null-check":"#475569",
  "collect-left":"#818cf8", "collect-right":"#c084fc", "collect-done":"#38bdf8",
  check:"#fbbf24", found:"#4ade80", "found-cross":"#4ade80",
  "check-cross":"#f472b6", "cross-start":"#f472b6", recurse:"#a78bfa",
};

// ─── TreeCanvas ────────────────────────────────────────────────────────
function TreeCanvas({ nodes, step }) {
  const pos = useMemo(()=>layoutTree(nodes),[nodes]);
  const edges = useMemo(()=>getEdges(nodes),[nodes]);
  const depth = useMemo(()=>treeDepth(nodes),[nodes]);
  const W=360, H=Math.max(160,depth*64+32), P=32;

  const hlMap = {};
  (step.highlights||[]).forEach(h => { hlMap[h.id] = h.style; });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{maxWidth:W, display:"block", margin:"0 auto"}}>
      <defs>
        <filter id="ngl"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      {edges.map(([a,b])=>{
        const pa=pos[a],pb=pos[b]; if(!pa||!pb) return null;
        const x1=P+pa.x*(W-P*2),y1=24+pa.y*58,x2=P+pb.x*(W-P*2),y2=24+pb.y*58;
        const as=hlMap[a], bs=hlMap[b];
        const hot=as&&bs;
        const c=hot?S_COLORS[bs]||"#fbbf24":"#1a1e2c";
        return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={hot?2.5:1.2} filter={hot?"url(#ngl)":undefined}/>;
      })}
      {Object.entries(pos).map(([id,p])=>{
        const nid=+id, x=P+p.x*(W-P*2), y=24+p.y*58;
        const s=hlMap[nid];
        const c=s?S_COLORS[s]:"#2a3040";
        const glow=s==="found"||s==="checking"||s==="active";
        return (
          <g key={id}>
            <circle cx={x} cy={y} r={s?20:18} fill={s?c+"18":"#0e1018"} stroke={c} strokeWidth={s?2:1.2} filter={glow?"url(#ngl)":undefined}/>
            <text x={x} y={y+1} textAnchor="middle" dominantBaseline="central" fill={s?c:"#586070"} fontSize={14} fontWeight={600} fontFamily="'Source Code Pro',monospace">{p.val}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── CodePanel ─────────────────────────────────────────────────────────
function CodePanel({ code, activeLines }) {
  const ref = useRef();
  useEffect(()=>{
    if(ref.current && activeLines.length>0){
      const el=ref.current.querySelector(`[data-ln="${activeLines[0]}"]`);
      if(el) el.scrollIntoView({block:"nearest",behavior:"smooth"});
    }
  },[activeLines]);

  return (
    <div ref={ref} style={{fontFamily:"'Source Code Pro',monospace", fontSize:11.5, lineHeight:"19px", overflowY:"auto", padding:"4px 0", flex:1}}>
      {code.map((line,i)=>{
        const active=activeLines.includes(i);
        return (
          <div key={i} data-ln={i} style={{
            display:"flex", padding:"0 10px", minHeight:19,
            background:active?"#60a5fa10":"transparent",
            borderLeft:active?"2px solid #60a5fa":"2px solid transparent",
            transition:"background 0.12s",
          }}>
            <span style={{width:24,textAlign:"right",paddingRight:8,color:active?"#60a5fa66":"#2e3444",fontSize:10,userSelect:"none",flexShrink:0}}>{i+1}</span>
            <span style={{color:active?"#e0e6f0":"#5a6478",whiteSpace:"pre"}}>{line}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── WatchPanel ────────────────────────────────────────────────────────
function VarValue({ v }) {
  if (!v || v.type==="null" || v.value===null) return <span style={{color:"#303848",fontStyle:"italic"}}>—</span>;

  if (v.type==="number") return (
    <span style={{fontSize:16,fontWeight:700,color:v.changed?"#4ade80":"#d0d6e0",
      background:v.changed?"#4ade8012":"transparent",padding:"1px 6px",borderRadius:4,
      border:v.changed?"1px solid #4ade8030":"1px solid transparent",transition:"all 0.15s"}}>
      {v.value}
    </span>
  );

  if (v.type==="string") return (
    <span style={{fontSize:12,color:v.changed?"#fbbf24":"#8b95a5",fontStyle:"italic",
      background:v.changed?"#fbbf2410":"transparent",padding:"2px 6px",borderRadius:4}}>
      {v.value}
    </span>
  );

  if (v.type==="array") {
    if (v.value.length===0) return <span style={{color:"#303848",fontSize:12}}>[ ]  <span style={{fontStyle:"italic",fontSize:10}}>empty</span></span>;
    return (
      <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
        {v.value.map((x,i)=>{
          const hl = v.highlight===i;
          const ch = v.changed && !hl;
          return (
            <span key={i} style={{
              padding:"3px 8px",borderRadius:5,fontSize:13,fontWeight:600,
              background:hl?"#fbbf2420":ch?"#4ade800c":"#141822",
              border:`1px solid ${hl?"#fbbf24":ch?"#4ade8025":"#1e2434"}`,
              color:hl?"#fbbf24":ch?"#4ade80":"#c0c8d4",
              boxShadow:hl?"0 0 8px #fbbf2422":"none",
              transition:"all 0.15s",
            }}>{x}</span>
          );
        })}
      </div>
    );
  }

  return <span style={{color:"#8b95a5",fontSize:12}}>{JSON.stringify(v.value)}</span>;
}

function WatchPanel({ variables }) {
  const entries = Object.entries(variables||{});
  return (
    <div style={{padding:"8px 14px",overflowY:"auto",flex:1}}>
      {entries.map(([name,v])=>(
        <div key={name} style={{marginBottom:10}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
            <span style={{
              fontFamily:"'Source Code Pro',monospace",fontSize:11,color:"#586880",
              minWidth:100,paddingTop:3,flexShrink:0,textAlign:"right",
            }}>{name}</span>
            <div style={{flex:1}}><VarValue v={v}/></div>
          </div>
          {v?.annotation && (
            <div style={{marginLeft:110,fontSize:9,color:"#3a4860",marginTop:2,fontStyle:"italic"}}>{v.annotation}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── AI Panel ──────────────────────────────────────────────────────────
const AI_PROMPT = `You are a visual debugger trace generator. Given Python code, return ONLY a JavaScript function body (no markdown, no backticks) that returns a trace object.

Schema: { viz:{type:"tree",nodes:[{id,val,left,right}]}, code:["line1",...], steps:[{activeLines:[],label:"",detail:"",highlights:[{id,style}],variables:{"name":{value,type:"number"|"array"|"string"|"null",changed:bool,annotation:"",highlight:idx}}}], target:number }

Create a 5-7 node sample tree. Track ALL variables. Show arrays building element-by-element. Styles: "active","visiting","path","checking","found","backtrack". Output ONLY the JS function body.`;

function AIPanel({ onTrace, onClose }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const analyze = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:1000,
          system: AI_PROMPT,
          messages:[{role:"user",content:code}],
        }),
      });
      const data = await res.json();
      const body = data.content?.map(c=>c.text||"").join("\n") || "";
      const clean = body.replace(/```(?:javascript|js)?\n?/g,"").replace(/```/g,"").trim();
      const fn = new Function(clean);
      const trace = fn();
      if (!trace?.steps?.length) throw new Error("Trace returned no steps");
      onTrace(trace);
      onClose();
    } catch(e) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#00000088",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center"}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"#10131a",borderRadius:12,border:"1px solid #1e2434",width:600,maxHeight:"80vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"14px 18px",borderBottom:"1px solid #1e2434",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:14,color:"#e8ecf4"}}>Analyze New Algorithm</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#586880",cursor:"pointer",fontSize:18}}>×</button>
        </div>
        <div style={{padding:"14px 18px",flex:1,overflow:"auto"}}>
          <div style={{fontSize:11,color:"#586880",marginBottom:8}}>Paste Python code below. Claude will generate a step-by-step trace with variable tracking.</div>
          <textarea value={code} onChange={e=>setCode(e.target.value)}
            placeholder="def my_algorithm(root, target):&#10;    ..."
            style={{
              width:"100%",height:240,background:"#080a10",border:"1px solid #1e2434",borderRadius:8,
              color:"#c0c8d4",fontFamily:"'Source Code Pro',monospace",fontSize:12,padding:12,resize:"vertical",
              outline:"none",
            }}/>
          {error && <div style={{marginTop:8,padding:"8px 12px",borderRadius:6,background:"#fb718515",border:"1px solid #fb718530",color:"#fb7185",fontSize:11}}>{error}</div>}
        </div>
        <div style={{padding:"14px 18px",borderTop:"1px solid #1e2434",display:"flex",justifyContent:"flex-end",gap:8}}>
          <button onClick={onClose} style={{padding:"8px 16px",borderRadius:6,border:"1px solid #1e2434",background:"transparent",color:"#586880",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>Cancel</button>
          <button onClick={analyze} disabled={loading||!code.trim()}
            style={{padding:"8px 20px",borderRadius:6,border:"none",background:loading?"#1e2434":"#60a5fa",color:loading?"#586880":"#080a10",cursor:loading?"wait":"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",opacity:!code.trim()?0.4:1}}>
            {loading?"Tracing…":"Trace with AI"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Controls ──────────────────────────────────────────────────────────
function Btn({c="#2a3040",w,onClick,children,disabled}) {
  return <button onClick={onClick} disabled={disabled} style={{
    padding:w?"5px 14px":"5px 9px",borderRadius:5,border:`1px solid ${c}44`,
    background:`${c}12`,color:c==="#2a3040"?"#7c8594":c,cursor:disabled?"default":"pointer",
    fontSize:11,fontWeight:600,fontFamily:"'Source Code Pro',monospace",lineHeight:1,opacity:disabled?0.4:1,
  }}>{children}</button>;
}

// ─── Main App ──────────────────────────────────────────────────────────
export default function App() {
  const [presetIdx, setPresetIdx] = useState(0);
  const [trace, setTrace] = useState(null);
  const [si, setSi] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(500);
  const [showAI, setShowAI] = useState(false);
  const timerRef = useRef();

  // Generate trace from preset
  useEffect(()=>{
    const p = PRESETS[presetIdx];
    setTrace(generateTrace(p.nodes, p.target));
    setSi(0); setPlaying(false);
  },[presetIdx]);

  // Playback
  useEffect(()=>{
    if(playing && trace){
      timerRef.current=setInterval(()=>{
        setSi(p=>{if(p>=trace.steps.length-1){setPlaying(false);return p;} return p+1;});
      },speed);
    }
    return ()=>clearInterval(timerRef.current);
  },[playing,speed,trace]);

  if(!trace) return null;

  const step = trace.steps[si]||{activeLines:[],label:"",detail:"",highlights:[],variables:{}};
  const lc = L_COLORS[step.label]||"#60a5fa";

  return (
    <div style={{height:"100vh",background:"#090b10",color:"#c4c9d4",fontFamily:"'Source Code Pro','Menlo',monospace",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@300;400;500;600;700&family=Outfit:wght@400;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1e2434;border-radius:2px}
        @keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      {/* Header */}
      <div style={{padding:"10px 18px",borderBottom:"1px solid #141a24",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",background:"#0b0d14",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:playing?"#4ade80":"#fbbf24",boxShadow:`0 0 6px ${playing?"#4ade8066":"#fbbf2466"}`}}/>
          <span style={{fontFamily:"'Outfit',sans-serif",fontSize:15,fontWeight:800,color:"#f0f2f5",letterSpacing:"-0.03em"}}>vdb</span>
          <span style={{fontSize:9,color:"#3a4860",borderLeft:"1px solid #1e2434",paddingLeft:8}}>visual debugger</span>
        </div>

        <div style={{display:"flex",gap:4,marginLeft:12}}>
          {PRESETS.map((p,i)=>(
            <button key={i} onClick={()=>setPresetIdx(i)} style={{
              padding:"4px 10px",borderRadius:4,fontSize:10,fontFamily:"inherit",cursor:"pointer",
              border:i===presetIdx?"1px solid #60a5fa":"1px solid #1a1e2c",
              background:i===presetIdx?"#60a5fa10":"transparent",
              color:i===presetIdx?"#60a5fa":"#3a4860",
            }}>{p.name} <span style={{color:"#4ade80",fontWeight:600}}>S={p.target}</span></button>
          ))}
        </div>

        <button onClick={()=>setShowAI(true)} style={{
          marginLeft:"auto",padding:"5px 14px",borderRadius:5,border:"1px solid #c084fc44",
          background:"#c084fc10",color:"#c084fc",cursor:"pointer",fontSize:10,fontWeight:700,
          fontFamily:"inherit",letterSpacing:"0.02em",
        }}>+ Analyze New Code</button>
      </div>

      {/* Main content: 3 columns */}
      <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>

        {/* Left: Code */}
        <div style={{width:"28%",minWidth:240,display:"flex",flexDirection:"column",borderRight:"1px solid #141a24",overflow:"hidden"}}>
          <div style={{padding:"6px 12px",borderBottom:"1px solid #141a24",fontSize:9,color:"#3a4860",fontWeight:600,letterSpacing:"0.06em",flexShrink:0}}>
            PYTHON SOURCE
          </div>
          <CodePanel code={trace.code} activeLines={step.activeLines}/>
        </div>

        {/* Center: Tree + Step detail */}
        <div style={{flex:1,display:"flex",flexDirection:"column",borderRight:"1px solid #141a24",overflow:"hidden"}}>
          <div style={{padding:"6px 12px",borderBottom:"1px solid #141a24",fontSize:9,color:"#3a4860",fontWeight:600,letterSpacing:"0.06em",flexShrink:0}}>
            TREE
          </div>
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:8,overflow:"auto"}}>
            <TreeCanvas nodes={trace.viz.nodes} step={step}/>
          </div>
          {/* Step detail */}
          <div style={{padding:"10px 14px",borderTop:"1px solid #141a24",flexShrink:0}}>
            <div key={si} style={{
              padding:"8px 12px",borderRadius:6,background:"#0c0e16",
              borderLeft:`3px solid ${lc}`,fontSize:12,lineHeight:1.5,color:"#b0b8c8",
              animation:"fadeIn 0.12s ease-out",
            }}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                <span style={{fontSize:8,fontWeight:700,padding:"1px 6px",borderRadius:3,background:lc+"20",color:lc,textTransform:"uppercase",letterSpacing:"0.05em"}}>{step.label}</span>
                <span style={{fontSize:9,color:"#3a4860"}}>step {si+1}/{trace.steps.length}</span>
              </div>
              {step.detail}
            </div>
          </div>
        </div>

        {/* Right: Watch panel */}
        <div style={{width:"32%",minWidth:260,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{padding:"6px 12px",borderBottom:"1px solid #141a24",fontSize:9,color:"#3a4860",fontWeight:600,letterSpacing:"0.06em",flexShrink:0}}>
            WATCH · VARIABLES
          </div>
          <WatchPanel variables={step.variables}/>
        </div>
      </div>

      {/* Controls */}
      <div style={{padding:"8px 18px",borderTop:"1px solid #141a24",display:"flex",alignItems:"center",gap:5,flexShrink:0,background:"#0b0d14"}}>
        <Btn onClick={()=>{setSi(0);setPlaying(false);}}>⏮</Btn>
        <Btn onClick={()=>setSi(Math.max(0,si-1))}>◀</Btn>
        <Btn c={playing?"#fb7185":"#4ade80"} w onClick={()=>setPlaying(!playing)}>{playing?"⏸ Pause":"▶ Play"}</Btn>
        <Btn onClick={()=>setSi(Math.min(trace.steps.length-1,si+1))}>▶</Btn>
        <Btn onClick={()=>{setSi(trace.steps.length-1);setPlaying(false);}}>⏭</Btn>

        <input type="range" min={0} max={trace.steps.length-1} value={si}
          onChange={e=>{setSi(+e.target.value);setPlaying(false);}}
          style={{flex:1,minWidth:60,accentColor:"#60a5fa",marginLeft:8}}/>

        <span style={{fontSize:9,color:"#3a4860",minWidth:60,textAlign:"right"}}>{si+1} / {trace.steps.length}</span>

        <div style={{display:"flex",alignItems:"center",gap:4,marginLeft:8}}>
          <span style={{fontSize:8,color:"#3a4860"}}>SPEED</span>
          <input type="range" min={80} max={1200} step={40} value={1280-speed}
            onChange={e=>setSpeed(1280-+e.target.value)}
            style={{width:50,accentColor:"#818cf8"}}/>
        </div>
      </div>

      {showAI && <AIPanel onTrace={t=>{setTrace(t);setSi(0);setPlaying(false);}} onClose={()=>setShowAI(false)}/>}
    </div>
  );
}
