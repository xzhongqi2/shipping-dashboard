import { useMemo, useState } from 'react'
import readXlsxFile from 'read-excel-file/browser'
import { useContentItems } from '../hooks/useContentItems'

const EXCEL_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
])

function fmtDate(ts) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getFileType(file) {
  if (file.type.startsWith('image/')) return 'image'
  if (EXCEL_TYPES.has(file.type) || /\.(xlsx|csv)$/i.test(file.name)) return 'excel'
  return ''
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"' && quoted && next === '"') {
      cell += '"'
      i += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  row.push(cell)
  rows.push(row)
  return rows
}

async function readExcelPreview(file) {
  const rows = /\.csv$/i.test(file.name)
    ? parseCsv(await file.text())
    : await readXlsxFile(file)

  const normalizeRow = (row) => {
    if (Array.isArray(row)) return row
    if (row && typeof row === 'object') return Object.values(row)
    return [row]
  }

  const cleaned = rows
    .map(row => normalizeRow(row).map(cell => String(cell ?? '').trim()))
    .filter(row => row.some(Boolean))

  return {
    sheetName: /\.csv$/i.test(file.name) ? 'CSV' : 'Sheet1',
    headers: cleaned[0] || [],
    rows: cleaned.slice(1),
  }
}

function EmptyState({ title }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-10 text-center">
      <p className="text-sm text-gray-400">暂无{title}，有上传权限的用户可以在上方发布。</p>
    </div>
  )
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getTextWidth(value) {
  const text = String(value ?? '')
  let width = 0
  for (const char of text) {
    width += /[\u4e00-\u9fff]/.test(char) ? 14 : 8
  }
  return width
}

function wrapCellText(value, maxChars) {
  const text = String(value ?? '')
  if (!text) return ['']
  const parts = []
  let line = ''
  for (const char of text) {
    const lineWidth = getTextWidth(line + char)
    if (line && lineWidth > maxChars * 8) {
      parts.push(line)
      line = char
    } else {
      line += char
    }
  }
  if (line) parts.push(line)
  return parts.slice(0, 6)
}

