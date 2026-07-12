import { demoWorkspace } from './demo'
import type {
  CandidateReviewStatus,
  GenerationCandidate,
  GenerationRun,
  GenerationRunRequest,
  GenerationRunStatus,
  ShotType,
  WorkflowResult,
  WorkspaceCombination,
  WorkspaceImage,
  WorkspaceShotSummary,
  WorkspaceSnapshot,
  WorkspaceTask,
} from '../types'

const jsonHeaders = { 'Content-Type': 'application/json' }
const shotTypes: ShotType[] = ['main', 'size', 'lifestyle-scene', 'detail', 'comparison']

type JsonRecord = Record<string, unknown>

class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function asShots(value: unknown): ShotType[] {
  const values = asStrings(value)
  return values.filter((item): item is ShotType => shotTypes.includes(item as ShotType))
}

function errorMessage(body: unknown, fallback: string): string {
  const data = asRecord(body)
  const detail = data.detail
  if (typeof detail === 'string') return detail
  if (isRecord(detail) && typeof detail.message === 'string') return detail.message
  return asString(data.message, fallback)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const text = await response.text()
  let body: unknown
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(body, response.statusText || `请求失败 (${response.status})`))
  }
  return body as T
}

function normalizeImage(value: unknown): WorkspaceImage {
  const item = asRecord(value)
  return {
    name: asString(item.name),
    relativePath: asString(item.relativePath ?? item.relative_path) || undefined,
    url: asString(item.url),
    sizeBytes: asNumber(item.sizeBytes ?? item.size_bytes) || undefined,
    modifiedAt: asString(item.modifiedAt ?? item.modified_at) || undefined,
  }
}

function normalizeShot(value: unknown, shot: ShotType): WorkspaceShotSummary {
  const item = asRecord(value)
  return {
    folder: asString(item.folder, shot),
    imageCount: asNumber(item.imageCount ?? item.image_count),
    images: Array.isArray(item.images) ? item.images.map(normalizeImage) : [],
  }
}

function normalizeTask(value: unknown): WorkspaceTask {
  const item = asRecord(value)
  const rawShots = asRecord(item.shots)
  const shots = Object.fromEntries(shotTypes.map((shot) => [shot, normalizeShot(rawShots[shot], shot)])) as Record<ShotType, WorkspaceShotSummary>
  return {
    id: asString(item.id),
    name: asString(item.name),
    product: asString(item.product),
    relativePath: asString(item.relativePath ?? item.relative_path) || undefined,
    kind: item.kind === 'combination' ? 'combination' : 'standalone',
    hasPrompts: Boolean(item.hasPrompts ?? item.has_prompts),
    promptCount: asNumber(item.promptCount ?? item.prompt_count),
    referenceCount: asNumber(item.referenceCount ?? item.reference_count),
    hasReferenceManifest: Boolean(item.hasReferenceManifest ?? item.has_reference_manifest),
    generatedImageCount: asNumber(item.generatedImageCount ?? item.generated_image_count),
    shots,
  }
}

function normalizeCombination(value: unknown): WorkspaceCombination {
  const item = asRecord(value)
  return {
    id: asString(item.id),
    name: asString(item.name),
    relativePath: asString(item.relativePath ?? item.relative_path) || undefined,
    taskCount: asNumber(item.taskCount ?? item.task_count),
    promptCount: asNumber(item.promptCount ?? item.prompt_count),
    generatedImageCount: asNumber(item.generatedImageCount ?? item.generated_image_count),
    tasks: Array.isArray(item.tasks) ? item.tasks.map(normalizeTask) : [],
  }
}

