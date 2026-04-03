import { RealtimeDiagnosticsClient } from '@/components/admin/RealtimeDiagnosticsClient'
import { PageNavbar } from '@/components/shared/PageNavbar'
import { UnofficialDisclaimer } from '@/components/shared/UnofficialDisclaimer'
import { getAuthenticatedPageUser, isMatchResultsAdmin } from '@/lib/server-auth'
import { redirect } from 'next/navigation'

export default async function RealtimeAdminPage() {
  const user = await getAuthenticatedPageUser()

  if (!user) {
    redirect('/auth/login')
  }

  if (!isMatchResultsAdmin(user.id)) {
    redirect('/')
  }

  return (
    <div className="screen page-with-navbar">
      <PageNavbar subtitle="REALTIME DIAGNOSTICS" showHome />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
        <UnofficialDisclaimer compact />
        <RealtimeDiagnosticsClient />
      </main>
    </div>
  )
}