function buildSheetImage(preview) {
  const headers = preview?.headers || []
  const rows = preview?.rows || []
  const tableRows = [headers, ...rows].filter(row => row?.some(Boolean))
  const columnCount = Math.max(...tableRows.map(row => row.length), 1)
  const columnWidths = Array.from({ length: columnCount }, (_, index) => {
    const widest = tableRows.reduce((max, row) => Math.max(max, getTextWidth(row[index])), 0)
    return Math.max(140, Math.min(widest + 36, 520))
  })
  const titleHeight = 46
  const width = columnWidths.reduce((sum, col) => sum + col, 0) + 2
  const rowLayouts = tableRows.map(row => {
    const cells = columnWidths.map((colWidth, colIndex) => {
      const maxChars = Math.max(10, Math.floor((colWidth - 24) / 8))
      return wrapCellText(row[colIndex] || '', maxChars)
    })
    const lineCount = Math.max(...cells.map(lines => lines.length), 1)
    return { cells, height: Math.max(38, 20 + lineCount * 19) }
  })
  const height = titleHeight + rowLayouts.reduce((sum, row) => sum + row.height, 0) + 2

  let y = titleHeight
  const body = rowLayouts.map((rowLayout, rowIndex) => {
    let x = 1
    const cells = columnWidths.map((colWidth, colIndex) => {
      const lines = rowLayout.cells[colIndex] || ['']
      const bg = rowIndex === 0 ? '#eef4ff' : rowIndex % 2 ? '#ffffff' : '#f8fafc'
      const weight = rowIndex === 0 ? '700' : '500'
      const color = rowIndex === 0 ? '#1f3b63' : '#334155'
      const cell = `
        <rect x="${x}" y="${y}" width="${colWidth}" height="${rowLayout.height}" fill="${bg}" stroke="#dbe3ee" />
        <text x="${x + 12}" y="${y + 24}" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="14" font-weight="${weight}" fill="${color}">
          ${lines.map((line, lineIndex) => `<tspan x="${x + 12}" dy="${lineIndex === 0 ? 0 : 19}">${escapeXml(line)}</tspan>`).join('')}
        </text>
      `
      x += colWidth
      return cell
    }).join('')
    y += rowLayout.height
    return cells
  }).join('')

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" rx="14" fill="#ffffff"/>
      <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14" fill="none" stroke="#dbe3ee"/>
      <text x="18" y="29" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="15" font-weight="700" fill="#0f172a">${escapeXml(preview?.sheetName || 'Excel 预览')}</text>
      ${body}
    </svg>
  `.trim()

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function ExcelPreview({ preview }) {
  const headers = preview?.headers || []
  const rows = preview?.rows || []
  if (!headers.length && !rows.length) return null
  const imageSrc = buildSheetImage(preview)

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100 bg-gray-50 p-3">
      <img src={imageSrc} alt="Excel 图片预览" className="max-w-none rounded-xl shadow-sm" />
    </div>
  )
}

function ContentCard({ item, canUpload, onDelete }) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!window.confirm(`确认删除「${item.title}」吗？`)) return
    setDeleting(true)
    try {
      await onDelete(item)
    } catch (e) {
      alert('删除失败:' + e.message)
      setDeleting(false)
    }
  }

  return (
    <article className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{item.title}</h3>
          <p className="text-xs text-gray-400 mt-1">
            {fmtDate(item.created_at)} · {item.file_name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {item.signed_url && (
            <a href={item.signed_url} target="_blank" rel="noopener"
              className="text-xs text-blue-600 hover:text-blue-800 border border-blue-100 rounded-lg px-3 py-1.5">
              下载
            </a>
          )}
          {canUpload && (
            <button onClick={handleDelete} disabled={deleting}
              className="text-xs text-red-500 hover:text-red-700 border border-red-100 rounded-lg px-3 py-1.5 disabled:opacity-50">
              {deleting ? '删除中...' : '删除'}
            </button>
          )}
        </div>
      </div>

      {item.file_type === 'image' && item.signed_url && (
        <img src={item.signed_url} alt={item.title} className="w-full rounded-xl border border-gray-100 object-contain max-h-[640px] bg-gray-50" />
      )}

      {item.file_type === 'excel' && <ExcelPreview preview={item.preview} />}
    </article>
  )
}

function UploadPanel({ title, type, canUpload, onUpload }) {
  const [uploadTitle, setUploadTitle] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  if (!canUpload) {
    return (
      <div className="bg-blue-50 border border-blue-100 rounded-2xl px-5 py-4 mb-6">
        <p className="text-sm text-blue-700">当前账号为只读权限，可以查看{title}，不能上传或删除。</p>
      </div>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    const form = e.currentTarget
    setMsg('')
    const selectedFile = file || form.elements.contentFile?.files?.[0]
    if (!selectedFile) { setMsg('请选择 Excel 或图片文件'); return }

    const fileType = getFileType(selectedFile)
    if (!fileType) { setMsg('仅支持 .xlsx/.csv 和图片文件，旧 .xls 请先另存为 .xlsx'); return }

    setBusy(true)
    try {
      const preview = fileType === 'excel' ? await readExcelPreview(selectedFile) : null
      await onUpload({
        title: uploadTitle.trim() || `${title} ${new Date().toLocaleDateString('zh-CN')}`,
        file: selectedFile,
        fileType,
        preview,
      })
      setUploadTitle('')
      setFile(null)
      form.reset()
      setMsg('已发布')
      setTimeout(() => setMsg(''), 1800)
    } catch (err) {
      setMsg('上传失败:' + err.message)
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">标题</label>
          <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)}
            placeholder={type === 'schedule' ? '例如：7月美线最新船期' : '例如：本周美线报价'}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">文件</label>
          <input name="contentFile" type="file" accept=".xlsx,.csv,image/*" onChange={e => setFile(e.target.files?.[0] || null)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" />
        </div>
        <button type="submit" disabled={busy}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2 rounded-lg disabled:opacity-50">
          {busy ? '上传中...' : '发布'}
        </button>
      </div>
      {msg && <p className={`text-sm mt-3 ${msg === '已发布' ? 'text-green-600' : 'text-red-500'}`}>{msg}</p>}
    </form>
  )
}

export function ContentLibrary({ type, role }) {
  const canUpload = ['owner', 'staff', 'operator'].includes(role)
  const { items, loading, error, upload, remove, reload } = useContentItems(type)
  const config = useMemo(() => ({
    schedule: {
      title: '最新船期',
      eyebrow: 'Amazon Consolidation Schedule',
      description: '发布和查看最新船期表、船司排期图片及相关说明。',
    },
    quotes: {
      title: '本周报价',
      eyebrow: 'Weekly Rates',
      description: '发布和查看本周渠道报价表、报价截图及价格更新。',
    },
  }[type]), [type])

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] uppercase text-blue-600">{config.eyebrow}</p>
          <h2 className="text-2xl font-bold text-gray-900 mt-1">{config.title}</h2>
          <p className="text-sm text-gray-500 mt-2">{config.description}</p>
        </div>
        <button onClick={reload}
          className="text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-4 py-2 bg-white">
          刷新
        </button>
      </div>

      <UploadPanel title={config.title} type={type} canUpload={canUpload} onUpload={upload} />

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 mb-6">
          <p className="text-sm text-red-600">读取失败：{error}</p>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-sm text-gray-400">加载中...</div>
      ) : items.length ? (
        <div className="space-y-5">
          {items.map(item => (
            <ContentCard key={item.id} item={item} canUpload={canUpload} onDelete={remove} />
          ))}
        </div>
      ) : (
        <EmptyState title={config.title} />
      )}
    </main>
  )
}
