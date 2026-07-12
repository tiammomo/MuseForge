import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignCenter,
  ArrowDownToLine,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Download,
  Eye,
  Grip,
  Hand,
  ImagePlus,
  Layers3,
  LockKeyhole,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  ScanSearch,
  Settings2,
  Sparkles,
  TextCursorInput,
  Trash2,
  Undo2,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ARTBOARD, StudioCanvas, type CanvasViewport, type StudioCanvasHandle } from '../components/StudioCanvas'
import { demoAssets } from '../lib/demo'
import { createGenerationRun, loadCanvas, previewWorkflow, saveCanvas } from '../lib/api'
import { useAppStore } from '../store/appStore'
import type { AssetItem, CanvasNode, PromptDraft, ShotType } from '../types'
import '../studio-enhancements.css'

const shotOptions: Array<{ id: ShotType; label: string; short: string }> = [
  { id: 'main', label: '主图', short: 'MAIN' },
  { id: 'size', label: '尺寸图', short: 'SIZE' },
  { id: 'lifestyle-scene', label: '场景图', short: 'SCENE' },
  { id: 'detail', label: '细节图', short: 'DETAIL' },
  { id: 'comparison', label: '对比图', short: 'COMPARE' },
]

const outputByShot: Record<ShotType, string> = {
  main: '/demo/product-studio.png',
  size: '/demo/campaign.png',
  'lifestyle-scene': '/demo/product-studio.png',
  detail: '/demo/fashion.png',
  comparison: '/demo/interior.png',
}

const defaultPrompt: PromptDraft = {
  subject: '完整展示透明喷雾瓶，保持真实轮廓、泵头结构、玻璃质感与比例，不新增任何部件。',
  environment: '明亮白天的自然梳妆台场景，柔和左侧窗光，浅木色与安静绿植形成克制的生活氛围。',
  composition: '商品居中偏右，占画面主要视觉权重；近景叶片形成前景引导，留出左上文案安全区。',
  negatives: '夜景、儿童、品牌 Logo、认证标识、无线符号、插头、中文文字、悬浮、变形、假接触。',
  visibleText: 'HYDRATION, REIMAGINED.',
}

type SaveState = 'loading' | 'dirty' | 'saving' | 'saved' | 'load-error' | 'save-error'

type CanvasSnapshot = {
  nodes: CanvasNode[]
  prompt: PromptDraft
  shot: ShotType
  task: string
  viewport: CanvasViewport
}

type CachedCanvas = {
  snapshot: CanvasSnapshot
  pendingSync: boolean
}

const canvasSaveQueues = new Map<string, Promise<unknown>>()

function readCanvasCache(id: string): CachedCanvas | undefined {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(`museforge-canvas:${id}`) ?? 'null') as unknown
    if (!value || typeof value !== 'object') return undefined
    const record = value as Record<string, unknown>
    const snapshot = (record.snapshot && typeof record.snapshot === 'object' ? record.snapshot : record) as Partial<CanvasSnapshot>
    if (!Array.isArray(snapshot.nodes) || !snapshot.prompt || typeof snapshot.prompt !== 'object') return undefined
    return {
      snapshot: snapshot as CanvasSnapshot,
      pendingSync: record.pendingSync === true,
    }
  } catch {
    return undefined
  }
}

function writeCanvasCache(id: string, snapshot: CanvasSnapshot, pendingSync: boolean): void {
  try {
    window.sessionStorage.setItem(`museforge-canvas:${id}`, JSON.stringify({ snapshot, pendingSync }))
  } catch {
    // The SQLite document remains authoritative when session storage is unavailable.
  }
}

function normalizeViewport(value: unknown): CanvasViewport | undefined {
  if (!value || typeof value !== 'object') return undefined
  const viewport = value as Partial<CanvasViewport>
  if (![viewport.x, viewport.y, viewport.zoom].every((item) => typeof item === 'number' && Number.isFinite(item))) return undefined
  return {
    x: viewport.x as number,
    y: viewport.y as number,
    zoom: Math.min(1.5, Math.max(0.35, viewport.zoom as number)),
    mode: viewport.mode === 'fit' ? 'fit' : 'custom',
  }
}

function shortHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function canvasDocumentId(product: string, task: string, shot: ShotType): string {
  const identity = `${product}|${task}|${shot}`
  return `${product.slice(0, 30)}-${task.slice(0, 30)}-${shot}-${shortHash(identity)}`
}

function initialNodes(shot: ShotType): CanvasNode[] {
  return [
    { id: 'scene-background', type: 'image', src: outputByShot[shot], x: ARTBOARD.x, y: ARTBOARD.y, width: ARTBOARD.width, height: ARTBOARD.height },
    { id: 'headline', type: 'text', text: 'HYDRATION, REIMAGINED.', x: 344, y: 184, width: 445, fontSize: 25, fontStyle: 'bold', fill: '#173f38' },
    { id: 'subline', type: 'text', text: 'A quiet ritual for bright summer mornings', x: 347, y: 218, width: 360, fontSize: 13, fill: '#42665f' },
  ]
}

function imageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 })
    image.onerror = () => resolve({ width: 1, height: 1 })
    image.src = src
  })
}

