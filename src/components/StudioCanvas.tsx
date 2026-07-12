import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import Konva from 'konva'
import { Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva'
import useImage from 'use-image'
import type { CanvasImageNode, CanvasNode, CanvasTextNode } from '../types'

export const ARTBOARD = { x: 300, y: 140, width: 640, height: 640 }

export type CanvasViewport = {
  x: number
  y: number
  zoom: number
  mode?: 'fit' | 'custom'
}

export type StudioCanvasHandle = {
  exportPng: (targetSize?: number) => string | undefined
  fitArtboard: () => void
  zoomTo: (zoom: number) => void
}

type Props = {
  nodes: CanvasNode[]
  onNodesChange: (nodes: CanvasNode[]) => void
  selectedId?: string
  onSelect: (id?: string) => void
  tool: 'select' | 'hand'
  viewport: CanvasViewport
  onViewportChange: (viewport: CanvasViewport) => void
  artboardLabel?: string
}

type ShapeProps<T extends CanvasNode> = {
  node: T
  canDrag: boolean
  onSelect: () => void
  onChange: (next: T) => void
  onRef: (id: string, shape: Konva.Node | null) => void
  onImageState?: (id: string, state: 'loading' | 'ready' | 'failed' | 'removed') => void
}

function ImageNode({ node, canDrag, onSelect, onChange, onRef, onImageState }: ShapeProps<CanvasImageNode>) {
  const [image, status] = useImage(node.src, 'anonymous')
  const shapeRef = useRef<Konva.Image>(null)

  useEffect(() => {
    onRef(node.id, shapeRef.current)
    return () => onRef(node.id, null)
  }, [node.id, onRef])

  useEffect(() => {
    onImageState?.(node.id, status === 'loaded' ? 'ready' : status === 'failed' ? 'failed' : 'loading')
    return () => onImageState?.(node.id, 'removed')
  }, [node.id, onImageState, status])

  return (
    <KonvaImage
      ref={shapeRef}
      image={image}
      x={node.x}
      y={node.y}
      width={node.width}
      height={node.height}
      rotation={node.rotation ?? 0}
      opacity={node.opacity ?? 1}
      draggable={canDrag}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(event) => onChange({ ...node, x: event.target.x(), y: event.target.y() })}
      onTransformEnd={() => {
        const shape = shapeRef.current
        if (!shape) return
        const scaleX = shape.scaleX()
        const scaleY = shape.scaleY()
        shape.scaleX(1)
        shape.scaleY(1)
        onChange({
          ...node,
          x: shape.x(),
          y: shape.y(),
          rotation: shape.rotation(),
          width: Math.max(24, shape.width() * scaleX),
          height: Math.max(24, shape.height() * scaleY),
        })
      }}
    />
  )
}

function TextNode({ node, canDrag, onSelect, onChange, onRef }: ShapeProps<CanvasTextNode>) {
  const shapeRef = useRef<Konva.Text>(null)

  useEffect(() => {
    onRef(node.id, shapeRef.current)
    return () => onRef(node.id, null)
  }, [node.id, onRef])

  return (
    <Text
      ref={shapeRef}
      x={node.x}
      y={node.y}
      width={node.width}
      text={node.text}
      fontSize={node.fontSize}
      fontFamily={node.fontFamily ?? 'Inter, Arial, sans-serif'}
      fontStyle={node.fontStyle ?? 'normal'}
      fill={node.fill}
      rotation={node.rotation ?? 0}
      align={node.align ?? 'left'}
      lineHeight={1.1}
      draggable={canDrag}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(event) => onChange({ ...node, x: event.target.x(), y: event.target.y() })}
      onTransformEnd={() => {
        const shape = shapeRef.current
        if (!shape) return
        const scaleX = shape.scaleX()
        shape.scaleX(1)
        shape.scaleY(1)
        onChange({
          ...node,
          x: shape.x(),
          y: shape.y(),
          width: Math.max(80, shape.width() * scaleX),
          rotation: shape.rotation(),
        })
      }}
    />
  )
}

