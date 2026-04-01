import type { CSSProperties } from 'react'

const CR = 10_000_000 // 1 Crore in paise units
const L = 100_000 // 1 Lakh

type TeamCode = 'CSK' | 'MI' | 'RCB' | 'KKR' | 'DC' | 'SRH' | 'RR' | 'PBKS' | 'GT' | 'LSG'

type TeamTheme = {
  primary: string
  secondary: string
  accent: string
  surface: string
  border: string
  glow: string
}

const TEAM_THEMES: Record<TeamCode, TeamTheme> = {
  CSK: {
    primary: '#0F766E',
    secondary: '#99F6E4',
    accent: '#2DD4BF',
    surface: 'rgba(45, 212, 191, 0.1)',
    border: 'rgba(45, 212, 191, 0.26)',
    glow: 'rgba(45, 212, 191, 0.18)'
  },
  MI: {
    primary: '#1D4ED8',
    secondary: '#BFDBFE',
    accent: '#60A5FA',
    surface: 'rgba(96, 165, 250, 0.1)',
    border: 'rgba(96, 165, 250, 0.26)',
    glow: 'rgba(96, 165, 250, 0.16)'
  },
  RCB: {
    primary: '#B91C1C',
    secondary: '#FECACA',
    accent: '#FB7185',
    surface: 'rgba(251, 113, 133, 0.1)',
    border: 'rgba(251, 113, 133, 0.24)',
    glow: 'rgba(251, 113, 133, 0.16)'
  },
  KKR: {
    primary: '#6D28D9',
    secondary: '#DDD6FE',
    accent: '#A78BFA',
    surface: 'rgba(167, 139, 250, 0.1)',
    border: 'rgba(167, 139, 250, 0.25)',
    glow: 'rgba(167, 139, 250, 0.16)'
  },
  DC: {
    primary: '#0F172A',
    secondary: '#CBD5E1',
    accent: '#38BDF8',
    surface: 'rgba(56, 189, 248, 0.1)',
    border: 'rgba(56, 189, 248, 0.24)',
    glow: 'rgba(56, 189, 248, 0.16)'
  },
  SRH: {
    primary: '#C2410C',
    secondary: '#FED7AA',
    accent: '#FB923C',
    surface: 'rgba(251, 146, 60, 0.1)',
    border: 'rgba(251, 146, 60, 0.24)',
    glow: 'rgba(251, 146, 60, 0.16)'
  },
  RR: {
    primary: '#BE185D',
    secondary: '#FBCFE8',
    accent: '#F472B6',
    surface: 'rgba(244, 114, 182, 0.1)',
    border: 'rgba(244, 114, 182, 0.24)',
    glow: 'rgba(244, 114, 182, 0.16)'
  },
  PBKS: {
    primary: '#7C2D12',
    secondary: '#FED7AA',
    accent: '#FDBA74',
    surface: 'rgba(253, 186, 116, 0.1)',
    border: 'rgba(253, 186, 116, 0.24)',
    glow: 'rgba(253, 186, 116, 0.16)'
  },
  GT: {
    primary: '#1E293B',
    secondary: '#E2E8F0',
    accent: '#22D3EE',
    surface: 'rgba(34, 211, 238, 0.1)',
    border: 'rgba(34, 211, 238, 0.24)',
    glow: 'rgba(34, 211, 238, 0.16)'
  },
  LSG: {
    primary: '#14532D',
    secondary: '#DCFCE7',
    accent: '#4ADE80',
    surface: 'rgba(74, 222, 128, 0.1)',
    border: 'rgba(74, 222, 128, 0.24)',
    glow: 'rgba(74, 222, 128, 0.16)'
  }
}

const TEAM_CODES: TeamCode[] = ['CSK', 'MI', 'RCB', 'KKR', 'DC', 'SRH', 'RR', 'PBKS', 'GT', 'LSG']

export function getBidIncrements(currentPrice: number): { label: string; amount: number }[] {
  if (currentPrice < 5 * CR) {
    return [{ label: '+25L', amount: 25 * L }]
  }
  if (currentPrice < 7 * CR) {
    return [{ label: '+50L', amount: 50 * L }]
  }
  return [{ label: '+1Cr', amount: CR }]
}

export function formatPrice(paise: number): string {
  const cr = paise / 10_000_000
  const l = paise / 100_000
  if (cr >= 1) return `₹${cr % 1 === 0 ? cr : cr.toFixed(2)} Cr`
  return `₹${l}L`
}

export function formatRole(role: 'batter' | 'wicketkeeper' | 'allrounder' | 'bowler'): string {
  if (role === 'allrounder') return 'AR'
  if (role === 'wicketkeeper') return 'WK'
  if (role === 'bowler') return 'Bowler'
  return 'Batter'
}

export function formatRolePlural(role: 'batter' | 'wicketkeeper' | 'allrounder' | 'bowler'): string {
  if (role === 'allrounder') return 'All-rounders'
  if (role === 'wicketkeeper') return 'Wicketkeepers'
  if (role === 'bowler') return 'Bowlers'
  return 'Batters'
}

export function getTeamColor(team?: string | null): string {
  const code = getTeamCode(team)
  if (!code) return '#94a3b8'
  return TEAM_THEMES[code]?.accent || '#94a3b8'
}

export function isInternalPlayerImageUrl(url?: string | null): boolean {
  if (!url) return false
  return /\/storage\/v1\/object\/public\//.test(url)
}

export function getTeamCode(team?: string | null): TeamCode | null {
  if (!team) return null
  const normalized = team.trim().toUpperCase()
  if ((TEAM_CODES as string[]).includes(normalized)) {
    return normalized as TeamCode
  }

  const tokens = normalized.split(/[^A-Z]+/).filter(Boolean)
  const match = TEAM_CODES.find((code) => tokens.includes(code))
  return match ?? null
}

export function getTeamThemeClass(team?: string | null): string {
  const code = getTeamCode(team)
  return code ? `team-${code.toLowerCase()}` : 'team-neutral'
}

export function getTeamTheme(team?: string | null): TeamTheme | null {
  const code = getTeamCode(team)
  return code ? TEAM_THEMES[code] : null
}

export function getTeamThemeStyle(team?: string | null): CSSProperties {
  const theme = getTeamTheme(team)
  if (!theme) return {}

  return {
    ['--team-primary' as string]: theme.primary,
    ['--team-secondary' as string]: theme.secondary,
    ['--team-accent' as string]: theme.accent,
    ['--team-surface' as string]: theme.surface,
    ['--team-border' as string]: theme.border,
    ['--team-glow' as string]: theme.glow
  }
}

export function formatAuctionStatus(status?: string | null): string {
  if (!status) return 'Standby'
  if (status === 'accelerated_selection') return 'Accelerated'
  return status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
