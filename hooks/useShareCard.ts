'use client'

import { useCallback, useState } from 'react'

type ShareOptions = {
  title: string
  text: string
  fileName: string
}

type BlobFactory = () => Promise<Blob>

async function loadImage(url: string) {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load generated share image'))
    image.src = url
  })
}

async function canvasToBlob(canvas: HTMLCanvasElement) {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('Failed to generate PNG blob'))
      }
    }, 'image/png')
  })
}

function getInitials(value: string) {
  return value
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to read generated image data'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read generated image data'))
    reader.readAsDataURL(blob)
  })
}

async function getExportSafeImageSrc(src: string) {
  if (src.startsWith('data:')) return src

  const response = await fetch(src, {
    mode: 'cors',
    credentials: 'omit'
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch export image: ${response.status}`)
  }

  const blob = await response.blob()
  return await blobToDataUrl(blob)
}

function replaceImageWithFallback(image: HTMLImageElement) {
  const fallback = document.createElement('div')
  const accent = image.getAttribute('data-share-accent') || 'rgba(77, 226, 255, 0.72)'
  const label = image.getAttribute('data-share-fallback') || image.getAttribute('alt') || 'Player'

  fallback.textContent = getInitials(label)
  fallback.setAttribute(
    'style',
    [
      `width:${image.style.width || '82px'}`,
      `height:${image.style.height || '82px'}`,
      `border-radius:${image.style.borderRadius || '24px'}`,
      `border:${image.style.border || `1px solid ${accent}`}`,
      `background:${image.style.background || `linear-gradient(135deg, ${accent}2b, rgba(255,255,255,0.05))`}`,
      'display:grid',
      'place-items:center',
      'font-family:var(--font-display), var(--font-body), system-ui, sans-serif',
      `font-size:${image.getAttribute('data-share-fallback-size') || '26px'}`,
      `color:${accent}`,
      'font-weight:700',
      'overflow:hidden'
    ].join(';')
  )

  image.replaceWith(fallback)
}

async function sanitizeCloneMedia(clone: HTMLElement) {
  const images = Array.from(clone.querySelectorAll('img'))

  await Promise.all(
    images.map(async (image) => {
      const src = image.getAttribute('src')
      if (!src) {
        replaceImageWithFallback(image)
        return
      }

      try {
        const safeSrc = await getExportSafeImageSrc(src)
        image.setAttribute('src', safeSrc)
        image.removeAttribute('crossorigin')
      } catch {
        replaceImageWithFallback(image)
      }
    })
  )
}

async function nodeToBlob(node: HTMLElement) {
  const rect = node.getBoundingClientRect()
  const width = Math.ceil(rect.width)
  const height = Math.ceil(rect.height)
  const clone = node.cloneNode(true) as HTMLElement
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  clone.style.margin = '0'
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`

  await sanitizeCloneMedia(clone)

  const markup = new XMLSerializer().serializeToString(clone)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject width="100%" height="100%">${markup}</foreignObject>
    </svg>
  `

  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  try {
    const image = await loadImage(url)
    const scale = Math.max(2, Math.min(3, window.devicePixelRatio || 2))
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale

    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas context unavailable')

    context.scale(scale, scale)
    context.drawImage(image, 0, 0, width, height)
    return await canvasToBlob(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${fileName}.png`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function useShareCard() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const downloadCard = useCallback(async (node: HTMLElement | null, fileName: string, blobFactory?: BlobFactory) => {
    setBusy(true)
    setError(null)

    try {
      const blob = blobFactory ? await blobFactory() : await nodeToBlob(node as HTMLElement)
      downloadBlob(blob, fileName)
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Failed to download share card')
      throw downloadError
    } finally {
      setBusy(false)
    }
  }, [])

  const shareCard = useCallback(async (node: HTMLElement | null, options: ShareOptions, blobFactory?: BlobFactory) => {
    setBusy(true)
    setError(null)

    try {
      const blob = blobFactory ? await blobFactory() : await nodeToBlob(node as HTMLElement)
      const file = new File([blob], `${options.fileName}.png`, { type: 'image/png' })
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: options.title,
          text: options.text,
          files: [file]
        })
        return 'shared'
      }

      await navigator.clipboard.writeText(options.text)
      return 'copied'
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : 'Failed to share card')
      throw shareError
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    busy,
    error,
    setError,
    downloadCard,
    shareCard
  }
}

export default useShareCard
