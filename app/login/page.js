'use client'
import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) { setError(error.message); setLoading(false); return }
      window.location.href = '/dashboard'
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(error.message); setLoading(false); return }
      window.location.href = '/dashboard'
    }
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0c10', display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace'
    }}>
      <div style={{
        background: '#111318', border: '1px solid #252830',
        padding: '40px', width: '380px'
      }}>
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{
            fontFamily: 'sans-serif', fontSize: '24px', fontWeight: '800',
            color: '#e8eaf0', marginBottom: '8px'
          }}>
            SAFE <span style={{ color: '#00e5a0' }}>//</span> SPLURGE
          </h1>
          <p style={{ color: '#6b7080', fontSize: '12px' }}>
            {isSignUp ? 'Create your account' : 'Sign in to your account'}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b7080', marginBottom: '6px' }}>Email</div>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              style={{ width: '100%', background: '#1a1d25', border: '1px solid #252830', color: '#e8eaf0', padding: '10px', fontFamily: 'monospace', fontSize: '13px', outline: 'none' }}
            />
          </div>
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b7080', marginBottom: '6px' }}>Password</div>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              style={{ width: '100%', background: '#1a1d25', border: '1px solid #252830', color: '#e8eaf0', padding: '10px', fontFamily: 'monospace', fontSize: '13px', outline: 'none' }}
            />
          </div>

          {error && <div style={{ color: '#ff4d6a', fontSize: '12px', marginBottom: '16px' }}>{error}</div>}

          <button type="submit" disabled={loading} style={{
            width: '100%', background: '#00e5a0', border: 'none', color: '#0a0c10',
            padding: '12px', fontFamily: 'monospace', fontSize: '13px', fontWeight: '700',
            cursor: 'pointer', letterSpacing: '0.06em'
          }}>
            {loading ? 'LOADING...' : isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN'}
          </button>
        </form>

        <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '12px', color: '#6b7080' }}>
          {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
          <button onClick={() => setIsSignUp(!isSignUp)} style={{
            background: 'none', border: 'none', color: '#00e5a0', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px'
          }}>
            {isSignUp ? 'Sign in' : 'Start free trial'}
          </button>
        </div>
      </div>
    </div>
  )
}
