import type { Metadata } from 'next'
import { Bebas_Neue, Rajdhani, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const fontDisplay = Bebas_Neue({ subsets: ['latin'], weight: '400', variable: '--font-display' })
const fontBody = Rajdhani({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body' })
const fontMono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'IPL Auction Simulator',
  description: 'Real-time multiplayer IPL auction rooms powered by Supabase.'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
