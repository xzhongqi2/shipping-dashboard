import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'

// ─────────────────────────────────
// 柜子配置
// ─────────────────────────────────
const CONTAINERS = [
  { name: '美西',   capacityCBM: 70, capacityKG: 12000, cost: 62243 },
  { name: '美中南', capacityCBM: 70, capacityKG: 12000, cost: 66734 },
  { name: '美中北', capacityCBM: 70, capacityKG: 12000, cost: 69259 },
  { name: '美东南', capacityCBM: 70, capacityKG: 12000, cost: 63845 },
  { name: '美东北', capacityCBM: 70, capacityKG: 12000, cost: 69259 },
]

const EMPTY_STATE = {}
CONTAINERS.forEach(c => { EMPTY_STATE[c.name] = { cbm: 0, kg: 0, revenue: 0 } })

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
function ContainerCard({ config, data }) {
  const loadRate    = data.cbm / config.capacityCBM
  const weightRate  = data.kg  / config.capacityKG
  const revenueRate = data.revenue / config.cost

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">{config.name}</h3>
        <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded">
          成本 ¥{config.cost.toLocaleString()}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center"><p className="text-xs text-gray-400">CBM</p>
          <p className="text-sm font-medium text-gray-700">{data.cbm} <span className="text-xs text-gray-400">/ {config.capacityCBM}</span></p></div>
        <div className="text-center"><p className="text-xs text-gray-400">KG</p>
          <p className="text-sm font-medium text-gray-700">{data.kg.toLocaleString()} <span className="text-xs text-gray-400">/ {config.capacityKG.toLocaleString()}</span></p></div>
        <div className="text-center"><p className="text-xs text-gray-400">收入</p>
          <p className="text-sm font-medium text-gray-700">¥{data.revenue.toLocaleString()}</p></div>
      </div>
      <div className="flex justify-around border-t border-gray-100 pt-4">
        <RateBadge value={loadRate}   label="装载率" />
        <RateBadge value={weightRate} label="重量率" />
        <RateBadge value={revenueRate} label="收入率" />
      </div>
    </div>
  )
}

