import { Check, ChevronRight, Cpu, Database, FolderCog, KeyRound, PlugZap, ShieldCheck, Sparkles, TerminalSquare } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export function SettingsPage() {
  const workspace = useAppStore((state) => state.workspace)
  const apiOnline = useAppStore((state) => state.apiOnline)
  const liveGenerationEnabled = workspace?.liveGenerationEnabled === true

  return (
    <div className="settings-page page-pad">
      <div className="settings-nav panel">
        <button className="active"><PlugZap size={16} />运行状态<ChevronRight size={14} /></button>
        <button disabled><FolderCog size={16} />工作区管理<small>规划中</small></button>
        <button disabled><ShieldCheck size={16} />规则与合规<small>规划中</small></button>
        <button disabled><Database size={16} />数据与备份<small>规划中</small></button>
        <button disabled><TerminalSquare size={16} />开发者选项<small>规划中</small></button>
      </div>
      <div className="settings-main">
        <section className="panel settings-section">
          <div className="settings-heading"><div><small>服务端配置</small><h3>模型与执行服务</h3><p>密钥、模型、尺寸与质量由本地 `.env` 和 Skill 读取，不写入浏览器或画布文档。</p></div><span className={`service-state ${apiOnline ? 'online' : ''}`}><i />{apiOnline ? 'API 正常' : 'API 未连接'}</span></div>
          <div className="provider-card active"><span className="provider-icon cloud"><Sparkles size={20} /></span><div><strong>Image2 兼容 Provider</strong><small>实际模型与质量会记录在每张候选结果中</small></div><span className="provider-status neutral">服务端管理</span></div>
          <div className="provider-card"><span className="provider-icon local"><Cpu size={20} /></span><div><strong>其他本地 Provider</strong><small>当前没有可由网页检测的连接器</small></div><span className="provider-status neutral">未检测</span></div>
        </section>
        <section className="panel settings-section">
          <div className="settings-heading"><div><small>费用安全</small><h3>真实生成门控</h3><p>网页只读取服务端状态，不能在浏览器里绕过费用开关。</p></div></div>
          <div className="live-switch-row"><span className="shield-icon"><KeyRound size={19} /></span><div><strong>{liveGenerationEnabled ? '真实图片生成已开放' : '真实图片生成已关闭'}</strong><small>通过 `MUSEFORGE_ENABLE_LIVE_GENERATION=true` 配置并重启 API 后生效。</small></div><button className={`toggle ${liveGenerationEnabled ? 'on' : ''}`} disabled aria-label="真实生成状态（只读）" aria-pressed={liveGenerationEnabled}><i /></button></div>
          <div className="safety-note"><ShieldCheck size={16} /><p><strong>服务端单一事实源</strong><span>Prepare 和 Preview 不调用图片 API；只有已开启门控的 Generation Run 才能执行真实生图。</span></p></div>
        </section>
        <section className="panel settings-section">
          <div className="settings-heading"><div><small>目录协议</small><h3>当前商品工作区</h3></div><span className="provider-status neutral">只读</span></div>
          <div className="path-field"><FolderCog size={17} /><span>{workspace?.root ?? '尚未连接'}</span></div>
          <div className="folder-contract"><p><span>原始商品图/</span><Check size={13} /></p><p><span>配件超市/</span><Check size={13} /></p><p><span>组合/</span><Check size={13} /></p></div>
        </section>
      </div>
    </div>
  )
}