function normalizeWorkspace(value: unknown): WorkspaceSnapshot {
  const item = asRecord(value)
  const stats = asRecord(item.stats)
  const products = Array.isArray(item.products) ? item.products.map((value) => {
    const product = asRecord(value)
    return {
      id: asString(product.id),
      name: asString(product.name, asString(product.id)),
      assetCount: asNumber(product.assetCount ?? product.asset_count),
      taskCount: asNumber(product.taskCount ?? product.task_count),
      promptCount: asNumber(product.promptCount ?? product.prompt_count),
      outputCount: asNumber(product.outputCount ?? product.output_count),
      readiness: ['draft', 'blocked', 'ready', 'stale'].includes(asString(product.readiness))
        ? asString(product.readiness) as 'draft' | 'blocked' | 'ready' | 'stale'
        : 'draft' as const,
      thumbnail: asString(product.thumbnail) || undefined,
      updatedAt: asString(product.updatedAt ?? product.updated_at) || undefined,
    }
  }) : []
  const accessories = Array.isArray(item.accessories) ? item.accessories.map((value) => {
    const accessory = asRecord(value)
    return { id: asString(accessory.id), assetCount: asNumber(accessory.assetCount ?? accessory.asset_count) }
  }) : []
  return {
    root: asString(item.root),
    products,
    accessories,
    combinations: Array.isArray(item.combinations) ? item.combinations.map(normalizeCombination) : [],
    warnings: asStrings(item.warnings),
    scannedAt: asString(item.scannedAt ?? item.scanned_at) || undefined,
    stats: {
      products: asNumber(stats.products),
      accessories: asNumber(stats.accessories),
      tasks: asNumber(stats.tasks),
      prompts: asNumber(stats.prompts),
      outputs: asNumber(stats.outputs),
      pendingReview: asNumber(stats.pendingReview ?? stats.pending_review),
    },
    liveGenerationEnabled: Boolean(item.liveGenerationEnabled ?? item.live_generation_enabled),
  }
}

function normalizeRun(value: unknown): GenerationRun {
  const item = asRecord(value)
  const payload = asRecord(item.request ?? item.payload)
  const tasks = asStrings(item.tasks ?? payload.tasks)
  const shots = asShots(item.shots ?? payload.shots)
  const variants = Math.max(1, asNumber(item.variants ?? payload.variants, 1))
  const statusValue = asString(item.status, 'queued')
  const status = (['queued', 'running', 'completed', 'succeeded', 'failed', 'cancelled'].includes(statusValue)
    ? statusValue
    : 'queued') as GenerationRunStatus
  const expectedCount = Math.max(0, asNumber(
    item.expectedCount ?? item.expected_count ?? item.expected_candidate_count ?? item.totalCandidates ?? item.total_candidates,
    tasks.length * shots.length * variants,
  ))
  const candidateCount = Math.max(0, asNumber(
    item.candidateCount ?? item.candidate_count ?? item.generatedCandidates ?? item.generated_candidates,
  ))
  const inferredProgress = expectedCount > 0 ? Math.round((candidateCount / expectedCount) * 100) : 0
  return {
    id: asString(item.id ?? item.job_id),
    product: asString(item.product ?? payload.product),
    tasks,
    shots,
    variants,
    concurrency: Math.max(1, asNumber(item.concurrency ?? payload.concurrency, 1)),
    status,
    progress: Math.min(100, Math.max(0, asNumber(item.progress, ['completed', 'succeeded'].includes(status) ? 100 : inferredProgress))),
    candidateCount,
    completedCount: Math.max(0, asNumber(item.completedCount ?? item.completed_count)),
    failedCount: Math.max(0, asNumber(item.failedCount ?? item.failed_count)),
    pendingReviewCount: Math.max(0, asNumber(item.pendingReviewCount ?? item.pending_review_count, candidateCount)),
    selectedCount: Math.max(0, asNumber(item.selectedCount ?? item.selected_count)),
    expectedCount,
    message: asString(item.message) || undefined,
    error: asString(item.error ?? item.stderr) || undefined,
    createdAt: asString(item.createdAt ?? item.created_at),
    updatedAt: asString(item.updatedAt ?? item.updated_at) || undefined,
    thumbnail: asString(item.thumbnail ?? item.thumbnail_url) || undefined,
  }
}