// ─────────────────────────────────
// 组件：输入表单
// ────────────────────────────────
function InputForm({ onSubmit }) {
  const [sales, setSales] = useState('')
  const [name, setName]   = useState('')
  const [cbm, setCbm]     = useState('')
  const [kg, setKg]       = useState('')
  const [rev, setRev]     = useState('')
  const [msg, setMsg]     = useState('')

  const submit = (e) => {
    e.preventDefault()
    if (!sales.trim())     { setMsg('⚠️ 请输入销售人员'); return }
    if (!name)             { setMsg('⚠️ 请选择柜子类型'); return }
    const c = parseFloat(cbm), k = parseFloat(kg), r = parseFloat(rev)
    if (isNaN(c) || c < 0) { setMsg('⚠️ 请输入有效的CBM'); return }
    if (isNaN(k) || k < 0) { setMsg('⚠️ 请输入有效的KG');  return }
    if (isNaN(r) || r < 0) { setMsg('⚠️ 请输入有效的收入'); return }
    onSubmit(sales.trim(), name, c, k, r)
    setSales(''); setName(''); setCbm(''); setKg(''); setRev(''); setMsg('✅ 已添加')
    setTimeout(() => setMsg(''), 2000)
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-base font-semibold text-gray-800 mb-4">录入数据</h3>
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
          <input type="number" step="0.1" min="0" value={cbm} onChange={e => setCbm(e.target.value)} placeholder="0"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">KG</label>
          <input type="number" step="1"   min="0" value={kg}  onChange={e => setKg(e.target.value)}  placeholder="0"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" /></div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">收入金额 (¥)</label>
          <input type="number" step="1"   min="0" value={rev} onChange={e => setRev(e.target.value)} placeholder="0"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" /></div>
      </div>
      <div className="flex items-center justify-between mt-5">
        {msg && <span className={`text-sm ${msg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>{msg}</span>}
        {!msg && <span />}
        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2 rounded-lg transition-colors">
          添加
        </button>
      </div>
    </form>
  )
}

// ─────────────────────────────────
// 组件：记录列表（可删除 / 可编辑）
// ─────────────────────────────────
function RecordList({ records, onDelete, onUpdate }) {
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
                  <input type="number"  value={edit.revenue}   onChange={e => setEdit({ ...edit, revenue: e.target.value })} className="border rounded px-2 py-1 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number"  value={edit.cbm}       onChange={e => setEdit({ ...edit, cbm: e.target.value })} className="border rounded px-2 py-1 text-sm" placeholder="CBM" />
                  <input type="number"  value={edit.kg}        onChange={e => setEdit({ ...edit, kg: e.target.value })}  className="border rounded px-2 py-1 text-sm" placeholder="KG"  />
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
                    <span className="text-xs text-gray-400">{fmtTime(r.created_at ?? r.time)}</span>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => start(r)} className="text-xs text-blue-600 hover:text-blue-800">编辑</button>
                    <button onClick={() => onDelete(r.id)}  className="text-xs text-red-500 hover:text-red-700">删除</button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 text-xs text-gray-500">
                  <span>CBM: {r.cbm}</span>
                  <span>KG: {r.kg.toLocaleString()}</span>
                  <span>收入: ¥{r.revenue.toLocaleString()}</span>
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
function Summary({ state }) {
  const totalCBM    = CONTAINERS.reduce((s, c) => s + state[c.name].cbm, 0)
  const totalKG     = CONTAINERS.reduce((s, c) => s + state[c.name].kg, 0)
  const totalRev    = CONTAINERS.reduce((s, c) => s + state[c.name].revenue, 0)
  const capCBM     = CONTAINERS.reduce((s, c) => s + c.capacityCBM, 0)
  const capKG      = CONTAINERS.reduce((s, c) => s + c.capacityKG, 0)
  const totalCost  = CONTAINERS.reduce((s, c) => s + c.cost, 0)
  const items = [
    { label: '总装载率', value: totalCBM / capCBM,   detail: `${totalCBM} / ${capCBM} CBM` },
    { label: '总重量率', value: totalKG  / capKG,    detail: `${totalKG.toLocaleString()} / ${capKG.toLocaleString()} KG` },
    { label: '总收入率', value: totalRev / totalCost,  detail: `¥${totalRev.toLocaleString()} / ¥${totalCost.toLocaleString()}` },
  ]
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-base font-semibold text-gray-800 mb-4">数据汇总</h3>
      <div className="grid grid-cols-3 gap-4">
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
// 组件：登录 / 注册
// ─────────────────────────────────
function Auth({ onLogin }) {
  const [email, setEmail]     = useState('')
  const [pass,  setPass]      = useState('')
  const [isNew, setIsNew]     = useState(false)
  const [name,  setNameAuth]   = useState('')
  const [msg,   setMsg]       = useState('')
  const [busy,  setBusy]      = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setMsg(''); setBusy(true)
    try {
      if (isNew) {
        if (!name.trim()) { setMsg('⚠️ 请输入姓名'); setBusy(false); return }
        const { error } = await supabase.auth.signUp({ email, password: pass, options: { data: { name: name.trim() } } })
        if (error) throw error
        setMsg('✅ 注册成功！请检查邮箱验证后登录。')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass })
        if (error) throw error
      }
    } catch (e) {
      setMsg('❌ ' + e.message)
    }
    setBusy(false)
  }

  return (
    <div className="min-h-screen bg-gray-50/80 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow border border-gray-100 p-8">
        <h2 className="text-xl font-bold text-gray-900 mb-1">海运拼箱系统</h2>
        <p className="text-xs text-gray-400 mb-6">{isNew ? '注册新账号' : '登录您的账号'}</p>
        <form onSubmit={submit} className="space-y-4">
          {isNew && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">姓名（UID将基于此生成）</label>
              <input value={name} onChange={e => setNameAuth(e.target.value)} placeholder="张三"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">邮箱</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">密码</label>
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="••••••"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          {msg && <p className="text-sm">{msg}</p>}
          <button type="submit" disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50">
            {busy ? '处理中...' : isNew ? '注册' : '登录'}
          </button>
        </form>
        <p className="text-center text-xs text-gray-400 mt-4 cursor-pointer hover:text-blue-600"
          onClick={() => { setIsNew(!isNew); setMsg('') }}>
          {isNew ? '已有账号？立即登录' : '没有账号？立即注册'}
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────
// 主 App
// ─────────────────────────────────
export default function App() {
  const [user,   setUser]   = useState(null)   // 当前用户
  const [state,  setState]  = useState(EMPTY_STATE)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)

  // ── 恢复登录状态 + 加载数据 ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) loadData(session.user.id)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) loadData(session.user.id)
      else { setState(EMPTY_STATE); setRecords([]) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function loadData(uid) {
    setLoading(true)
    const { data, error } = await supabase.from('records').select('*').eq('user_id', uid).order('created_at', { ascending: false })
    if (!error && data) {
      setRecords(data)
      const s = { ...EMPTY_STATE }
      data.forEach(r => {
        s[r.container].cbm     += r.cbm
        s[r.container].kg      += r.kg
        s[r.container].revenue += r.revenue
      })
      setState(s)
    }
    setLoading(false)
  }

  // ── 添加记录 ──
  const handleSubmit = useCallback(async (salesperson, container, cbm, kg, revenue) => {
    if (!user) return
    const { data, error } = await supabase.from('records').insert({
      user_id: user.id, salesperson, container, cbm, kg, revenue
    }).select().single()
    if (error) { alert('添加失败：' + error.message); return }
    setRecords(prev => [data, ...prev])
    setState(prev => ({
      ...prev,
      [container]: {
        cbm:     prev[container].cbm     + cbm,
        kg:      prev[container].kg      + kg,
        revenue: prev[container].revenue + revenue,
      }
    }))
  }, [user])

  // ── 删除记录 ──
  const handleDelete = useCallback(async (id) => {
    const record = records.find(r => r.id === id)
    if (!record) return
    const { error } = await supabase.from('records').delete().eq('id', id)
    if (error) { alert('删除失败：' + error.message); return }
    setRecords(prev => prev.filter(r => r.id !== id))
    setState(prev => ({
      ...prev,
      [record.container]: {
        cbm:     prev[record.container].cbm     - record.cbm,
        kg:      prev[record.container].kg      - record.kg,
        revenue: prev[record.container].revenue - record.revenue,
      }
    }))
  }, [records])

  // ── 更新记录 ──
  const handleUpdate = useCallback(async (id, updated) => {
    const old = records.find(r => r.id === id)
    if (!old) return
    const { data, error } = await supabase.from('records').update({
      salesperson: updated.salesperson,
      container:   updated.container,
      cbm:         parseFloat(updated.cbm) || 0,
      kg:          parseFloat(updated.kg)  || 0,
      revenue:     parseFloat(updated.revenue) || 0,
    }).eq('id', id).select().single()
    if (error) { alert('更新失败：' + error.message); return }
    setRecords(prev => prev.map(r => r.id === id ? data : r))
    // 刷新汇总
    const s = { ...EMPTY_STATE }
    records.map(r => r.id === id ? data : r).forEach(r => {
      s[r.container].cbm     += r.cbm
      s[r.container].kg      += r.kg
      s[r.container].revenue += r.revenue
    })
    setState(s)
  }, [records])

  // ── 登出 ──
  const logout = async () => { await supabase.auth.signOut(); setUser(null) }

  // ── 未登录：显示 Auth 页面 ──
  if (!user) return <Auth onLogin={setUser} />

  // ── 已登录：显示主界面 ──
  const displayName = user.user_metadata?.name || user.email

  return (
    <div className="min-h-screen bg-gray-50/80">
      {/* 顶部导航 */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">⚓ 海运拼箱 Dashboard</h1>
            <p className="text-xs text-gray-400">实时追踪柜子装载、重量与收入情况</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">👤 {displayName}</span>
            <button onClick={logout} className="text-xs text-gray-400 hover:text-red-500 transition-colors">退出</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* 输入区 + 记录列表 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div><InputForm onSubmit={handleSubmit} /></div>
          <div className="lg:col-span-2">
            {loading ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center text-sm text-gray-400">加载中...</div>
            ) : (
              <RecordList records={records} onDelete={handleDelete} onUpdate={handleUpdate} />
            )}
          </div>
        </div>

        {/* 汇总 */}
        <div className="mb-6"><Summary state={state} /></div>

        {/* 五个柜子看板 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {CONTAINERS.map(config => (
            <ContainerCard key={config.name} config={config} data={state[config.name]} />
          ))}
        </div>
      </main>
    </div>
  )
}
