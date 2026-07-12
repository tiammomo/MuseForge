import { useEffect, type ReactNode } from 'react'
import {
  Blocks,
  Box,
  ChevronDown,
  CircleHelp,
  Command,
  FolderKanban,
  GalleryHorizontalEnd,
  ImageIcon,
  LayoutDashboard,
  ListTodo,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { checkHealth, loadWorkspace } from '../lib/api'
import { useAppStore } from '../store/appStore'

const nav = [
  { to: '/', icon: LayoutDashboard, label: '项目概览' },
  { to: '/studio', icon: Sparkles, label: '创作画布' },
  { to: '/matrix', icon: Blocks, label: '任务矩阵' },
  { to: '/assets', icon: ImageIcon, label: '素材与事实' },
  { to: '/queue', icon: ListTodo, label: '生成队列' },
  { to: '/review', icon: GalleryHorizontalEnd, label: '审核与交付' },
]

const titles: Record<string, { eyebrow: string; title: string }> = {
  '/': { eyebrow: '工作空间', title: '今天，从一个好画面开始' },
  '/studio': { eyebrow: '创作画布', title: '单张精修工作台' },
  '/matrix': { eyebrow: '商品图流水线', title: '任务矩阵' },
  '/assets': { eyebrow: '证据与边界', title: '素材与商品事实' },
  '/queue': { eyebrow: '全局运行', title: '生成队列' },
  '/review': { eyebrow: '质量门禁', title: '审核与交付' },
  '/settings': { eyebrow: '本地工作站', title: '连接与规则设置' },
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><span /><span /><span /></div>
        <div>
          <strong>MuseForge</strong>
          <small>AI IMAGE STATION</small>
        </div>
      </div>

      <button className="workspace-switcher">
        <span className="workspace-icon"><Box size={16} /></span>
        <span><small>当前工作区</small><strong>商品图实验室</strong></span>
        <ChevronDown size={15} />
      </button>

      <nav className="main-nav" aria-label="主导航">
        <p>生产</p>
        {nav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}>
            <item.icon size={18} strokeWidth={1.8} />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <p className="nav-section">系统</p>
        <NavLink to="/settings">
          <Settings size={18} strokeWidth={1.8} />
          <span>连接与设置</span>
        </NavLink>
      </nav>

      <div className="sidebar-bottom">
        <div className="storage-card">
          <div className="storage-heading"><span>本地存储</span><strong>27.4 GB</strong></div>
          <div className="storage-track"><span /></div>
          <small>已用 27.4 GB / 120 GB</small>
        </div>
        <button className="profile-button">
          <span className="avatar">MF</span>
          <span><strong>创意工作组</strong><small>本地管理员</small></span>
          <SlidersHorizontal size={15} />
        </button>
      </div>
    </aside>
  )
}

function Topbar() {
  const location = useLocation()
  const selectedProduct = useAppStore((state) => state.selectedProduct)
  const selectedTask = useAppStore((state) => state.selectedTask)
  const selectedShot = useAppStore((state) => state.selectedShot)
  const workspace = useAppStore((state) => state.workspace)
  const defaultMeta = titles[location.pathname] ?? titles['/']
  const selectedProductName = workspace?.products.find((product) => product.id === selectedProduct)?.name ?? selectedProduct
  const shotName = ({ main: '主图', size: '尺寸图', 'lifestyle-scene': '场景图', detail: '细节图', comparison: '对比图' })[selectedShot]
  const meta = location.pathname === '/studio'
    ? { eyebrow: selectedProduct, title: `${selectedProductName} · ${selectedTask} · ${shotName}` }
    : defaultMeta
  const apiOnline = useAppStore((state) => state.apiOnline)
  const demoMode = useAppStore((state) => state.demoMode)

  return (
    <header className="topbar">
      <div className="page-title">
        <small>{meta.eyebrow}</small>
        <h1>{meta.title}</h1>
      </div>
      <div className="topbar-actions">
        <button className="search-button"><Search size={16} /><span>搜索项目、SKU 或任务</span><kbd>⌘ K</kbd></button>
        <span className={`connection-pill ${apiOnline ? 'online' : ''}`}><i />{demoMode ? '演示数据' : apiOnline ? '本地服务正常' : '离线'}</span>
        <button className="icon-button" aria-label="命令"><Command size={18} /></button>
        <button className="icon-button" aria-label="帮助"><CircleHelp size={18} /></button>
      </div>
    </header>
  )
}

function ToastStack() {
  const toasts = useAppStore((state) => state.toasts)
  const remove = useAppStore((state) => state.removeToast)
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <button key={toast.id} className={`toast ${toast.tone ?? 'neutral'}`} onClick={() => remove(toast.id)}>
          <span className="toast-dot" />
          <span><strong>{toast.title}</strong>{toast.detail && <small>{toast.detail}</small>}</span>
        </button>
      ))}
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const setWorkspace = useAppStore((state) => state.setWorkspace)
  const setApiOnline = useAppStore((state) => state.setApiOnline)

  useEffect(() => {
    Promise.all([loadWorkspace(), checkHealth()]).then(([workspace, online]) => {
      setWorkspace(workspace.data, workspace.demo)
      setApiOnline(online)
    })
  }, [setApiOnline, setWorkspace])

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-column">
        <Topbar />
        <main className="page-content">{children}</main>
      </div>
      <ToastStack />
    </div>
  )
}
