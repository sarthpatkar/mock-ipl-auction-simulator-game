'use client'
/* eslint-disable @next/next/no-img-element */

import type { CSSProperties, ReactNode } from 'react'
import { formatPrice } from '@/lib/auction-helpers'
import { AwardBadgeModel, PurchaseSpotlightModel, ResultsDerivedTeam, TeamComparisonModel } from '@/lib/results-virality'

const baseCardStyle: CSSProperties = {
  width: 292,
  minHeight: 520,
  borderRadius: 24,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'linear-gradient(180deg, rgba(6,11,18,0.98) 0%, rgba(10,19,30,0.98) 100%)',
  boxShadow: '0 24px 80px rgba(0,0,0,0.38)',
  padding: 16,
  display: 'grid',
  gap: 12,
  color: '#f4f7fb',
  position: 'relative',
  overflow: 'hidden',
  fontFamily: 'var(--font-body), system-ui, sans-serif'
}

const labelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'rgba(212,224,238,0.7)'
}

const sectionTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase'
}

function getInitials(value: string) {
  return value
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function ShareCardFrame({
  accent,
  kicker,
  title,
  subtitle,
  children,
  footer
}: {
  accent: string
  kicker: string
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div style={{ ...baseCardStyle, ['--share-accent' as string]: accent }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at top right, ${accent}26, transparent 34%), radial-gradient(circle at bottom left, ${accent}12, transparent 30%)`,
          pointerEvents: 'none'
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: '0 0 auto',
          height: 4,
          background: `linear-gradient(90deg, ${accent}, transparent 72%)`,
          pointerEvents: 'none'
        }}
      />

      <div style={{ position: 'relative', zIndex: 1, display: 'grid', gap: 8 }}>
        <span style={{ ...labelStyle, color: accent }}>{kicker}</span>
        <div style={{ display: 'grid', gap: 6 }}>
          <h2 style={{ fontFamily: 'var(--font-display), var(--font-body), system-ui, sans-serif', fontSize: 27, lineHeight: 0.92 }}>{title}</h2>
          {subtitle && <p style={{ color: 'rgba(214,226,239,0.8)', fontSize: 11, lineHeight: 1.4 }}>{subtitle}</p>}
        </div>
      </div>

      <div style={{ position: 'relative', zIndex: 1, display: 'grid', gap: 12 }}>{children}</div>

      <div style={{ position: 'relative', zIndex: 1, display: 'grid', gap: 10, marginTop: 'auto' }}>
        {footer}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            paddingTop: 6,
            borderTop: '1px solid rgba(255,255,255,0.08)'
          }}
        >
          <span style={{ ...labelStyle, color: 'rgba(245,197,24,0.86)' }}>{APP_NAME}</span>
          <span style={{ fontSize: 11, color: 'rgba(214,226,239,0.78)' }}>Unofficial fan-made simulator</span>
        </div>
      </div>
    </div>
  )
}

function TeamAvatar({ label, accent }: { label: string; accent: string }) {
  return (
    <div
      style={{
        width: 68,
        height: 68,
        borderRadius: 22,
        border: `1px solid ${accent}55`,
        background: `linear-gradient(135deg, ${accent}2b, rgba(255,255,255,0.05))`,
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'var(--font-display), var(--font-body), system-ui, sans-serif',
        fontSize: 22,
        color: accent
      }}
    >
      {getInitials(label)}
    </div>
  )
}

function PlayerArt({ name, imageUrl, accent }: { name: string; imageUrl?: string | null; accent: string }) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        crossOrigin="anonymous"
        data-share-fallback={name}
        data-share-accent={accent}
        data-share-fallback-size="30px"
        style={{
          width: 82,
          height: 82,
          borderRadius: 22,
          objectFit: 'cover',
          border: `1px solid ${accent}44`,
          background: '#111a24'
        }}
      />
    )
  }

  return <TeamAvatar label={name} accent={accent} />
}

export function TeamShareCard({ team }: { team: ResultsDerivedTeam }) {
  const accent = team.result.rank === 1 ? '#f5c518' : '#4de2ff'
  const owner = team.participant?.profiles?.username || 'Franchise Owner'
  const teamName = team.participant?.team_name || 'Franchise'

  return (
    <ShareCardFrame
      accent={accent}
      kicker="Share Team"
      title={teamName}
      subtitle={`${owner} · Team rating ${team.result.team_score.toFixed(2)}`}
      footer={
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            <MetricPill label="Purse Left" value={formatPrice(team.remainingPurse)} />
            <MetricPill label="Stars" value={String(team.starCount)} />
            <MetricPill label="Top Buy" value={team.mostExpensivePurchase ? team.mostExpensivePurchase.player.name : '—'} />
          </div>
          <p style={{ color: 'rgba(214,226,239,0.82)', fontSize: 10, lineHeight: 1.35 }}>
            Built for the final table. Screenshot it, share it, run it back.
          </p>
        </div>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <TeamAvatar label={teamName} accent={accent} />
        <div style={{ display: 'grid', gap: 4 }}>
          <span style={labelStyle}>Franchise Owner</span>
          <strong style={{ fontSize: 16 }}>{owner}</strong>
          <span style={{ color: 'rgba(214,226,239,0.74)', fontSize: 11 }}>
            {team.squad.length} players · Avg rating {team.averageRating.toFixed(1)}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={sectionTitleStyle}>Complete Squad</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {team.purchases.map((purchase) => (
            <div
              key={purchase.row.id}
              style={{
                borderRadius: 14,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.04)',
              padding: '7px 9px',
              display: 'grid',
              gap: 3
            }}
          >
              <strong style={{ fontSize: 10, lineHeight: 1.15 }}>{purchase.player.name}</strong>
              <span style={{ color: 'rgba(214,226,239,0.72)', fontSize: 9.5 }}>{purchase.player.role}</span>
              <span style={{ color: accent, fontSize: 10, fontWeight: 700 }}>{formatPrice(purchase.pricePaid)}</span>
            </div>
          ))}
        </div>
      </div>
    </ShareCardFrame>
  )
}

export function AwardShareCard({ award }: { award: AwardBadgeModel }) {
  const accent = award.id === 'auction-winner' ? '#f5c518' : award.id === 'best-bowling' ? '#7ce2b7' : award.id === 'best-batting' ? '#4de2ff' : '#ff9cde'
  const teamName = award.team.participant?.team_name || 'Franchise'
  const owner = award.team.participant?.profiles?.username || 'Franchise Owner'

  return (
    <ShareCardFrame
      accent={accent}
      kicker="Share Badge"
      title={award.title}
      subtitle={award.strapline}
      footer={<p style={{ color: 'rgba(214,226,239,0.82)', fontSize: 12, lineHeight: 1.5 }}>{award.supportingCopy}</p>}
    >
      <div
        style={{
          display: 'grid',
          gap: 14,
          padding: 14,
          borderRadius: 18,
          border: `1px solid ${accent}44`,
          background: `linear-gradient(135deg, ${accent}1a, rgba(255,255,255,0.03))`
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <TeamAvatar label={teamName} accent={accent} />
          <div style={{ textAlign: 'right', display: 'grid', gap: 4 }}>
            <span style={labelStyle}>Awarded To</span>
            <strong style={{ fontSize: 16 }}>{teamName}</strong>
            <span style={{ color: 'rgba(214,226,239,0.78)', fontSize: 11 }}>{owner}</span>
          </div>
        </div>
        <div
          style={{
            padding: '9px 11px',
            borderRadius: 16,
            background: 'rgba(6,11,18,0.45)',
            border: '1px solid rgba(255,255,255,0.07)',
            display: 'grid',
            gap: 6
          }}
        >
          <span style={labelStyle}>Winning Metric</span>
          <strong style={{ fontFamily: 'var(--font-display), var(--font-body), system-ui, sans-serif', fontSize: 22, lineHeight: 0.95, color: accent }}>
            {award.valueLabel}
          </strong>
        </div>
      </div>
    </ShareCardFrame>
  )
}

export function SpotlightShareCard({ spotlight }: { spotlight: PurchaseSpotlightModel }) {
  const accent = spotlight.id === 'most-expensive' ? '#f5c518' : spotlight.id === 'best-value' ? '#7ce2b7' : '#ff8f8f'
  const player = spotlight.purchase.player
  const teamName = spotlight.team.participant?.team_name || 'Franchise'
  const owner = spotlight.team.participant?.profiles?.username || 'Franchise Owner'

  return (
    <ShareCardFrame
      accent={accent}
      kicker="Auction Spotlight"
      title={spotlight.title}
      subtitle={spotlight.strapline}
      footer={<p style={{ color: 'rgba(214,226,239,0.82)', fontSize: 10, lineHeight: 1.35 }}>{spotlight.supportingCopy}</p>}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <PlayerArt name={player.name} imageUrl={player.image_url} accent={accent} />
        <div style={{ display: 'grid', gap: 4 }}>
          <span style={labelStyle}>Player</span>
          <strong style={{ fontSize: 17, lineHeight: 1.05 }}>{player.name}</strong>
          <span style={{ color: 'rgba(214,226,239,0.78)', fontSize: 11 }}>
            {teamName} · {owner}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <MetricPill label="Sold Price" value={formatPrice(spotlight.purchase.pricePaid)} accent={accent} />
        <MetricPill label="Base Price" value={spotlight.purchase.basePrice ? formatPrice(spotlight.purchase.basePrice) : '—'} />
        <MetricPill label="Overspend" value={formatPrice(spotlight.purchase.priceDelta)} />
        <MetricPill label={spotlight.id === 'best-value' ? 'Value Index' : 'Quality Score'} value={spotlight.id === 'best-value' ? spotlight.purchase.valueIndex.toFixed(1) : spotlight.purchase.qualityScore.toFixed(1)} />
      </div>
    </ShareCardFrame>
  )
}

export function ComparisonShareCard({ comparison }: { comparison: TeamComparisonModel }) {
  const leftName = comparison.left.participant?.team_name || 'Team A'
  const rightName = comparison.right.participant?.team_name || 'Team B'
  const accent = comparison.overallWinner === 'tie' ? '#f5c518' : comparison.overallWinner === 'left' ? '#4de2ff' : '#7ce2b7'

  return (
    <ShareCardFrame
      accent={accent}
      kicker="Share Comparison"
      title={`${leftName} vs ${rightName}`}
      subtitle="Head-to-head across the final squad metrics"
      footer={
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <MetricPill label={leftName} value={`${comparison.leftWins} wins`} accent={comparison.overallWinner === 'left' ? '#4de2ff' : undefined} />
            <MetricPill label={rightName} value={`${comparison.rightWins} wins`} accent={comparison.overallWinner === 'right' ? '#7ce2b7' : undefined} />
          </div>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 10 }}>
        {comparison.metrics.map((metric) => (
          <div
            key={metric.id}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
              gap: 8,
              alignItems: 'center',
              padding: '9px 11px',
              borderRadius: 16,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)'
            }}
          >
            <strong style={{ fontSize: 11 }}>{metric.leftValue}</strong>
            <span style={{ ...labelStyle, textAlign: 'center' }}>{metric.label}</span>
            <strong style={{ fontSize: 11, textAlign: 'right' }}>{metric.rightValue}</strong>
          </div>
        ))}
      </div>
    </ShareCardFrame>
  )
}

function MetricPill({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${accent ? `${accent}55` : 'rgba(255,255,255,0.08)'}`,
        background: accent ? `${accent}14` : 'rgba(255,255,255,0.04)',
        padding: '9px 11px',
        display: 'grid',
        gap: 5
      }}
    >
      <span style={labelStyle}>{label}</span>
      <strong style={{ fontSize: 12, lineHeight: 1.15 }}>{value}</strong>
    </div>
  )
}
import { APP_NAME } from '@/lib/branding'