function normalizeCandidate(value: unknown): GenerationCandidate {
  const item = asRecord(value)
  const shotValue = asString(item.shot, 'main')
  const reviewStatusValue = asString(item.reviewStatus ?? item.review_status ?? item.decision, 'pending')
  const storageStatus = item.storage_status === 'promoted' ? 'promoted' : item.storage_status === 'staged' ? 'staged' : undefined
  const relativePath = asString(item.relativePath ?? item.relative_path) || undefined
  const stableAssetUrl = storageStatus === 'promoted' && relativePath
    ? `/api/workspace/assets/${relativePath.split('/').map(encodeURIComponent).join('/')}`
    : undefined
  return {
    id: asString(item.id),
    jobId: asString(item.jobId ?? item.job_id ?? item.run_id),
    product: asString(item.product),
    task: asString(item.task),
    shot: shotTypes.includes(shotValue as ShotType) ? shotValue as ShotType : 'main',
    variant: Math.max(1, asNumber(item.variant ?? item.variant_index ?? item.candidate_index, 1)),
    url: stableAssetUrl ?? asString(item.url ?? item.image_url),
    reviewStatus: (reviewStatusValue === 'selected' ? 'selected' : 'pending') as CandidateReviewStatus,
    storageStatus,
    name: asString(item.name) || undefined,
    relativePath,
    createdAt: asString(item.createdAt ?? item.created_at) || undefined,
    width: asNumber(item.width) || undefined,
    height: asNumber(item.height) || undefined,
    score: asNumber(item.score ?? item.quality_score) || undefined,
    model: asString(item.model) || undefined,
    quality: asString(item.quality) || undefined,
    estimatedCost: asNumber(item.estimatedCost ?? item.estimated_cost) || undefined,
    elapsedSeconds: asNumber(item.elapsedSeconds ?? item.elapsed_seconds) || undefined,
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    await request('/api/health')
    return true
  } catch {
    return false
  }
}

export async function loadWorkspace(): Promise<{ data: WorkspaceSnapshot; demo: boolean }> {
  try {
    return { data: normalizeWorkspace(await request<unknown>('/api/workspace')), demo: false }
  } catch {
    return { data: demoWorkspace, demo: true }
  }
}

export function prepareWorkflow(product: string): Promise<WorkflowResult> {
  return request('/api/workflow/prepare', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ product, refreshPrompts: true }),
  })
}

export function previewWorkflow(product: string, shot?: string, task?: string): Promise<WorkflowResult> {
  return request('/api/workflow/preview', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ product, tasks: task ? [task] : [], shots: shot ? [shot] : [] }),
  })
}

export function saveCanvas(id: string, document: unknown): Promise<{ ok: boolean; version: number }> {
  return request(`/api/canvases/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ document }),
  })
}

export async function loadCanvas(id: string): Promise<Record<string, unknown> | undefined> {
  try {
    return await request<Record<string, unknown>>(`/api/canvases/${encodeURIComponent(id)}`)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return undefined
    throw error
  }
}

export async function createGenerationRun(payload: GenerationRunRequest): Promise<GenerationRun> {
  const result = await request<unknown>('/api/generation-runs', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  })
  return normalizeRun(result)
}

export async function listGenerationRuns(): Promise<GenerationRun[]> {
  const result = await request<unknown>('/api/generation-runs')
  const data = asRecord(result)
  const items = Array.isArray(result) ? result : Array.isArray(data.items) ? data.items : Array.isArray(data.runs) ? data.runs : []
  return items.map(normalizeRun)
}

export async function getGenerationRun(id: string): Promise<GenerationRun> {
  return normalizeRun(await request<unknown>(`/api/generation-runs/${encodeURIComponent(id)}`))
}

export async function listCandidates(filters: { jobId?: string; reviewStatus?: CandidateReviewStatus } = {}): Promise<GenerationCandidate[]> {
  const search = new URLSearchParams()
  if (filters.jobId) search.set('job_id', filters.jobId)
  if (filters.reviewStatus) search.set('review_status', filters.reviewStatus)
  const suffix = search.size ? `?${search.toString()}` : ''
  const result = await request<unknown>(`/api/candidates${suffix}`)
  const data = asRecord(result)
  const items = Array.isArray(result) ? result : Array.isArray(data.items) ? data.items : Array.isArray(data.candidates) ? data.candidates : []
  return items.map(normalizeCandidate)
}

export async function selectCandidate(id: string): Promise<GenerationCandidate> {
  return normalizeCandidate(await request<unknown>(`/api/candidates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ decision: 'selected' }),
  }))
}

export async function deleteCandidate(id: string): Promise<void> {
  await request<unknown>(`/api/candidates/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
