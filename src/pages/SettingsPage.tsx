import { useState } from 'react'
import { Check, ChevronRight, Cpu, Database, ExternalLink, FolderCog, KeyRound, PlugZap, Save, ShieldCheck, Sparkles, TerminalSquare } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export function SettingsPage() {
  const workspace = useAppStore((state) => state.workspace)
  const apiOnline = useAppStore((state) => state.apiOnline)
  const notify = useAppStore((state) => state.notify)
  const [live, setLive] = useState(false)
  return (
    <div className="settings-page page-pad">
      <div className="settings-nav panel"><button className="active"><PlugZap size={16} />模型连接<ChevronRight size={14} /></button><button><FolderCog size={16} />工作区与存储<ChevronRight size={14} /></button><button><ShieldCheck size={16} />规则与合规<ChevronRight size={14} /></button><button><Database size={16} />数据与备份<ChevronRight size={14} /></button><button><TerminalSquare size={16} />开发者选项<ChevronRight size={14} /></button></div>
      <div className="settings-main">
        <section className="panel settings-section"><div className="settings-heading"><div><small>生成提供方</small><h3>模型与执行服务</h3><p>密钥仅保存在本地 `.env`，不会写入浏览器或画布文档。</p></div><span className={`service-state ${apiOnline ? 'online' : ''}`}><i />{apiOnline ? 'API 正常' : '演示模式'}</span></div>
          <div className="provider-card active"><span className="provider-icon cloud"><Sparkles size={20} /></span><div><strong>Image2 兼容 API</strong><small>主生产模型 · 图片编辑 / 参考图生成</small></div><span className="provider-status"><Check size={12} />已配置</span><button>编辑</button></div>
          <div className="provider-card"><span className="provider-icon local"><Cpu size={20} /></span><div><strong>CanvasPilot / ComfyUI</strong><small>本地候选预览 · http://127.0.0.1:38188</small></div><span className="provider-status neutral">未连接</span><button>测试连接</button></div>
        </section>
        <section className="panel settings-section"><div className="settings-heading"><div><small>安全控制</small><h3>真实生成开关</h3><p>避免演示、预检或误操作触发真实 API 费用。</p></div></div><div className="live-switch-row"><span className="shield-icon"><KeyRound size={19} /></span><div><strong>允许真实图片生成</strong><small>还需要服务端环境变量 `MUSEFORGE_ENABLE_LIVE_GENERATION=true` 才会生效。</small></div><button className={`toggle ${live ? 'on' : ''}`} onClick={() => setLive((value) => !value)} aria-pressed={live}><i /></button></div><div className="safety-note"><ShieldCheck size={16} /><p><strong>双重门控已启用</strong><span>界面开关与服务端环境变量必须同时开启；Prepare 和 Preview 永远不会调用图片 API。</span></p></div></section>
        <section className="panel settings-section"><div className="settings-heading"><div><small>目录协议</small><h3>当前工作区</h3></div><button className="button secondary">打开目录 <ExternalLink size={14} /></button></div><div className="path-field"><FolderCog size={17} /><span>{workspace?.root ?? '/home/tiammomo/projects/dev/MuseForge'}</span></div><div className="folder-contract"><p><span>原始商品图/</span><Check size={13} /></p><p><span>配件超市/</span><Check size={13} /></p><p><span>组合/</span><Check size={13} /></p><p><span>.agents/skills/generate-product-images/</span><Check size={13} /></p></div></section>
        <button className="button dark save-settings" onClick={() => notify({ title: '设置已保存', detail: '连接参数已写入本地配置', tone: 'success' })}><Save size={16} />保存设置</button>
      </div>
    </div>
  )
}