export const StudioCanvas = forwardRef<StudioCanvasHandle, Props>(function StudioCanvas({
  nodes,
  onNodesChange,
  selectedId,
  onSelect,
  tool,
  viewport,
  onViewportChange,
  artboardLabel = '画板',
}, forwardedRef) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const backdropLayerRef = useRef<Konva.Layer>(null)
  const overlayLayerRef = useRef<Konva.Layer>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef(new Map<string, Konva.Node>())
  const [size, setSize] = useState({ width: 900, height: 720 })
  const [imageStates, setImageStates] = useState<Map<string, 'loading' | 'ready' | 'failed'>>(new Map())

  const rememberNodeRef = useMemo(() => (id: string, shape: Konva.Node | null) => {
    if (shape) nodeRefs.current.set(id, shape)
    else nodeRefs.current.delete(id)
  }, [])

  const rememberImageState = useMemo(() => (id: string, state: 'loading' | 'ready' | 'failed' | 'removed') => {
    setImageStates((current) => {
      const next = new Map(current)
      state === 'removed' ? next.delete(id) : next.set(id, state)
      return next
    })
  }, [])

  const fitArtboard = () => {
    const horizontalPadding = 92
    const verticalPadding = 116
    const nextZoom = Math.min(
      1.35,
      Math.max(
        0.35,
        Math.min(
          (size.width - horizontalPadding) / ARTBOARD.width,
          (size.height - verticalPadding) / ARTBOARD.height,
        ),
      ),
    )
    onViewportChange({
      zoom: Number(nextZoom.toFixed(3)),
      x: (size.width - ARTBOARD.width * nextZoom) / 2 - ARTBOARD.x * nextZoom,
      y: (size.height - ARTBOARD.height * nextZoom) / 2 - ARTBOARD.y * nextZoom,
      mode: 'fit',
    })
  }

  const zoomTo = (requestedZoom: number) => {
    const nextZoom = Math.min(1.5, Math.max(0.35, requestedZoom))
    const anchor = { x: size.width / 2, y: size.height / 2 }
    const worldPoint = {
      x: (anchor.x - viewport.x) / viewport.zoom,
      y: (anchor.y - viewport.y) / viewport.zoom,
    }
    onViewportChange({
      zoom: Number(nextZoom.toFixed(3)),
      x: anchor.x - worldPoint.x * nextZoom,
      y: anchor.y - worldPoint.y * nextZoom,
      mode: 'custom',
    })
  }

  useImperativeHandle(forwardedRef, () => ({
    fitArtboard,
    zoomTo,
    exportPng: (targetSize = 1024) => {
      const stage = stageRef.current
      if (!stage) return undefined
      const imageNodeIds = nodes.filter((node) => node.type === 'image').map((node) => node.id)
      if (imageNodeIds.some((id) => imageStates.get(id) === 'failed')) {
        throw new Error('画板中有图片加载失败，请检查素材后重试')
      }
      if (imageNodeIds.some((id) => imageStates.get(id) !== 'ready')) {
        throw new Error('画板图片仍在加载，请稍后再导出')
      }
      const previousPosition = stage.position()
      const previousScale = stage.scale()
      const backdropVisible = backdropLayerRef.current?.visible() ?? true
      const overlayVisible = overlayLayerRef.current?.visible() ?? true
      try {
        backdropLayerRef.current?.visible(false)
        overlayLayerRef.current?.visible(false)
        stage.position({ x: 0, y: 0 })
        stage.scale({ x: 1, y: 1 })
        stage.draw()
        return stage.toDataURL({
          x: ARTBOARD.x,
          y: ARTBOARD.y,
          width: ARTBOARD.width,
          height: ARTBOARD.height,
          pixelRatio: targetSize / ARTBOARD.width,
          mimeType: 'image/png',
        })
      } finally {
        stage.position(previousPosition)
        stage.scale(previousScale)
        backdropLayerRef.current?.visible(backdropVisible)
        overlayLayerRef.current?.visible(overlayVisible)
        stage.draw()
      }
    },
  }))

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if ((viewport.mode ?? 'fit') === 'fit' && size.width > 0 && size.height > 0) fitArtboard()
    // fitArtboard intentionally follows the latest measured container and controlled viewport callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height])

  useEffect(() => {
    const transformer = transformerRef.current
    if (!transformer) return
    const selected = selectedId && selectedId !== 'scene-background' ? nodeRefs.current.get(selectedId) : undefined
    transformer.nodes(selected ? [selected] : [])
    transformer.getLayer()?.batchDraw()
  }, [nodes, selectedId])

  const guideLines = useMemo(() => [
    [ARTBOARD.x + 32, ARTBOARD.y + 32, ARTBOARD.x + ARTBOARD.width - 32, ARTBOARD.y + 32],
    [ARTBOARD.x + ARTBOARD.width - 32, ARTBOARD.y + 32, ARTBOARD.x + ARTBOARD.width - 32, ARTBOARD.y + ARTBOARD.height - 32],
    [ARTBOARD.x + ARTBOARD.width - 32, ARTBOARD.y + ARTBOARD.height - 32, ARTBOARD.x + 32, ARTBOARD.y + ARTBOARD.height - 32],
    [ARTBOARD.x + 32, ARTBOARD.y + ARTBOARD.height - 32, ARTBOARD.x + 32, ARTBOARD.y + 32],
  ], [])

  const selectedNode = selectedId ? nodes.find((node) => node.id === selectedId) : undefined
  const updateNode = (id: string, next: CanvasNode) => onNodesChange(nodes.map((node) => node.id === id ? next : node))

  return (
    <div className={`studio-canvas ${tool === 'hand' ? 'is-hand' : ''}`} ref={containerRef}>
      <div className="canvas-dot-grid" />
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        scaleX={viewport.zoom}
        scaleY={viewport.zoom}
        x={viewport.x}
        y={viewport.y}
        draggable={tool === 'hand'}
        onDragEnd={(event) => {
          if (tool === 'hand') onViewportChange({ ...viewport, x: event.target.x(), y: event.target.y(), mode: 'custom' })
        }}
        onMouseDown={(event) => {
          if (event.target === event.target.getStage()) onSelect(undefined)
        }}
        onWheel={(event) => {
          event.evt.preventDefault()
          const stage = event.target.getStage()
          if (!stage) return
          const pointer = stage.getPointerPosition()
          if (!pointer) return
          const oldScale = viewport.zoom
          const mousePoint = {
            x: (pointer.x - viewport.x) / oldScale,
            y: (pointer.y - viewport.y) / oldScale,
          }
          const direction = event.evt.deltaY > 0 ? -1 : 1
          const nextZoom = Math.min(1.5, Math.max(0.35, oldScale + direction * 0.08))
          onViewportChange({
            zoom: Number(nextZoom.toFixed(2)),
            x: pointer.x - mousePoint.x * nextZoom,
            y: pointer.y - mousePoint.y * nextZoom,
            mode: 'custom',
          })
        }}
      >
        <Layer ref={backdropLayerRef} listening={false}>
          <Rect x={ARTBOARD.x} y={ARTBOARD.y} width={ARTBOARD.width} height={ARTBOARD.height} fill="#fbfaf7" shadowColor="#4b4e49" shadowOpacity={0.18} shadowBlur={32} shadowOffsetY={14} />
        </Layer>
        <Layer clipX={ARTBOARD.x} clipY={ARTBOARD.y} clipWidth={ARTBOARD.width} clipHeight={ARTBOARD.height}>
          <Rect x={ARTBOARD.x} y={ARTBOARD.y} width={ARTBOARD.width} height={ARTBOARD.height} fill="#fbfaf7" listening={false} />
          {nodes.map((node) => node.type === 'image' ? (
            <ImageNode
              key={node.id}
              node={node}
              canDrag={tool === 'select' && node.id !== 'scene-background'}
              onSelect={() => tool === 'select' && onSelect(node.id)}
              onChange={(next) => updateNode(node.id, next)}
              onRef={rememberNodeRef}
              onImageState={rememberImageState}
            />
          ) : (
            <TextNode
              key={node.id}
              node={node}
              canDrag={tool === 'select'}
              onSelect={() => tool === 'select' && onSelect(node.id)}
              onChange={(next) => updateNode(node.id, next)}
              onRef={rememberNodeRef}
            />
          ))}
        </Layer>
        <Layer ref={overlayLayerRef} listening={tool === 'select'}>
          <Rect x={ARTBOARD.x} y={ARTBOARD.y} width={ARTBOARD.width} height={ARTBOARD.height} stroke="#c8c9c3" strokeWidth={1} listening={false} />
          {guideLines.map((points, index) => <Line key={index} points={points} stroke="#3a8f82" opacity={0.34} dash={[7, 8]} strokeWidth={1} listening={false} />)}
          <Text x={ARTBOARD.x} y={ARTBOARD.y - 28} text={`${artboardLabel} · 1024 × 1024`} fontSize={13} fill="#60635e" listening={false} />
          <Transformer
            ref={transformerRef}
            rotateEnabled
            keepRatio={selectedNode?.type === 'image'}
            enabledAnchors={selectedNode?.type === 'text' ? ['middle-left', 'middle-right'] : undefined}
            borderStroke="#13675d"
            borderStrokeWidth={1.5}
            anchorFill="#ffffff"
            anchorStroke="#13675d"
            anchorSize={10}
            anchorCornerRadius={2}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 24 || newBox.height < 24 ? oldBox : newBox)}
          />
        </Layer>
      </Stage>
    </div>
  )
})
