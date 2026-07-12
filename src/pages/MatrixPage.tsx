import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CircleDot,
  ImageIcon,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { createGenerationRun, prepareWorkflow } from '../lib/api'
import { demoWorkspace } from '../lib/demo'
import { useAppStore } from '../store/appStore'
import type { ShotType, WorkspaceTask } from '../types'
import '../batch.css'

const columns: Array<{ id: ShotType; label: string; short: string }> = [
  { id: 'main', label: '主图', short: 'MAIN' },
  { id: 'size', label: '尺寸图', short: 'SIZE' },
  { id: 'lifestyle-scene', label: '场景图', short: 'SCENE' },
  { id: 'detail', label: '细节图', short: 'DETAIL' },
  { id: 'comparison', label: '对比图', short: 'COMPARE' },
]

type CellState = 'ready' | 'review' | 'blocked'

const cellMeta: Record<CellState, { label: string; icon: typeof Check }> = {
  ready: { label: '可生成', icon: CircleDot },
  review: { label: '已有候选', icon: Sparkles },
  blocked: { label: '资料阻塞', icon: AlertTriangle },
}

function demoTasks(product: string): WorkspaceTask[] {
  const shots = Object.fromEntries(columns.map(({ id, label }) => [id, {
    folder: label,
    imageCount: id === 'main' ? 1 : 0,
    images: id === 'main' ? [{ name: '演示候选', url: '/demo/product-studio.png' }] : [],
  }])) as WorkspaceTask['shots']
  return [{
    id: `${product}/单品`,
    name: '单品',
    product,
    kind: 'standalone',
    hasPrompts: true,
    promptCount: 5,
    referenceCount: 2,
    hasReferenceManifest: true,
    generatedImageCount: 1,
    shots,
  }]
}

function taskState(task: WorkspaceTask, shot: ShotType): CellState {
  if (!task.hasPrompts || !task.hasReferenceManifest || task.referenceCount < 1) return 'blocked'
  if ((task.shots[shot]?.imageCount ?? 0) > 0) return 'review'
  return 'ready'
}

