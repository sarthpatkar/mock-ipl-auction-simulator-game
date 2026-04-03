import { formatPrice } from '@/lib/auction-helpers'
import { AwardBadgeModel, PurchaseSpotlightModel, ResultsDerivedTeam, TeamComparisonModel } from '@/lib/results-virality'

const CARD_WIDTH = 296
const CARD_HEIGHT = 520

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function getInitials(value: string) {
  return value
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

function wrapText(text: string, maxChars: number, maxLines = Number.POSITIVE_INFINITY) {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }

    if (current) lines.push(current)
    current = word
  }

  if (current) lines.push(current)
  if (lines.length <= maxLines) return lines

  return lines.slice(0, maxLines).map((line, index, array) => {
    if (index !== array.length - 1) return line
    return truncateText(line, maxChars)
  })
}

function textBlock(lines: string[], x: number, y: number, lineHeight: number, style: string) {
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" style="${style}">${escapeXml(line)}</text>`
    )
    .join('')
}

function metricBox({
  x,
  y,
  width,
  label,
  value,
  accent
}: {
  x: number
  y: number
  width: number
  label: string
  value: string
  accent?: string
}) {
  return `
    <rect x="${x}" y="${y}" width="${width}" height="58" rx="16" fill="${accent ? `${accent}16` : 'rgba(255,255,255,0.04)'}" stroke="${
      accent ? `${accent}55` : 'rgba(255,255,255,0.08)'
    }"/>
    <text x="${x + 12}" y="${y + 19}" style="font:700 9px var(--font-body), system-ui, sans-serif; letter-spacing:1.4px; text-transform:uppercase; fill:rgba(212,224,238,0.68);">${escapeXml(
      label
    )}</text>
    <text x="${x + 12}" y="${y + 42}" style="font:700 15px var(--font-display), system-ui, sans-serif; fill:${accent || '#f4f7fb'};">${escapeXml(
      truncateText(value, 16)
    )}</text>
  `
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to read image data'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read image data'))
    reader.readAsDataURL(blob)
  })
}

