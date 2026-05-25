import { useState } from 'react'
import { useInvites } from '../hooks/useInvites'

const DDP_BASE = 'https://ddp.starlinkailog.com'

function buildInviteUrl(code) {
  return `${DDP_BASE}/?invite=${encodeURIComponent(code)}`
}

function statusOf(inv) {
  if (inv.used_at) return { label: '已使用', color: 'text-gray-400' }
  if (new Date(inv.expires_at) < new Date()) return { label: '已过期', color: 'text-red-500' }
  return { label: '未使用', color: 'text-green-600' }
}

export function InvitePanel() {
  const { invites, loading, create } = useInvites()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setMsg(''); setBusy(true)
    try {
      const inv = await create(email.trim())
      setEmail('')
      setMsg(`邀请已生成,链接已复制: ${buildInviteUrl(inv.code)}`)
      navigator.clipboard?.writeText(buildInviteUrl(inv.code))
    } catch (err) {
      setMsg('生成失败:' + err.message)
    }
    setBusy(false)
  }

  const copy = (code) => navigator.clipboard?.writeText(buildInviteUrl(code))

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
      <h3 className="text-base font-semibold text-gray-800 mb-4">邀请码 · DDP 只读访客</h3>
      <form onSubmit={submit} className="flex gap-2 mb-4">
        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="访客邮箱"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" required />
        <button type="submit" disabled={busy}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-5 py-2 rounded-lg">
          {busy ? '...' : '生成邀请链接'}
        </button>
      </form>
      {msg && <p className="text-xs text-gray-500 mb-3 break-all">{msg}</p>}
      {loading ? (
        <p className="text-sm text-gray-400">加载中...</p>
      ) : invites.length === 0 ? (
        <p className="text-sm text-gray-400">暂无邀请记录</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 px-2 text-xs text-gray-500 font-medium">邮箱</th>
              <th className="text-left py-2 px-2 text-xs text-gray-500 font-medium">生成时间</th>
              <th className="text-left py-2 px-2 text-xs text-gray-500 font-medium">过期时间</th>
              <th className="text-center py-2 px-2 text-xs text-gray-500 font-medium">状态</th>
              <th className="text-center py-2 px-2 text-xs text-gray-500 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {invites.map(inv => {
              const s = statusOf(inv)
              return (
                <tr key={inv.code} className="border-b border-gray-50">
                  <td className="py-2 px-2">{inv.email}</td>
                  <td className="py-2 px-2 text-gray-500">{new Date(inv.created_at).toLocaleDateString('zh-CN')}</td>
                  <td className="py-2 px-2 text-gray-500">{new Date(inv.expires_at).toLocaleDateString('zh-CN')}</td>
                  <td className={`py-2 px-2 text-center ${s.color}`}>{s.label}</td>
                  <td className="py-2 px-2 text-center">
                    <button onClick={() => copy(inv.code)}
                      className="text-xs text-blue-600 hover:text-blue-800">复制链接</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