export function MatrixPage() {
  const navigate = useNavigate()
  const workspace = useAppStore((state) => state.workspace) ?? demoWorkspace
  const demoMode = useAppStore((state) => state.demoMode)
  const apiOnline = useAppStore((state) => state.apiOnline)
  const selectedProduct = useAppStore((state) => state.selectedProduct)
  const setSelectedProduct = useAppStore((state) => state.setSelectedProduct)
  const setSelectedTask = useAppStore((state) => state.setSelectedTask)
  const setSelectedShot = useAppStore((state) => state.setSelectedShot)
  const setActiveRunId = useAppStore((state) => state.setActiveRunId)
  const notify = useAppStore((state) => state.notify)

  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set())
  const [selectedShots, setSelectedShots] = useState<Set<ShotType>>(new Set(['main', 'lifestyle-scene']))
  const [variants, setVariants] = useState(4)
  const [concurrency, setConcurrency] = useState(2)
  const [search, setSearch] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!workspace.products.some((product) => product.id === selectedProduct) && workspace.products[0]) {
      setSelectedProduct(workspace.products[0].id)
    }
  }, [selectedProduct, setSelectedProduct, workspace.products])

  const product = workspace.products.find((item) => item.id === selectedProduct) ?? workspace.products[0]
  const combination = workspace.combinations?.find((item) => item.id === product?.id)
  const tasks = useMemo(
    () => combination?.tasks ?? (demoMode && product ? demoTasks(product.id) : []),
    [combination, demoMode, product],
  )
  const taskKey = tasks.map((task) => task.name).join('|')

  useEffect(() => {
    setSelectedTasks(tasks[0] ? new Set([tasks[0].name]) : new Set())
  }, [product?.id, taskKey])

  const visibleTasks = tasks.filter((task) => task.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const selectedCellCount = selectedTasks.size * selectedShots.size
  const expectedCount = selectedCellCount * variants
  const generatedCount = tasks.reduce((sum, task) => sum + task.generatedImageCount, 0)
  const blockedCount = tasks.reduce((sum, task) => sum + columns.filter(({ id }) => taskState(task, id) === 'blocked').length, 0)
  const selectedBlockedCount = tasks
    .filter((task) => selectedTasks.has(task.name))
    .reduce((sum, task) => sum + [...selectedShots].filter((shot) => taskState(task, shot) === 'blocked').length, 0)
  const liveReady = apiOnline && !demoMode && workspace.liveGenerationEnabled

  const toggleTask = (task: string) => setSelectedTasks((current) => {
    const next = new Set(current)
    next.has(task) ? next.delete(task) : next.add(task)
    return next
  })

  const toggleShot = (shot: ShotType) => setSelectedShots((current) => {
    const next = new Set(current)
    next.has(shot) ? next.delete(shot) : next.add(shot)
    return next
  })

  const openCell = (task: string, shot: ShotType) => {
    setSelectedTask(task)
    setSelectedShot(shot)
    navigate('/studio')
  }

  const prepare = async () => {
    if (!product) return
    if (!apiOnline || demoMode) {
      notify({ title: '当前为演示数据', detail: '连接本地服务后才能刷新真实 Prompt。', tone: 'warning' })
      return
    }
    setPreparing(true)
    try {
      await prepareWorkflow(product.id)
      notify({ title: 'Prompt 基线已刷新', detail: `${product.id} 的任务资料已重新扫描。`, tone: 'success' })
    } catch (error) {
      notify({ title: 'Prompt 准备失败', detail: error instanceof Error ? error.message : '请检查 Skill 日志', tone: 'warning' })
    } finally {
      setPreparing(false)
    }
  }

  const generate = async () => {
    if (!product || !selectedTasks.size || !selectedShots.size) {
      notify({ title: '还不能开始生成', detail: '请至少选择一个任务和一种图型。', tone: 'warning' })
      return
    }
    if (selectedBlockedCount) {
      notify({ title: '所选范围包含资料阻塞项', detail: `请先处理 ${selectedBlockedCount} 个缺少 Prompt 或参考图清单的工作项。`, tone: 'warning' })
      return
    }
    if (!liveReady) {
      notify({
        title: demoMode ? '演示模式不会创建真实任务' : '真实生图尚未开启',
        detail: demoMode ? '请先连接本地 MuseForge 服务。' : '请到连接与设置中开启实时生图。',
        tone: 'warning',
      })
      return
    }
    setSubmitting(true)
    try {
      const run = await createGenerationRun({
        product: product.id,
        tasks: [...selectedTasks],
        shots: [...selectedShots],
        variants,
        concurrency,
      })
      setActiveRunId(run.id)
      notify({ title: '批量任务已进入本地队列', detail: `预计生成 ${expectedCount} 张候选图。`, tone: 'success' })
      navigate(`/queue?run=${encodeURIComponent(run.id)}`)
    } catch (error) {
      notify({ title: '创建批量任务失败', detail: error instanceof Error ? error.message : '本地工作流未响应', tone: 'warning' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="matrix-page page-pad batch-matrix-page">
      <section className="matrix-summary batch-matrix-summary">
        <div className="summary-copy">
          <span className="product-avatar"><img src={product?.thumbnail ?? '/demo/product-cutout.png'} alt="" /></span>
          <div>
            <small>当前商品</small>
            <select value={product?.id ?? ''} onChange={(event) => setSelectedProduct(event.target.value)} aria-label="选择商品">
              {workspace.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <p>{tasks.length} 组任务 · {tasks.length * columns.length} 个图型工作项</p>
          </div>
        </div>
        <div className="matrix-summary-stat"><span>{generatedCount}</span><small>已有输出</small></div>
        <div className="matrix-summary-stat"><span>{selectedCellCount}</span><small>本次工作项</small></div>
        <div className="matrix-summary-stat warning"><span>{blockedCount}</span><small>资料阻塞</small></div>
        <button className="button secondary" onClick={prepare} disabled={preparing}>{preparing ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}刷新 Prompt</button>
      </section>

      {!liveReady && (
        <section className="generation-gate" role="status">
          <AlertTriangle size={19} />
          <div><strong>{demoMode ? '当前展示的是演示数据' : '实时生图开关尚未开启'}</strong><p>{demoMode ? '可以浏览完整工作流，但不会伪造本地任务或候选图。' : '设置 MUSEFORGE_ENABLE_LIVE_GENERATION=true 并重启本地服务后，才可提交批量任务。'}</p></div>
          <button onClick={() => navigate('/settings')}><Settings2 size={15} />连接与设置</button>
        </section>
      )}

      <section className="matrix-toolbar batch-matrix-toolbar">
        <div className="inline-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索任务或配件" /></div>
        <button className="filter-button" onClick={() => setSelectedTasks(new Set(tasks.map((task) => task.name)))}>选择全部任务</button>
        <button className="filter-button" onClick={() => { setSelectedTasks(new Set()); setSelectedShots(new Set()) }}>清空选择</button>
        <span className="toolbar-spacer" />
        <span className="selection-count">已选择 {selectedTasks.size} 个任务 × {selectedShots.size} 种图型</span>
      </section>

      <section className="matrix-table panel batch-matrix-table">
        <div className="matrix-head">
          <div className="task-col">选择任务 / 配件</div>
          {columns.map((column) => (
            <button key={column.id} className={selectedShots.has(column.id) ? 'selected-axis' : ''} onClick={() => toggleShot(column.id)}>
              <span className="axis-checkbox">{selectedShots.has(column.id) && <Check size={12} />}</span>
              <span>{column.label}</span><small>{column.short}</small>
            </button>
          ))}
          <div className="more-col" />
        </div>
        {visibleTasks.map((task) => (
          <div className={`matrix-row ${selectedTasks.has(task.name) ? 'selected-task-row' : ''}`} key={task.id}>
            <button className="task-col task-selector" onClick={() => toggleTask(task.name)}>
              <span className="axis-checkbox">{selectedTasks.has(task.name) && <Check size={12} />}</span>
              <span className={`task-symbol ${task.kind === 'standalone' ? 'standalone' : ''}`}>{task.kind === 'standalone' ? 'P' : '＋'}</span>
              <p><strong>{task.name}</strong><small>{task.kind === 'standalone' ? '主商品' : '配件组合'} · {task.referenceCount} 张参考</small></p>
            </button>
            {columns.map((column) => {
              const state = taskState(task, column.id)
              const meta = cellMeta[state]
              const Icon = meta.icon
              const image = task.shots[column.id]?.images[0]
              const selected = selectedTasks.has(task.name) && selectedShots.has(column.id)
              return (
                <button
                  key={`${task.id}-${column.id}`}
                  className={`matrix-cell ${state} ${selected ? 'selected' : ''}`}
                  onClick={() => {
                    if (!selectedTasks.has(task.name)) setSelectedTasks((current) => new Set(current).add(task.name))
                    if (!selectedShots.has(column.id)) setSelectedShots((current) => new Set(current).add(column.id))
                  }}
                  onDoubleClick={() => openCell(task.name, column.id)}
                >
                  <span className="cell-checkbox">{selected && <Check size={12} />}</span>
                  {image ? <img src={image.url} alt="" /> : <span className="cell-placeholder"><Icon size={18} /></span>}
                  <strong><Icon size={12} />{meta.label}</strong>
                  <small>{state === 'blocked' ? '缺 Prompt 或参考图清单' : state === 'review' ? `${task.shots[column.id].imageCount} 张输出` : '预检资料完整'}</small>
                </button>
              )
            })}
            <div className="more-col"><ImageIcon size={16} /></div>
          </div>
        ))}
        {!visibleTasks.length && <div className="batch-empty"><Search size={22} /><strong>没有匹配的真实任务</strong><span>请先运行 Skill 准备 prompts 与 reference manifest。</span></div>}
        <div className="matrix-legend"><span><i className="review" />已有候选</span><span><i className="ready" />可生成</span><span><i className="blocked" />资料阻塞</span><small>选择任务行与图型列；双击工作项进入画布</small></div>
      </section>

      <section className="batch-selection-bar">
        <div className="batch-selection-copy"><small>本次批量任务</small><strong>{selectedTasks.size} 个任务 × {selectedShots.size} 种图型 × {variants} 个候选</strong><span className={selectedBlockedCount ? 'blocked-copy' : ''}>{selectedBlockedCount ? `${selectedBlockedCount} 个所选工作项资料阻塞，暂不可提交` : `预计生成 ${expectedCount} 张 · 每个工作项保留独立审核组`}</span></div>
        <label>每组候选<select value={variants} onChange={(event) => setVariants(Number(event.target.value))}><option value={1}>1 张</option><option value={2}>2 张</option><option value={4}>4 张</option></select></label>
        <label>本地并发<select value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={4}>4</option><option value={6}>6</option></select></label>
        <button className="button dark" onClick={generate} disabled={submitting || !liveReady || expectedCount === 0}>{submitting ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}生成 {expectedCount} 张候选</button>
      </section>
    </div>
  )
}
