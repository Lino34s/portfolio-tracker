// src/components/LoginScreen.jsx
import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function LoginScreen({ onLoginSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLogin, setIsLogin] = useState(true)   // true = login | false = registo
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      if (isLogin) {
        // === LOGIN ===
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (error) throw error
        // Se chegar aqui, o login foi bem sucedido
        if (onLoginSuccess) onLoginSuccess(data.session)

      } else {
        // === REGISTO ===
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,   // volta para a tua app após confirmar email
          }
        })

        if (error) throw error

        alert('Registo efetuado! Verifica o teu email para confirmares a conta.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: '400px', margin: '50px auto', padding: '20px' }}>
      <h2>{isLogin ? 'Entrar' : 'Criar Conta'}</h2>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ width: '100%', padding: '10px', margin: '10px 0' }}
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ width: '100%', padding: '10px', margin: '10px 0' }}
        />

        <button 
          type="submit" 
          disabled={loading}
          style={{ width: '100%', padding: '12px', marginTop: '10px' }}
        >
          {loading ? 'A processar...' : (isLogin ? 'Entrar' : 'Registar')}
        </button>
      </form>

      <p style={{ textAlign: 'center', marginTop: '15px' }}>
        {isLogin ? "Não tens conta?" : "Já tens conta?"}
        <button 
          onClick={() => setIsLogin(!isLogin)}
          style={{ background: 'none', border: 'none', color: 'blue', cursor: 'pointer' }}
        >
          {isLogin ? ' Registar' : ' Entrar'}
        </button>
      </p>
    </div>
  )
}
