import { CreatorBranding } from '@/components/shared/CreatorBranding'

export function HeroSide() {
  const featureCards = [
    {
      title: 'Live Auction Rooms',
      copy: 'Private rooms for your auction group.'
    },
    {
      title: 'Real Player Pool',
      copy: 'Bid on a deep IPL-inspired player list.'
    },
    {
      title: 'Budget Strategy',
      copy: 'Balance stars, depth, and purse pressure.'
    },
    {
      title: 'Multiplayer With Friends',
      copy: 'Compete live with friends in real time.'
    }
  ]

  const mobileHighlights = [
    { label: 'Teams', value: '10' },
    { label: 'Players', value: '250+' },
    { label: 'Purse', value: '₹250Cr' }
  ]

  return (
    <>
      <section className="auth-hero auth-hero-desktop">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>

        <div className="hero-content">
          <div className="auth-hero-shell">
            <div className="auth-hero-copy">
              <p className="hero-eyebrow">Multiplayer Auction Game</p>
              <h1 className="hero-title auth-hero-title">
                <span className="line-1">IPL Auction</span>
                <span className="line-2">Game</span>
              </h1>
              <p className="hero-desc auth-hero-desc">
                Build your franchise, outbid rivals, and compete with friends in a realistic IPL auction simulation.
              </p>
            </div>

            <section className="auth-stats-grid" aria-label="Platform stats">
              <div className="auth-stat-card">
                <span className="auth-stat-value">10</span>
                <span className="auth-stat-label">Teams</span>
              </div>
              <div className="auth-stat-card">
                <span className="auth-stat-value">250+</span>
                <span className="auth-stat-label">Players</span>
              </div>
              <div className="auth-stat-card">
                <span className="auth-stat-value">₹250Cr</span>
                <span className="auth-stat-label">Budget</span>
              </div>
            </section>

            <section className="auth-feature-grid" aria-label="Platform features">
              {featureCards.map((feature) => (
                <div key={feature.title} className="auth-feature-card">
                  <strong>{feature.title}</strong>
                  <span>{feature.copy}</span>
                </div>
              ))}
            </section>

            <CreatorBranding variant="auth-panel" />
          </div>
        </div>
      </section>

      <section className="auth-mobile-hero">
        <div className="auth-mobile-backdrop auth-mobile-backdrop-gold" />
        <div className="auth-mobile-backdrop auth-mobile-backdrop-blue" />

        <div className="auth-mobile-hero-top">
          <div className="auth-mobile-hero-copy">
            <span className="auth-mobile-kicker">Multiplayer Auction Game</span>
            <h1 className="auth-mobile-title">
              <span>IPL Auction Game</span>
              <strong>Build Your Dream Squad</strong>
            </h1>
            <p className="auth-mobile-tagline">Bid smart. Build your team. Beat your friends.</p>
          </div>

          <div className="auth-mobile-stat-pills" aria-label="Platform stats">
            {mobileHighlights.map((item) => (
              <div key={item.label} className="auth-mobile-stat-pill">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

      </section>
    </>
  )
}

export default HeroSide
