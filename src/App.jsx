import { useState, useEffect, useCallback, useRef } from "react";
import { 
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  CartesianGrid, BarChart, Bar, Cell, PieChart, Pie 
} from "recharts";

import { supabase } from './supabaseClient';
import { loadTransactions, saveTransaction, deleteTransaction } from './supabase/transactions';
import LoginScreen from './components/LoginScreen';

// ─── CONFIGURAÇÕES E CONSTANTES ──────────────────────────────────────────────
const ACCENT = "#7c6fff";
const BG_DARK = "#0d0d15";
const CARD_BG = "#151522";
const BORDER = "#1e1e30";

// ─── CSV Parser ───────────────────────────────────────────────────────────────
function parseTrading212CSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) throw new Error("Ficheiro CSV vazio ou inválido.");
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
  const idx = names => { 
    for (const n of names) { 
      const i = headers.findIndex(h => h.toLowerCase().includes(n.toLowerCase())); 
      if (i !== -1) return i; 
    } 
    return -1; 
  };
  const cA=idx(["Action"]),cT=idx(["Time"]),cTk=idx(["Ticker"]),cN=idx(["Name"]),cSh=idx(["No. of shares","Shares"]);
  const cPr=idx(["Price / share","Price/share"]),cCu=idx(["Currency (Price","Currency"]),cTo=idx(["Total"]);
  
  return lines.slice(1).map(l => {
    const r = l.split(",").map(c => c.trim().replace(/"/g, ""));
    if (!r[cA] || !r[cTk]) return null;
    const a = r[cA].toLowerCase();
    if (!a.includes("buy") && !a.includes("sell")) return null;
    return {
      id: crypto.randomUUID(),
      action: a.includes("buy") ? "BUY" : "SELL",
      ticker: r[cTk],
      name: r[cN] || r[cTk],
      shares: parseFloat(r[cSh]) || 0,
      price: parseFloat(r[cPr]) || 0,
      currency: r[cCu] || "EUR",
      total: parseFloat(r[cTo]) || 0,
      date: r[cT]?.split(" ")[0] || new Date().toISOString().split("T")[0]
    };
  }).filter(Boolean);
}

// ─── HELPERS VISUAIS ──────────────────────────────────────────────────────────
const fmt = (v, c = "EUR") => new Intl.NumberFormat("pt-PT", { style: "currency", currency: c }).format(v || 0);
const fmtC = (v, c) => `${v.toFixed(2)} ${c}`;

const Icon = ({ name, size = 16, color = "currentColor", ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {name === "plus" && <path d="M12 5v14M5 12h14" />}
    {name === "upload" && <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />}
    {name === "trash" && <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />}
    {name === "search" && <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />}
    {name === "chevron-right" && <path d="m9 18 6-6-6-6" />}
    {name === "chart" && <path d="M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z" />}
    {name === "list" && <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />}
    {name === "wallet" && <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4M4 6v12c0 1.1.9 2 2 2h14v-4M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />}
  </svg>
);

// ─── COMPONENTES AUXILIARES ──────────────────────────────────────────────────
const AutocompleteInput = ({ value, onChange, placeholder }) => {
  const [q, setQ] = useState(value);
  const [sug, setSug] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.length < 2) { setSug([]); return; }
      try {
        const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${q}`);
        const d = await r.json();
        setSug(d.quotes?.slice(0, 5) || []);
      } catch { setSug([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <div className="fi" style={{ display: "flex", alignItems: "center", background: "#1a1a2e", border: `1px solid ${BORDER}`, borderRadius: 9, padding: "0 10px" }}>
        <Icon name="search" size={14} color="#6b6b8a" />
        <input 
          style={{ flex: 1, background: "transparent", border: "none", color: "#fff", padding: "10px", fontSize: 13, outline: "none" }}
          placeholder={placeholder} value={q} onChange={e => { setQ(e.target.value); setOpen(true); }}
        />
      </div>
      {open && sug.length > 0 && (
        <div style={{ position: "absolute", top: "105%", left: 0, right: 0, background: "#1a1a2e", border: `1px solid ${BORDER}`, borderRadius: 9, zIndex: 100, overflow: "hidden" }}>
          {sug.map(s => (
            <div key={s.symbol} onClick={() => { onChange(s.symbol, s.shortname || s.symbol); setQ(s.symbol); setOpen(false); }} 
                 style={{ padding: "10px", cursor: "pointer", fontSize: 12, borderBottom: `1px solid ${BORDER}` }} className="sug-item">
              <span style={{ fontWeight: 600, color: ACCENT }}>{s.symbol}</span> - <span style={{ color: "#6b6b8a" }}>{s.shortname}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── API FETCHERS ────────────────────────────────────────────────────────────
async function fetchQuote(symbol) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`);
    const d = await r.json();
    return d.chart.result[0].meta.regularMarketPrice;
  } catch { return null; }
}

