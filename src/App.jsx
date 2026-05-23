import { useState, useCallback, useMemo } from 'react'
import { useRecords } from './hooks/useRecords'
import { useClientId } from './hooks/useClientId'
import { useAdmin } from './hooks/useAdmin'
import { useWeek } from './hooks/useWeek'

// ─────────────────────────────────
// 柜子配置
// ─────────────────────────────────
const CONTAINERS = [
  { name: '美西',   capacityCBM: 70, capacityKG: 19500 },
  { name: '美中南', capacityCBM: 70, capacityKG: 19500 },
  { name: '美中北', capacityCBM: 70, capacityKG: 19500 },
  { name: '美东南', capacityCBM: 70, capacityKG: 19500 },
  { name: '美东北', capacityCBM: 70, capacityKG: 19500 },
  { name: '锁仓柜', capacityCBM: 70, capacityKG: 19500 },
]


// ─────────────────────────────────
// 工具函数
// ─────────────────────────────────
function fmtTime(ts) {
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ─────────────────────────────────
// 组件：比率徽章
// ─────────────────────────────────
function RateBadge({ value, label }) {
  const pct = (value * 100).toFixed(1)
  const good = value >= 1
  return (
    <div className="flex flex-col items-center">
      <span className="text-xs text-gray-500 mb-1">{label}</span>
      <span className={`text-lg font-bold px-3 py-1 rounded-lg ${good ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
        {pct}%
      </span>
    </div>
  )
}

// ─────────────────────────────────
// 组件：柜子卡片
// ─────────────────────────────────
function ContainerCard({ config, data, cost }) {
  const loadRate    = data.cbm / config.capacityCBM
  const weightRate  = data.kg  / config.capacityKG
  const revenueRate = cost ? data.revenue / cost : null

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">{config.name}</h3>
        {cost && (
          <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded">
            成本 ¥{cost.toLocaleString()}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center"><p className="text-xs text-gray-400">CBM</p>
          <p className="text-sm font-medium text-gray-700">{data.cbm.toFixed(2)} <span className="text-xs text-gray-400">/ {config.capacityCBM}</span></p></div>
        <div className="text-center"><p className="text-xs text-gray-400">KG</p>
          <p className="text-sm font-medium text-gray-700">{data.kg.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-xs text-gray-400">/ {config.capacityKG.toLocaleString()}</span></p></div>
        <div className="text-center"><p className="text-xs text-gray-400">收入</p>
          <p className="text-sm font-medium text-gray-700">¥{data.revenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p></div>
      </div>
      <div className="flex justify-around border-t border-gray-100 pt-4">
        <RateBadge value={loadRate}   label="装载率" />
        <RateBadge value={weightRate} label="重量率" />
        {revenueRate !== null && <RateBadge value={revenueRate} label="收入率" />}
      </div>
    </div>
  )
}

// ─────────────────────────────────
// 组件：输入表单
// ────────────────────────────────
function InputForm({ onSubmit, disabled, currentWeek, selectedWeek }) {
  const [sales, setSales] = useState('')
  const [name, setName]   = useState('')
  const [cbm, setCbm]     = useState('')
  const [kg, setKg]       = useState('')
  const [rev, setRev]     = useState('')
  const [msg, setMsg]     = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!sales.trim())     { setMsg('⚠️ 请输入销售人员'); return }
    if (!name)             { setMsg('⚠️ 请选择柜子类型'); return }
    const c = parseFloat(cbm), k = parseFloat(kg), r = parseFloat(rev)
    if (isNaN(c) || c < 0) { setMsg('⚠️ 请输入有效的CBM'); return }
    if (isNaN(k) || k < 0) { setMsg('⚠️ 请输入有效的KG');  return }
    if (isNaN(r) || r < 0) { setMsg('⚠️ 请输入有效的收入'); return }
    try {
      await onSubmit(sales.trim(), name, c, k, r)
      setSales(''); setName(''); setCbm(''); setKg(''); setRev(''); setMsg('✅ 已添加')
      setTimeout(() => setMsg(''), 2000)
    } catch (err) {
      setMsg('⚠️ 提交失败:' + err.message)
    }
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-base font-semibold text-gray-800 mb-4">录入数据</h3>
      {disabled && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mb-4 text-xs text-yellow-700">
          查看历史 (Wk{selectedWeek}),录入功能仅在 Wk{currentWeek} (本周) 可用
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">销售人员</label>
          <input value={sales} onChange={e => setSales(e.target.value)} placeholder="请输入姓名"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs text-gray-500 mb-1">柜子类型</label>
          <select value={name} onChange={e => setName(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
            <option value="">请选择</option>
            {CONTAINERS.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        <div><label className="block text-xs text-gray-500 mb-1">CBM</label>
          <input type="number" step="0.01" min="0" value={cbm} onChange={e => setCbm(e.target.value)} placeholder="0"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">KG</label>
          <input type="number" step="0.01" min="0" value={kg}  onChange={e => setKg(e.target.value)}  placeholder="0"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" /></div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">收入金额 (¥)</label>
          <input type="number" step="0.01" min="0" value={rev} onChange={e => setRev(e.target.value)} placeholder="0"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" /></div>
      </div>
      <div className="flex items-center justify-between mt-5">
        {msg && <span className={`text-sm ${msg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>{msg}</span>}
        {!msg && <span />}
        <button type="submit" disabled={disabled || !currentWeek}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          {!currentWeek ? '加载中...' : '添加'}
        </button>
      </div>
    </form>
  )
}

// ─────────────────────────────────
// 组件：记录列表（可删除 / 可编辑）
// ─────────────────────────────────
function RecordList({ records, clientId, isAdmin, onDelete, onUpdate }) {
  const [editingId, setEditingId] = useState(null)
  const [edit, setEdit]           = useState({})

  const start = (r) => { setEditingId(r.id); setEdit({ ...r }) }
  const cancel = () => { setEditingId(null); setEdit({}) }
  const save   = () => { onUpdate(editingId, edit); setEditingId(null); setEdit({}) }

  if (records.length === 0)
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-base font-semibold text-gray-800 mb-4">输入记录</h3>
        <p className="text-sm text-gray-400 text-center py-8">暂无记录，请在左侧录入 ✏️</p>
      </div>
    )

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-base font-semibold text-gray-800 mb-4">输入记录 ({records.length})</h3>
      <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
        {records.map(r => (
          <div key={r.id} className="border border-gray-100 rounded-lg p-4 hover:bg-gray-50 transition-colors">
            {editingId === r.id ? (
              /* ── 编辑模式 ── */
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <input type="text"     value={edit.salesperson} onChange={e => setEdit({ ...edit, salesperson: e.target.value })} className="border rounded px-2 py-1 text-sm" />
                  <select               value={edit.container}  onChange={e => setEdit({ ...edit, container: e.target.value })}
                    className="border rounded px-2 py-1 text-sm bg-white">
                    {CONTAINERS.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                  <input type="number" step="0.01" value={edit.revenue}   onChange={e => setEdit({ ...edit, revenue: e.target.value })} className="border rounded px-2 py-1 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" step="0.01" value={edit.cbm}       onChange={e => setEdit({ ...edit, cbm: e.target.value })} className="border rounded px-2 py-1 text-sm" placeholder="CBM" />
                  <input type="number" step="0.01" value={edit.kg}        onChange={e => setEdit({ ...edit, kg: e.target.value })}  className="border rounded px-2 py-1 text-sm" placeholder="KG"  />
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <button onClick={cancel} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1">取消</button>
                  <button onClick={save}   className="text-xs bg-green-600 text-white hover:bg-green-700 px-3 py-1 rounded">保存</button>
                </div>
              </div>
            ) : (
              /* ── 查看模式 ── */
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-800">{r.salesperson}</span>
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{r.container}</span>
                    <span className="text-xs text-gray-400">{fmtTime(r.created_at)}</span>
                  </div>
                  {(isAdmin || r.client_id === clientId) && (
                    <div className="flex gap-3">
                      <button onClick={() => start(r)} className="text-xs text-blue-600 hover:text-blue-800">编辑</button>
                      <button onClick={() => onDelete(r.id)}  className="text-xs text-red-500 hover:text-red-700">删除</button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-4 text-xs text-gray-500">
                  <span>CBM: {Number(r.cbm).toFixed(2)}</span>
                  <span>KG: {Number(r.kg).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  <span>收入: ¥{Number(r.revenue).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────
// 组件：数据汇总
// ─────────────────────────────────
function Summary({ state, costs, selectedWeek, currentWeek, weeksWithData, onWeekChange }) {
  const totalCBM    = CONTAINERS.reduce((s, c) => s + state[c.name].cbm, 0)
  const totalKG     = CONTAINERS.reduce((s, c) => s + state[c.name].kg, 0)
  const totalRev    = CONTAINERS.reduce((s, c) => s + state[c.name].revenue, 0)
  const capCBM      = CONTAINERS.reduce((s, c) => s + c.capacityCBM, 0)
  const capKG       = CONTAINERS.reduce((s, c) => s + c.capacityKG, 0)
  const totalCost   = costs ? CONTAINERS.reduce((s, c) => s + (costs[c.name] || 0), 0) : 0

  const items = [
    { label: '总装载率', value: totalCBM / capCBM, detail: `${totalCBM.toFixed(2)} / ${capCBM} CBM` },
    { label: '总重量率', value: totalKG  / capKG,  detail: `${totalKG.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ${capKG.toLocaleString()} KG` },
  ]
  if (costs && totalCost > 0) {
    items.push({ label: '总收入率', value: totalRev / totalCost, detail: `¥${totalRev.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ¥${totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}` })
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-800">数据汇总</h3>
        <WeekSelector
          selectedWeek={selectedWeek}
          currentWeek={currentWeek}
          weeksWithData={weeksWithData}
          onChange={onWeekChange}
        />
      </div>
      <div className={`grid gap-4 ${items.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {items.map(item => {
          const good = item.value >= 1
          return (
            <div key={item.label} className="text-center">
              <span className={`text-2xl font-bold ${good ? 'text-green-600' : 'text-red-500'}`}>
                {(item.value * 100).toFixed(1)}%
              </span>
              <p className="text-xs text-gray-500 mt-1">{item.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{item.detail}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────
// 组件：周选择器
// ─────────────────────────────────
function WeekSelector({ selectedWeek, currentWeek, weeksWithData, onChange }) {
  return (
    <select
      value={selectedWeek ?? ''}
      onChange={e => onChange(Number(e.target.value))}
      className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
    >
      {Array.from({ length: 52 }, (_, i) => i + 1).map(w => (
        <option key={w} value={w} className={weeksWithData.has(w) ? 'text-red-600 font-semibold' : 'text-gray-400'}>
          Wk{w}{w === currentWeek ? ' (本周)' : ''}
        </option>
      ))}
    </select>
  )
}

// ─────────────────────────────────
// 组件：进入下一周按钮
// ─────────────────────────────────
function NextWeekButton({ currentWeek, password, onAdvance }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleConfirm = async () => {
    setBusy(true)
    try {
      await onAdvance(password)
      setConfirming(false)
    } catch (e) {
      alert('推进失败:' + e.message)
    }
    setBusy(false)
  }

  return (
    <>
      <button onClick={() => setConfirming(true)}
        className="text-xs text-orange-600 hover:text-orange-800 border border-orange-200 px-3 py-1.5 rounded-lg mr-2">
        进入下一周
      </button>
      {confirming && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-20" onClick={() => setConfirming(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-lg p-6 w-80">
            <h3 className="text-base font-semibold text-gray-800 mb-3">确认进入下一周</h3>
            <p className="text-sm text-gray-600 mb-4">
              确定从 Wk{currentWeek} 进入 Wk{currentWeek + 1} 吗?Wk{currentWeek} 数据将归档保留。
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5">取消</button>
              <button onClick={handleConfirm} disabled={busy}
                className="text-xs bg-orange-600 hover:bg-orange-700 text-white px-4 py-1.5 rounded-lg disabled:opacity-50">
                {busy ? '处理中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────
// 组件：周汇总表
// ─────────────────────────────────
function WeekSummaryTable({ records, costs, isAdmin, onSelectWeek }) {
  const weekGroups = useMemo(() => {
    const groups = {}
    records.forEach(r => {
      if (!r.week_number) return
      if (!groups[r.week_number]) groups[r.week_number] = { cbm: 0, kg: 0, revenue: 0 }
      groups[r.week_number].cbm     += Number(r.cbm)
      groups[r.week_number].kg      += Number(r.kg)
      groups[r.week_number].revenue += Number(r.revenue)
    })
    return groups
  }, [records])

  const capCBM  = CONTAINERS.reduce((s, c) => s + c.capacityCBM, 0)
  const capKG   = CONTAINERS.reduce((s, c) => s + c.capacityKG, 0)
  const totalCost = isAdmin && costs ? CONTAINERS.reduce((s, c) => s + (costs[c.name] || 0), 0) : 0

  const weeks = Object.keys(weekGroups).map(Number).sort((a, b) => a - b)

  if (weeks.length === 0) return null

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mt-6">
      <h3 className="text-base font-semibold text-gray-800 mb-4">周汇总</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">周</th>
              <th className="text-center py-2 px-3 text-xs text-gray-500 font-medium">总装载率</th>
              <th className="text-center py-2 px-3 text-xs text-gray-500 font-medium">总重量率</th>
              <th className="text-center py-2 px-3 text-xs text-gray-500 font-medium">总收入率</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map(w => {
              const g = weekGroups[w]
              const loadRate = g.cbm / capCBM
              const weightRate = g.kg / capKG
              const revenueRate = totalCost > 0 ? g.revenue / totalCost : null
              return (
                <tr key={w} onClick={() => onSelectWeek(w)}
                  className="border-b border-gray-50 hover:bg-blue-50 cursor-pointer transition-colors">
                  <td className="py-2 px-3 font-medium text-gray-800">Wk{w}</td>
                  <td className={`py-2 px-3 text-center font-medium ${loadRate >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                    {(loadRate * 100).toFixed(1)}%
                  </td>
                  <td className={`py-2 px-3 text-center font-medium ${weightRate >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                    {(weightRate * 100).toFixed(1)}%
                  </td>
                  <td className={`py-2 px-3 text-center font-medium ${revenueRate === null ? 'text-gray-400' : revenueRate >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                    {revenueRate === null ? '--' : `${(revenueRate * 100).toFixed(1)}%`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────
// 组件：成本配置面板 (仅管理员)
// ─────────────────────────────────
function CostConfigPanel({ costs, onUpdate }) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState('')

  const start = (container) => {
    setEditing(container); setDraft(String(costs[container] ?? '')); setErr('')
  }
  const save = async () => {
    const num = parseFloat(draft)
    if (isNaN(num) || num < 0) { setErr('请输入有效数字'); return }
    setBusy(true)
    try {
      await onUpdate(editing, num)
      setEditing(null); setDraft(''); setErr('')
    } catch (e) {
      setErr('保存失败:' + e.message)
    }
    setBusy(false)
  }
  const cancel = () => { setEditing(null); setDraft(''); setErr('') }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
      <h3 className="text-base font-semibold text-gray-800 mb-4">成本配置 (仅管理员可见)</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {CONTAINERS.map(c => (
          <div key={c.name} className="border border-gray-100 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">{c.name}</p>
            {editing === c.name ? (
              <div>
                <input type="number" step="0.01" value={draft} onChange={e => setDraft(e.target.value)} autoFocus
                  className="w-full border border-gray-200 rounded px-2 py-1 text-sm" />
                <div className="flex gap-2 mt-2">
                  <button onClick={save} disabled={busy}
                    className="text-xs bg-green-600 text-white hover:bg-green-700 px-2 py-1 rounded disabled:opacity-50">
                    {busy ? '...' : '保存'}
                  </button>
                  <button onClick={cancel} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">取消</button>
                </div>
                {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800">¥{(costs[c.name] ?? 0).toLocaleString()}</span>
                <button onClick={() => start(c.name)} className="text-xs text-blue-600 hover:text-blue-800">编辑</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────
// 组件：管理员入口按钮
// ─────────────────────────────────
function AdminButton({ isAdmin, onLogin, onLogout }) {
  const [open, setOpen] = useState(false)
  const [pw, setPw]     = useState('')
  const [err, setErr]   = useState('')
  const [busy, setBusy] = useState(false)

  if (isAdmin) {
    return (
      <button onClick={onLogout}
        className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-3 py-1.5 rounded-lg">
        退出管理员
      </button>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      await onLogin(pw)
      setOpen(false); setPw('')
    } catch {
      setErr('密码错误')
    }
    setBusy(false)
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-3 py-1.5 rounded-lg">
        管理员
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-20" onClick={() => setOpen(false)}>
          <form onSubmit={submit} onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-lg p-6 w-80">
            <h3 className="text-base font-semibold text-gray-800 mb-4">管理员登录</h3>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus placeholder="管理员密码"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 mb-3" />
            {err && <p className="text-sm text-red-500 mb-2">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)}
                className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5">取消</button>
              <button type="submit" disabled={busy}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg disabled:opacity-50">
                {busy ? '验证中...' : '登录'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────
// 主 App
// ─────────────────────────────────
export default function App() {
  const clientId = useClientId()
  const { records, add, update, remove } = useRecords()
  const { isAdmin, costs, password, login, logout, updateCost } = useAdmin()
  const { currentWeek, selectedWeek, setSelectedWeek, advance } = useWeek()

  const state = useMemo(() => {
    const s = {}
    CONTAINERS.forEach(c => { s[c.name] = { cbm: 0, kg: 0, revenue: 0 } })
    records.filter(r => r.week_number === selectedWeek).forEach(r => {
      if (!s[r.container]) return
      s[r.container].cbm     += Number(r.cbm)
      s[r.container].kg      += Number(r.kg)
      s[r.container].revenue += Number(r.revenue)
    })
    return s
  }, [records, selectedWeek])

  const weeksWithData = useMemo(() => {
    const s = new Set()
    records.forEach(r => { if (r.week_number) s.add(r.week_number) })
    return s
  }, [records])

  const handleSubmit = useCallback(async (salesperson, container, cbm, kg, revenue) => {
    await add({ salesperson, container, cbm, kg, revenue, client_id: clientId, week_number: currentWeek })
  }, [add, clientId, currentWeek])

  const handleDelete = useCallback(async (id) => {
    try { await remove(id) }
    catch (e) { alert('删除失败:' + e.message) }
  }, [remove])

  const handleUpdate = useCallback(async (id, updated) => {
    try {
      await update(id, {
        salesperson: updated.salesperson,
        container:   updated.container,
        cbm:         parseFloat(updated.cbm) || 0,
        kg:          parseFloat(updated.kg)  || 0,
        revenue:     parseFloat(updated.revenue) || 0,
      })
    } catch (e) {
      alert('更新失败:' + e.message)
    }
  }, [update])

  return (
    <div className="min-h-screen bg-gray-50/80">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">⚓ 海运拼箱 Dashboard</h1>
            <p className="text-xs text-gray-400">实时追踪柜子装载、重量与收入情况</p>
          </div>
          <div className="flex items-center">
            {isAdmin && <NextWeekButton currentWeek={currentWeek} password={password} onAdvance={advance} />}
            <AdminButton isAdmin={isAdmin} onLogin={login} onLogout={logout} />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div><InputForm onSubmit={handleSubmit} disabled={selectedWeek !== currentWeek} currentWeek={currentWeek} selectedWeek={selectedWeek} /></div>
          <div className="lg:col-span-2">
            <RecordList
              records={records}
              clientId={clientId}
              isAdmin={isAdmin}
              onDelete={handleDelete}
              onUpdate={handleUpdate}
            />
          </div>
        </div>

        {isAdmin && <CostConfigPanel costs={costs} onUpdate={updateCost} />}

        <div className="mb-6">
          <Summary
            state={state}
            costs={isAdmin ? costs : null}
            selectedWeek={selectedWeek}
            currentWeek={currentWeek}
            weeksWithData={weeksWithData}
            onWeekChange={setSelectedWeek}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {CONTAINERS.map(config => (
            <ContainerCard
              key={config.name}
              config={config}
              data={state[config.name]}
              cost={isAdmin ? costs[config.name] : null}
            />
          ))}
        </div>

        <WeekSummaryTable
          records={records}
          costs={isAdmin ? costs : null}
          isAdmin={isAdmin}
          onSelectWeek={setSelectedWeek}
        />
      </main>
    </div>
  )
}
