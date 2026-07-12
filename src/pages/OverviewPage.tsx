import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileStack,
  FolderPlus,
  Images,
  MoreHorizontal,
  Play,
  Plus,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { demoWorkspace } from '../lib/demo'
import { useAppStore } from '../store/appStore'

const statusMeta = {
  ready: { label: '可生成', icon: Check },
  stale: { label: '需刷新', icon: Clock3 },
  blocked: { label: '资料阻塞', icon: CircleAlert },
  draft: { label: '草稿', icon: Clock3 },
}

export function OverviewPage() {
  const workspace = useAppStore((state) => state.workspace) ?? demoWorkspace

  return (
    <div className="overview-page">
      <section className="welcome-row">
        <div>
          <p>7 月 12 日，星期日</p>
          <h2>把创意变成一套可交付的图。</h2>
          <span>{workspace.stats.pendingReview} 张图片等待审核，2 个任务正在生成。</span>
        </div>
        <div className="welcome-actions">
          <button className="button secondary"><FolderPlus size={17} />导入已有目录</button>
          <Link className="button primary" to="/studio"><Plus size={17} />新建创作</Link>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card featured">
          <div className="metric-icon"><WandSparkles size={20} /></div>
          <div><small>今日生成</small><strong>42</strong><span>张候选图</span></div>
          <em>+18%</em>
          <div className="mini-bars" aria-hidden="true">{[32, 48, 39, 66, 52, 78, 92].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
        </article>
        <article className="metric-card">
          <div className="metric-icon mint"><Images size={20} /></div>
          <div><small>待审核</small><strong>{workspace.stats.pendingReview}</strong><span>张图片</span></div>
          <Link to="/review">开始审核 <ArrowRight size={14} /></Link>
        </article>
        <article className="metric-card">
          <div className="metric-icon sand"><FileStack size={20} /></div>
          <div><small>活跃任务</small><strong>{workspace.stats.tasks}</strong><span>组任务</span></div>
          <Link to="/matrix">查看矩阵 <ArrowRight size={14} /></Link>
        </article>
        <article className="metric-card">
          <div className="metric-icon coral"><Sparkles size={20} /></div>
          <div><small>一次通过率</small><strong>86<sup>%</sup></strong><span>近 30 天</span></div>
          <span className="positive">质量稳定</span>
        </article>
      </section>

      <section className="overview-columns">
        <div className="panel recent-projects">
          <div className="panel-heading">
            <div><small>继续工作</small><h3>最近项目</h3></div>
            <button className="text-button">查看全部 <ChevronRight size={15} /></button>
          </div>
          <div className="project-list">
            {workspace.products.slice(0, 3).map((project, index) => {
              const meta = statusMeta[project.readiness]
              const StatusIcon = meta.icon
              const completion = Math.min(100, Math.round((project.outputCount / Math.max(project.promptCount, 1)) * 100))
              return (
                <article className="project-row" key={project.id}>
                  <Link to={index === 0 ? '/studio' : '/matrix'} className="project-thumb">
                    <img src={project.thumbnail ?? `/demo/${index === 1 ? 'interior' : 'product-studio'}.png`} alt="" />
                    {index === 0 && <span><Play size={14} fill="currentColor" /></span>}
                  </Link>
                  <div className="project-copy">
                    <div className="project-title"><strong>{project.name}</strong><span className={`readiness ${project.readiness}`}><StatusIcon size={12} />{meta.label}</span></div>
                    <small>{project.taskCount} 个任务 · {project.outputCount} 张输出 · {project.updatedAt ?? '最近更新'}</small>
                    <div className="project-progress"><span><i style={{ width: `${completion}%` }} /></span><em>{completion}%</em></div>
                  </div>
                  <button className="icon-button small" aria-label="更多"><MoreHorizontal size={17} /></button>
                </article>
              )
            })}
          </div>
        </div>

        <div className="panel production-pulse">
          <div className="panel-heading">
            <div><small>生产脉搏</small><h3>当前流水线</h3></div>
            <span className="live-label"><i /> LIVE</span>
          </div>
          <div className="pulse-feature">
            <img src="/demo/product-studio.png" alt="当前生成中的商品图" />
            <div className="pulse-gradient" />
            <div className="pulse-copy">
              <span>正在生成 · 68%</span>
              <strong>自然晨光场景</strong>
              <small>MF-DEMO-001 · 候选 2 / 4</small>
              <div className="pulse-progress"><i /></div>
            </div>
          </div>
          <div className="pipeline-steps">
            <div className="done"><span><Check size={13} /></span><p><strong>事实校验</strong><small>10:21 完成</small></p></div>
            <i />
            <div className="done"><span><Check size={13} /></span><p><strong>Prompt 策划</strong><small>10:24 完成</small></p></div>
            <i />
            <div className="active"><span>3</span><p><strong>候选生成</strong><small>2 张处理中</small></p></div>
            <i />
            <div><span>4</span><p><strong>人工审核</strong><small>等待开始</small></p></div>
          </div>
          <Link to="/queue" className="full-link">打开生成队列 <ArrowRight size={15} /></Link>
        </div>
      </section>

      <section className="quick-start panel">
        <div><small>快速开始</small><h3>选择一条生产路径</h3></div>
        <Link to="/matrix" className="quick-card"><span className="quick-icon product"><Images size={20} /></span><p><strong>商品图工作流</strong><small>五类镜头、配件组合、规则校验</small></p><ChevronRight size={18} /></Link>
        <Link to="/studio" className="quick-card"><span className="quick-icon canvas"><Sparkles size={20} /></span><p><strong>自由画布</strong><small>参考图、构图、变体自由编排</small></p><ChevronRight size={18} /></Link>
        <button className="quick-card"><span className="quick-icon import"><FolderPlus size={20} /></span><p><strong>导入既有任务</strong><small>扫描现有目录并继续生产</small></p><ChevronRight size={18} /></button>
      </section>
    </div>
  )
}
