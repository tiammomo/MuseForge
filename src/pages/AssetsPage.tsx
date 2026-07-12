import { useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronRight,
  FileImage,
  FileText,
  Fingerprint,
  FolderOpen,
  ImagePlus,
  Link2,
  LockKeyhole,
  MoreHorizontal,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { demoAssets } from '../lib/demo'
import { useAppStore } from '../store/appStore'

const facts = [
  { field: '商品身份', value: 'MF-DEMO-001 · 夏日补水喷雾', source: '商品说明.md', confidence: '已确认' },
  { field: '外形结构', value: '透明圆柱瓶身，深绿色圆角泵头', source: '主商品.png', confidence: '已确认' },
  { field: '包装数量', value: '单件', source: '商品说明.md', confidence: '已确认' },
  { field: '使用机制', value: '独立站立；完整底座接触水平平面', source: '主商品.png', confidence: '已确认' },
  { field: '准确尺寸', value: '未提供，不生成数字尺寸', source: '—', confidence: '缺失' },
  { field: '适用场景', value: '中性商业 / 明亮家居护理场景', source: '商品说明.md', confidence: '已确认' },
]

export function AssetsPage() {
  const [tab, setTab] = useState<'assets' | 'facts' | 'references'>('references')
  const [selected, setSelected] = useState<Set<string>>(new Set(['cutout']))
  const notify = useAppStore((state) => state.notify)

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div className="assets-page page-pad">
      <section className="asset-context-bar">
        <div><span className="product-avatar"><img src="/demo/product-cutout.png" alt="" /></span><p><small>商品工作区</small><strong>MF-DEMO-001 · 夏日补水喷雾</strong></p><ChevronRight size={16} /><button>单品任务 <ChevronRight size={14} /></button></div>
        <span className="fingerprint"><Fingerprint size={14} />源资料指纹有效 · 刚刚校验</span>
      </section>

      <div className="wide-tabs">
        <button className={tab === 'assets' ? 'active' : ''} onClick={() => setTab('assets')}><FolderOpen size={16} />源素材 <em>5</em></button>
        <button className={tab === 'facts' ? 'active' : ''} onClick={() => setTab('facts')}><FileText size={16} />商品事实 <em>8</em></button>
        <button className={tab === 'references' ? 'active' : ''} onClick={() => setTab('references')}><ScanSearch size={16} />参考图筛选 <em>2 / 5</em></button>
      </div>

      {tab === 'references' && (
        <div className="reference-layout">
          <section className="panel candidate-panel">
            <div className="panel-heading"><div><small>视觉审查</small><h3>候选素材</h3></div><button className="button secondary"><ImagePlus size={15} />添加素材</button></div>
            <div className="curation-help"><ShieldCheck size={17} /><p><strong>参考图只锁定商品身份</strong><span>请选择能确认完整外形、关键结构和正确使用关系的图片。单品最多 5 张主商品图。</span></p></div>
            <div className="candidate-grid">
              {demoAssets.slice(0, 6).map((asset, index) => {
                const isSelected = selected.has(asset.id)
                const excluded = index === 4 || index === 5
                return (
                  <article key={asset.id} className={`candidate-card ${isSelected ? 'selected' : ''} ${excluded ? 'excluded' : ''}`}>
                    <button className="candidate-image" onClick={() => !excluded && toggle(asset.id)}>
                      <img src={asset.url} alt={asset.name} />
                      <span className="candidate-check">{isSelected && <Check size={14} />}{excluded && <X size={14} />}</span>
                      <em>{asset.dimensions}</em>
                    </button>
                    <div><strong>{asset.name}</strong><small>{excluded ? (index === 4 ? '排除 · 场景不相关' : '排除 · 人像类素材') : isSelected ? '已选择 · 商品身份' : '待审查'}</small></div>
                    <button className="icon-button small"><MoreHorizontal size={15} /></button>
                  </article>
                )
              })}
            </div>
          </section>

          <aside className="panel manifest-panel">
            <div className="panel-heading"><div><small>任务局部清单</small><h3>参考图集合</h3></div><span className="count-pill">{selected.size} / 5</span></div>
            <div className="manifest-task"><span>用于任务</span><button>单品 · 全部五类图 <ChevronRight size={14} /></button></div>
            <div className="manifest-list">
              {demoAssets.filter((asset) => selected.has(asset.id)).map((asset, index) => (
                <div key={asset.id}><img src={asset.url} alt="" /><p><strong>主商品-{String(index + 1).padStart(2, '0')}.png</strong><small>{index === 0 ? '身份 · 结构 · 场景' : '身份 · 质感 · 主图'}</small></p><button onClick={() => toggle(asset.id)}><X size={14} /></button></div>
              ))}
            </div>
            <div className="role-limit"><div><span>主商品</span><strong>{selected.size} / 5</strong></div><div className="limit-track"><i style={{ width: `${selected.size * 20}%` }} /></div><small>组合任务限制为 3 张主商品 + 2 张配件</small></div>
            <div className="manifest-preview"><div><FileText size={15} /><span><strong>reference_manifest.json</strong><small>将记录角色、来源、用途与限制</small></span></div><button>预览</button></div>
            <div className="manifest-checks"><p><Check size={13} />商品身份清晰且一致</p><p><Check size={13} />包含完整商品全貌</p><p><Check size={13} />未发现品牌、认证或敏感文字</p><p className="warning"><AlertCircle size={13} />尚缺少可信尺寸证据</p></div>
            <button className="button dark full" onClick={() => notify({ title: '参考图集合已发布', detail: `${selected.size} 张图片与 manifest 已固化到任务目录`, tone: 'success' })}><Sparkles size={16} />发布参考图集合</button>
            <small className="publish-note"><LockKeyhole size={11} />发布会创建新版本，不覆盖旧的生成记录</small>
          </aside>
        </div>
      )}

      {tab === 'facts' && (
        <section className="panel facts-panel">
          <div className="panel-heading"><div><small>证据层 · 只读</small><h3>已确认商品事实</h3></div><button className="button secondary"><Link2 size={15} />查看来源目录</button></div>
          <div className="facts-table"><div className="facts-head"><span>字段</span><span>确认值</span><span>证据来源</span><span>状态</span></div>{facts.map((fact) => <div className="fact-row" key={fact.field}><strong>{fact.field}</strong><p>{fact.value}</p><button><FileText size={13} />{fact.source}</button><span className={fact.confidence === '缺失' ? 'missing' : ''}>{fact.confidence === '缺失' ? <AlertCircle size={12} /> : <Check size={12} />}{fact.confidence}</span></div>)}</div>
          <div className="truth-note"><LockKeyhole size={17} /><p><strong>事实优先于创意</strong><span>冲突或缺失字段不会被常识补全。若要更正，请更新源资料并重新生成指纹。</span></p></div>
        </section>
      )}

      {tab === 'assets' && (
        <section className="panel source-assets-panel">
          <div className="panel-heading"><div><small>workspace / 原始商品图 / MF-DEMO-001</small><h3>源素材与文档</h3></div><button className="button secondary"><ImagePlus size={15} />导入文件</button></div>
          <div className="source-file-grid">{demoAssets.slice(0, 4).map((asset) => <article key={asset.id}><img src={asset.url} alt={asset.name} /><div><FileImage size={15} /><p><strong>{asset.name}</strong><small>{asset.dimensions} · PNG</small></p><MoreHorizontal size={16} /></div></article>)}<article className="document-card"><div className="document-icon"><FileText size={28} /></div><div><FileText size={15} /><p><strong>商品说明.md</strong><small>1.8 KB · UTF-8</small></p><MoreHorizontal size={16} /></div></article></div>
        </section>
      )}
    </div>
  )
}
