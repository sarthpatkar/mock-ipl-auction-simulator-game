import { CreatorBranding } from '@/components/shared/CreatorBranding'

export function HeroSide() {
  return (
    <div className="auth-hero">
      <div className="blob blob-1"></div>
      <div className="blob blob-2"></div>

      <div className="hero-content">
        <p className="hero-eyebrow">Live Bidding Platform</p>
        <h1 className="hero-title">
          <span className="line-1">IPL</span>
          <span className="line-2">AUCTION</span>
          <span className="line-3">GAME</span>
        </h1>
        <p className="hero-desc">
          Build your franchise. Outbid rivals. Win the tournament. The most realistic IPL auction simulation — live, with
          friends.
        </p>
        <CreatorBranding variant="auth" />
        <div className="hero-stats">
          <div className="hero-stat">
            <span className="hero-stat-num">10</span>
            <span className="hero-stat-label">Max Teams</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-num">250+</span>
            <span className="hero-stat-label">Players</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-num">₹250Cr</span>
            <span className="hero-stat-label">Max Budget</span>
          </div>
        </div>
      </div>

      <div className="floating-card">
        <div className="fc-role">Batter</div>
        <div className="fc-name">VIRAT KOHLI</div>
        <div className="fc-team">RCB</div>
        <div className="fc-divider"></div>
        <div className="fc-price-label">SOLD FOR</div>
        <div className="fc-price">₹21 Cr</div>
      </div>
    </div>
  )
}

export default HeroSide
