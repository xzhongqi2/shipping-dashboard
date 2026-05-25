import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthUser } from '../hooks/useAuthUser'

const ALLOWED_DOMAIN = '@starlinkai-logistics.cn'

export function AuthGate({ children }) {
  const { user, role, loading } = useAuthUser()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">加载中...</div>
  }

  if (user && role === 'staff') return children

  if (user && role !== 'staff') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-md text-center">
          <h1 className="text-xl font-bold text-gray-800 mb-2">无访问权限</h1>
          <p className="text-sm text-gray-600 mb-6">此页面仅限内部员工访问。如需查看 DDP 物流跟踪,请使用您收到的邀请链接。</p>
          <button onClick={() => supabase.auth.signOut()}
            className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-4 py-2 rounded-lg">
            退出登录
          </button>
        </div>
      </div>
    )
  }

  const handleSend = async (e) => {
    e.preventDefault()
    setErr(''); setMsg('')
    if (!email.trim().toLowerCase().endsWith(ALLOWED_DOMAIN)) {
      setErr(`仅 ${ALLOWED_DOMAIN} 邮箱可登录`)
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setMsg(`已发送登录链接到 ${email.trim()},请到邮箱点链接完成登录`)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-md">
        <h1 className="text-xl font-bold text-gray-800 mb-2">星链智运 · 内部登录</h1>
        <p className="text-sm text-gray-500 mb-6">请使用公司邮箱登录</p>
        <form onSubmit={handleSend}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder={`name${ALLOWED_DOMAIN}`}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 mb-3"
            required />
          {err && <p className="text-sm text-red-500 mb-3">{err}</p>}
          {msg && <p className="text-sm text-green-600 mb-3">{msg}</p>}
          <button type="submit" disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg">
            {busy ? '发送中...' : '发送登录链接'}
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-5 text-center">仅 {ALLOWED_DOMAIN} 邮箱可登录</p>
      </div>
    </div>
  )
}