async function fetchImageAsDataUrl(src: string) {
  const response = await fetch(src, {
    mode: 'cors',
    credentials: 'omit'
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`)
  }

  return await blobToDataUrl(await response.blob())
}

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

async function svgToPngBlob(svg: string) {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  try {
    const image = await loadImage(url)
    const scale = Math.max(2, Math.min(3, window.devicePixelRatio || 2))
    const canvas = document.createElement('canvas')
    canvas.width = CARD_WIDTH * scale
    canvas.height = CARD_HEIGHT * scale
    const context = canvas.getContext('2d')

    if (!context) throw new Error('Canvas context unavailable')

    context.scale(scale, scale)
    context.drawImage(image, 0, 0, CARD_WIDTH, CARD_HEIGHT)
    return await canvasToBlob(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function baseShell(accent: string, content: string) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
      <defs>
        <linearGradient id="cardBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#060b12"/>
          <stop offset="100%" stop-color="#0b1623"/>
        </linearGradient>
        <linearGradient id="accentLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${accent}"/>
          <stop offset="100%" stop-color="transparent"/>
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="${CARD_WIDTH - 1}" height="${CARD_HEIGHT - 1}" rx="28" fill="url(#cardBg)" stroke="rgba(255,255,255,0.1)"/>
      <circle cx="${CARD_WIDTH - 20}" cy="40" r="120" fill="${accent}" opacity="0.08"/>
      <circle cx="34" cy="${CARD_HEIGHT - 30}" r="86" fill="${accent}" opacity="0.05"/>
      <rect x="0" y="0" width="${CARD_WIDTH}" height="4" fill="url(#accentLine)"/>
      ${content}
    </svg>
  `
}

async function resolvePlayerImageBlock(name: string, imageUrl: string | null | undefined, accent: string) {
  if (imageUrl) {
    try {
      const href = await fetchImageAsDataUrl(imageUrl)
      return `
        <clipPath id="playerClip">
          <rect x="24" y="98" width="78" height="78" rx="22"/>
        </clipPath>
        <rect x="24" y="98" width="78" height="78" rx="22" fill="#111a24" stroke="${accent}" stroke-opacity="0.28"/>
        <image href="${href}" x="24" y="98" width="78" height="78" preserveAspectRatio="xMidYMid slice" clip-path="url(#playerClip)"/>
      `
    } catch {
      // fallback below
    }
  }

  return `
    <rect x="24" y="98" width="78" height="78" rx="22" fill="${accent}" fill-opacity="0.14" stroke="${accent}" stroke-opacity="0.34"/>
    <text x="63" y="145" text-anchor="middle" style="font: 700 30px var(--font-display), system-ui, sans-serif; fill:${accent};">${escapeXml(
      getInitials(name)
    )}</text>
  `
}

export async function renderTeamShareCardBlob(team: ResultsDerivedTeam) {
  const accent = team.result.rank === 1 ? '#f5c518' : '#4de2ff'
  const owner = team.participant?.profiles?.username || 'Franchise Owner'
  const teamName = team.participant?.team_name || 'Franchise'
  const squad = team.purchases.slice(0, 20)
  const leftColumn = squad.filter((_, index) => index % 2 === 0)
  const rightColumn = squad.filter((_, index) => index % 2 === 1)
  const mostExpensive = team.mostExpensivePurchase
  const squadOverflow = Math.max(team.purchases.length - squad.length, 0)

  const renderSquadColumn = (items: typeof squad, x: number) =>
    items
      .map((purchase, index) => {
        const y = 224 + index * 22
        return `
          <text x="${x}" y="${y}" style="font: 700 10px var(--font-body), system-ui, sans-serif; fill:#f4f7fb;">${escapeXml(
            truncateText(purchase.player.name, 12)
          )}</text>
          <text x="${x + 112}" y="${y}" text-anchor="end" style="font: 700 10px var(--font-body), system-ui, sans-serif; fill:${accent};">${escapeXml(
            formatPrice(purchase.pricePaid)
          )}</text>
        `
      })
      .join('')

  const svg = baseShell(
    accent,
    `
      <text x="20" y="30" style="font: 700 10px var(--font-body), system-ui, sans-serif; letter-spacing:2px; text-transform:uppercase; fill:${accent};">Share Team</text>
      <text x="20" y="60" style="font: 700 27px var(--font-display), system-ui, sans-serif; fill:#f4f7fb;">${escapeXml(
        truncateText(teamName, 17)
      )}</text>
      <text x="20" y="78" style="font: 500 11px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.82);">${escapeXml(
        truncateText(owner, 30)
      )}</text>

      <rect x="92" y="92" width="184" height="64" rx="18" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
      <text x="108" y="112" style="font:700 9px var(--font-body), system-ui, sans-serif; letter-spacing:1.6px; text-transform:uppercase; fill:rgba(212,224,238,0.68);">Team Rating</text>
      <text x="108" y="136" style="font:700 19px var(--font-display), system-ui, sans-serif; fill:#f4f7fb;">${escapeXml(
        team.result.team_score.toFixed(2)
      )}</text>
      <text x="108" y="151" style="font:500 10px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.78);">${escapeXml(
        `${team.squad.length} players · Avg ${team.averageRating.toFixed(1)}`
      )}</text>

      ${metricBox({ x: 20, y: 170, width: 122, label: 'Purse Left', value: formatPrice(team.remainingPurse), accent })}
      ${metricBox({ x: 154, y: 170, width: 122, label: 'Stars', value: `${team.starCount} stars` })}

      <text x="20" y="216" style="font: 700 11px var(--font-body), system-ui, sans-serif; letter-spacing:1.8px; text-transform:uppercase; fill:rgba(245,197,24,0.86);">Complete Squad</text>
      <rect x="20" y="224" width="118" height="220" rx="18" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
      <rect x="158" y="224" width="118" height="220" rx="18" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
      ${renderSquadColumn(leftColumn, 36)}
      ${renderSquadColumn(rightColumn, 174)}
      ${
        squadOverflow > 0
          ? `<text x="148" y="438" text-anchor="middle" style="font:500 10px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.72);">+${squadOverflow} more players</text>`
          : ''
      }

      <rect x="20" y="456" width="256" height="38" rx="16" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
      <text x="34" y="479" style="font: 700 9px var(--font-body), system-ui, sans-serif; letter-spacing:1.4px; text-transform:uppercase; fill:rgba(212,224,238,0.68);">Most Expensive Buy</text>
      <text x="264" y="479" text-anchor="end" style="font: 700 10px var(--font-body), system-ui, sans-serif; fill:#f4f7fb;">${escapeXml(
        mostExpensive ? `${truncateText(mostExpensive.player.name, 11)} · ${formatPrice(mostExpensive.pricePaid)}` : 'No purchase'
      )}</text>

      <text x="20" y="504" style="font: 700 9px var(--font-body), system-ui, sans-serif; letter-spacing:1.8px; text-transform:uppercase; fill:rgba(245,197,24,0.82);">${escapeXml(APP_NAME)}</text>
      <text x="276" y="504" text-anchor="end" style="font: 500 10px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.78);">Play with friends</text>
      ${await resolvePlayerImageBlock(teamName, null, accent)}
    `
  )

  return await svgToPngBlob(svg)
}

export async function renderAwardShareCardBlob(award: AwardBadgeModel) {
  const accent = award.id === 'auction-winner' ? '#f5c518' : award.id === 'best-bowling' ? '#7ce2b7' : award.id === 'best-batting' ? '#4de2ff' : '#ff9cde'
  const teamName = award.team.participant?.team_name || 'Franchise'
  const owner = award.team.participant?.profiles?.username || 'Franchise Owner'
  const subtitleLines = wrapText(award.strapline, 28, 2)
  const copyLines = wrapText(award.supportingCopy, 34, 4)

  const svg = baseShell(
    accent,
    `
      <text x="20" y="30" style="font: 700 10px var(--font-body), system-ui, sans-serif; letter-spacing:2px; text-transform:uppercase; fill:${accent};">Share Badge</text>
      <text x="20" y="60" style="font: 700 28px var(--font-display), system-ui, sans-serif; fill:#f4f7fb;">${escapeXml(
        truncateText(award.title, 18)
      )}</text>
      ${textBlock(subtitleLines, 20, 80, 15, 'font:500 12px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.82);')}

      <rect x="20" y="122" width="256" height="112" rx="24" fill="${accent}" fill-opacity="0.12" stroke="${accent}" stroke-opacity="0.32"/>
      <rect x="34" y="142" width="58" height="58" rx="20" fill="${accent}" fill-opacity="0.14" stroke="${accent}" stroke-opacity="0.38"/>
      <text x="63" y="178" text-anchor="middle" style="font:700 23px var(--font-display), system-ui, sans-serif; fill:${accent};">${escapeXml(
        getInitials(teamName)
      )}</text>
      <text x="108" y="162" style="font:700 9px var(--font-body), system-ui, sans-serif; letter-spacing:1.5px; text-transform:uppercase; fill:rgba(212,224,238,0.68);">Awarded To</text>
      <text x="108" y="184" style="font:700 19px var(--font-display), system-ui, sans-serif; fill:#f4f7fb;">${escapeXml(
        truncateText(teamName, 16)
      )}</text>
      <text x="108" y="201" style="font:500 11px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.78);">${escapeXml(
        truncateText(owner, 22)
      )}</text>

      <rect x="20" y="250" width="256" height="72" rx="18" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
      <text x="34" y="272" style="font:700 9px var(--font-body), system-ui, sans-serif; letter-spacing:1.5px; text-transform:uppercase; fill:rgba(212,224,238,0.68);">Winning Metric</text>
      <text x="34" y="300" style="font:700 22px var(--font-display), system-ui, sans-serif; fill:${accent};">${escapeXml(
        truncateText(award.valueLabel, 22)
      )}</text>

      ${textBlock(copyLines, 20, 352, 16, 'font:500 12px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.82);')}
      <text x="20" y="504" style="font: 700 9px var(--font-body), system-ui, sans-serif; letter-spacing:1.8px; text-transform:uppercase; fill:rgba(245,197,24,0.82);">${escapeXml(APP_NAME)}</text>
      <text x="276" y="504" text-anchor="end" style="font: 500 10px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.78);">Play with friends</text>
    `
  )

  return await svgToPngBlob(svg)
}

export async function renderSpotlightShareCardBlob(spotlight: PurchaseSpotlightModel) {
  const accent = spotlight.id === 'most-expensive' ? '#f5c518' : spotlight.id === 'best-value' ? '#7ce2b7' : '#ff8f8f'
  const player = spotlight.purchase.player
  const teamName = spotlight.team.participant?.team_name || 'Franchise'
  const owner = spotlight.team.participant?.profiles?.username || 'Franchise Owner'
  const subtitleLines = wrapText(spotlight.strapline, 28, 2)
  const copyLines = wrapText(spotlight.supportingCopy, 34, 4)
  const imageBlock = await resolvePlayerImageBlock(player.name, player.image_url, accent)

  const svg = baseShell(
    accent,
    `
      <text x="20" y="30" style="font: 700 10px var(--font-body), system-ui, sans-serif; letter-spacing:2px; text-transform:uppercase; fill:${accent};">Auction Spotlight</text>
      <text x="20" y="60" style="font: 700 27px var(--font-display), system-ui, sans-serif; fill:#f4f7fb;">${escapeXml(
        truncateText(spotlight.title, 18)
      )}</text>
      ${textBlock(subtitleLines, 20, 80, 15, 'font:500 12px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.82);')}
      ${imageBlock}
      <text x="108" y="118" style="font:700 9px var(--font-body), system-ui, sans-serif; letter-spacing:1.5px; text-transform:uppercase; fill:rgba(212,224,238,0.68);">Player</text>
      <text x="108" y="140" style="font:700 19px var(--font-display), system-ui, sans-serif; fill:#f4f7fb;">${escapeXml(
        truncateText(player.name, 16)
      )}</text>
      <text x="108" y="157" style="font:500 11px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.78);">${escapeXml(
        truncateText(`${teamName} · ${owner}`, 27)
      )}</text>

      ${metricBox({ x: 20, y: 192, width: 122, label: 'Sold Price', value: formatPrice(spotlight.purchase.pricePaid), accent })}
      ${metricBox({
        x: 154,
        y: 192,
        width: 122,
        label: 'Base Price',
        value: spotlight.purchase.basePrice ? formatPrice(spotlight.purchase.basePrice) : '—'
      })}

      <rect x="20" y="264" width="256" height="76" rx="18" fill="${accent}" fill-opacity="0.09" stroke="${accent}" stroke-opacity="0.24"/>
      <text x="34" y="286" style="font:700 9px var(--font-body), system-ui, sans-serif; letter-spacing:1.5px; text-transform:uppercase; fill:rgba(212,224,238,0.68);">${
        spotlight.id === 'best-value' ? 'Value Index' : 'Overspend'
      }</text>
      <text x="34" y="315" style="font:700 22px var(--font-display), system-ui, sans-serif; fill:${accent};">${escapeXml(
        spotlight.id === 'best-value' ? spotlight.purchase.valueIndex.toFixed(1) : formatPrice(spotlight.purchase.priceDelta)
      )}</text>

      ${textBlock(copyLines, 20, 368, 16, 'font:500 12px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.82);')}
      <text x="20" y="504" style="font: 700 9px var(--font-body), system-ui, sans-serif; letter-spacing:1.8px; text-transform:uppercase; fill:rgba(245,197,24,0.82);">${escapeXml(APP_NAME)}</text>
      <text x="276" y="504" text-anchor="end" style="font: 500 10px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.78);">Play with friends</text>
    `
  )

  return await svgToPngBlob(svg)
}

export async function renderComparisonShareCardBlob(comparison: TeamComparisonModel) {
  const leftName = comparison.left.participant?.team_name || 'Team A'
  const rightName = comparison.right.participant?.team_name || 'Team B'
  const accent = comparison.overallWinner === 'tie' ? '#f5c518' : comparison.overallWinner === 'left' ? '#4de2ff' : '#7ce2b7'

  const metricsBlock = comparison.metrics
    .slice(0, 6)
    .map((metric, index) => {
      const y = 212 + index * 44
      return `
        <rect x="20" y="${y - 18}" width="256" height="32" rx="14" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.07)"/>
        <text x="34" y="${y}" style="font:700 11px var(--font-body), system-ui, sans-serif; fill:${metric.winner === 'left' ? accent : '#f4f7fb'};">${escapeXml(
          truncateText(metric.leftValue, 12)
        )}</text>
        <text x="148" y="${y}" text-anchor="middle" style="font:700 9px var(--font-body), system-ui, sans-serif; letter-spacing:1.4px; text-transform:uppercase; fill:rgba(212,224,238,0.68);">${escapeXml(
          truncateText(metric.label, 15)
        )}</text>
        <text x="262" y="${y}" text-anchor="end" style="font:700 11px var(--font-body), system-ui, sans-serif; fill:${metric.winner === 'right' ? accent : '#f4f7fb'};">${escapeXml(
          truncateText(metric.rightValue, 12)
        )}</text>
      `
    })
    .join('')

  const svg = baseShell(
    accent,
    `
      <text x="20" y="30" style="font: 700 10px var(--font-body), system-ui, sans-serif; letter-spacing:2px; text-transform:uppercase; fill:${accent};">Share Comparison</text>
      <text x="20" y="58" style="font: 700 22px var(--font-display), system-ui, sans-serif; fill:#f4f7fb;">${escapeXml(
        truncateText(leftName, 10)
      )} vs ${escapeXml(truncateText(rightName, 10))}</text>
      <text x="20" y="76" style="font: 500 12px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.82);">Final squad head-to-head</text>

      <rect x="20" y="100" width="112" height="58" rx="18" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
      <rect x="164" y="100" width="112" height="58" rx="18" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
      <circle cx="148" cy="128" r="22" fill="${accent}" fill-opacity="0.12" stroke="${accent}" stroke-opacity="0.3"/>
      <text x="148" y="136" text-anchor="middle" style="font:700 18px var(--font-display), system-ui, sans-serif; fill:${accent};">VS</text>
      <text x="34" y="123" style="font:700 14px var(--font-display), system-ui, sans-serif; fill:#f4f7fb;">${escapeXml(
        truncateText(leftName, 10)
      )}</text>
      <text x="34" y="142" style="font:500 11px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.78);">${comparison.leftWins} wins</text>
      <text x="178" y="123" style="font:700 14px var(--font-display), system-ui, sans-serif; fill:#f4f7fb;">${escapeXml(
        truncateText(rightName, 10)
      )}</text>
      <text x="178" y="142" style="font:500 11px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.78);">${comparison.rightWins} wins</text>

      ${metricsBlock}
      <text x="20" y="504" style="font: 700 9px var(--font-body), system-ui, sans-serif; letter-spacing:1.8px; text-transform:uppercase; fill:rgba(245,197,24,0.82);">${escapeXml(APP_NAME)}</text>
      <text x="276" y="504" text-anchor="end" style="font: 500 10px var(--font-body), system-ui, sans-serif; fill:rgba(214,226,239,0.78);">Play with friends</text>
    `
  )

  return await svgToPngBlob(svg)
}
import { APP_NAME } from '@/lib/branding'
