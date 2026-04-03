import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function LoginScreen() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode]         = useState("login");   // "login" | "signup"
  const [loading, setLoading]   = useState(false);
  const [msg, setMsg]           = useState(null);      // {text, ok}

  const ACCENT = "#7c6fff";
  const input = {
    width: "100%", background: "#0d0d18", border: "1px solid #1e1e30",
    borderRadius: 9, padding: "11px 14px", color: "#e8e6f0",
    fontSize: 14, fontFamily: "inherit", outline: "none", colorScheme: "dark",
  };

  const handleSubmit = async () => {
    if (!email || !password) { setMsg({ text: "Preenche email e password.", ok: false }); return; }
    setLoading(true); setMsg(null);
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setMsg({ text: error.message, ok: false });
      else setMsg({ text: "Conta criada! Verifica o teu email para confirmar.", ok: true });
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg({ text: "Email ou password incorretos.", ok: false });
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans','Segoe UI',sans-serif", padding: 20 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');*{box-sizing:border-box;margin:0;padding:0;}input::placeholder{color:#3a3a50;}`}</style>
      <div style={{ width: "100%", maxWidth: 380 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 36 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#7c6fff,#4fc3f7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
          </div>
          <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 500, fontSize: 17, color: "#f0eeff" }}>portfolio<span style={{ color: ACCENT }}>.track</span></span>
        </div>

        {/* Card */}
        <div style={{ background: "#12121e", border: "1px solid #1e1e30", borderRadius: 16, padding: "28px 28px" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#f0eeff", marginBottom: 6 }}>
            {mode === "login" ? "Entrar na conta" : "Criar conta"}
          </h2>
          <p style={{ fontSize: 13, color: "#4a4a65", marginBottom: 22 }}>
            {mode === "login" ? "O teu portfolio aguarda." : "Começa a acompanhar o teu portfolio."}
          </p>

          <div style={{ marginBottom: 13 }}>
            <label style={{ display: "block", fontSize: 11, color: "#3a3a55", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" style={input}
              onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, color: "#3a3a55", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={input}
              onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          </div>

          {msg && (
            <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, background: msg.ok ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)", border: `1px solid ${msg.ok ? "#2a4a2a" : "#4a2a2a"}`, fontSize: 13, color: msg.ok ? "#4ade80" : "#f87171" }}>
              {msg.text}
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading}
            style={{ width: "100%", padding: "11px 0", background: loading ? "#2a2a40" : "linear-gradient(135deg,#7c6fff,#5b4de8)", border: "none", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: "inherit", cursor: loading ? "not-allowed" : "pointer", transition: "all 0.15s" }}>
            {loading ? "A processar..." : mode === "login" ? "Entrar" : "Criar conta"}
          </button>

          <div style={{ textAlign: "center", marginTop: 18, fontSize: 13, color: "#4a4a65" }}>
            {mode === "login" ? (
              <span>Não tens conta? <button onClick={() => { setMode("signup"); setMsg(null); }} style={{ background: "none", border: "none", color: ACCENT, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600 }}>Criar conta</button></span>
            ) : (
              <span>Já tens conta? <button onClick={() => { setMode("login"); setMsg(null); }} style={{ background: "none", border: "none", color: ACCENT, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600 }}>Entrar</button></span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
