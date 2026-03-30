import type { Metadata } from 'next'
import Script from 'next/script'
import { Bebas_Neue, Rajdhani, JetBrains_Mono } from 'next/font/google'
import { ThemeProvider, THEME_STORAGE_KEY } from '@/components/theme/ThemeProvider'
import './globals.css'

const fontDisplay = Bebas_Neue({ subsets: ['latin'], weight: '400', variable: '--font-display' })
const fontBody = Rajdhani({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body' })
const fontMono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'IPL Auction Simulator',
  description: 'Real-time multiplayer IPL auction rooms powered by Supabase.'
}

const themeInitScript = `
  (function () {
    try {
      var key = ${JSON.stringify(THEME_STORAGE_KEY)};
      var stored = window.localStorage.getItem(key);
      var theme = stored === 'light' || stored === 'dark' ? stored : 'dark';
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch (error) {
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.style.colorScheme = 'dark';
    }
  })();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}>
      <body className="min-h-screen antialiased">
        <Script id="ipl-theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
