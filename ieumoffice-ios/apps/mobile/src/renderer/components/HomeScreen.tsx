import type { RecentDocEntry, RecoveryEntry } from '@genoffice/mobile-bridge/transport'
import { useMobileLocale } from '../i18n'
import {
  DocTypeIcon,
  IconSettings,
  AllEditorAppIcon,
} from './MobileIcons'
import { CreditFooter, RecentDocuments, UnifiedHomeSection } from './OfficeSuite'

export interface HomeScreenProps {
  readonly recentDocs: readonly RecentDocEntry[]
  readonly recoveryEntries: readonly RecoveryEntry[]
  readonly permissionDeniedRecentId: string | null
  readonly defaultHwpFormat: 'hwp' | 'hwpx'
  readonly onCreateNew: (format: 'hwp' | 'hwpx' | 'md') => void
  readonly onOpenFile: () => void
  readonly onOpenRecent: (entry: RecentDocEntry) => void
  readonly onRemoveRecent: (id: string) => void
  readonly onRestoreRecovery: (entry: RecoveryEntry) => void
  readonly onDiscardRecovery: (docKey: string) => void
  readonly onOpenSettings: () => void
}

export function HomeScreen({
  recoveryEntries,
  defaultHwpFormat,
  onOpenFile,
  onRestoreRecovery,
  onDiscardRecovery,
  onOpenSettings,
}: HomeScreenProps) {
  const { t } = useMobileLocale()

  return (
    <div className="mobile-page" data-testid="mobile-home-screen">
      <header className="mobile-appbar">
        <div className="mobile-brand-wrap">
          <AllEditorAppIcon size={28} />
          <h1 className="mobile-appbar-title">AllEditor</h1>
        </div>
        <button
          type="button"
          className="mobile-icon-btn"
          onClick={onOpenSettings}
          aria-label={t('settings')}
          title={t('settings')}
          data-testid="home-settings-btn"
        >
          <IconSettings size={21} />
        </button>
      </header>

      <main className="mobile-page-body">
        {recoveryEntries.length > 0 && (
          <section
            className="mobile-card mobile-recovery-banner"
            aria-label={t('recoveryBannerTitle')}
            data-testid="home-recovery-banner"
          >
            <h2 className="mobile-section-title">{t('recoveryBannerTitle')}</h2>
            <ul className="mobile-list">
              {recoveryEntries.map((entry) => (
                <li key={entry.docKey} className="mobile-list-item-col">
                  <div className="mobile-list-row">
                    <div className="mobile-list-meta">
                      <DocTypeIcon format={entry.format} size={26} />
                      <span className="mobile-list-name">{entry.title}</span>
                      <span className="mobile-badge">{entry.format.toUpperCase()}</span>
                    </div>
                  </div>
                  <div className="mobile-row-actions">
                    <button
                      type="button"
                      className="mobile-touch-btn mobile-btn-primary"
                      onClick={() => onRestoreRecovery(entry)}
                    >
                      {t('recoveryRestore')}
                    </button>
                    <button
                      type="button"
                      className="mobile-touch-btn mobile-btn-ghost"
                      onClick={() => onDiscardRecovery(entry.docKey)}
                    >
                      {t('recoveryDiscard')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <UnifiedHomeSection hwpFormat={defaultHwpFormat} onOpenAny={onOpenFile} />

        <RecentDocuments />

        <CreditFooter />
      </main>
    </div>
  )
}
