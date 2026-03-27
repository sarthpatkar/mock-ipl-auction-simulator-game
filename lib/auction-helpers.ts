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
    primary: '#FBE122',
    secondary: '#1C3F94',
    accent: '#FDB913',
    surface: 'rgba(253, 185, 19, 0.09)',
    border: 'rgba(253, 185, 19, 0.24)',
    glow: 'rgba(251, 225, 34, 0.18)'
  },
  MI: {
    primary: '#004BA0',
    secondary: '#D1AB3E',
    accent: '#1C6DD0',
    surface: 'rgba(28, 109, 208, 0.09)',
    border: 'rgba(28, 109, 208, 0.25)',
    glow: 'rgba(0, 75, 160, 0.16)'
  },
  RCB: {
    primary: '#DA1818',
    secondary: '#000000',
    accent: '#C9A643',
    surface: 'rgba(218, 24, 24, 0.09)',
    border: 'rgba(218, 24, 24, 0.24)',
    glow: 'rgba(201, 166, 67, 0.14)'
  },
  KKR: {
    primary: '#3A225D',
    secondary: '#F2C028',
    accent: '#6A4C93',
    surface: 'rgba(106, 76, 147, 0.1)',
    border: 'rgba(106, 76, 147, 0.25)',
    glow: 'rgba(242, 192, 40, 0.14)'
  },
  DC: {
    primary: '#17449B',
    secondary: '#E41E26',
    accent: '#6FA8FF',
    surface: 'rgba(111, 168, 255, 0.09)',
    border: 'rgba(111, 168, 255, 0.24)',
    glow: 'rgba(228, 30, 38, 0.12)'
  },
  SRH: {
    primary: '#FF822A',
    secondary: '#000000',
    accent: '#FFB347',
    surface: 'rgba(255, 179, 71, 0.09)',
    border: 'rgba(255, 130, 42, 0.24)',
    glow: 'rgba(255, 130, 42, 0.15)'
  },
  RR: {
    primary: '#EA1A8C',
    secondary: '#254AA5',
    accent: '#FF66C4',
    surface: 'rgba(255, 102, 196, 0.09)',
    border: 'rgba(234, 26, 140, 0.24)',
    glow: 'rgba(37, 74, 165, 0.12)'
  },
  PBKS: {
    primary: '#DD1F2D',
    secondary: '#4960B6',
    accent: '#F2D1A0',
    surface: 'rgba(221, 31, 45, 0.09)',
    border: 'rgba(221, 31, 45, 0.24)',
    glow: 'rgba(242, 209, 160, 0.13)'
  },
  GT: {
    primary: '#1C1C2E',
    secondary: '#00AEEF',
    accent: '#FFD700',
    surface: 'rgba(0, 174, 239, 0.08)',
    border: 'rgba(0, 174, 239, 0.22)',
    glow: 'rgba(255, 215, 0, 0.12)'
  },
  LSG: {
    primary: '#00AEEF',
    secondary: '#FF7F50',
    accent: '#7CFC00',
    surface: 'rgba(0, 174, 239, 0.08)',
    border: 'rgba(124, 252, 0, 0.22)',
    glow: 'rgba(255, 127, 80, 0.14)'
  }
}

const TEAM_ALIASES: Record<string, TeamCode> = {
  'CHENNAI SUPER KINGS': 'CSK',
  CSK: 'CSK',
  'MUMBAI INDIANS': 'MI',
  MI: 'MI',
  'ROYAL CHALLENGERS BENGALURU': 'RCB',
  'ROYAL CHALLENGERS BANGALORE': 'RCB',
  RCB: 'RCB',
  'KOLKATA KNIGHT RIDERS': 'KKR',
  KKR: 'KKR',
  'DELHI CAPITALS': 'DC',
  DC: 'DC',
  'SUNRISERS HYDERABAD': 'SRH',
  SRH: 'SRH',
  'RAJASTHAN ROYALS': 'RR',
  RR: 'RR',
  'PUNJAB KINGS': 'PBKS',
  PBKS: 'PBKS',
  'LUCKNOW SUPER GIANTS': 'LSG',
  LSG: 'LSG',
  'GUJARAT TITANS': 'GT',
  GT: 'GT'
}

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
  const direct = TEAM_ALIASES[normalized]
  if (direct) return direct

  const compact = normalized.replace(/[^A-Z]/g, '')
  const match = Object.entries(TEAM_ALIASES).find(([alias]) => compact.includes(alias.replace(/[^A-Z]/g, '')))
  return match?.[1] || null
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
