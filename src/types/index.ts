export type ShotType = 'main' | 'size' | 'lifestyle-scene' | 'detail' | 'comparison'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type GenerationRunStatus = 'queued' | 'running' | 'completed' | 'succeeded' | 'failed' | 'cancelled'

export type CandidateReviewStatus = 'pending' | 'selected'

export interface WorkspaceProduct {
  id: string
  name: string
  assetCount: number
  taskCount: number
  promptCount: number
  outputCount: number
  readiness: 'draft' | 'blocked' | 'ready' | 'stale'
  thumbnail?: string
  updatedAt?: string
}

export interface WorkspaceSnapshot {
  root: string
  products: WorkspaceProduct[]
  accessories: Array<{ id: string; assetCount: number }>
  combinations?: WorkspaceCombination[]
  warnings?: string[]
  scannedAt?: string
  stats: {
    products: number
    accessories: number
    tasks: number
    prompts: number
    outputs: number
    pendingReview: number
  }
  liveGenerationEnabled: boolean
}

export interface WorkspaceImage {
  name: string
  relativePath?: string
  url: string
  sizeBytes?: number
  modifiedAt?: string
}

export interface WorkspaceShotSummary {
  folder: string
  imageCount: number
  images: WorkspaceImage[]
}

export interface WorkspaceTask {
  id: string
  name: string
  product: string
  relativePath?: string
  kind: 'standalone' | 'combination'
  hasPrompts: boolean
  promptCount: number
  referenceCount: number
  hasReferenceManifest: boolean
  generatedImageCount: number
  shots: Record<ShotType, WorkspaceShotSummary>
}

export interface WorkspaceCombination {
  id: string
  name: string
  relativePath?: string
  taskCount: number
  promptCount: number
  generatedImageCount: number
  tasks: WorkspaceTask[]
}

export interface AssetItem {
  id: string
  name: string
  url: string
  kind: 'product' | 'reference' | 'output' | 'scene'
  dimensions?: string
  selected?: boolean
}

export interface CanvasNodeBase {
  id: string
  name?: string
  visible?: boolean
  locked?: boolean
  x: number
  y: number
  rotation?: number
  opacity?: number
}

export interface CanvasImageNode extends CanvasNodeBase {
  type: 'image'
  src: string
  width: number
  height: number
}

export interface CanvasTextNode extends CanvasNodeBase {
  type: 'text'
  text: string
  width: number
  fontSize: number
  fontFamily?: string
  fontStyle?: string
  fill: string
  align?: 'left' | 'center' | 'right'
}

export type CanvasNode = CanvasImageNode | CanvasTextNode

export interface GenerationJob {
  id: string
  title: string
  product: string
  shot: ShotType
  status: JobStatus
  progress: number
  createdAt: string
  thumbnail?: string
  error?: string
}

export interface GenerationRunRequest {
  product: string
  tasks: string[]
  shots: ShotType[]
  variants: number
  concurrency: number
}

export interface GenerationRun {
  id: string
  product: string
  tasks: string[]
  shots: ShotType[]
  variants: number
  concurrency: number
  status: GenerationRunStatus
  progress: number
  candidateCount: number
  completedCount: number
  failedCount: number
  pendingReviewCount: number
  selectedCount: number
  expectedCount: number
  message?: string
  error?: string
  createdAt: string
  updatedAt?: string
  thumbnail?: string
  demo?: boolean
}

export interface GenerationCandidate {
  id: string
  jobId: string
  product: string
  task: string
  shot: ShotType
  variant: number
  url: string
  reviewStatus: CandidateReviewStatus
  storageStatus?: 'staged' | 'promoted'
  name?: string
  relativePath?: string
  createdAt?: string
  width?: number
  height?: number
  score?: number
  model?: string
  quality?: string
  estimatedCost?: number
  elapsedSeconds?: number
}

export type CanvasInsertMode = 'background' | 'layer'

export interface CanvasInsertRequest {
  requestId: string
  productId: string
  taskId: string
  shot: ShotType
  asset: AssetItem
  mode: CanvasInsertMode
}

export interface PromptDraft {
  subject: string
  environment: string
  composition: string
  negatives: string
  visibleText: string
}

export interface WorkflowResult {
  ok: boolean
  command: string[]
  stdout: string
  stderr?: string
}