function AssetPanel({ onAdd }: { onAdd: (asset: AssetItem) => void }) {
  const [tab, setTab] = useState<'assets' | 'reference' | 'history'>('assets')
  const filtered = tab === 'assets' ? demoAssets.slice(0, 4) : tab === 'reference' ? demoAssets.slice(3) : demoAssets.slice(1, 4)
  return (
    <aside className="asset-panel">
      <div className="panel-tabs compact">
        <button className={tab === 'assets' ? 'active' : ''} onClick={() => setTab('assets')}>素材</button>
        <button className={tab === 'reference' ? 'active' : ''} onClick={() => setTab('reference')}>参考</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>历史</button>
      </div>
      <button className="upload-zone"><ImagePlus size={18} /><span><strong>导入素材</strong><small>拖入图片或点击选择</small></span></button>
      <div className="asset-section-title"><span>{tab === 'history' ? '最近生成' : '项目素材'}</span><em>{filtered.length}</em></div>
      <div className="asset-grid">
        {filtered.map((asset) => (
          <button key={asset.id} className="asset-tile" onClick={() => onAdd(asset)} title={`添加 ${asset.name}`}>
            <img src={asset.url} alt={asset.name} />
            <span className={`asset-kind ${asset.kind}`}>{asset.kind === 'product' ? '商品' : asset.kind === 'output' ? '输出' : asset.kind === 'scene' ? '场景' : '参考'}</span>
            <small>{asset.name}</small>
            <i><Plus size={13} /></i>
          </button>
        ))}
      </div>
      <div className="asset-section-title"><span>商品事实</span><LockKeyhole size={13} /></div>
      <div className="fact-mini-card">
        <strong>MF-DEMO-001</strong>
        <p>透明喷雾瓶 · 深绿色泵头<br />完整单件 · 竖直独立摆放</p>
        <button>查看 8 条证据 <Eye size={13} /></button>
      </div>
    </aside>
  )
}

function Inspector({
  prompt,
  setPrompt,
  selectedNode,
  onUpdateSelected,
  onGenerate,
  onPreflight,
  onCenterHorizontal,
  onCenterVertical,
  onLayerUp,
  onLayerDown,
  generating,
  canvasVersion,
}: {
  prompt: PromptDraft
  setPrompt: (value: PromptDraft) => void
  selectedNode?: CanvasNode
  onUpdateSelected: (patch: Partial<CanvasNode>) => void
  onGenerate: () => void
  onPreflight: () => void
  onCenterHorizontal: () => void
  onCenterVertical: () => void
  onLayerUp: () => void
  onLayerDown: () => void
  generating: boolean
  canvasVersion?: number
}) {
  const [tab, setTab] = useState<'generate' | 'properties' | 'history'>('generate')
  const [advanced, setAdvanced] = useState(false)
  const selectedIsBackground = selectedNode?.id === 'scene-background'

  useEffect(() => {
    if (selectedNode) setTab('properties')
  }, [selectedNode?.id])

  return (
    <aside className="inspector-panel">
      <div className="panel-tabs">
        <button className={tab === 'generate' ? 'active' : ''} onClick={() => setTab('generate')}><WandSparkles size={15} />生成</button>
        <button className={tab === 'properties' ? 'active' : ''} onClick={() => setTab('properties')}><Settings2 size={15} />属性</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><Layers3 size={15} />版本</button>
      </div>

      {tab === 'generate' && (
        <div className="inspector-scroll">
          <div className="inspector-section">
            <div className="section-heading"><span>参考图</span><small>2 / 5</small></div>
            <div className="reference-strip">
              <div><img src="/demo/product-cutout.png" alt="主商品参考" /><span>主商品</span></div>
              <div><img src="/demo/product-studio.png" alt="构图参考" /><span>构图</span></div>
              <button><Plus size={18} /><small>添加</small></button>
            </div>
            <p className="helper-copy"><LockKeyhole size={12} />参考图仅锁定商品身份，不复制原构图与背景。</p>
          </div>

          <div className="inspector-section prompt-fields">
            <div className="section-heading"><span>结构化 Prompt</span><button>展开 JSON</button></div>
            <label><span>商品主体 <em>已锁定</em></span><textarea value={prompt.subject} onChange={(event) => setPrompt({ ...prompt, subject: event.target.value })} rows={3} /></label>
            <label><span>场景与氛围</span><textarea value={prompt.environment} onChange={(event) => setPrompt({ ...prompt, environment: event.target.value })} rows={3} /></label>
            <label><span>构图</span><textarea value={prompt.composition} onChange={(event) => setPrompt({ ...prompt, composition: event.target.value })} rows={2} /></label>
            <label><span>画面文字</span><input value={prompt.visibleText} onChange={(event) => setPrompt({ ...prompt, visibleText: event.target.value })} /></label>
            <label><span>负面约束</span><textarea className="negative" value={prompt.negatives} onChange={(event) => setPrompt({ ...prompt, negatives: event.target.value })} rows={2} /></label>
          </div>

          <div className="inspector-section">
            <button className="advanced-toggle" onClick={() => setAdvanced((value) => !value)}><span>生成参数</span><span>Image2 · 1:1 · Medium</span><ChevronDown size={15} className={advanced ? 'rotated' : ''} /></button>
            {advanced && <div className="advanced-grid"><label>模型<select defaultValue="image2"><option value="image2">GPT Image 2</option><option value="comfy">ComfyUI · Local</option></select></label><label>候选数<select defaultValue="4"><option>2</option><option>4</option><option>6</option></select></label><label>尺寸<select><option>1024 × 1024</option></select></label><label>质量<select><option>Medium</option><option>High</option></select></label></div>}
          </div>

          <div className="preflight-card">
            <div><span><Check size={13} /></span><p><strong>4 项硬门槛已通过</strong><small>商品事实、参考边界、场景规则、文字语言</small></p></div>
            <button onClick={onPreflight}>重新检查</button>
          </div>
        </div>
      )}

      {tab === 'properties' && (
        <div className="inspector-scroll property-panel">
          {selectedNode ? (
            <>
              <div className="selection-summary"><span>{selectedNode.type === 'image' ? <ImagePlus size={17} /> : <TextCursorInput size={17} />}</span><p><small>当前选择</small><strong>{selectedNode.id === 'scene-background' ? '画板底图（已锁定）' : selectedNode.type === 'image' ? '图片图层' : '文字图层'}</strong></p></div>
              <div className="property-grid"><label>X<input type="number" disabled={selectedIsBackground} value={Math.round(selectedNode.x)} onChange={(event) => onUpdateSelected({ x: Number(event.target.value) })} /></label><label>Y<input type="number" disabled={selectedIsBackground} value={Math.round(selectedNode.y)} onChange={(event) => onUpdateSelected({ y: Number(event.target.value) })} /></label></div>
              {selectedNode.type === 'text' && <><label className="property-label">文字内容<textarea value={selectedNode.text} onChange={(event) => onUpdateSelected({ text: event.target.value } as Partial<CanvasNode>)} /></label><div className="property-grid"><label>字号<input type="number" value={selectedNode.fontSize} onChange={(event) => onUpdateSelected({ fontSize: Number(event.target.value) } as Partial<CanvasNode>)} /></label><label>颜色<input type="color" value={selectedNode.fill} onChange={(event) => onUpdateSelected({ fill: event.target.value } as Partial<CanvasNode>)} /></label></div></>}
              <div className="inspector-section layer-actions"><div className="section-heading"><span>对齐与层级</span></div><div><button className="row-action" disabled={selectedIsBackground} onClick={onCenterHorizontal}><AlignCenter size={15} />水平居中</button><button className="row-action" disabled={selectedIsBackground} onClick={onCenterVertical}><AlignCenter size={15} />垂直居中</button><button className="row-action" disabled={selectedIsBackground} onClick={onLayerUp}><Layers3 size={15} />上移一层</button><button className="row-action" disabled={selectedIsBackground} onClick={onLayerDown}><ArrowDownToLine size={15} />下移一层</button></div></div>
            </>
          ) : <div className="empty-inspector"><MousePointer2 size={28} /><strong>选择一个画布元素</strong><p>点击图片或文字即可编辑；方向键微移，按住 Shift 每次移动 10px。</p></div>}
        </div>
      )}

      {tab === 'history' && (
        <div className="inspector-scroll version-list">
          <div className="version-item current"><span>V{canvasVersion ?? 1}</span><p><strong>当前已保存画布</strong><small>每个图型独立保存 · 自动同步</small></p><em>当前</em></div>
          <p className="version-note">完整版本回溯尚未开启；当前只展示数据库中真实存在的最新版。</p>
        </div>
      )}

      <div className="generate-footer">
        <button className="generate-button" onClick={onGenerate} disabled={generating}>
          {generating ? <><span className="spinner" />正在加入队列</> : <><Sparkles size={18} />生成 4 个候选</>}
        </button>
        <small><kbd>⌘</kbd><kbd>↵</kbd> 入队 · 候选仅在本地暂存</small>
      </div>
    </aside>
  )
}