async function fetchDividendData(symbol) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=1y`);
    const d = await r.json();
    const meta = d.chart.result[0].meta;
    return { yield: meta.dividendYield || 0, rate: meta.dividendRate || 0 };
  } catch { return { yield: 0, rate: 0 }; }
}

// ─── LÓGICA DE CÁLCULO ────────────────────────────────────────────────────────
function computePositions(txs, prices, divData) {
  const p = {};
  txs.forEach(t => {
    if (!p[t.ticker]) p[t.ticker] = { ticker: t.ticker, name: t.name, shares: 0, invested: 0, currency: t.currency };
    if (t.action === "BUY") {
      p[t.ticker].shares += t.shares;
      p[t.ticker].invested += t.total;
    } else {
      const avg = p[t.ticker].invested / p[t.ticker].shares;
      p[t.ticker].shares -= t.shares;
      p[t.ticker].invested -= avg * t.shares;
    }
  });

  return Object.values(p).filter(x => x.shares > 0.0001).map(x => {
    const currentPrice = prices[x.ticker] || (x.invested / x.shares);
    const value = x.shares * currentPrice;
    const gain = value - x.invested;
    const div = divData[x.ticker] || { yield: 0, rate: 0 };
    return { ...x, currentPrice, value, gain, gainPct: (gain / x.invested) * 100, divYield: div.yield, annualDiv: x.shares * div.rate };
  });
}

function buildChartData(pos) {
  return pos.sort((a, b) => b.value - a.value).slice(0, 8).map(x => ({ name: x.ticker, value: x.value }));
}

// ─── APP COMPONENT ───────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  
  const [tab, setTab] = useState("dashboard");
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [prices, setPrices] = useState({});
  const [divData, setDivData] = useState({});
  const [csvPreview, setCsvPreview] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({ ticker: "", name: "", shares: "", price: "", date: new Date().toISOString().split("T")[0], currency: "EUR", action: "BUY" });

  const fileRef = useRef();

  // AUTH SESSION
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoadingAuth(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  // LOAD DATA
  useEffect(() => {
    if (session) {
      (async () => {
        setLoading(true);
        const data = await loadTransactions();
        setTransactions(data);
        setLoading(false);
        fetchAllData(data);
      })();
    }
  }, [session]);

  const fetchAllData = async (txs) => {
    const tickers = [...new Set(txs.map(t => t.ticker))];
    const pResults = await Promise.all(tickers.map(async t => ({ t, v: await fetchQuote(t) })));
    const dResults = await Promise.all(tickers.map(async t => ({ t, v: await fetchDividendData(t) })));
    
    const newPrices = {}; pResults.forEach(r => { if (r.v) newPrices[r.t] = r.v; });
    const newDivs = {}; dResults.forEach(r => { newDivs[r.t] = r.v; });
    
    setPrices(prev => ({ ...prev, ...newPrices }));
    setDivData(prev => ({ ...prev, ...newDivs }));
  };

  const persist = useCallback(async (txs) => {
    setTransactions(txs);
    // Nota: Aqui o ideal é uma função bulk no supabase, mas usamos o transactions.js
    // que já configuraste anteriormente.
  }, []);

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const handleAddTx = async () => {
    if (!form.ticker || !form.shares) return;
    const newTx = { ...form, id: crypto.randomUUID(), shares: parseFloat(form.shares), price: parseFloat(form.price), total: parseFloat(form.shares) * parseFloat(form.price) };
    const updated = [newTx, ...transactions];
    await saveTransaction(newTx);
    setTransactions(updated);
    setShowAdd(false);
    setForm({ ticker: "", name: "", shares: "", price: "", date: new Date().toISOString().split("T")[0], currency: "EUR", action: "BUY" });
    fetchAllData([newTx]);
    showToast("Transação adicionada");
  };

  const handleDelete = async (id) => {
    await deleteTransaction(id);
    setTransactions(transactions.filter(t => t.id !== id));
    showToast("Eliminado", false);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseTrading212CSV(ev.target.result);
        setCsvPreview(rows);
      } catch (err) { alert(err.message); }
    };
    reader.readAsText(file);
  };

  const confirmImport = async () => {
    if (!csvPreview) return;
    // Persistir cada uma (ou adaptar transactions.js para bulk)
    for(const tx of csvPreview) { await saveTransaction(tx); }
    const merged = [...csvPreview, ...transactions].sort((a,b) => b.date.localeCompare(a.date));
    setTransactions(merged);
    setCsvPreview(null);
    fetchAllData(merged);
    showToast(`${csvPreview.length} importados`);
  };

  const positions = computePositions(transactions, prices, divData);
  const totalValue = positions.reduce((acc, p) => acc + p.value, 0);
  const totalInvested = positions.reduce((acc, p) => acc + p.invested, 0);
  const totalDiv = positions.reduce((acc, p) => acc + p.annualDiv, 0);
  const chartData = buildChartData(positions);

  if (loadingAuth) return <div style={{background: BG_DARK, color: "#fff", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center"}}>A carregar...</div>;
  if (!session) return <LoginScreen />;

  return (
    <div style={{ minHeight: "100vh", background: BG_DARK, color: "#fff", paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: "-0.5px" }}>Portfolio <span style={{ color: ACCENT }}>Tracker</span></h1>
          <p style={{ fontSize: 11, color: "#6b6b8a", margin: "2px 0 0 0" }}>{session.user.email}</p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => fileRef.current.click()} style={{ background: "transparent", border: `1px solid ${BORDER}`, color: "#6b6b8a", padding: "8px 12px", borderRadius: 9, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <Icon name="upload" size={14} /> Importar
          </button>
          <button onClick={() => setShowAdd(true)} style={{ background: ACCENT, border: "none", color: "#fff", padding: "8px 14px", borderRadius: 9, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600 }}>
            <Icon name="plus" size={14} /> Transação
          </button>
          <button onClick={() => supabase.auth.signOut()} style={{ background: "transparent", border: "1px solid #f87171", color: "#f87171", padding: "8px 12px", borderRadius: 9, cursor: "pointer", fontSize: 12 }}>Sair</button>
        </div>
        <input type="file" ref={fileRef} style={{ display: "none" }} accept=".csv" onChange={handleFileUpload} />
      </div>

      {/* Main Content */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>
        
        {tab === "dashboard" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
            {/* Stats */}
            <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              <div style={{ background: CARD_BG, padding: 20, borderRadius: 16, border: `1px solid ${BORDER}` }}>
                <p style={{ margin: 0, fontSize: 11, color: "#6b6b8a", textTransform: "uppercase", fontWeight: 600 }}>Valor Total</p>
                <h2 style={{ margin: "8px 0 0 0", fontSize: 24 }}>{fmt(totalValue)}</h2>
                <p style={{ margin: "4px 0 0 0", fontSize: 12, color: totalValue >= totalInvested ? "#10b981" : "#f87171" }}>
                  {totalValue >= totalInvested ? "+" : ""}{fmt(totalValue - totalInvested)} ({((totalValue/totalInvested - 1)*100 || 0).toFixed(2)}%)
                </p>
              </div>
              <div style={{ background: CARD_BG, padding: 20, borderRadius: 16, border: `1px solid ${BORDER}` }}>
                <p style={{ margin: 0, fontSize: 11, color: "#6b6b8a", textTransform: "uppercase", fontWeight: 600 }}>Dividendos Anuais</p>
                <h2 style={{ margin: "8px 0 0 0", fontSize: 24, color: "#10b981" }}>{fmt(totalDiv)}</h2>
                <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#6b6b8a" }}>Yield Médio: {(totalDiv / totalValue * 100 || 0).toFixed(2)}%</p>
              </div>
            </div>

            {/* Chart */}
            <div style={{ background: CARD_BG, padding: 20, borderRadius: 16, border: `1px solid ${BORDER}`, minHeight: 300 }}>
              <p style={{ margin: "0 0 20px 0", fontSize: 14, fontWeight: 600 }}>Alocação por Ticker</p>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={chartData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                    {chartData.map((_, i) => <Cell key={i} fill={[ACCENT, "#9f95ff", "#c2bcff", "#e1dfff"][i % 4]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#1a1a2e", border: `1px solid ${BORDER}`, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* List */}
            <div style={{ background: CARD_BG, borderRadius: 16, border: `1px solid ${BORDER}`, overflow: "hidden" }}>
               <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                 <thead style={{ background: "#1a1a2e", color: "#6b6b8a" }}>
                   <tr>
                     <th style={{ textAlign: "left", padding: 16 }}>Ativo</th>
                     <th style={{ textAlign: "right", padding: 16 }}>Valor</th>
                     <th style={{ textAlign: "right", padding: 16 }}>Ganhos</th>
                   </tr>
                 </thead>
                 <tbody>
                   {positions.map(p => (
                     <tr key={p.ticker} style={{ borderBottom: `1px solid ${BORDER}` }}>
                       <td style={{ padding: 16 }}>
                         <div style={{ fontWeight: 600 }}>{p.ticker}</div>
                         <div style={{ fontSize: 11, color: "#6b6b8a" }}>{p.shares.toFixed(4)} un.</div>
                       </td>
                       <td style={{ textAlign: "right", padding: 16 }}>{fmt(p.value)}</td>
                       <td style={{ textAlign: "right", padding: 16, color: p.gain >= 0 ? "#10b981" : "#f87171" }}>
                         {p.gainPct.toFixed(1)}%
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
            </div>
          </div>
        ) : (
          /* Aba de Transações Simples */
          <div style={{ background: CARD_BG, borderRadius: 16, border: `1px solid ${BORDER}` }}>
             {transactions.map(t => (
               <div key={t.id} style={{ padding: 16, borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between" }}>
                 <div>
                   <span style={{ fontSize: 10, background: t.action === "BUY" ? "#10b98133" : "#f8717133", color: t.action === "BUY" ? "#10b981" : "#f87171", padding: "2px 6px", borderRadius: 4, marginRight: 8 }}>{t.action}</span>
                   <span style={{ fontWeight: 600 }}>{t.ticker}</span>
                   <div style={{ fontSize: 11, color: "#6b6b8a" }}>{t.date} • {t.shares} un a {fmt(t.price, t.currency)}</div>
                 </div>
                 <button onClick={() => handleDelete(t.id)} style={{ background: "transparent", border: "none", cursor: "pointer" }}><Icon name="trash" size={14} color="#444" /></button>
               </div>
             ))}
          </div>
        )}
      </div>

      {/* Navigation Bar */}
      <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "rgba(21, 21, 34, 0.8)", backdropFilter: "blur(12px)", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "6px", display: "flex", gap: 4, zIndex: 100 }}>
        <button onClick={() => setTab("dashboard")} style={{ background: tab === "dashboard" ? ACCENT : "transparent", border: "none", padding: "10px 20px", borderRadius: 16, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500 }}>
          <Icon name="chart" size={16} /> Dashboard
        </button>
        <button onClick={() => setTab("transactions")} style={{ background: tab === "transactions" ? ACCENT : "transparent", border: "none", padding: "10px 20px", borderRadius: 16, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500 }}>
          <Icon name="list" size={16} /> Histórico
        </button>
      </div>

      {/* Modal Adicionar */}
      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <div style={{ background: CARD_BG, width: "100%", maxWidth: 400, borderRadius: 20, padding: 24, border: `1px solid ${BORDER}` }}>
            <h3 style={{ margin: "0 0 20px 0" }}>Nova Transação</h3>
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              <button onClick={() => setForm({ ...form, action: "BUY" })} style={{ flex: 1, padding: 10, borderRadius: 10, border: "none", background: form.action === "BUY" ? "#10b981" : "#1a1a2e", color: "#fff" }}>Compra</button>
              <button onClick={() => setForm({ ...form, action: "SELL" })} style={{ flex: 1, padding: 10, borderRadius: 10, border: "none", background: form.action === "SELL" ? "#f87171" : "#1a1a2e", color: "#fff" }}>Venda</button>
            </div>
            <AutocompleteInput placeholder="Ticker (ex: AAPL)" onChange={(s, n) => setForm({ ...form, ticker: s, name: n })} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <input type="number" placeholder="Qtd" value={form.shares} onChange={e => setForm({ ...form, shares: e.target.value })} style={{ background: "#1a1a2e", border: `1px solid ${BORDER}`, color: "#fff", padding: 12, borderRadius: 9 }} />
              <input type="number" placeholder="Preço" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} style={{ background: "#1a1a2e", border: `1px solid ${BORDER}`, color: "#fff", padding: 12, borderRadius: 9 }} />
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
              <button onClick={() => setShowAdd(false)} style={{ flex: 1, background: "transparent", color: "#6b6b8a", border: "none", cursor: "pointer" }}>Cancelar</button>
              <button onClick={handleAddTx} style={{ flex: 2, background: ACCENT, color: "#fff", border: "none", padding: 12, borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Importação */}
      {csvPreview && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 1100, padding: 20, display: "flex", flexDirection: "column" }}>
          <div style={{ background: CARD_BG, borderRadius: 20, padding: 24, maxWidth: 600, margin: "auto", width: "100%", maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <h3>Confirmar Importação ({csvPreview.length})</h3>
            <div style={{ overflowY: "auto", flex: 1, margin: "16px 0" }}>
              {csvPreview.slice(0, 10).map(r => (
                <div key={r.id} style={{ fontSize: 12, padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
                  {r.date} • <b>{r.ticker}</b> • {r.shares} un @ {r.price}
                </div>
              ))}
              {csvPreview.length > 10 && <p style={{ fontSize: 11, color: "#6b6b8a" }}>...e mais {csvPreview.length - 10} linhas</p>}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setCsvPreview(null)} style={{ flex: 1, padding: 12, background: "transparent", color: "#6b6b8a", border: "none" }}>Cancelar</button>
              <button onClick={confirmImport} style={{ flex: 2, padding: 12, background: ACCENT, color: "#fff", border: "none", borderRadius: 10, fontWeight: 600 }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)", background: toast.ok ? "#10b981" : "#f87171", padding: "10px 20px", borderRadius: 12, fontSize: 13, fontWeight: 600, zIndex: 2000 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}