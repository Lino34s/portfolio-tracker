import { useState, useEffect, useCallback, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, Cell, PieChart, Pie } from "recharts";
import { supabase } from "./supabaseClient";
import LoginScreen from "./components/LoginScreen";

// ─── Supabase data helpers ────────────────────────────────────────────────────
async function dbLoad() {
  const { data, error } = await supabase.from("transactions").select("*").order("date", { ascending: false });
  if (error) { console.error("Load error:", error); return []; }
  return (data || []).map(r => ({
    id: r.id, type: r.type, ticker: r.ticker, name: r.name,
    shares: Number(r.shares), price: Number(r.price), currency: r.currency,
    total: Number(r.total), date: r.date, notes: r.notes || "", isin: r.isin || "", source: r.source || "manual",
  }));
}

async function dbUpsert(tx) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("transactions").upsert({
    id: tx.id, user_id: user.id, type: tx.type, ticker: tx.ticker, name: tx.name,
    shares: tx.shares, price: tx.price, currency: tx.currency, total: tx.total,
    date: tx.date, notes: tx.notes || "", isin: tx.isin || "", source: tx.source || "manual",
  });
  if (error) console.error("Upsert error:", error);
}

async function dbDelete(id) {
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) console.error("Delete error:", error);
}

async function dbUpsertMany(txs) {
  const { data: { user } } = await supabase.auth.getUser();
  const rows = txs.map(tx => ({
    id: tx.id, user_id: user.id, type: tx.type, ticker: tx.ticker, name: tx.name,
    shares: tx.shares, price: tx.price, currency: tx.currency, total: tx.total,
    date: tx.date, notes: tx.notes || "", isin: tx.isin || "", source: tx.source || "manual",
  }));
  const { error } = await supabase.from("transactions").upsert(rows);
  if (error) console.error("UpsertMany error:", error);
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────
function parseTrading212CSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) throw new Error("Ficheiro CSV vazio ou inválido.");
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
  const idx = names => { for (const n of names) { const i = headers.findIndex(h => h.toLowerCase().includes(n.toLowerCase())); if (i !== -1) return i; } return -1; };
  const cA=idx(["Action"]),cT=idx(["Time"]),cTk=idx(["Ticker"]),cN=idx(["Name"]),cSh=idx(["No. of shares","Shares"]);
  const cPr=idx(["Price / share","Price/share"]),cCu=idx(["Currency (Price","Currency"]),cTo=idx(["Total"]),cI=idx(["ISIN"]);
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]; if (!raw.trim()) continue;
    const cols=[]; let cur="",inQ=false;
    for(const ch of raw){if(ch==='"'){inQ=!inQ;}else if(ch===","&&!inQ){cols.push(cur.trim());cur="";}else{cur+=ch;}}
    cols.push(cur.trim());
    const action=cA>=0?cols[cA]?.replace(/"/g,""):""; const al=action.toLowerCase();
    if(!al.includes("buy")&&!al.includes("sell")&&!al.includes("dividend")) continue;
    const type=al.includes("sell")?"SELL":al.includes("dividend")?"DIVIDEND":"BUY";
    const ticker=cTk>=0?cols[cTk]?.replace(/"/g,""):""; const name=cN>=0?cols[cN]?.replace(/"/g,""):ticker;
    const shares=cSh>=0?parseFloat(cols[cSh]):0; const price=cPr>=0?parseFloat(cols[cPr]):0;
    const currency=cCu>=0?cols[cCu]?.replace(/"/g,""):"USD"; const total=cTo>=0?Math.abs(parseFloat(cols[cTo])):shares*price;
    const isin=cI>=0?cols[cI]?.replace(/"/g,""):""; const dateRaw=cT>=0?cols[cT]?.replace(/"/g,""):"";
    const date=dateRaw?dateRaw.split(" ")[0]:new Date().toISOString().split("T")[0];
    if(!ticker&&type!=="DIVIDEND") continue;
    results.push({id:`csv_${i}_${Date.now()}`,type,ticker:ticker.toUpperCase(),name:name||ticker,shares:isNaN(shares)?0:shares,price:isNaN(price)?0:price,currency:currency||"USD",total:isNaN(total)?0:total,date,isin,source:"csv"});
  }
  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n,d=2) => isNaN(n)?"—":Number(n).toLocaleString("pt-PT",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtC = (n,cy="USD") => (isNaN(n)||n===null)?"—":Number(n).toLocaleString("pt-PT",{style:"currency",currency:cy,minimumFractionDigits:2});
const fmtPct = n => isNaN(n)?"—":`${n>=0?"+":""}${fmt(n)}%`;
const MONTHS_PT   = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const MONTHS_FULL = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const TYPE_LABELS = {BUY:"Compra",SELL:"Venda",DIVIDEND:"Dividendo"};
const TYPE_COLORS = {BUY:"#4ade80",SELL:"#f87171",DIVIDEND:"#60a5fa"};
const ACCENT = "#7c6fff";
const PIE_PALETTE = ["#7c6fff","#4fc3f7","#4ade80","#f59e0b","#f87171","#a78bfa","#34d399","#fb923c","#60a5fa","#e879f9","#facc15","#2dd4bf"];

// ─── Icons ────────────────────────────────────────────────────────────────────
function Icon({name,size=16}){
  const p={width:size,height:size,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2"};
  if(name==="plus")       return <svg {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
  if(name==="upload")     return <svg {...p}><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>;
  if(name==="trash")      return <svg {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>;
  if(name==="list")       return <svg {...p}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>;
  if(name==="close")      return <svg {...p} strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
  if(name==="check")      return <svg {...p} strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>;
  if(name==="portfolio")  return <svg {...p}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>;
  if(name==="chart")      return <svg {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
  if(name==="refresh")    return <svg {...p}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>;
  if(name==="arrow_up")   return <svg {...p} strokeWidth="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>;
  if(name==="arrow_dn")   return <svg {...p} strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>;
  if(name==="dividend")   return <svg {...p}><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>;
  if(name==="chevron_r")  return <svg {...p} strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>;
  if(name==="chevron_l")  return <svg {...p} strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>;
  if(name==="chevron_d")  return <svg {...p} strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>;
  if(name==="pie")        return <svg {...p}><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>;
  if(name==="perf")       return <svg {...p}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
  if(name==="menu")       return <svg {...p}><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
  if(name==="x")          return <svg {...p} strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
  if(name==="logout")     return <svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
  return null;
}

// ─── Autocomplete ─────────────────────────────────────────────────────────────
function AutocompleteInput({value,onChange,onSelect,suggestions,placeholder,inputStyle}){
  const [open,setOpen]=useState(false);const [hi,setHi]=useState(0);const ref=useRef(null);
  useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false)};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  const filtered=value.length>=1?suggestions.filter(s=>s.ticker.toLowerCase().includes(value.toLowerCase())||s.name.toLowerCase().includes(value.toLowerCase())).slice(0,6):[];
  const handleKey=e=>{if(!open||!filtered.length)return;if(e.key==="ArrowDown"){e.preventDefault();setHi(h=>Math.min(h+1,filtered.length-1));}if(e.key==="ArrowUp"){e.preventDefault();setHi(h=>Math.max(h-1,0));}if(e.key==="Enter"){e.preventDefault();onSelect(filtered[hi]);setOpen(false);}if(e.key==="Escape")setOpen(false);};
  return(
    <div ref={ref} style={{position:"relative"}}>
      <input value={value} onChange={e=>{onChange(e.target.value);setOpen(true);setHi(0);}} onFocus={()=>{if(value.length>=1)setOpen(true);}} onKeyDown={handleKey} placeholder={placeholder} style={inputStyle} autoComplete="off"/>
      {open&&filtered.length>0&&(
        <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:"#16162a",border:"1px solid #2a2a40",borderRadius:10,zIndex:500,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.55)"}}>
          {filtered.map((s,i)=>(
            <div key={s.ticker} onMouseDown={()=>{onSelect(s);setOpen(false);}} onMouseEnter={()=>setHi(i)}
              style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",cursor:"pointer",background:i===hi?"rgba(124,111,255,0.12)":"transparent",borderBottom:i<filtered.length-1?"1px solid #1e1e30":"none",transition:"background 0.1s"}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,color:i===hi?"#a89fff":"#e8e6f0",minWidth:50}}>{s.ticker}</span>
              <span style={{fontSize:12,color:"#4a4a65",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── API (Yahoo Finance via allorigins) ───────────────────────────────────────
async function fetchQuote(ticker){
  try{
    const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
    const res=await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);if(!res.ok)return null;
    const data=await res.json();const parsed=JSON.parse(data.contents);
    const meta=parsed?.chart?.result?.[0]?.meta;if(!meta)return null;
    return{price:meta.regularMarketPrice,prev:meta.chartPreviousClose||meta.previousClose,currency:meta.currency||"USD"};
  }catch{return null;}
}
async function fetchDividendData(ticker){
  try{
    const url=`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=summaryDetail,calendarEvents`;
    const res=await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);if(!res.ok)return null;
    const data=await res.json();const parsed=JSON.parse(data.contents);
    const sd=parsed?.quoteSummary?.result?.[0]?.summaryDetail;
    const cal=parsed?.quoteSummary?.result?.[0]?.calendarEvents;
    if(!sd)return null;
    const dividendRate=sd.dividendRate?.raw||0;const trailingRate=sd.trailingAnnualDividendRate?.raw||dividendRate;
    const exDate=cal?.exDividendDate?.raw?new Date(cal.exDividendDate.raw*1000).toISOString().split("T")[0]:null;
    let frequency=4;
    if(dividendRate>0&&trailingRate>0){const r=trailingRate/dividendRate;if(r<=1.2)frequency=1;else if(r<=2.5)frequency=2;else if(r<=5)frequency=4;else frequency=12;}
    return{dividendRate,trailingRate,exDate,frequency};
  }catch{return null;}
}
async function fetchFxRate(){
  try{
    const url=`https://query1.finance.yahoo.com/v8/finance/chart/USDEUR=X?interval=1d&range=1d`;
    const res=await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);if(!res.ok)return null;
    const data=await res.json();const parsed=JSON.parse(data.contents);
    return parsed?.chart?.result?.[0]?.meta?.regularMarketPrice||null;
  }catch{return null;}
}

// ─── Computations ─────────────────────────────────────────────────────────────
function computePositions(transactions){
  const map={};
  const sorted=[...transactions].sort((a,b)=>a.date.localeCompare(b.date));
  for(const tx of sorted){
    if(tx.type==="DIVIDEND")continue;
    if(!map[tx.ticker])map[tx.ticker]={ticker:tx.ticker,name:tx.name,shares:0,totalCost:0};
    const pos=map[tx.ticker];
    if(tx.type==="BUY"){pos.shares+=tx.shares;pos.totalCost+=tx.total;}
    if(tx.type==="SELL"){const avg=pos.shares>0?pos.totalCost/pos.shares:0;pos.shares-=tx.shares;pos.totalCost-=avg*tx.shares;}
  }
  return Object.values(map).filter(p=>p.shares>0.0001).map(p=>({...p,avgCost:p.shares>0?p.totalCost/p.shares:0}));
}
function buildChartData(transactions,quotes){
  if(!transactions.length)return[];
  const sorted=[...transactions].filter(t=>t.type!=="DIVIDEND").sort((a,b)=>a.date.localeCompare(b.date));
  const days=[];const start=new Date(sorted[0].date);const end=new Date();
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1))days.push(new Date(d).toISOString().split("T")[0]);
  return days.map(day=>{
    const dayTxs=sorted.filter(t=>t.date<=day);const pos={};
    for(const tx of dayTxs){if(!pos[tx.ticker])pos[tx.ticker]={shares:0,totalCost:0};if(tx.type==="BUY"){pos[tx.ticker].shares+=tx.shares;pos[tx.ticker].totalCost+=tx.total;}if(tx.type==="SELL"){const avg=pos[tx.ticker].shares>0?pos[tx.ticker].totalCost/pos[tx.ticker].shares:0;pos[tx.ticker].shares-=tx.shares;pos[tx.ticker].totalCost-=avg*tx.shares;}}
    let value=0;for(const[ticker,p]of Object.entries(pos)){if(p.shares>0){const q=quotes[ticker];value+=p.shares*(q?.price||(p.totalCost/p.shares));}}
    return{date:day,value:Math.round(value*100)/100};
  });
}
function buildMonthlyPerf(transactions,quotes){
  if(!transactions.length)return[];
  const sorted=[...transactions].filter(t=>t.type!=="DIVIDEND").sort((a,b)=>a.date.localeCompare(b.date));
  const divTxs=transactions.filter(t=>t.type==="DIVIDEND");
  const firstDate=new Date(sorted[0]?.date||new Date());const now=new Date();
  const months=[];
  for(let y=firstDate.getFullYear();y<=now.getFullYear();y++){const mStart=y===firstDate.getFullYear()?firstDate.getMonth():0;const mEnd=y===now.getFullYear()?now.getMonth():11;for(let m=mStart;m<=mEnd;m++)months.push({y,m});}
  return months.map(({y,m})=>{
    const monthEnd=`${y}-${String(m+1).padStart(2,"0")}-31`;
    const dayTxs=sorted.filter(t=>t.date<=monthEnd);const pos={};
    for(const tx of dayTxs){if(!pos[tx.ticker])pos[tx.ticker]={shares:0,totalCost:0};if(tx.type==="BUY"){pos[tx.ticker].shares+=tx.shares;pos[tx.ticker].totalCost+=tx.total;}if(tx.type==="SELL"){const avg=pos[tx.ticker].shares>0?pos[tx.ticker].totalCost/pos[tx.ticker].shares:0;pos[tx.ticker].shares-=tx.shares;pos[tx.ticker].totalCost-=avg*tx.shares;}}
    let invested=0,marketValue=0;
    for(const[ticker,p]of Object.entries(pos)){if(p.shares>0){const q=quotes[ticker];invested+=p.totalCost;marketValue+=p.shares*(q?.price||(p.totalCost/p.shares));}}
    const monthStr=`${y}-${String(m+1).padStart(2,"0")}`;
    const monthDivs=divTxs.filter(t=>t.date.startsWith(monthStr)).reduce((s,t)=>s+t.total,0);
    const ret=invested>0?((marketValue-invested)/invested)*100:0;
    return{label:`${MONTHS_PT[m]} ${y}`,month:m+1,year:y,invested:Math.round(invested*100)/100,value:Math.round(marketValue*100)/100,gainLoss:Math.round((marketValue-invested)*100)/100,ret:Math.round(ret*100)/100,dividends:Math.round(monthDivs*100)/100};
  });
}
function buildYearlyPerf(monthlyPerf){
  const byYear={};
  for(const m of monthlyPerf){if(!byYear[m.year])byYear[m.year]={year:m.year,months:[],dividends:0};byYear[m.year].months.push(m);byYear[m.year].dividends+=m.dividends;}
  return Object.values(byYear).sort((a,b)=>b.year-a.year).map(yr=>{
    const last=yr.months[yr.months.length-1];const first=yr.months[0];
    const ret=first.invested>0?((last.value-first.invested)/first.invested)*100:0;
    return{...yr,startValue:first.invested,endValue:last.value,gainLoss:last.value-first.invested,ret:Math.round(ret*100)/100};
  });
}
function buildDividendProjection(positions,divData){
  const currentYear=new Date().getFullYear();const years=[currentYear,currentYear+1,currentYear+2];
  const byYear={};
  for(const yr of years){byYear[yr]={total:0,byMonth:{},byTicker:{}};for(let m=1;m<=12;m++)byYear[yr].byMonth[m]=0;}
  for(const pos of positions){
    const d=divData[pos.ticker];if(!d||!d.dividendRate||d.dividendRate===0)continue;
    const freq=d.frequency||4;const divPerPayment=d.dividendRate/freq;
    const exMonth=d.exDate?new Date(d.exDate).getMonth()+1:null;
    let payMonths=[];
    if(freq===12){payMonths=[1,2,3,4,5,6,7,8,9,10,11,12];}
    else if(freq===4){const base=exMonth?(exMonth%3===0?exMonth-2:exMonth%3===1?exMonth:exMonth-1):1;const s=((base-1+12)%12)+1;payMonths=[s,((s+2)%12)||12,((s+5)%12)||12,((s+8)%12)||12].sort((a,b)=>a-b);}
    else if(freq===2){const base=exMonth||3;payMonths=[base,((base+5)%12)||12].sort((a,b)=>a-b);}
    else{payMonths=[exMonth||6];}
    for(const yr of years){
      byYear[yr].byTicker[pos.ticker]={name:pos.name,shares:pos.shares,annualDivPerShare:d.dividendRate,freq,payMonths,divPerPayment,monthAmounts:{}};
      for(const m of payMonths){const amt=divPerPayment*pos.shares;byYear[yr].byMonth[m]=(byYear[yr].byMonth[m]||0)+amt;byYear[yr].total+=amt;byYear[yr].byTicker[pos.ticker].monthAmounts[m]=(byYear[yr].byTicker[pos.ticker].monthAmounts[m]||0)+amt;}
    }
  }
  return{byYear,years};
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────
function ChartTip({active,payload,label}){if(!active||!payload?.length)return null;return(<div style={{background:"#16162a",border:"1px solid #2a2a3a",borderRadius:10,padding:"10px 14px",fontSize:12}}><div style={{color:"#4a4a65",marginBottom:4}}>{label}</div><div style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:"#e8e6f0",fontSize:14}}>{fmtC(payload[0].value,"USD")}</div></div>);}
function DivTip({active,payload,label}){if(!active||!payload?.length)return null;return(<div style={{background:"#16162a",border:"1px solid #2a2a3a",borderRadius:10,padding:"10px 14px",fontSize:12}}><div style={{color:"#4a4a65",marginBottom:4}}>{label}</div>{payload.map((p,i)=><div key={i} style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:p.fill,fontSize:13}}>{p.name}: {fmtC(p.value,"USD")}</div>)}</div>);}
function PerfTip({active,payload,label}){if(!active||!payload?.length)return null;const d=payload[0]?.payload;return(<div style={{background:"#16162a",border:"1px solid #2a2a3a",borderRadius:10,padding:"10px 14px",fontSize:12,minWidth:140}}><div style={{color:"#4a4a65",marginBottom:6}}>{label}</div><div style={{display:"flex",justifyContent:"space-between",gap:16,marginBottom:3}}><span style={{color:"#6b6b8a"}}>Investido</span><span style={{fontFamily:"'DM Mono',monospace",color:"#9896b0"}}>{fmtC(d?.invested,"USD")}</span></div><div style={{display:"flex",justifyContent:"space-between",gap:16,marginBottom:3}}><span style={{color:"#6b6b8a"}}>Valor</span><span style={{fontFamily:"'DM Mono',monospace",color:"#e8e6f0",fontWeight:600}}>{fmtC(d?.value,"USD")}</span></div><div style={{display:"flex",justifyContent:"space-between",gap:16}}><span style={{color:"#6b6b8a"}}>Retorno</span><span style={{fontFamily:"'DM Mono',monospace",color:d?.ret>=0?"#4ade80":"#f87171",fontWeight:600}}>{fmtPct(d?.ret)}</span></div></div>);}
function PieTip({active,payload}){if(!active||!payload?.length)return null;const d=payload[0];return(<div style={{background:"#16162a",border:"1px solid #2a2a3a",borderRadius:10,padding:"10px 14px",fontSize:12}}><div style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:d.payload.fill,marginBottom:4}}>{d.name}</div><div style={{color:"#e8e6f0",fontFamily:"'DM Mono',monospace"}}>{fmtC(d.value,"USD")}</div><div style={{color:"#4a4a65",fontSize:11,marginTop:2}}>{fmt(d.payload.pct)}% do portfolio</div></div>);}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT — session gate
// ═══════════════════════════════════════════════════════════════════════════════
export default function Root() {
  const [session, setSession] = useState(undefined); // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 28, height: 28, border: "2px solid #7c6fff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>;
  }
  if (!session) return <LoginScreen />;
  return <App session={session} />;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
function App({ session }) {
  const [tab,setTab]=useState("dashboard");
  const [mobileMenuOpen,setMobileMenuOpen]=useState(false);
  const [transactions,setTransactions]=useState([]);
  const [loading,setLoading]=useState(true);
  const [quotes,setQuotes]=useState({});
  const [divData,setDivData]=useState({});
  const [fxRate,setFxRate]=useState(null);
  const [quotesLoading,setQuotesLoading]=useState(false);
  const [divLoading,setDivLoading]=useState(false);
  const [lastUpdated,setLastUpdated]=useState(null);
  const [showForm,setShowForm]=useState(false);
  const [csvDragOver,setCsvDragOver]=useState(false);
  const [toast,setToast]=useState(null);
  const [filterType,setFilterType]=useState("ALL");
  const [filterTicker,setFilterTicker]=useState("");
  const [sortBy,setSortBy]=useState("date_desc");
  const [csvPreview,setCsvPreview]=useState(null);
  const [chartData,setChartData]=useState([]);
  const [chartRange,setChartRange]=useState("ALL");
  const [divView,setDivView]=useState("overview");
  const [divYear,setDivYear]=useState(new Date().getFullYear());
  const [expandedMonth,setExpandedMonth]=useState(null);
  const [perfView,setPerfView]=useState("yearly");
  const [perfYear,setPerfYear]=useState(null);
  const emptyForm={type:"BUY",ticker:"",name:"",shares:"",price:"",currency:"USD",date:new Date().toISOString().split("T")[0],notes:""};
  const [form,setForm]=useState(emptyForm);

  // Load from Supabase on mount
  useEffect(()=>{
    dbLoad().then(txs=>{setTransactions(txs);setLoading(false);});
  },[]);

  const fetchAllQuotes=useCallback(async(txs)=>{
    const tickers=[...new Set(txs.filter(t=>t.type!=="DIVIDEND").map(t=>t.ticker))];
    if(!tickers.length)return;setQuotesLoading(true);
    const[fx,...qs]=await Promise.all([fetchFxRate(),...tickers.map(t=>fetchQuote(t).then(q=>({ticker:t,q})))]);
    if(fx)setFxRate(fx);const nq={};for(const{ticker,q}of qs){if(q)nq[ticker]=q;}
    setQuotes(nq);setLastUpdated(new Date());setQuotesLoading(false);
  },[]);

  const fetchAllDivData=useCallback(async(txs)=>{
    const tickers=[...new Set(txs.filter(t=>t.type==="BUY").map(t=>t.ticker))];
    if(!tickers.length)return;setDivLoading(true);
    const results=await Promise.all(tickers.map(t=>fetchDividendData(t).then(d=>({ticker:t,d}))));
    const nd={};for(const{ticker,d}of results){if(d)nd[ticker]=d;}
    setDivData(nd);setDivLoading(false);
  },[]);

  useEffect(()=>{if(!loading&&transactions.length){fetchAllQuotes(transactions);fetchAllDivData(transactions);}},[loading,transactions]);
  useEffect(()=>{if(Object.keys(quotes).length||transactions.length)setChartData(buildChartData(transactions,quotes));},[transactions,quotes]);

  const showToast=(msg,ok=true)=>{setToast({msg,ok});setTimeout(()=>setToast(null),3200);};
  const tickerSuggestions=[...new Map(transactions.map(t=>[t.ticker,{ticker:t.ticker,name:t.name}])).values()];
  const closeForm=()=>{setShowForm(false);setForm(emptyForm);};

  const handleAddTx=async()=>{
    if(!form.ticker||!form.shares||(!form.price&&form.type!=="DIVIDEND")){showToast("Preenche todos os campos obrigatórios.",false);return;}
    const tx={id:`manual_${Date.now()}`,type:form.type,ticker:form.ticker.toUpperCase(),name:form.name||form.ticker.toUpperCase(),shares:parseFloat(form.shares),price:parseFloat(form.price)||0,currency:form.currency,total:parseFloat(form.shares)*(parseFloat(form.price)||1),date:form.date,notes:form.notes,source:"manual"};
    await dbUpsert(tx);
    const updated=[tx,...transactions].sort((a,b)=>b.date.localeCompare(a.date));
    setTransactions(updated);fetchAllQuotes(updated);fetchAllDivData(updated);closeForm();showToast("Transação adicionada!");
  };

  const handleCSVFile=async file=>{
    if(!file)return;
    try{const rows=parseTrading212CSV(await file.text());if(!rows.length){showToast("Nenhuma transação encontrada.",false);return;}setCsvPreview({rows,filename:file.name});}
    catch(e){showToast("Erro CSV: "+e.message,false);}
  };

  const confirmCsvImport=async()=>{
    if(!csvPreview)return;
    const existing=new Set(transactions.map(t=>`${t.ticker}_${t.date}_${t.shares}_${t.type}`));
    const newRows=csvPreview.rows.filter(r=>!existing.has(`${r.ticker}_${r.date}_${r.shares}_${r.type}`));
    if(newRows.length>0){
      await dbUpsertMany(newRows);
      const merged=[...newRows,...transactions].sort((a,b)=>b.date.localeCompare(a.date));
      setTransactions(merged);fetchAllQuotes(merged);fetchAllDivData(merged);
    }
    showToast(`${newRows.length} transações importadas (${csvPreview.rows.length-newRows.length} duplicadas ignoradas).`);
    setCsvPreview(null);setTab("dashboard");
  };

  const deleteTx=async id=>{
    await dbDelete(id);
    const updated=transactions.filter(t=>t.id!==id);
    setTransactions(updated);fetchAllQuotes(updated);fetchAllDivData(updated);showToast("Transação eliminada.");
  };

  const handleLogout=async()=>{await supabase.auth.signOut();};

  // ── Metrics ────────────────────────────────────────────────────────────────
  const positions=computePositions(transactions);
  const positionsWithLive=positions.map(p=>{
    const q=quotes[p.ticker];const livePrice=q?.price||p.avgCost;
    const marketValue=p.shares*livePrice;const gainLoss=marketValue-p.totalCost;
    const gainLossPct=p.totalCost>0?(gainLoss/p.totalCost)*100:0;
    const dayChange=q?(livePrice-q.prev)*p.shares:0;const dayChangePct=q?((livePrice-q.prev)/q.prev)*100:0;
    return{...p,livePrice,marketValue,gainLoss,gainLossPct,dayChange,dayChangePct,hasLive:!!q};
  }).sort((a,b)=>b.marketValue-a.marketValue);

  const totalValue=positionsWithLive.reduce((s,p)=>s+p.marketValue,0);
  const totalCost=positionsWithLive.reduce((s,p)=>s+p.totalCost,0);
  const totalGainLoss=totalValue-totalCost;
  const totalGainPct=totalCost>0?(totalGainLoss/totalCost)*100:0;
  const totalDayChange=positionsWithLive.reduce((s,p)=>s+p.dayChange,0);
  const totalValueEUR=fxRate?totalValue*fxRate:null;
  const totalGainLossEUR=fxRate?totalGainLoss*fxRate:null;
  const totalDividendsReceived=transactions.filter(t=>t.type==="DIVIDEND").reduce((s,t)=>s+t.total,0);
  const allocationData=positionsWithLive.map((p,i)=>({name:p.ticker,value:Math.round(p.marketValue*100)/100,pct:totalValue>0?Math.round((p.marketValue/totalValue)*10000)/100:0,fill:PIE_PALETTE[i%PIE_PALETTE.length],fullName:p.name}));
  const monthlyPerf=buildMonthlyPerf(transactions,quotes);
  const yearlyPerf=buildYearlyPerf(monthlyPerf);
  const selectedYearMonths=perfYear?monthlyPerf.filter(m=>m.year===perfYear):[];
  const divProjection=buildDividendProjection(positions,divData);
  const currentYear=new Date().getFullYear();
  const currentYearProjTotal=divProjection.byYear[currentYear]?.total||0;
  const yocValues=positions.map(p=>{const d=divData[p.ticker];return(d&&d.dividendRate&&p.avgCost>0)?(d.dividendRate/p.avgCost)*100:null;}).filter(v=>v!==null);
  const avgYoC=yocValues.length?fmt(yocValues.reduce((a,b)=>a+b,0)/yocValues.length)+"%":"—";
  const livYieldValues=positions.map(p=>{const d=divData[p.ticker];const q=quotes[p.ticker];return(d&&d.dividendRate&&q?.price>0)?(d.dividendRate/q.price)*100:null;}).filter(v=>v!==null);
  const avgLivYield=livYieldValues.length?fmt(livYieldValues.reduce((a,b)=>a+b,0)/livYieldValues.length)+"%":"—";
  const histDivTxs=transactions.filter(t=>t.type==="DIVIDEND").sort((a,b)=>b.date.localeCompare(a.date));
  const histByYear={};
  for(const tx of histDivTxs){const yr=parseInt(tx.date.split("-")[0]);const mo=parseInt(tx.date.split("-")[1]);if(!histByYear[yr])histByYear[yr]={total:0,byMonth:{}};histByYear[yr].total+=tx.total;if(!histByYear[yr].byMonth[mo])histByYear[yr].byMonth[mo]=[];histByYear[yr].byMonth[mo].push(tx);}
  const projectedYearTotal=divProjection.byYear[divYear]?.total||0;
  const histYearTotal=histByYear[divYear]?.total||0;
  const divBarData=MONTHS_PT.map((month,mi)=>{const mo=mi+1;const projected=divProjection.byYear[divYear]?.byMonth[mo]||0;const received=(histByYear[divYear]?.byMonth[mo]||[]).reduce((s,t)=>s+t.total,0);return{month,projected,received};});
  const filtered=transactions.filter(t=>filterType==="ALL"||t.type===filterType).filter(t=>!filterTicker||t.ticker.toLowerCase().includes(filterTicker.toLowerCase())||t.name.toLowerCase().includes(filterTicker.toLowerCase())).sort((a,b)=>{if(sortBy==="date_desc")return b.date.localeCompare(a.date);if(sortBy==="date_asc")return a.date.localeCompare(b.date);if(sortBy==="ticker")return a.ticker.localeCompare(b.ticker);if(sortBy==="total_desc")return b.total-a.total;return 0;});
  const chartFiltered=(()=>{if(!chartData.length)return[];if(chartRange==="ALL")return chartData;const now=new Date();const cutoff=new Date(now);if(chartRange==="1M")cutoff.setMonth(now.getMonth()-1);if(chartRange==="3M")cutoff.setMonth(now.getMonth()-3);if(chartRange==="6M")cutoff.setMonth(now.getMonth()-6);if(chartRange==="1Y")cutoff.setFullYear(now.getFullYear()-1);return chartData.filter(d=>d.date>=cutoff.toISOString().split("T")[0]);})();
  const chartMin=chartFiltered.length?Math.min(...chartFiltered.map(d=>d.value))*0.97:0;
  const chartMax=chartFiltered.length?Math.max(...chartFiltered.map(d=>d.value))*1.03:0;
  const chartGain=(chartFiltered[chartFiltered.length-1]?.value||0)-(chartFiltered[0]?.value||0);
  const chartColor=chartGain>=0?"#4ade80":"#f87171";
  const inputBase={width:"100%",background:"#0d0d18",border:"1px solid #1e1e30",borderRadius:9,padding:"10px 12px",color:"#e8e6f0",fontSize:13,fontFamily:"inherit",colorScheme:"dark",outline:"none"};
  const isUpdating=quotesLoading||divLoading;
  const TABS=[{id:"dashboard",label:"Dashboard",icon:"chart"},{id:"performance",label:"Performance",icon:"perf"},{id:"allocation",label:"Alocação",icon:"pie"},{id:"dividends",label:"Dividendos",icon:"dividend"},{id:"transactions",label:"Transações",icon:"list"},{id:"import",label:"Importar CSV",icon:"upload"}];
  const navTo=(id)=>{setTab(id);setMobileMenuOpen(false);};

  return(
    <div style={{minHeight:"100vh",background:"#0a0a0f",color:"#e8e6f0",fontFamily:"'DM Sans','Segoe UI',sans-serif",paddingBottom:80}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:#12121a;}::-webkit-scrollbar-thumb{background:#2a2a3a;border-radius:2px;}
        input,select,textarea{outline:none;}input::placeholder{color:#3a3a50;}
        .rh:hover{background:rgba(255,255,255,0.028)!important;}
        .bp{transition:all 0.15s;}.bp:hover{filter:brightness(1.15);transform:translateY(-1px);}
        .bg:hover{background:rgba(255,255,255,0.06)!important;}
        .tb{transition:all 0.2s;}.fb{transition:all 0.15s;}
        @keyframes fadeIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
        @keyframes slideUp{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideInR{from{opacity:0;transform:translateX(100%);}to{opacity:1;transform:translateX(0);}}
        .ai{animation:fadeIn 0.3s ease forwards;}.ti{animation:slideUp 0.3s ease forwards;}
        .spin{animation:spin 1s linear infinite;}
        .drag-over{border-color:#7c6fff!important;background:rgba(124,111,255,0.08)!important;}
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.5);cursor:pointer;}
        .rb{cursor:pointer;border:none;font-family:inherit;transition:all 0.15s;}.rb:hover{background:rgba(255,255,255,0.06)!important;}
        .mo-row{cursor:pointer;transition:background 0.15s;}.mo-row:hover{background:rgba(255,255,255,0.03);}
        .yr-card{transition:all 0.18s;}.yr-card:hover{border-color:#2a2a50!important;background:#14142a!important;}
        .perf-row:hover{background:rgba(255,255,255,0.025);}
        .mobile-menu{animation:slideInR 0.25s ease forwards;}
        @media(max-width:640px){.desktop-nav{display:none!important;}.mobile-nav-btn{display:flex!important;}.main-pad{padding:16px 14px!important;}.hero-val{font-size:30px!important;}.card-grid{grid-template-columns:1fr 1fr!important;}.pos-table{font-size:11px!important;}.hide-mobile{display:none!important;}}
        @media(min-width:641px){.mobile-nav-btn{display:none!important;}}
      `}</style>

      {/* Header */}
      <header style={{background:"rgba(10,10,15,0.97)",backdropFilter:"blur(20px)",borderBottom:"1px solid #1a1a28",position:"sticky",top:0,zIndex:100,padding:"0 20px"}}>
        <div style={{maxWidth:1080,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:58}}>
          <div style={{display:"flex",alignItems:"center",gap:9,flexShrink:0}}>
            <div style={{width:28,height:28,borderRadius:8,background:"linear-gradient(135deg,#7c6fff,#4fc3f7)",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="portfolio" size={13}/></div>
            <span style={{fontFamily:"'DM Mono',monospace",fontWeight:500,fontSize:14,letterSpacing:"-0.02em",color:"#f0eeff"}}>portfolio<span style={{color:ACCENT}}>.track</span></span>
          </div>
          <nav className="desktop-nav" style={{display:"flex",gap:2,overflowX:"auto"}}>
            {TABS.map(t=>(
              <button key={t.id} className="tb" onClick={()=>setTab(t.id)}
                style={{display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontFamily:"inherit",fontWeight:500,whiteSpace:"nowrap",background:tab===t.id?"rgba(124,111,255,0.15)":"transparent",color:tab===t.id?ACCENT:"#6b6b8a",borderBottom:tab===t.id?"2px solid "+ACCENT:"2px solid transparent"}}>
                <Icon name={t.icon} size={12}/>{t.label}
              </button>
            ))}
          </nav>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {lastUpdated&&<span style={{fontSize:10,color:"#2a2a45",fontFamily:"'DM Mono',monospace"}} className="hide-mobile">{lastUpdated.toLocaleTimeString("pt-PT",{hour:"2-digit",minute:"2-digit"})}</span>}
            <button className="bg bp" onClick={()=>{fetchAllQuotes(transactions);fetchAllDivData(transactions);}} disabled={isUpdating}
              style={{display:"flex",alignItems:"center",gap:4,padding:"5px 10px",background:"transparent",border:"1px solid #1e1e30",borderRadius:8,color:isUpdating?"#3a3a55":"#6b6b8a",cursor:isUpdating?"not-allowed":"pointer",fontSize:11,fontFamily:"inherit"}}>
              <span className={isUpdating?"spin":""}><Icon name="refresh" size={12}/></span>
              <span className="hide-mobile">{isUpdating?"Atualizar...":"Atualizar"}</span>
            </button>
            <button className="bg" onClick={handleLogout} title="Sair"
              style={{display:"flex",alignItems:"center",padding:"5px 8px",background:"transparent",border:"1px solid #1e1e30",borderRadius:8,color:"#3a3a55",cursor:"pointer"}}>
              <Icon name="logout" size={13}/>
            </button>
            <button className="mobile-nav-btn" onClick={()=>setMobileMenuOpen(o=>!o)}
              style={{background:"transparent",border:"1px solid #1e1e30",borderRadius:8,padding:"6px 8px",color:"#6b6b8a",cursor:"pointer",display:"none",alignItems:"center"}}>
              <Icon name={mobileMenuOpen?"x":"menu"} size={16}/>
            </button>
          </div>
        </div>
        {mobileMenuOpen&&(
          <div className="mobile-menu" style={{background:"#10101e",borderTop:"1px solid #1a1a28",padding:"8px 0"}}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>navTo(t.id)}
                style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"12px 20px",background:tab===t.id?"rgba(124,111,255,0.1)":"transparent",border:"none",cursor:"pointer",fontSize:14,fontFamily:"inherit",fontWeight:500,color:tab===t.id?ACCENT:"#9896b0",textAlign:"left"}}>
                <Icon name={t.icon} size={16}/>{t.label}
              </button>
            ))}
            <button onClick={handleLogout} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"12px 20px",background:"transparent",border:"none",cursor:"pointer",fontSize:14,fontFamily:"inherit",color:"#3a3a55",textAlign:"left"}}>
              <Icon name="logout" size={16}/>Sair
            </button>
          </div>
        )}
      </header>

      <main className="main-pad" style={{maxWidth:1080,margin:"0 auto",padding:"24px 20px"}}>

        {/* DASHBOARD */}
        {tab==="dashboard"&&(
          <div className="ai">
            <div style={{marginBottom:20}}>
              <div style={{fontSize:11,color:"#3a3a55",fontWeight:500,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Valor total</div>
              <div style={{display:"flex",alignItems:"flex-end",gap:14,flexWrap:"wrap"}}>
                <div className="hero-val" style={{fontFamily:"'DM Mono',monospace",fontSize:38,fontWeight:500,color:"#f0eeff",letterSpacing:"-0.03em",lineHeight:1}}>{fmtC(totalValue,"USD")}</div>
                {totalValueEUR&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:18,color:"#4a4a65",marginBottom:3}}>{fmtC(totalValueEUR,"EUR")}</div>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:14,marginTop:8,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:5}}>
                  <span style={{color:totalGainLoss>=0?"#4ade80":"#f87171",display:"flex",alignItems:"center",gap:2,fontSize:13,fontFamily:"'DM Mono',monospace",fontWeight:600}}>
                    <Icon name={totalGainLoss>=0?"arrow_up":"arrow_dn"} size={13}/>{fmtC(Math.abs(totalGainLoss),"USD")}
                  </span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:totalGainPct>=0?"#4ade80":"#f87171",background:totalGainPct>=0?"rgba(74,222,128,0.1)":"rgba(248,113,113,0.1)",padding:"2px 7px",borderRadius:5}}>{fmtPct(totalGainPct)}</span>
                  <span style={{fontSize:11,color:"#3a3a55"}}>total</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:5}}>
                  <span style={{color:totalDayChange>=0?"#4ade80":"#f87171",fontSize:12,fontFamily:"'DM Mono',monospace"}}>{totalDayChange>=0?"+":""}{fmtC(totalDayChange,"USD")}</span>
                  <span style={{fontSize:11,color:"#3a3a55"}}>hoje</span>
                </div>
                {fxRate&&<span style={{fontSize:10,color:"#2a2a40"}}>1 USD = {fmt(fxRate,4)} EUR</span>}
              </div>
            </div>
            <div className="card-grid" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:24}}>
              {[{label:"Investido",value:fmtC(totalCost,"USD"),accent:"#7c6fff"},{label:"Dividendos",value:fmtC(totalDividendsReceived,"USD"),accent:"#60a5fa"},{label:"Projeção div./ano",value:fmtC(currentYearProjTotal,"USD"),accent:"#34d399"},{label:"Posições",value:positionsWithLive.length,accent:"#f59e0b"}].map((c,i)=>(
                <div key={i} style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:12,padding:"13px 15px",position:"relative",overflow:"hidden"}}>
                  <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:c.accent,opacity:0.5}}/>
                  <div style={{fontSize:10,color:"#3a3a55",fontWeight:500,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>{c.label}</div>
                  <div style={{fontSize:17,fontFamily:"'DM Mono',monospace",fontWeight:500,color:"#e8e6f0"}}>{c.value}</div>
                </div>
              ))}
            </div>
            {chartFiltered.length>1&&(
              <div style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:14,padding:"18px 18px 10px",marginBottom:24}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#e8e6f0"}}>Evolução do Portfolio</div>
                  <div style={{display:"flex",gap:3,background:"#0d0d18",borderRadius:7,padding:3}}>
                    {["1M","3M","6M","1Y","ALL"].map(r=>(
                      <button key={r} className="rb" onClick={()=>setChartRange(r)} style={{padding:"3px 9px",borderRadius:5,fontSize:11,fontWeight:600,fontFamily:"inherit",background:chartRange===r?"#1e1e30":"transparent",color:chartRange===r?"#e8e6f0":"#4a4a65"}}>{r}</button>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={190}>
                  <LineChart data={chartFiltered} margin={{top:4,right:4,left:0,bottom:0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a28" vertical={false}/>
                    <XAxis dataKey="date" tick={{fill:"#3a3a55",fontSize:9,fontFamily:"DM Mono"}} tickLine={false} axisLine={false} tickFormatter={d=>{const dt=new Date(d);return`${dt.getDate()}/${dt.getMonth()+1}`;}} interval={Math.max(1,Math.floor(chartFiltered.length/5))}/>
                    <YAxis tick={{fill:"#3a3a55",fontSize:9,fontFamily:"DM Mono"}} tickLine={false} axisLine={false} domain={[chartMin,chartMax]} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} width={44}/>
                    <Tooltip content={<ChartTip/>}/>
                    <Line type="monotone" dataKey="value" stroke={chartColor} strokeWidth={2} dot={false} activeDot={{r:4,fill:chartColor,stroke:"#0a0a0f",strokeWidth:2}}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div style={{marginBottom:10,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <h2 style={{fontSize:14,fontWeight:600,color:"#e8e6f0"}}>Posições</h2>
              {quotesLoading&&<span style={{fontSize:10,color:"#3a3a55",fontFamily:"'DM Mono',monospace"}}>A buscar cotações...</span>}
            </div>
            {positionsWithLive.length===0?(
              <div style={{textAlign:"center",padding:"50px 0",color:"#3a3a55"}}><div style={{fontSize:32,marginBottom:10}}>📈</div><div style={{fontSize:14,marginBottom:5}}>Sem posições abertas</div><div style={{fontSize:12}}>Adiciona transações para ver o portfolio</div></div>
            ):(
              <div style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:14,overflow:"hidden"}}>
                <div className="pos-table" style={{display:"grid",gridTemplateColumns:"1fr 80px 95px 105px 105px",padding:"9px 16px",borderBottom:"1px solid #1a1a28",fontSize:10,color:"#3a3a55",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em"}}>
                  <div>Ativo</div><div style={{textAlign:"right"}} className="hide-mobile">Qtd</div><div style={{textAlign:"right"}}>P. Médio / Atual</div><div style={{textAlign:"right"}}>Valor</div><div style={{textAlign:"right"}}>G/P</div>
                </div>
                {positionsWithLive.map((p,i)=>(
                  <div key={p.ticker} className="rh pos-table" style={{display:"grid",gridTemplateColumns:"1fr 80px 95px 105px 105px",padding:"12px 16px",borderBottom:i<positionsWithLive.length-1?"1px solid #161622":"none",alignItems:"center",transition:"background 0.15s"}}>
                    <div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,color:"#f0eeff"}}>{p.ticker}</div>
                      <div style={{fontSize:10,color:"#3a3a55",marginTop:1,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name!==p.ticker?p.name:""}</div>
                      {p.hasLive&&<div style={{fontSize:9,color:p.dayChangePct>=0?"#4ade80":"#f87171",fontFamily:"'DM Mono',monospace",marginTop:2}}>{p.dayChangePct>=0?"+":""}{fmt(p.dayChangePct)}% hoje</div>}
                    </div>
                    <div className="hide-mobile" style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:12,color:"#9896b0"}}>{fmt(p.shares,4)}</div>
                    <div style={{textAlign:"right"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#6b6b8a"}}>{fmtC(p.avgCost,"USD")}</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:p.hasLive?"#e8e6f0":"#4a4a65",marginTop:1}}>{fmtC(p.livePrice,"USD")}</div></div>
                    <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:600,color:"#e8e6f0"}}>{fmtC(p.marketValue,"USD")}</div>
                    <div style={{textAlign:"right"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:600,color:p.gainLoss>=0?"#4ade80":"#f87171"}}>{p.gainLoss>=0?"+":""}{fmtC(p.gainLoss,"USD")}</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:p.gainLossPct>=0?"rgba(74,222,128,0.7)":"rgba(248,113,113,0.7)",marginTop:1}}>{fmtPct(p.gainLossPct)}</div></div>
                  </div>
                ))}
                <div style={{display:"grid",gridTemplateColumns:"1fr 80px 95px 105px 105px",padding:"10px 16px",borderTop:"1px solid #1e1e30",background:"#0d0d18",alignItems:"center"}}>
                  <div style={{fontSize:11,fontWeight:600,color:"#4a4a65",textTransform:"uppercase"}}>Total</div><div className="hide-mobile"/><div/>
                  <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,color:"#f0eeff"}}>{fmtC(totalValue,"USD")}</div>
                  <div style={{textAlign:"right"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,color:totalGainLoss>=0?"#4ade80":"#f87171"}}>{totalGainLoss>=0?"+":""}{fmtC(totalGainLoss,"USD")}</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:totalGainPct>=0?"rgba(74,222,128,0.7)":"rgba(248,113,113,0.7)",marginTop:1}}>{fmtPct(totalGainPct)}</div></div>
                </div>
              </div>
            )}
            {fxRate&&totalValueEUR&&<div style={{marginTop:8,fontSize:10,color:"#2a2a40",textAlign:"right",fontFamily:"'DM Mono',monospace"}}>EUR: {fmtC(totalValueEUR,"EUR")} · G/P: {totalGainLossEUR>=0?"+":""}{fmtC(totalGainLossEUR,"EUR")} · {fmt(fxRate,4)}</div>}
          </div>
        )}

        {/* PERFORMANCE */}
        {tab==="performance"&&(
          <div className="ai">
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22,flexWrap:"wrap",gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <button onClick={()=>{setPerfView("yearly");setPerfYear(null);}} style={{background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:15,fontWeight:600,color:perfView==="yearly"&&!perfYear?"#f0eeff":"#4a4a65",padding:0}}>Performance</button>
                {perfYear&&<><span style={{color:"#2a2a40",fontSize:14}}>/</span><span style={{fontSize:15,fontWeight:600,color:ACCENT}}>{perfYear}</span></>}
              </div>
              {!perfYear&&(<div style={{display:"flex",gap:4,background:"#12121e",border:"1px solid #1e1e30",borderRadius:9,padding:3}}>{["yearly","monthly"].map(v=>(<button key={v} className="rb" onClick={()=>setPerfView(v)} style={{padding:"5px 14px",borderRadius:7,fontSize:12,fontWeight:500,fontFamily:"inherit",background:perfView===v?"#1e1e30":"transparent",color:perfView===v?"#e8e6f0":"#4a4a65",border:"none"}}>{v==="yearly"?"Por Ano":"Por Mês"}</button>))}</div>)}
              {perfYear&&<button className="bg" onClick={()=>{setPerfYear(null);setPerfView("yearly");}} style={{background:"transparent",border:"1px solid #1e1e30",borderRadius:8,padding:"5px 12px",color:"#6b6b8a",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>← Voltar</button>}
            </div>
            {perfView==="yearly"&&!perfYear&&(
              yearlyPerf.length===0?(<div style={{textAlign:"center",padding:"60px 0",color:"#3a3a55"}}><div style={{fontSize:32,marginBottom:10}}>📊</div><div style={{fontSize:14}}>Sem dados de performance ainda</div></div>):(
                <>
                  <div style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:14,padding:"18px 18px 10px",marginBottom:22}}>
                    <div style={{fontSize:13,fontWeight:600,color:"#e8e6f0",marginBottom:14}}>Retorno Anual (%)</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={[...yearlyPerf].reverse()} margin={{top:4,right:4,left:0,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a28" vertical={false}/>
                        <XAxis dataKey="year" tick={{fill:"#4a4a65",fontSize:11,fontFamily:"DM Mono"}} tickLine={false} axisLine={false}/>
                        <YAxis tick={{fill:"#3a3a55",fontSize:10,fontFamily:"DM Mono"}} tickLine={false} axisLine={false} tickFormatter={v=>`${v}%`} width={40}/>
                        <Tooltip formatter={(v)=>[fmtPct(v),"Retorno"]}/>
                        <Bar dataKey="ret" radius={[4,4,0,0]}>{[...yearlyPerf].reverse().map((e,i)=><Cell key={i} fill={e.ret>=0?"#4ade80":"#f87171"} opacity={0.8}/>)}</Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:14,overflow:"hidden"}}>
                    <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr 1fr 1fr 36px",padding:"9px 16px",borderBottom:"1px solid #1a1a28",fontSize:10,color:"#3a3a55",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em"}}>
                      <div>Ano</div><div style={{textAlign:"right"}}>Investido</div><div style={{textAlign:"right"}}>Valor Final</div><div style={{textAlign:"right"}}>G/P</div><div style={{textAlign:"right"}}>Retorno</div><div/>
                    </div>
                    {yearlyPerf.map((yr,i)=>(
                      <div key={yr.year} className="perf-row rh" onClick={()=>{setPerfYear(yr.year);setPerfView("monthly");}} style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr 1fr 1fr 36px",padding:"13px 16px",borderBottom:i<yearlyPerf.length-1?"1px solid #161622":"none",alignItems:"center",cursor:"pointer",transition:"background 0.15s"}}>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:600,color:"#f0eeff"}}>{yr.year}</div>
                        <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:12,color:"#6b6b8a"}}>{fmtC(yr.startValue,"USD")}</div>
                        <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:12,color:"#e8e6f0"}}>{fmtC(yr.endValue,"USD")}</div>
                        <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:600,color:yr.gainLoss>=0?"#4ade80":"#f87171"}}>{yr.gainLoss>=0?"+":""}{fmtC(yr.gainLoss,"USD")}</div>
                        <div style={{textAlign:"right"}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:yr.ret>=0?"#4ade80":"#f87171",background:yr.ret>=0?"rgba(74,222,128,0.1)":"rgba(248,113,113,0.1)",padding:"3px 8px",borderRadius:6}}>{fmtPct(yr.ret)}</span></div>
                        <div style={{display:"flex",justifyContent:"center",color:"#3a3a50"}}><Icon name="chevron_r" size={13}/></div>
                      </div>
                    ))}
                  </div>
                </>
              )
            )}
            {(perfView==="monthly"||perfYear)&&(
              <>
                <div style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:14,padding:"18px 18px 10px",marginBottom:22}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#e8e6f0",marginBottom:4}}>{perfYear?`Evolução Mensal — ${perfYear}`:"Evolução Mensal"}</div>
                  <div style={{fontSize:11,color:"#3a3a55",marginBottom:14}}>Investido vs Valor de Mercado</div>
                  <ResponsiveContainer width="100%" height={190}>
                    <LineChart data={perfYear?selectedYearMonths:monthlyPerf} margin={{top:4,right:4,left:0,bottom:0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1a28" vertical={false}/>
                      <XAxis dataKey="label" tick={{fill:"#3a3a55",fontSize:9,fontFamily:"DM Mono"}} tickLine={false} axisLine={false} interval={perfYear?0:Math.floor((perfYear?selectedYearMonths:monthlyPerf).length/6)}/>
                      <YAxis tick={{fill:"#3a3a55",fontSize:9,fontFamily:"DM Mono"}} tickLine={false} axisLine={false} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} width={44}/>
                      <Tooltip content={<PerfTip/>}/>
                      <Line type="monotone" dataKey="invested" stroke="#4a4a65" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name="Investido"/>
                      <Line type="monotone" dataKey="value" stroke={ACCENT} strokeWidth={2} dot={false} activeDot={{r:4,fill:ACCENT,stroke:"#0a0a0f",strokeWidth:2}} name="Valor"/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:14,overflow:"hidden"}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 95px 95px 95px 90px 90px",padding:"9px 16px",borderBottom:"1px solid #1a1a28",fontSize:10,color:"#3a3a55",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em"}}>
                    <div>Mês</div><div style={{textAlign:"right"}}>Investido</div><div style={{textAlign:"right"}}>Valor</div><div style={{textAlign:"right"}}>G/P</div><div style={{textAlign:"right"}}>Retorno</div><div style={{textAlign:"right"}}>Dividendos</div>
                  </div>
                  {(perfYear?[...selectedYearMonths].reverse():[...monthlyPerf].reverse()).map((m,i,arr)=>(
                    <div key={m.label} className="rh" style={{display:"grid",gridTemplateColumns:"1fr 95px 95px 95px 90px 90px",padding:"11px 16px",borderBottom:i<arr.length-1?"1px solid #161622":"none",alignItems:"center"}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"#e8e6f0",fontWeight:500}}>{m.label}</div>
                      <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#6b6b8a"}}>{fmtC(m.invested,"USD")}</div>
                      <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#e8e6f0"}}>{fmtC(m.value,"USD")}</div>
                      <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:600,color:m.gainLoss>=0?"#4ade80":"#f87171"}}>{m.gainLoss>=0?"+":""}{fmtC(m.gainLoss,"USD")}</div>
                      <div style={{textAlign:"right"}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:m.ret>=0?"#4ade80":"#f87171"}}>{fmtPct(m.ret)}</span></div>
                      <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:11,color:m.dividends>0?"#60a5fa":"#2a2a45"}}>{m.dividends>0?fmtC(m.dividends,"USD"):"—"}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ALOCAÇÃO */}
        {tab==="allocation"&&(
          <div className="ai">
            <h2 style={{fontSize:15,fontWeight:600,color:"#e8e6f0",marginBottom:22}}>Alocação do Portfolio</h2>
            {allocationData.length===0?(<div style={{textAlign:"center",padding:"60px 0",color:"#3a3a55"}}><div style={{fontSize:32,marginBottom:10}}>🥧</div><div style={{fontSize:14}}>Sem posições para mostrar</div></div>):(
              <>
                <div style={{display:"flex",gap:24,flexWrap:"wrap",marginBottom:24,alignItems:"center",justifyContent:"center"}}>
                  <div style={{flexShrink:0}}>
                    <ResponsiveContainer width={240} height={240}>
                      <PieChart><Pie data={allocationData} cx="50%" cy="50%" innerRadius={65} outerRadius={105} paddingAngle={2} dataKey="value" nameKey="name">{allocationData.map((e,i)=><Cell key={i} fill={e.fill} strokeWidth={0}/>)}</Pie><Tooltip content={<PieTip/>}/></PieChart>
                    </ResponsiveContainer>
                    <div style={{textAlign:"center",marginTop:-8}}><div style={{fontSize:10,color:"#3a3a55",textTransform:"uppercase",letterSpacing:"0.07em"}}>Total</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:16,fontWeight:600,color:"#e8e6f0"}}>{fmtC(totalValue,"USD")}</div></div>
                  </div>
                  <div style={{flex:1,minWidth:200}}>
                    {allocationData.map((d,i)=>(
                      <div key={d.name} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:i<allocationData.length-1?"1px solid #161622":"none"}}>
                        <div style={{width:10,height:10,borderRadius:3,background:d.fill,flexShrink:0}}/>
                        <div style={{flex:1,minWidth:0}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,color:"#e8e6f0"}}>{d.name}</div><div style={{fontSize:11,color:"#3a3a55",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.fullName!==d.name?d.fullName:""}</div></div>
                        <div style={{textAlign:"right",flexShrink:0}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"#9896b0"}}>{fmtC(d.value,"USD")}</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:d.fill,fontWeight:600}}>{fmt(d.pct)}%</div></div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:14,padding:"18px 18px 10px",marginBottom:24}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#e8e6f0",marginBottom:14}}>Peso por Ativo (%)</div>
                  <ResponsiveContainer width="100%" height={Math.max(160,allocationData.length*40)}>
                    <BarChart data={[...allocationData].sort((a,b)=>b.pct-a.pct)} layout="vertical" margin={{top:0,right:8,left:0,bottom:0}}>
                      <XAxis type="number" tick={{fill:"#3a3a55",fontSize:9,fontFamily:"DM Mono"}} tickLine={false} axisLine={false} tickFormatter={v=>`${v}%`}/>
                      <YAxis type="category" dataKey="name" tick={{fill:"#9896b0",fontSize:11,fontFamily:"DM Mono"}} tickLine={false} axisLine={false} width={52}/>
                      <Tooltip formatter={(v)=>[`${fmt(v)}%`,"Peso"]}/>
                      <Bar dataKey="pct" radius={[0,4,4,0]} maxBarSize={22}>{[...allocationData].sort((a,b)=>b.pct-a.pct).map((e,i)=><Cell key={i} fill={e.fill} opacity={0.85}/>)}</Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {allocationData.length>0&&(()=>{const top1=allocationData[0];const top3pct=allocationData.slice(0,3).reduce((s,d)=>s+d.pct,0);return(<div style={{background:"#0d0d18",border:"1px solid #1a1a28",borderRadius:12,padding:"14px 16px",display:"flex",gap:16,flexWrap:"wrap"}}>{[{label:"Maior posição",value:`${top1.name} (${fmt(top1.pct)}%)`,accent:"#f59e0b"},{label:"Top 3 posições",value:`${fmt(top3pct)}% do portfolio`,accent:top3pct>60?"#f87171":"#4ade80"},{label:"Posições totais",value:allocationData.length,accent:ACCENT}].map((s,i)=>(<div key={i} style={{flex:1,minWidth:120}}><div style={{fontSize:10,color:"#3a3a55",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>{s.label}</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:600,color:s.accent}}>{s.value}</div></div>))}</div>);})()}
              </>
            )}
          </div>
        )}

        {/* DIVIDENDOS */}
        {tab==="dividends"&&(
          <div className="ai">
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22,flexWrap:"wrap",gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <button onClick={()=>setDivView("overview")} style={{background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:15,fontWeight:600,color:divView==="overview"?"#f0eeff":"#4a4a65",padding:0}}>Dividendos</button>
                {divView==="year"&&<><span style={{color:"#2a2a40",fontSize:14}}>/</span><span style={{fontSize:15,fontWeight:600,color:ACCENT}}>{divYear}</span></>}
              </div>
              {divView==="year"&&(<div style={{display:"flex",alignItems:"center",gap:8}}><button className="bg" onClick={()=>setDivYear(y=>y-1)} style={{background:"transparent",border:"1px solid #1e1e30",borderRadius:8,padding:"4px 9px",color:"#6b6b8a",cursor:"pointer",display:"flex",alignItems:"center"}}><Icon name="chevron_l" size={14}/></button><span style={{fontFamily:"'DM Mono',monospace",fontSize:13,color:"#e8e6f0",minWidth:36,textAlign:"center"}}>{divYear}</span><button className="bg" onClick={()=>setDivYear(y=>y+1)} style={{background:"transparent",border:"1px solid #1e1e30",borderRadius:8,padding:"4px 9px",color:"#6b6b8a",cursor:"pointer",display:"flex",alignItems:"center"}}><Icon name="chevron_r" size={14}/></button></div>)}
              {divLoading&&<span style={{fontSize:10,color:"#3a3a55",fontFamily:"'DM Mono',monospace"}}>A buscar dividendos...</span>}
            </div>
            {divView==="overview"&&(
              <>
                <div className="card-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:11,marginBottom:26}}>
                  {[{label:"Recebidos (histórico)",value:fmtC(totalDividendsReceived,"USD"),sub:`${histDivTxs.length} pagamentos`,accent:"#60a5fa"},{label:`Projeção ${currentYear}`,value:fmtC(currentYearProjTotal,"USD"),sub:"baseado em yield atual",accent:"#34d399"},{label:"Yield on Cost médio",value:avgYoC,sub:"yield sobre custo",accent:"#f59e0b"},{label:"Yield Live médio",value:avgLivYield,sub:"yield ao preço atual",accent:ACCENT}].map((c,i)=>(
                    <div key={i} style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:14,padding:"15px 17px",position:"relative",overflow:"hidden"}}>
                      <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:c.accent,opacity:0.5}}/>
                      <div style={{fontSize:10,color:"#3a3a55",fontWeight:500,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:7}}>{c.label}</div>
                      <div style={{fontSize:19,fontFamily:"'DM Mono',monospace",fontWeight:500,color:"#e8e6f0",marginBottom:3}}>{c.value}</div>
                      <div style={{fontSize:10,color:"#2a2a40"}}>{c.sub}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginBottom:10,fontSize:13,fontWeight:600,color:"#e8e6f0"}}>Por Ativo</div>
                {positions.length===0?(<div style={{textAlign:"center",padding:"50px 0",color:"#3a3a55"}}><div style={{fontSize:32,marginBottom:10}}>💰</div><div style={{fontSize:14}}>Sem posições</div></div>):(
                  <div style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:14,overflow:"hidden",marginBottom:26}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 70px 105px 80px 80px 110px 80px",padding:"9px 16px",borderBottom:"1px solid #1a1a28",fontSize:10,color:"#3a3a55",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em"}}>
                      <div>Ativo</div><div style={{textAlign:"right"}}>Qtd</div><div style={{textAlign:"right"}}>Div/Ação/Ano</div><div style={{textAlign:"right"}}>Freq.</div><div style={{textAlign:"right"}}>YoC</div><div style={{textAlign:"right"}}>Projeção Anual</div><div style={{textAlign:"right"}}>Yield Live</div>
                    </div>
                    {positions.map((p,i)=>{
                      const d=divData[p.ticker];const q=quotes[p.ticker];
                      const noDivData=!d||!d.dividendRate;
                      const annualProj=noDivData?null:d.dividendRate*p.shares;
                      const yoc=(!noDivData&&p.avgCost>0)?(d.dividendRate/p.avgCost)*100:null;
                      const livYield=(!noDivData&&q?.price>0)?(d.dividendRate/q.price)*100:null;
                      const freqLabel=noDivData?"—":({1:"Anual",2:"Semestral",4:"Trimestral",12:"Mensal"}[d.frequency]||"—");
                      return(
                        <div key={p.ticker} className="rh" style={{display:"grid",gridTemplateColumns:"1fr 70px 105px 80px 80px 110px 80px",padding:"12px 16px",borderBottom:i<positions.length-1?"1px solid #161622":"none",alignItems:"center",transition:"background 0.15s"}}>
                          <div><div style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:600,color:"#f0eeff"}}>{p.ticker}</div><div style={{fontSize:10,color:"#3a3a55",marginTop:1,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name!==p.ticker?p.name:""}</div></div>
                          <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#9896b0"}}>{fmt(p.shares,2)}</div>
                          <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:12,color:noDivData?"#2a2a45":"#e8e6f0"}}>{noDivData?"—":fmtC(d.dividendRate,"USD")}</div>
                          <div style={{textAlign:"right",fontSize:11,color:"#6b6b8a"}}>{freqLabel}</div>
                          <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:12,color:yoc!==null?"#f59e0b":"#2a2a45"}}>{yoc!==null?fmt(yoc)+"%":"—"}</div>
                          <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:600,color:annualProj!==null?"#34d399":"#2a2a45"}}>{annualProj!==null?fmtC(annualProj,"USD"):"—"}</div>
                          <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:12,color:livYield!==null?ACCENT:"#2a2a45"}}>{livYield!==null?fmt(livYield)+"%":"—"}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{marginBottom:10,fontSize:13,fontWeight:600,color:"#e8e6f0"}}>Projeção Futura</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:11,marginBottom:26}}>
                  {divProjection.years.map(yr=>{const yrData=divProjection.byYear[yr];const monthVals=Object.values(yrData.byMonth);const maxV=Math.max(...monthVals,0.01);return(
                    <div key={yr} className="yr-card" onClick={()=>{setDivYear(yr);setDivView("year");setExpandedMonth(null);}} style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:14,padding:"17px 19px",cursor:"pointer",position:"relative",overflow:"hidden"}}>
                      <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"#34d399",opacity:0.4}}/>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:9}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:15,fontWeight:600,color:"#f0eeff"}}>{yr}</span><span style={{fontSize:10,color:"#3a3a55",display:"flex",alignItems:"center",gap:2}}>Ver <Icon name="chevron_r" size={11}/></span></div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:20,fontWeight:500,color:"#34d399",marginBottom:5}}>{fmtC(yrData.total,"USD")}</div>
                      <div style={{fontSize:10,color:"#3a3a55",marginBottom:11}}>{Object.keys(yrData.byTicker).length} ativos com dividendo</div>
                      <div style={{display:"flex",gap:2,alignItems:"flex-end",height:22}}>{monthVals.map((v,mi)=><div key={mi} style={{flex:1,height:v>0?Math.max(3,Math.round((v/maxV)*22)):2,background:v>0?"#34d399":"#1a1a28",borderRadius:2}}/>)}</div>
                    </div>
                  );})}
                </div>
                {Object.keys(histByYear).length>0&&(<><div style={{marginBottom:10,fontSize:13,fontWeight:600,color:"#e8e6f0"}}>Histórico Recebido</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:11}}>{Object.entries(histByYear).sort(([a],[b])=>Number(b)-Number(a)).map(([yr,data])=>(<div key={yr} className="yr-card" onClick={()=>{setDivYear(parseInt(yr));setDivView("year");setExpandedMonth(null);}} style={{background:"#0f0f1e",border:"1px solid #1a1a28",borderRadius:14,padding:"17px 19px",cursor:"pointer",position:"relative",overflow:"hidden"}}><div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"#60a5fa",opacity:0.4}}/><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:9}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:15,fontWeight:600,color:"#e8e6f0"}}>{yr}</span><span style={{fontSize:10,padding:"2px 7px",background:"rgba(96,165,250,0.1)",color:"#60a5fa",borderRadius:5,fontWeight:600}}>RECEBIDO</span></div><div style={{fontFamily:"'DM Mono',monospace",fontSize:20,fontWeight:500,color:"#60a5fa",marginBottom:5}}>{fmtC(data.total,"USD")}</div><div style={{fontSize:10,color:"#3a3a55"}}>{Object.values(data.byMonth).flat().length} pagamentos</div></div>))}</div></>)}
              </>
            )}
            {divView==="year"&&(
              <>
                <div style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:14,padding:"18px 18px 10px",marginBottom:22}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:8}}>
                    <div style={{fontSize:13,fontWeight:600,color:"#e8e6f0"}}>Distribuição Mensal — {divYear}</div>
                    <div style={{display:"flex",gap:12,fontSize:11,color:"#4a4a65"}}><span style={{display:"flex",alignItems:"center",gap:3}}><span style={{width:7,height:7,borderRadius:2,background:"#34d399",display:"inline-block"}}/> Projeção</span><span style={{display:"flex",alignItems:"center",gap:3}}><span style={{width:7,height:7,borderRadius:2,background:"#60a5fa",display:"inline-block"}}/> Recebido</span></div>
                  </div>
                  <div style={{fontSize:11,color:"#3a3a55",marginBottom:14}}>Projeção: <span style={{color:"#34d399",fontFamily:"'DM Mono',monospace"}}>{fmtC(projectedYearTotal,"USD")}</span>{histYearTotal>0&&<span> · Recebido: <span style={{color:"#60a5fa",fontFamily:"'DM Mono',monospace"}}>{fmtC(histYearTotal,"USD")}</span></span>}</div>
                  <ResponsiveContainer width="100%" height={155}>
                    <BarChart data={divBarData} margin={{top:0,right:4,left:0,bottom:0}} barGap={2} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1a28" vertical={false}/>
                      <XAxis dataKey="month" tick={{fill:"#4a4a65",fontSize:10,fontFamily:"DM Mono"}} tickLine={false} axisLine={false}/>
                      <YAxis tick={{fill:"#3a3a55",fontSize:9,fontFamily:"DM Mono"}} tickLine={false} axisLine={false} tickFormatter={v=>v>0?`$${v.toFixed(0)}`:""} width={42}/>
                      <Tooltip content={<DivTip/>}/>
                      <Bar dataKey="projected" name="Projeção" fill="#34d399" opacity={0.5} radius={[3,3,0,0]}/>
                      <Bar dataKey="received" name="Recebido" fill="#60a5fa" opacity={0.85} radius={[3,3,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"36px 1fr 125px 125px 30px",padding:"0 16px 5px",fontSize:10,color:"#3a3a55",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em"}}>
                  <div/><div/><div style={{textAlign:"right",color:"#34d399"}}>Projeção</div><div style={{textAlign:"right",color:"#60a5fa"}}>Recebido</div><div/>
                </div>
                <div style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:14,overflow:"hidden",marginBottom:22}}>
                  {MONTHS_FULL.map((monthName,mi)=>{
                    const mo=mi+1;const projected=divProjection.byYear[divYear]?.byMonth[mo]||0;
                    const receivedTxs=histByYear[divYear]?.byMonth[mo]||[];const received=receivedTxs.reduce((s,t)=>s+t.total,0);
                    const tickerProjections=Object.entries(divProjection.byYear[divYear]?.byTicker||{}).filter(([,td])=>td.monthAmounts&&td.monthAmounts[mo]>0);
                    const isExpanded=expandedMonth===mo;const hasData=projected>0||received>0;const isPast=new Date(divYear,mi,1)<new Date();
                    return(
                      <div key={mo} style={{borderBottom:mi<11?"1px solid #161622":"none"}}>
                        <div className="mo-row" onClick={()=>hasData&&setExpandedMonth(isExpanded?null:mo)} style={{display:"grid",gridTemplateColumns:"36px 1fr 125px 125px 30px",padding:"12px 16px",alignItems:"center",opacity:hasData?1:0.3}}>
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#4a4a65",fontWeight:600}}>{String(mo).padStart(2,"0")}</div>
                          <div style={{fontSize:13,fontWeight:hasData?600:400,color:hasData?"#e8e6f0":"#3a3a55"}}>{monthName}{isPast&&received>0&&<span style={{marginLeft:7,fontSize:9,color:"#60a5fa",background:"rgba(96,165,250,0.1)",padding:"2px 5px",borderRadius:4,fontWeight:500}}>RECEBIDO</span>}</div>
                          <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:12,color:"#34d399"}}>{projected>0?fmtC(projected,"USD"):"—"}</div>
                          <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:12,color:"#60a5fa"}}>{received>0?fmtC(received,"USD"):"—"}</div>
                          <div style={{display:"flex",justifyContent:"flex-end",color:"#2a2a40"}}>{hasData&&<Icon name={isExpanded?"chevron_d":"chevron_r"} size={13}/>}</div>
                        </div>
                        {isExpanded&&(
                          <div style={{background:"#0d0d18",borderTop:"1px solid #1a1a28",padding:"11px 16px 14px"}}>
                            {tickerProjections.length>0&&(<><div style={{fontSize:10,color:"#4a4a65",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:9}}>Projeção por Ativo</div>{tickerProjections.map(([ticker,td])=>(<div key={ticker} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #141422"}}><div style={{display:"flex",alignItems:"center",gap:9}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:600,color:"#9896b0",minWidth:48}}>{ticker}</span><span style={{fontSize:10,color:"#3a3a55"}}>{fmt(td.shares,2)} ações × {fmtC(td.divPerPayment,"USD")}</span></div><span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:600,color:"#34d399"}}>{fmtC(td.monthAmounts[mo],"USD")}</span></div>))}</>)}
                            {receivedTxs.length>0&&(<><div style={{fontSize:10,color:"#4a4a65",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:9,marginTop:tickerProjections.length>0?14:0}}>Pagamentos Recebidos</div>{receivedTxs.map(tx=>(<div key={tx.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #141422"}}><div style={{display:"flex",alignItems:"center",gap:9}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:600,color:"#60a5fa",minWidth:48}}>{tx.ticker}</span><span style={{fontSize:10,color:"#3a3a55"}}>{tx.date}</span></div><span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:600,color:"#60a5fa"}}>{fmtC(tx.total,"USD")}</span></div>))}</>)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div style={{display:"grid",gridTemplateColumns:"36px 1fr 125px 125px 30px",padding:"11px 16px",borderTop:"1px solid #1e1e30",background:"#0d0d18",alignItems:"center"}}>
                    <div/><div style={{fontSize:11,fontWeight:600,color:"#4a4a65",textTransform:"uppercase"}}>Total {divYear}</div>
                    <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,color:"#34d399"}}>{fmtC(projectedYearTotal,"USD")}</div>
                    <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,color:"#60a5fa"}}>{fmtC(histYearTotal,"USD")}</div>
                    <div/>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* TRANSACTIONS */}
        {tab==="transactions"&&(
          <div className="ai">
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18,flexWrap:"wrap"}}>
              <AutocompleteInput value={filterTicker} onChange={setFilterTicker} onSelect={s=>setFilterTicker(s.ticker)} suggestions={tickerSuggestions} placeholder="Filtrar por ticker ou nome..." inputStyle={{...inputBase,padding:"9px 13px",minWidth:140,flex:1}}/>
              <div style={{display:"flex",gap:3,background:"#12121e",border:"1px solid #1e1e30",borderRadius:9,padding:3}}>
                {["ALL","BUY","SELL","DIVIDEND"].map(t=>(<button key={t} className="fb" onClick={()=>setFilterType(t)} style={{padding:"4px 10px",borderRadius:6,border:"none",cursor:"pointer",fontSize:11,fontWeight:500,fontFamily:"inherit",background:filterType===t?"#1e1e30":"transparent",color:filterType===t?"#e8e6f0":"#4a4a65"}}>{t==="ALL"?"Todos":TYPE_LABELS[t]}</button>))}
              </div>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...inputBase,width:"auto",padding:"8px 11px",color:"#6b6b8a",cursor:"pointer"}}>
                <option value="date_desc">Data ↓</option><option value="date_asc">Data ↑</option><option value="ticker">Ticker A-Z</option><option value="total_desc">Valor ↓</option>
              </select>
              <button className="bp" onClick={()=>setShowForm(true)} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",background:"linear-gradient(135deg,#7c6fff,#5b4de8)",border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:600,fontFamily:"inherit",cursor:"pointer",whiteSpace:"nowrap"}}>
                <Icon name="plus" size={13}/> Nova
              </button>
            </div>
            {loading?(<div style={{textAlign:"center",padding:"50px 0",color:"#3a3a55"}}>A carregar...</div>):filtered.length===0?(<div style={{textAlign:"center",padding:"70px 0",color:"#3a3a55"}}><div style={{fontSize:36,marginBottom:12}}>📊</div><div style={{fontSize:14,marginBottom:6}}>Sem transações</div><div style={{fontSize:12}}>Adiciona manualmente ou importa um CSV</div></div>):(
              <div style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:14,overflow:"hidden"}}>
                <div style={{display:"grid",gridTemplateColumns:"85px 1fr 90px 90px 100px 80px 32px",padding:"9px 15px",borderBottom:"1px solid #1a1a28",fontSize:10,color:"#3a3a55",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em"}}>
                  <div>Data</div><div>Ativo</div><div style={{textAlign:"right"}}>Tipo</div><div style={{textAlign:"right"}} className="hide-mobile">Qtd</div><div style={{textAlign:"right"}}>Preço</div><div style={{textAlign:"right"}}>Total</div><div/>
                </div>
                {filtered.map((tx,i)=>(
                  <div key={tx.id} className="rh" style={{display:"grid",gridTemplateColumns:"85px 1fr 90px 90px 100px 80px 32px",padding:"11px 15px",borderBottom:i<filtered.length-1?"1px solid #161622":"none",alignItems:"center",transition:"background 0.15s"}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#4a4a65"}}>{tx.date}</div>
                    <div><div style={{fontWeight:600,fontSize:12,color:"#e8e6f0",fontFamily:"'DM Mono',monospace"}}>{tx.ticker}</div><div style={{fontSize:10,color:"#3a3a55",marginTop:1,maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.name!==tx.ticker?tx.name:""}</div></div>
                    <div style={{textAlign:"right"}}><span style={{background:`${TYPE_COLORS[tx.type]}18`,color:TYPE_COLORS[tx.type],fontSize:10,fontWeight:600,padding:"2px 7px",borderRadius:5,fontFamily:"'DM Mono',monospace"}}>{TYPE_LABELS[tx.type]}</span></div>
                    <div className="hide-mobile" style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#9896b0"}}>{fmt(tx.shares)}</div>
                    <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#9896b0"}}>{fmtC(tx.price,tx.currency)}</div>
                    <div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:600,color:"#e8e6f0"}}>{fmtC(tx.total,tx.currency)}</div>
                    <div style={{display:"flex",justifyContent:"center"}}><button className="bg" onClick={()=>deleteTx(tx.id)} style={{background:"transparent",border:"none",cursor:"pointer",color:"#2a2a45",padding:5,borderRadius:5,display:"flex",alignItems:"center"}}><Icon name="trash" size={12}/></button></div>
                  </div>
                ))}
              </div>
            )}
            <div style={{marginTop:10,fontSize:11,color:"#2a2a45",textAlign:"right"}}>{filtered.length} transações {filterType!=="ALL"||filterTicker?"(filtradas)":""}</div>
          </div>
        )}

        {/* IMPORT CSV */}
        {tab==="import"&&(
          <div className="ai">
            <div style={{marginBottom:22}}><h2 style={{fontSize:17,fontWeight:600,color:"#f0eeff",marginBottom:5}}>Importar CSV do Trading 212</h2><p style={{fontSize:13,color:"#4a4a65",lineHeight:1.6}}>Exporta o histórico em <strong style={{color:"#6a6a85"}}>History → Export CSV</strong> e faz upload aqui.</p></div>
            {!csvPreview?(
              <>
                <div className={csvDragOver?"drag-over":""} onDragOver={e=>{e.preventDefault();setCsvDragOver(true);}} onDragLeave={()=>setCsvDragOver(false)} onDrop={e=>{e.preventDefault();setCsvDragOver(false);handleCSVFile(e.dataTransfer.files[0]);}} style={{border:"2px dashed #2a2a3a",borderRadius:16,padding:"50px 30px",textAlign:"center",cursor:"pointer",transition:"all 0.2s",background:"#0d0d18"}} onClick={()=>document.getElementById("csvInput").click()}>
                  <input id="csvInput" type="file" accept=".csv" style={{display:"none"}} onChange={e=>handleCSVFile(e.target.files[0])}/>
                  <div style={{width:44,height:44,borderRadius:11,background:"rgba(124,111,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}><Icon name="upload" size={20}/></div>
                  <div style={{fontSize:14,fontWeight:600,color:"#e8e6f0",marginBottom:7}}>Arrasta o ficheiro CSV aqui</div>
                  <div style={{fontSize:12,color:"#3a3a55"}}>ou clica para selecionar</div>
                  <div style={{marginTop:14,fontSize:10,color:"#2a2a40",fontFamily:"'DM Mono',monospace"}}>suporta: trading212_*.csv</div>
                </div>
                <div style={{marginTop:26,background:"#0d0d18",border:"1px solid #1a1a28",borderRadius:13,padding:"18px 22px"}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#6b6b8a",marginBottom:11}}>Como exportar do Trading 212</div>
                  {["Abre a app ou web do Trading 212","Vai a Portfólio → Histórico (ícone de relógio)","Carrega em 'Exportar' no canto superior direito","Seleciona o intervalo de datas desejado","Faz download do ficheiro CSV","Faz upload aqui em cima"].map((step,i)=>(<div key={i} style={{display:"flex",alignItems:"flex-start",gap:11,marginBottom:8}}><div style={{width:19,height:19,borderRadius:5,background:"rgba(124,111,255,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontFamily:"'DM Mono',monospace",color:ACCENT,flexShrink:0,marginTop:1}}>{i+1}</div><div style={{fontSize:12,color:"#4a4a65",lineHeight:1.5}}>{step}</div></div>))}
                </div>
              </>
            ):(
              <div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:15,flexWrap:"wrap",gap:10}}>
                  <div><div style={{fontSize:13,fontWeight:600,color:"#f0eeff"}}>Pré-visualização</div><div style={{fontSize:11,color:"#4a4a65",marginTop:2}}>{csvPreview.filename} — {csvPreview.rows.length} transações</div></div>
                  <div style={{display:"flex",gap:8}}>
                    <button className="bg" onClick={()=>setCsvPreview(null)} style={{padding:"7px 14px",background:"transparent",border:"1px solid #1e1e30",borderRadius:8,color:"#6b6b8a",fontSize:12,fontFamily:"inherit",cursor:"pointer"}}>Cancelar</button>
                    <button className="bp" onClick={confirmCsvImport} style={{display:"flex",alignItems:"center",gap:5,padding:"7px 16px",background:"linear-gradient(135deg,#7c6fff,#5b4de8)",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:600,fontFamily:"inherit",cursor:"pointer"}}><Icon name="check" size={13}/> Confirmar</button>
                  </div>
                </div>
                <div style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:13,overflow:"hidden",maxHeight:400,overflowY:"auto"}}>
                  <div style={{display:"grid",gridTemplateColumns:"85px 75px 1fr 80px 95px 95px",padding:"9px 15px",borderBottom:"1px solid #1a1a28",fontSize:10,color:"#3a3a55",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em",position:"sticky",top:0,background:"#12121e"}}>
                    <div>Data</div><div>Ticker</div><div>Nome</div><div>Tipo</div><div style={{textAlign:"right"}}>Qtd</div><div style={{textAlign:"right"}}>Total</div>
                  </div>
                  {csvPreview.rows.map((tx,i)=>(<div key={i} className="rh" style={{display:"grid",gridTemplateColumns:"85px 75px 1fr 80px 95px 95px",padding:"9px 15px",borderBottom:i<csvPreview.rows.length-1?"1px solid #161622":"none",alignItems:"center"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#4a4a65"}}>{tx.date}</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:600,color:"#e8e6f0"}}>{tx.ticker}</div><div style={{fontSize:11,color:"#4a4a65",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.name}</div><div><span style={{background:`${TYPE_COLORS[tx.type]}18`,color:TYPE_COLORS[tx.type],fontSize:10,fontWeight:600,padding:"2px 6px",borderRadius:5}}>{TYPE_LABELS[tx.type]}</span></div><div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#9896b0"}}>{fmt(tx.shares)}</div><div style={{textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#e8e6f0",fontWeight:600}}>{fmtC(tx.total,tx.currency)}</div></div>))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modal Nova Transação */}
      {showForm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(8px)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{if(e.target===e.currentTarget)closeForm();}}>
          <div className="ai" style={{background:"#12121e",border:"1px solid #1e1e30",borderRadius:16,padding:"24px",width:"100%",maxWidth:460,maxHeight:"92vh",overflowY:"auto"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}><h3 style={{fontSize:15,fontWeight:600,color:"#f0eeff"}}>Nova Transação</h3><button onClick={closeForm} style={{background:"transparent",border:"none",cursor:"pointer",color:"#3a3a55",padding:4}}><Icon name="close" size={17}/></button></div>
            <div style={{display:"flex",gap:5,marginBottom:18,background:"#0d0d18",borderRadius:9,padding:3}}>
              {["BUY","SELL","DIVIDEND"].map(t=>(<button key={t} onClick={()=>setForm(f=>({...f,type:t}))} style={{flex:1,padding:"7px 0",borderRadius:7,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",transition:"all 0.15s",background:form.type===t?TYPE_COLORS[t]+"22":"transparent",color:form.type===t?TYPE_COLORS[t]:"#3a3a55",borderBottom:form.type===t?`2px solid ${TYPE_COLORS[t]}`:"2px solid transparent"}}>{TYPE_LABELS[t]}</button>))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11}}>
              <div><label style={{display:"block",fontSize:10,color:"#3a3a55",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Ticker *</label><AutocompleteInput value={form.ticker} onChange={v=>setForm(f=>({...f,ticker:v}))} onSelect={s=>setForm(f=>({...f,ticker:s.ticker,name:s.name}))} suggestions={tickerSuggestions} placeholder="AAPL" inputStyle={inputBase}/></div>
              <div><label style={{display:"block",fontSize:10,color:"#3a3a55",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Nome</label><AutocompleteInput value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} onSelect={s=>setForm(f=>({...f,ticker:s.ticker,name:s.name}))} suggestions={tickerSuggestions} placeholder="Apple Inc." inputStyle={inputBase}/></div>
              {[{label:form.type==="DIVIDEND"?"Valor Recebido *":"Quantidade *",key:"shares",placeholder:form.type==="DIVIDEND"?"0.00":"10",type:"number"},{label:"Preço por Ação"+(form.type!=="DIVIDEND"?" *":""),key:"price",placeholder:"150.00",type:"number"},{label:"Data *",key:"date",type:"date"},{label:"Moeda",key:"currency",select:["USD","EUR","GBP"]}].map(({label,key,placeholder,type,select})=>(<div key={key}><label style={{display:"block",fontSize:10,color:"#3a3a55",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>{label}</label>{select?<select value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} style={{...inputBase,cursor:"pointer"}}>{select.map(s=><option key={s}>{s}</option>)}</select>:<input type={type||"text"} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} placeholder={placeholder} style={inputBase}/>}</div>))}
              <div style={{gridColumn:"1/-1"}}><label style={{display:"block",fontSize:10,color:"#3a3a55",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Notas</label><textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Notas opcionais..." rows={2} style={{...inputBase,resize:"vertical"}}/></div>
            </div>
            {form.shares&&form.price&&(<div style={{marginTop:14,padding:"9px 13px",background:"rgba(124,111,255,0.08)",borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:11,color:"#6b6b8a"}}>Total estimado</span><span style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:ACCENT,fontSize:14}}>{fmtC(parseFloat(form.shares)*parseFloat(form.price),form.currency)}</span></div>)}
            <div style={{display:"flex",gap:8,marginTop:18}}>
              <button className="bg" onClick={closeForm} style={{flex:1,padding:"10px 0",background:"transparent",border:"1px solid #1e1e30",borderRadius:9,color:"#6b6b8a",fontSize:12,fontFamily:"inherit",cursor:"pointer"}}>Cancelar</button>
              <button className="bp" onClick={handleAddTx} style={{flex:2,padding:"10px 0",background:"linear-gradient(135deg,#7c6fff,#5b4de8)",border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:600,fontFamily:"inherit",cursor:"pointer"}}>Adicionar</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast&&(<div className="ti" style={{position:"fixed",bottom:22,left:"50%",transform:"translateX(-50%)",background:toast.ok?"#1a2a1a":"#2a1a1a",border:`1px solid ${toast.ok?"#2a4a2a":"#4a2a2a"}`,borderRadius:11,padding:"11px 18px",display:"flex",alignItems:"center",gap:7,fontSize:12,color:toast.ok?"#4ade80":"#f87171",zIndex:300,whiteSpace:"nowrap",boxShadow:"0 8px 32px rgba(0,0,0,0.4)"}}><Icon name={toast.ok?"check":"close"} size={13}/>{toast.msg}</div>)}
    </div>
  );
}
