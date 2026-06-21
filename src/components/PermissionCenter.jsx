import { useMemo, useState } from 'react'
import { ROLE_OPTIONS, usePermissions } from '../hooks/usePermissions'

const roleTone = {
  owner: 'bg-purple-50 text-purple-700 border-purple-100',
  staff: 'bg-blue-50 text-blue-700 border-blue-100',
  operator: 'bg-amber-50 text-amber-700 border-amber-100',
  viewer: 'bg-gray-50 text-gray-600 border-gray-100',
}

function fmtDate(value) {
  if (!value) return '从未登录'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function PermissionCenter({ role }) {
  const isOwner = role === 'owner'
  const { users, loading, error, refresh, setRole } = usePermissions(isOwner)
  const [draftEmail, setDraftEmail] = useState('')
  const [draftRole, setDraftRole] = useState('staff')
  const [busyKey, setBusyKey] = useState('')
  const [msg, setMsg] = useState('')

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const ar = a.role || 'viewer'
      const br = b.role || 'viewer'
      const ai = ROLE_OPTIONS.findIndex(r => r.value === ar)
      const bi = ROLE_OPTIONS.findIndex(r => r.value === br)
      if (ai !== bi) return ai - bi
      return String(a.email).localeCompare(String(b.email))
    })
  }, [users])

  if (!isOwner) return null

  const submit = async (event) => {
    event.preventDefault()
    const email = draftEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      setMsg('请输入有效邮箱')
      return
    }
    setBusyKey('new')
    setMsg('')
    try {
      await setRole(email, draftRole)
      setDraftEmail('')
      setDraftRole('staff')
      setMsg(`已将 ${email} 设置为 ${ROLE_OPTIONS.find(r => r.value === draftRole)?.label}`)
    } catch (err) {
      setMsg('设置失败:' + err.message)
    } finally {
      setBusyKey('')
    }
  }

  const changeRole = async (email, nextRole) => {
    setBusyKey(email)
    setMsg('')
    try {
      await setRole(email, nextRole)
      setMsg(`已更新 ${email} 的权限`)
    } catch (err) {
      setMsg('更新失败:' + err.message)
    } finally {
      setBusyKey('')
    }
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900">权限管理中心</h2>
          <p className="text-xs text-gray-500 mt-1">仅 owner 可见。这里负责分配系统角色；用户需重新登录后新权限才会生效。</p>
        </div>
        <button type="button" onClick={refresh}
          className="self-start text-xs text-blue-600 hover:text-blue-800 border border-blue-100 px-3 py-1.5 rounded-lg">
          刷新
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        {ROLE_OPTIONS.map(item => (
          <div key={item.value} className={`border rounded-xl p-3 ${roleTone[item.value]}`}>
            <div className="text-sm font-semibold">{item.label}</div>
            <div className="text-xs mt-1 opacity-80 leading-5">{item.hint}</div>
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-2 mb-4">
        <input type="email" value={draftEmail} onChange={e => setDraftEmail(e.target.value)}
          placeholder="输入已登录过的用户邮箱"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <select value={draftRole} onChange={e => setDraftRole(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
          {ROLE_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button type="submit" disabled={busyKey === 'new'}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-5 py-2 rounded-lg">
          {busyKey === 'new' ? '设置中...' : '设置权限'}
        </button>
      </form>

      {msg && <p className="text-xs text-gray-500 mb-3">{msg}</p>}
      {error && <p className="text-xs text-red-500 mb-3">加载失败:{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-500">
              <th className="text-left font-medium py-2 px-2">邮箱</th>
              <th className="text-left font-medium py-2 px-2">当前角色</th>
              <th className="text-left font-medium py-2 px-2">最近登录</th>
              <th className="text-left font-medium py-2 px-2">创建时间</th>
              <th className="text-center font-medium py-2 px-2">调整权限</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="py-6 text-center text-gray-400">加载中...</td></tr>
            ) : sortedUsers.length === 0 ? (
              <tr><td colSpan={5} className="py-6 text-center text-gray-400">暂无用户</td></tr>
            ) : sortedUsers.map(user => {
              const currentRole = user.role || 'viewer'
              return (
                <tr key={user.id} className="border-b border-gray-50">
                  <td className="py-2 px-2 text-gray-800">{user.email}</td>
                  <td className="py-2 px-2">
                    <span className={`inline-flex border rounded-full px-2 py-0.5 text-xs ${roleTone[currentRole] || roleTone.viewer}`}>
                      {ROLE_OPTIONS.find(r => r.value === currentRole)?.label || currentRole}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-gray-500">{fmtDate(user.last_sign_in_at)}</td>
                  <td className="py-2 px-2 text-gray-500">{fmtDate(user.created_at)}</td>
                  <td className="py-2 px-2 text-center">
                    <select value={currentRole} disabled={busyKey === user.email}
                      onChange={e => changeRole(user.email, e.target.value)}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white">
                      {ROLE_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
