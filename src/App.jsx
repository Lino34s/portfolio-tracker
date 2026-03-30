// src/App.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { 
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  CartesianGrid, BarChart, Bar, Cell, PieChart, Pie 
} from "recharts";

import { supabase } from './supabaseClient';
import { loadTransactions, saveTransaction, deleteTransaction } from './supabase/transactions';
import LoginScreen from './components/LoginScreen';

// ─── Todo o teu código original (parseCSV, helpers, icons, computations, etc.) fica aqui ───
// (copiei exatamente o teu código original e só fiz as alterações necessárias)

const STORAGE_KEY = "portfolio_transactions_v1"; // já não é usado, mas deixei para referência

// ─── CSV Parser (igual) ───────────────────────────────────────────────────────────────
function parseTrading212CSV(text) { /* ... teu código original completo ... */ }

// ─── Helpers, Icons, Autocomplete, API, Computations (tudo igual) ─────────────────────
/* ... cola aqui todo o teu código original das funções fmt, Icon, AutocompleteInput, 
   fetchQuote, fetchDividendData, computePositions, buildChartData, etc. ... */

// (para não ficar gigante, assumo que colas tudo igual até ao export default function App()

export default function App() {
  // ─── NOVO: Estado de autenticação ─────────────────────────────────────
  const [session, setSession] = useState(null);

  // ─── Teus estados originais ───────────────────────────────────────────
  const [tab, setTab] = useState("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  // ... todos os teus outros useState (quotes, divData, form, etc.) ficam iguais

  // ─── 1. Gerir sessão Supabase (novo) ─────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ─── 2. Carregar transações do Supabase (substitui o window.storage) ───
  useEffect(() => {
    if (!session) return;

    const fetchData = async () => {
      const txs = await loadTransactions();
      setTransactions(txs);
      setLoading(false);
    };

    fetchData();
  }, [session]);

  // ─── 3. Persistir alterações (agora usa Supabase) ─────────────────────
  const persist = useCallback(async (txs) => {
    setTransactions(txs);
    // Guarda cada transação individualmente (simples e seguro)
    for (const tx of txs) {
      try {
        await saveTransaction(tx);
      } catch (err) {
        console.error("Erro ao guardar transação:", err);
      }
    }
  }, []);

  // ─── 4. Eliminar transação ────────────────────────────────────────────
  const deleteTx = async (id) => {
    try {
      await deleteTransaction(id);
      const updated = transactions.filter(t => t.id !== id);
      setTransactions(updated);
      showToast("Transação eliminada.");
    } catch (err) {
      showToast("Erro ao eliminar transação", false);
    }
  };

  // ─── 5. Adicionar transação (adaptado) ───────────────────────────────
  const handleAddTx = async () => {
    if (!form.ticker || !form.shares || (!form.price && form.type !== "DIVIDEND")) {
      showToast("Preenche todos os campos obrigatórios.", false);
      return;
    }

    const tx = {
      id: `manual_${Date.now()}`,
      type: form.type,
      ticker: form.ticker.toUpperCase(),
      name: form.name || form.ticker.toUpperCase(),
      shares: parseFloat(form.shares),
      price: parseFloat(form.price) || 0,
      currency: form.currency,
      total: parseFloat(form.shares) * (parseFloat(form.price) || 1),
      date: form.date,
      notes: form.notes,
      source: "manual"
    };

    try {
      const saved = await saveTransaction(tx);
      const updated = [saved, ...transactions].sort((a, b) => b.date.localeCompare(a.date));
      await persist(updated);           // atualiza lista local + Supabase
      fetchAllQuotes(updated);
      fetchAllDivData(updated);
      closeForm();
      showToast("Transação adicionada!");
    } catch (err) {
      showToast("Erro ao adicionar transação", false);
    }
  };

  // ─── 6. Importar CSV (adaptado) ───────────────────────────────────────
  const confirmCsvImport = async () => {
    if (!csvPreview) return;
    // ... teu código de filtro de duplicados ...
    const merged = [...newRows, ...transactions].sort((a, b) => b.date.localeCompare(a.date));

    try {
      await persist(merged);            // guarda tudo no Supabase
      fetchAllQuotes(merged);
      fetchAllDivData(merged);
      showToast(`${newRows.length} transações importadas!`);
      setCsvPreview(null);
      setTab("dashboard");
    } catch (err) {
      showToast("Erro ao importar CSV", false);
    }
  };

  // ─── Logout (novo botão) ──────────────────────────────────────────────
  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // ─── Se não estiver logado → mostra LoginScreen ───────────────────────
  if (!session) {
    return <LoginScreen />;
  }

  // ─── O resto do teu return original (header, main, modais, etc.) fica IGUAL ───
  // (cola aqui todo o teu return original a partir de return( <div style={{minHeight:"100vh"... )

  // Só adiciono um botão de logout no header (exemplo no canto direito):

  // Dentro da div de "Right actions" (procura o comentário {/* Right actions */})
  // Adiciona isto:
  <button 
    onClick={handleLogout}
    style={{padding:"5px 12px", background:"transparent", border:"1px solid #f87171", color:"#f87171", borderRadius:8, fontSize:11}}
  >
    Sair
  </button>

  // ... resto do teu código original continua igual até ao final do return
}