export function StudioPage() {
  const navigate = useNavigate()
  const selectedProduct = useAppStore((state) => state.selectedProduct)
  const selectedTask = useAppStore((state) => state.selectedTask)
  const selectedShot = useAppStore((state) => state.selectedShot)
  const setSelectedProduct = useAppStore((state) => state.setSelectedProduct)
  const setSelectedTask = useAppStore((state) => state.setSelectedTask)
  const setSelectedShot = useAppStore((state) => state.setSelectedShot)
  const jobs = useAppStore((state) => state.jobs)
  const activeRunId = useAppStore((state) => state.activeRunId)
  const addJob = useAppStore((state) => state.addJob)
  const updateJob = useAppStore((state) => state.updateJob)
  const setActiveRunId = useAppStore((state) => state.setActiveRunId)
  const notify = useAppStore((state) => state.notify)
  const apiOnline = useAppStore((state) => state.apiOnline)
  const demoMode = useAppStore((state) => state.demoMode)
  const workspace = useAppStore((state) => state.workspace)
  const canvasInsertRequest = useAppStore((state) => state.canvasInsertRequest)
  const consumeCanvasInsert = useAppStore((state) => state.consumeCanvasInsert)

  const [nodes, setNodes] = useState<CanvasNode[]>(() => initialNodes(selectedShot))
  const [past, setPast] = useState<CanvasNode[][]>([])
  const [future, setFuture] = useState<CanvasNode[][]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [tool, setTool] = useState<'select' | 'hand'>('select')
  const [spaceHand, setSpaceHand] = useState(false)
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 0, y: 0, zoom: 0.78, mode: 'fit' })
  const [prompt, setPromptState] = useState(defaultPrompt)
  const [generating, setGenerating] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const [canvasVersion, setCanvasVersion] = useState<number>()
  const [reloadToken, setReloadToken] = useState(0)
  const [canvasFocused, setCanvasFocused] = useState(false)
  const hydrating = useRef(true)
  const nodesRef = useRef(nodes)
  const promptRef = useRef(prompt)
  const viewportRef = useRef(viewport)
  const revisions = useRef(new Map<string, number>())
  const dirtyCanvases = useRef(new Set<string>())
  const loadFailedCanvases = useRef(new Set<string>())
  const insertInFlight = useRef<string | undefined>(undefined)
  const switchSequence = useRef(0)
  const canvasRef = useRef<StudioCanvasHandle>(null)
  const canvasId = canvasDocumentId(selectedProduct, selectedTask, selectedShot)
  const hydrationKey = `${canvasId}-${reloadToken}`
  const renderedHydrationKey = useRef(hydrationKey)
  if (renderedHydrationKey.current !== hydrationKey) {
    renderedHydrationKey.current = hydrationKey
    hydrating.current = true
  }
  const activeCanvasId = useRef(canvasId)
  const activeTool = spaceHand ? 'hand' : tool

  const markDirty = useCallback(() => {
    if (!hydrating.current && !loadFailedCanvases.current.has(activeCanvasId.current)) {
      const id = activeCanvasId.current
      revisions.current.set(id, (revisions.current.get(id) ?? 0) + 1)
      dirtyCanvases.current.add(id)
      writeCanvasCache(id, {
        nodes: nodesRef.current,
        prompt: promptRef.current,
        shot: selectedShot,
        task: selectedTask,
        viewport: viewportRef.current,
      }, true)
      setSaveState('dirty')
    }
  }, [selectedShot, selectedTask])

  const commitNodes = useCallback((next: CanvasNode[]) => {
    const previous = nodesRef.current
    nodesRef.current = next
    setPast((items) => [...items.slice(-19), previous])
    setNodes(next)
    setFuture([])
    markDirty()
  }, [markDirty])

  const setPrompt = (next: PromptDraft) => {
    promptRef.current = next
    setPromptState(next)
    markDirty()
  }

  const changeViewport = useCallback((next: CanvasViewport) => {
    viewportRef.current = next
    setViewport(next)
    markDirty()
  }, [markDirty])

  const persistCanvas = useCallback(async (
    id: string,
    snapshot: CanvasSnapshot,
    revision: number,
    updateActiveUi: boolean,
    withNotice = false,
  ): Promise<boolean> => {
    writeCanvasCache(id, snapshot, true)
    if (!apiOnline) {
      if (updateActiveUi && activeCanvasId.current === id) setSaveState('saved')
      if (withNotice) notify({ title: '画布已保存到当前会话', detail: '连接本地服务后会自动写入数据库', tone: 'neutral' })
      return true
    }
    if (updateActiveUi && activeCanvasId.current === id) setSaveState('saving')
    const previousSave = canvasSaveQueues.get(id) ?? Promise.resolve()
    const operation = previousSave
      .catch(() => undefined)
      .then(() => saveCanvas(id, snapshot))
    const queueTail = operation.then(() => undefined, () => undefined)
    canvasSaveQueues.set(id, queueTail)
    void queueTail.then(() => {
      if (canvasSaveQueues.get(id) === queueTail) canvasSaveQueues.delete(id)
    })
    try {
      const saved = await operation
      const stillCurrentRevision = (revisions.current.get(id) ?? 0) === revision
      if (stillCurrentRevision) {
        dirtyCanvases.current.delete(id)
        writeCanvasCache(id, snapshot, false)
      }
      if (updateActiveUi && activeCanvasId.current === id) {
        setSaveState(stillCurrentRevision ? 'saved' : 'dirty')
        if (typeof saved.version === 'number') setCanvasVersion(saved.version)
      }
      if (withNotice) notify({ title: '画布已保存', detail: `${snapshot.task} · ${snapshot.shot}`, tone: 'success' })
      return true
    } catch (error) {
      if (updateActiveUi && activeCanvasId.current === id) setSaveState('save-error')
      if (withNotice) notify({ title: '保存失败', detail: error instanceof Error ? error.message : '未知错误', tone: 'warning' })
      return false
    }
  }, [apiOnline, notify])

  const save = useCallback(async (withNotice = false): Promise<boolean> => {
    if (hydrating.current || saveState === 'load-error') return false
    const id = activeCanvasId.current
    const revision = revisions.current.get(id) ?? 0
    const snapshot: CanvasSnapshot = {
      nodes: nodesRef.current,
      prompt: promptRef.current,
      shot: selectedShot,
      task: selectedTask,
      viewport: viewportRef.current,
    }
    return persistCanvas(id, snapshot, revision, true, withNotice)
  }, [persistCanvas, saveState, selectedShot, selectedTask])

  useEffect(() => {
    let cancelled = false
    activeCanvasId.current = canvasId
    hydrating.current = true
    setSaveState('loading')
    setSelectedId(undefined)
    setPast([])
    setFuture([])
    const hydrate = async () => {
      const cached = readCanvasCache(canvasId)
      try {
        const stored = apiOnline ? await loadCanvas(canvasId) : undefined
        if (cancelled) return
        const source = cached?.pendingSync ? cached.snapshot : (stored ?? cached?.snapshot)
        const nextNodes = Array.isArray(source?.nodes) ? source.nodes as CanvasNode[] : initialNodes(selectedShot)
        const nextPrompt = source?.prompt && typeof source.prompt === 'object'
          ? { ...defaultPrompt, ...source.prompt as PromptDraft }
          : defaultPrompt
        const nextViewport = normalizeViewport(source?.viewport) ?? { x: 0, y: 0, zoom: 0.78, mode: 'fit' as const }
        nodesRef.current = nextNodes
        promptRef.current = nextPrompt
        viewportRef.current = nextViewport
        setNodes(nextNodes)
        setPromptState(nextPrompt)
        setViewport(nextViewport)
        setCanvasVersion(typeof stored?.version === 'number' ? stored.version : undefined)
        loadFailedCanvases.current.delete(canvasId)
        dirtyCanvases.current.delete(canvasId)
        revisions.current.set(canvasId, 0)
        const hasPendingLocalChanges = cached?.pendingSync === true
        const needsSync = apiOnline && (hasPendingLocalChanges || !stored)
        if (needsSync) {
          revisions.current.set(canvasId, 1)
          dirtyCanvases.current.add(canvasId)
          writeCanvasCache(canvasId, { nodes: nextNodes, prompt: nextPrompt, shot: selectedShot, task: selectedTask, viewport: nextViewport }, true)
          setSaveState('dirty')
        } else if (!apiOnline && hasPendingLocalChanges) {
          revisions.current.set(canvasId, 1)
          dirtyCanvases.current.add(canvasId)
          writeCanvasCache(canvasId, { nodes: nextNodes, prompt: nextPrompt, shot: selectedShot, task: selectedTask, viewport: nextViewport }, true)
          setSaveState('saved')
        } else {
          if (source) writeCanvasCache(canvasId, { nodes: nextNodes, prompt: nextPrompt, shot: selectedShot, task: selectedTask, viewport: nextViewport }, false)
          setSaveState('saved')
        }
      } catch (error) {
        if (!cancelled) {
          const fallback = cached?.snapshot
          const nextNodes = Array.isArray(fallback?.nodes) ? fallback.nodes : initialNodes(selectedShot)
          const nextPrompt = fallback?.prompt && typeof fallback.prompt === 'object' ? { ...defaultPrompt, ...fallback.prompt } : defaultPrompt
          const nextViewport = normalizeViewport(fallback?.viewport) ?? { x: 0, y: 0, zoom: 0.78, mode: 'fit' as const }
          nodesRef.current = nextNodes
          promptRef.current = nextPrompt
          viewportRef.current = nextViewport
          setNodes(nextNodes)
          setPromptState(nextPrompt)
          setViewport(nextViewport)
          setCanvasVersion(undefined)
          loadFailedCanvases.current.add(canvasId)
          dirtyCanvases.current.delete(canvasId)
          setSaveState('load-error')
          notify({ title: '画布加载失败', detail: error instanceof Error ? error.message : '请重新加载后再编辑', tone: 'warning' })
        }
      } finally {
        if (!cancelled) hydrating.current = false
      }
    }
    void hydrate()
    return () => {
      cancelled = true
      if (activeCanvasId.current !== canvasId || !dirtyCanvases.current.has(canvasId) || loadFailedCanvases.current.has(canvasId)) return
      const revision = revisions.current.get(canvasId) ?? 0
      const snapshot: CanvasSnapshot = {
        nodes: nodesRef.current,
        prompt: promptRef.current,
        shot: selectedShot,
        task: selectedTask,
        viewport: viewportRef.current,
      }
      writeCanvasCache(canvasId, snapshot, true)
      void persistCanvas(canvasId, snapshot, revision, false)
    }
  }, [apiOnline, canvasId, notify, persistCanvas, reloadToken, selectedShot, selectedTask])

  useEffect(() => {
    const cacheBeforeUnload = () => {
      const id = activeCanvasId.current
      if (!dirtyCanvases.current.has(id) || loadFailedCanvases.current.has(id)) return
      writeCanvasCache(id, {
        nodes: nodesRef.current,
        prompt: promptRef.current,
        shot: selectedShot,
        task: selectedTask,
        viewport: viewportRef.current,
      }, true)
    }
    window.addEventListener('beforeunload', cacheBeforeUnload)
    return () => window.removeEventListener('beforeunload', cacheBeforeUnload)
  }, [selectedShot, selectedTask])

  useEffect(() => {
    if (saveState !== 'dirty') return
    const timer = window.setTimeout(() => { void save(false) }, 850)
    return () => window.clearTimeout(timer)
  }, [save, saveState])

  const undo = useCallback(() => {
    const previous = past.at(-1)
    if (!previous) return
    const current = nodesRef.current
    setFuture((items) => [current, ...items])
    nodesRef.current = previous
    setNodes(previous)
    setPast((items) => items.slice(0, -1))
    markDirty()
  }, [markDirty, past])

  const redo = useCallback(() => {
    const next = future[0]
    if (!next) return
    setPast((items) => [...items, nodesRef.current])
    nodesRef.current = next
    setNodes(next)
    setFuture((items) => items.slice(1))
    markDirty()
  }, [future, markDirty])

  const addAsset = useCallback(async (asset: AssetItem, mode: 'background' | 'layer' = 'layer') => {
    const targetCanvasId = activeCanvasId.current
    const natural = await imageDimensions(asset.url)
    if (activeCanvasId.current !== targetCanvasId || hydrating.current || loadFailedCanvases.current.has(targetCanvasId)) return false
    const currentNodes = nodesRef.current
    if (mode === 'background') {
      const scale = Math.max(ARTBOARD.width / natural.width, ARTBOARD.height / natural.height)
      const width = natural.width * scale
      const height = natural.height * scale
      const background: CanvasNode = {
        id: 'scene-background',
        type: 'image',
        src: asset.url,
        x: ARTBOARD.x + (ARTBOARD.width - width) / 2,
        y: ARTBOARD.y + (ARTBOARD.height - height) / 2,
        width,
        height,
      }
      commitNodes([background, ...currentNodes.filter((node) => node.id !== 'scene-background')])
      setSelectedId(undefined)
    } else {
      const scale = Math.min(320 / natural.width, 320 / natural.height)
      const width = Math.max(24, natural.width * scale)
      const height = Math.max(24, natural.height * scale)
      const offset = (currentNodes.length % 4) * 20
      const node: CanvasNode = {
        id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'image',
        src: asset.url,
        x: ARTBOARD.x + (ARTBOARD.width - width) / 2 + offset,
        y: ARTBOARD.y + (ARTBOARD.height - height) / 2 + offset,
        width,
        height,
      }
      commitNodes([...currentNodes, node])
      setSelectedId(node.id)
    }
    notify({ title: mode === 'background' ? '已设为画板底图' : '素材已加入画布', detail: asset.name, tone: 'success' })
    return true
  }, [commitNodes, notify])

  useEffect(() => {
    const request = canvasInsertRequest
    if (!request || insertInFlight.current === request.requestId) return
    const targetsAnotherCanvas = request.productId !== selectedProduct || request.taskId !== selectedTask || request.shot !== selectedShot
    if (targetsAnotherCanvas) {
      insertInFlight.current = request.requestId
      const sequence = ++switchSequence.current
      void (async () => {
        const hasPendingChanges = dirtyCanvases.current.has(activeCanvasId.current) || saveState === 'save-error' || saveState === 'saving'
        if (hasPendingChanges && saveState !== 'load-error') {
          const saved = await save(false)
          if (!saved) {
            notify({ title: '未切换画布', detail: '当前画布保存失败，请重试后再送入候选图', tone: 'warning' })
            consumeCanvasInsert()
            return
          }
        }
        if (sequence !== switchSequence.current) return
        setSelectedProduct(request.productId)
        setSelectedTask(request.taskId)
        setSelectedShot(request.shot)
      })().finally(() => {
        if (insertInFlight.current === request.requestId) insertInFlight.current = undefined
      })
      return
    }
    if (hydrating.current) return
    insertInFlight.current = request.requestId
    void addAsset(request.asset, request.mode)
      .then((inserted) => {
        if (inserted) consumeCanvasInsert()
        else notify({ title: '候选尚未插入', detail: '目标画布在素材加载期间发生切换，请返回后重试。', tone: 'warning' })
      })
      .finally(() => {
        insertInFlight.current = undefined
      })
  }, [addAsset, canvasInsertRequest, consumeCanvasInsert, notify, save, saveState, selectedProduct, selectedShot, selectedTask, setSelectedProduct, setSelectedShot, setSelectedTask])

  const addText = () => {
    const node: CanvasNode = { id: `text-${Date.now()}`, type: 'text', text: '输入标题', x: 380, y: 680, width: 280, fontSize: 24, fontStyle: 'bold', fill: '#173f38' }
    commitNodes([...nodesRef.current, node])
    setSelectedId(node.id)
  }

  const deleteSelected = useCallback(() => {
    if (!selectedId || selectedId === 'scene-background') return
    commitNodes(nodesRef.current.filter((node) => node.id !== selectedId))
    setSelectedId(undefined)
  }, [commitNodes, selectedId])

  const duplicateSelected = useCallback(() => {
    const currentNodes = nodesRef.current
    const source = currentNodes.find((node) => node.id === selectedId)
    if (!source || source.id === 'scene-background') return
    const copy = { ...source, id: `${source.type}-${Date.now()}`, x: source.x + 24, y: source.y + 24 } as CanvasNode
    commitNodes([...currentNodes, copy])
    setSelectedId(copy.id)
  }, [commitNodes, selectedId])

  const updateSelected = (patch: Partial<CanvasNode>) => {
    if (!selectedId || selectedId === 'scene-background') return
    commitNodes(nodesRef.current.map((node) => node.id === selectedId ? ({ ...node, ...patch } as CanvasNode) : node))
  }

  const centerSelected = (axis: 'horizontal' | 'vertical') => {
    const node = nodesRef.current.find((item) => item.id === selectedId)
    if (!node || node.id === 'scene-background') return
    const lineCount = node.type === 'text' ? Math.max(1, node.text.split('\n').length) : 1
    const height = node.type === 'image' ? node.height : node.fontSize * 1.1 * lineCount
    updateSelected(axis === 'horizontal'
      ? { x: ARTBOARD.x + (ARTBOARD.width - node.width) / 2 }
      : { y: ARTBOARD.y + (ARTBOARD.height - height) / 2 })
  }

  const moveLayer = (direction: 'up' | 'down') => {
    if (!selectedId || selectedId === 'scene-background') return
    const currentNodes = nodesRef.current
    const index = currentNodes.findIndex((node) => node.id === selectedId)
    const target = direction === 'up' ? index + 1 : index - 1
    if (index < 0 || target < 1 || target >= currentNodes.length) return
    const next = [...currentNodes]
    ;[next[index], next[target]] = [next[target], next[index]]
    commitNodes(next)
  }

  const nudgeSelected = useCallback((dx: number, dy: number) => {
    const currentNodes = nodesRef.current
    const node = currentNodes.find((item) => item.id === selectedId)
    if (!node || node.id === 'scene-background') return
    commitNodes(currentNodes.map((item) => item.id === selectedId ? { ...item, x: item.x + dx, y: item.y + dy } : item))
  }, [commitNodes, selectedId])

  const generate = useCallback(async () => {
    if (generating) return
    if (hydrating.current || saveState === 'load-error') {
      notify({ title: '暂时无法生成', detail: '请先重新加载当前画布，避免使用未确认的内容', tone: 'warning' })
      return
    }
    setGenerating(true)
    if (apiOnline && !demoMode && workspace?.liveGenerationEnabled) {
      try {
        const run = await createGenerationRun({ product: selectedProduct, tasks: [selectedTask], shots: [selectedShot], variants: 4, concurrency: 1 })
        setActiveRunId(run.id)
        notify({ title: '已交给本地 Skill 执行', detail: `运行 ${run.id} · 4 个候选仅本地暂存`, tone: 'success' })
        navigate(`/queue?run=${encodeURIComponent(run.id)}`)
      } catch (error) {
        notify({ title: '无法启动本地生成', detail: error instanceof Error ? error.message : '请检查 Skill 与参考图门槛', tone: 'warning' })
      } finally {
        setGenerating(false)
      }
      return
    }
    if (apiOnline && !workspace?.liveGenerationEnabled) {
      notify({ title: '真实生成尚未开启', detail: '请在本地环境设置 MUSEFORGE_ENABLE_LIVE_GENERATION=true 后重启 API', tone: 'warning' })
      setGenerating(false)
      return
    }
    const id = `demo-${Date.now()}`
    addJob({ id, title: `${selectedTask} · ${shotOptions.find((shot) => shot.id === selectedShot)?.label} · 演示候选`, product: selectedProduct, shot: selectedShot, status: 'queued', progress: 0, createdAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) })
    notify({ title: '演示任务（未调用生图服务）', detail: '用于预览队列与审核交互', tone: 'neutral' })
    window.setTimeout(() => { updateJob(id, { status: 'running', progress: 68 }); setGenerating(false) }, 500)
    window.setTimeout(() => updateJob(id, { status: 'succeeded', progress: 100, thumbnail: outputByShot[selectedShot] }), 2200)
  }, [addJob, apiOnline, demoMode, generating, navigate, notify, saveState, selectedProduct, selectedShot, selectedTask, setActiveRunId, updateJob, workspace?.liveGenerationEnabled])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
      const interactive = Boolean(target.closest('button, a, [role="button"], [contenteditable="true"]'))
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void generate(); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(true); return }
      if (editing || interactive || !canvasFocused || hydrating.current || saveState === 'load-error') return
      if (event.code === 'Space') { event.preventDefault(); setSpaceHand(true); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); return }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); return }
      if (event.key === 'Escape') { setSelectedId(undefined); return }
      if (event.key === '0') { event.preventDefault(); canvasRef.current?.fitArtboard(); return }
      if (event.key === '1') { event.preventDefault(); canvasRef.current?.zoomTo(1); return }
      const step = event.shiftKey ? 10 : 1
      if (event.key === 'ArrowLeft') { event.preventDefault(); nudgeSelected(-step, 0) }
      if (event.key === 'ArrowRight') { event.preventDefault(); nudgeSelected(step, 0) }
      if (event.key === 'ArrowUp') { event.preventDefault(); nudgeSelected(0, -step) }
      if (event.key === 'ArrowDown') { event.preventDefault(); nudgeSelected(0, step) }
      if (event.key.toLowerCase() === 'v') setTool('select')
      if (event.key.toLowerCase() === 'h') setTool('hand')
    }
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') setSpaceHand(false) }
    const onBlur = () => setSpaceHand(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [canvasFocused, deleteSelected, duplicateSelected, generate, nudgeSelected, redo, save, saveState, undo])

  const preflight = async () => {
    if (!apiOnline || demoMode) {
      notify({ title: '演示预检通过', detail: '未调用 Skill；连接本地 API 后可执行真实门槛检查', tone: 'neutral' })
      return
    }
    try {
      await previewWorkflow(selectedProduct, selectedShot, selectedTask)
      notify({ title: 'Skill 预检通过', detail: '参考图与 Prompt 结构有效', tone: 'success' })
    } catch (error) {
      notify({ title: '预检发现阻塞项', detail: error instanceof Error ? error.message : '请检查参考图清单', tone: 'warning' })
    }
  }

  const exportCanvas = () => {
    try {
      if (saveState === 'load-error' || hydrating.current) throw new Error('画布尚未可靠载入，请重新加载后再导出')
      const dataUrl = canvasRef.current?.exportPng(1024)
      if (!dataUrl) throw new Error('画板尚未准备完成')
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = `${selectedProduct}-${selectedTask}-${selectedShot}-1024.png`
      link.click()
      notify({ title: '画板已导出', detail: '1024 × 1024 PNG，不含安全线与操作框', tone: 'success' })
    } catch (error) {
      notify({ title: '暂时无法导出', detail: error instanceof Error ? error.message : '请稍后重试', tone: 'warning' })
    }
  }

  const switchShot = async (shot: ShotType) => {
    if (shot === selectedShot) return
    const sequence = ++switchSequence.current
    const hasPendingChanges = dirtyCanvases.current.has(activeCanvasId.current) || saveState === 'save-error' || saveState === 'saving'
    if (hasPendingChanges && saveState !== 'load-error') {
      const saved = await save(false)
      if (sequence !== switchSequence.current) return
      if (!saved) {
        notify({ title: '未切换图型', detail: '当前画布保存失败，请重试后再切换', tone: 'warning' })
        return
      }
    }
    if (sequence !== switchSequence.current) return
    setSelectedShot(shot)
  }

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedId), [nodes, selectedId])
  const saveLabel = saveState === 'loading'
    ? '正在加载画布'
    : saveState === 'dirty'
      ? '有未保存更改'
      : saveState === 'saving'
        ? '保存中…'
        : saveState === 'load-error'
          ? '加载失败'
          : saveState === 'save-error'
            ? '保存失败'
            : apiOnline ? '已自动保存' : '当前会话已保存'

  return (
    <div className="studio-page">
      <div className="studio-subbar">
        <div className="shot-switcher">
          {shotOptions.map((shot) => <button key={shot.id} className={selectedShot === shot.id ? 'active' : ''} onClick={() => { void switchShot(shot.id) }}><span>{shot.label}</span><small>{shot.short}</small></button>)}
        </div>
        <div className="studio-status"><span className={`autosave ${saveState}`}><i />{saveLabel}</span><button className="button ghost" disabled={saveState === 'loading' || saveState === 'load-error'} onClick={exportCanvas}><Download size={15} />导出 1024</button><button className="button dark" disabled={generating || saveState === 'loading' || saveState === 'load-error'} onClick={() => { void generate() }}><Zap size={15} />生成候选</button></div>
      </div>
      <div className="studio-workspace" onPointerDownCapture={(event) => setCanvasFocused(Boolean((event.target as HTMLElement).closest('.canvas-column')))}>
        {(saveState === 'loading' || saveState === 'load-error') && (
          <div className="canvas-load-blocker" role={saveState === 'load-error' ? 'alert' : 'status'}>
            <div>
              <CircleAlert size={26} />
              <strong>{saveState === 'load-error' ? '当前画布未能可靠载入' : '正在载入画布'}</strong>
              <p>{saveState === 'load-error' ? '已暂停编辑、生成和自动保存，避免默认内容覆盖原稿。' : '正在恢复节点、Prompt 与视图位置，请稍候。'}</p>
              {saveState === 'load-error' && <button className="button dark" onClick={() => setReloadToken((value) => value + 1)}>重新加载</button>}
            </div>
          </div>
        )}
        <AssetPanel onAdd={(asset) => { void addAsset(asset) }} />
        <section className="canvas-column">
          <div className="floating-toolbar">
            <button className={activeTool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="选择工具 (V)"><MousePointer2 size={17} /></button>
            <button className={activeTool === 'hand' ? 'active' : ''} onClick={() => setTool('hand')} title="抓手工具 (H / Space)"><Hand size={17} /></button>
            <span />
            <button onClick={addText} title="添加文字"><TextCursorInput size={17} /></button>
            <button onClick={() => { void addAsset(demoAssets[0]) }} title="添加图片"><ImagePlus size={17} /></button>
            <span />
            <button onClick={undo} disabled={!past.length} title="撤销"><Undo2 size={17} /></button>
            <button onClick={redo} disabled={!future.length} title="重做"><Redo2 size={17} /></button>
            <button onClick={duplicateSelected} disabled={!selectedId || selectedId === 'scene-background'} title="复制"><Copy size={17} /></button>
            <button onClick={deleteSelected} disabled={!selectedId || selectedId === 'scene-background'} title="删除"><Trash2 size={17} /></button>
          </div>
          {saveState !== 'loading' && <StudioCanvas key={hydrationKey} ref={canvasRef} nodes={nodes} onNodesChange={commitNodes} selectedId={selectedId} onSelect={setSelectedId} tool={activeTool} viewport={viewport} onViewportChange={changeViewport} artboardLabel={`${selectedTask} · ${shotOptions.find((shot) => shot.id === selectedShot)?.label ?? ''}`} />}
          <div className="zoom-control"><button onClick={() => canvasRef.current?.zoomTo(viewport.zoom - 0.1)}><Minus size={14} /></button><input type="range" min="35" max="150" value={Math.round(viewport.zoom * 100)} onChange={(event) => canvasRef.current?.zoomTo(Number(event.target.value) / 100)} /><span>{Math.round(viewport.zoom * 100)}%</span><button onClick={() => canvasRef.current?.zoomTo(viewport.zoom + 0.1)}><Plus size={14} /></button><button onClick={() => canvasRef.current?.fitArtboard()} title="适应画板 (0)"><Maximize2 size={14} /></button></div>
          <div className="canvas-hint"><Grip size={13} />滚轮缩放 · Space 抓手 · 0 适应 · 方向键微移 · ⌘D 复制</div>
          <button className="queue-peek" onClick={() => navigate(activeRunId ? `/queue?run=${encodeURIComponent(activeRunId)}` : '/queue')}><span><i />{activeRunId ? `真实运行 ${activeRunId.slice(0, 8)} 已接入队列` : demoMode && jobs.filter((job) => job.status === 'running').length ? `${jobs.filter((job) => job.status === 'running').length} 个演示任务生成中` : '本地候选暂存已启用'}</span><strong>查看运行队列 <ChevronDown size={14} /></strong></button>
        </section>
        <Inspector prompt={prompt} setPrompt={setPrompt} selectedNode={selectedNode} onUpdateSelected={updateSelected} onGenerate={() => { void generate() }} onPreflight={() => { void preflight() }} onCenterHorizontal={() => centerSelected('horizontal')} onCenterVertical={() => centerSelected('vertical')} onLayerUp={() => moveLayer('up')} onLayerDown={() => moveLayer('down')} generating={generating} canvasVersion={canvasVersion} />
      </div>
      <div className="studio-warning"><ScanSearch size={14} /><span>场景图物理交互：独立摆放 · 完整底座接触平面 · 重心竖直稳定</span><button><CircleAlert size={13} />查看计划</button><X size={13} /></div>
    </div>
  )
}
