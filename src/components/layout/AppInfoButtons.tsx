import { Info } from 'lucide-react'
import { useState } from 'react'
import { version } from '../../../package.json'
import { useT } from '../../lib/i18n'
import { Dialog, DialogContent, Tip } from '../ui/kit'

const PROJECT_URL = 'https://github.com/darkmatter2048/JianJi'
const RELEASES_URL = `${PROJECT_URL}/releases`

export function AppInfoButtons() {
  const t = useT()
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <>
      <Tip label={t('关于')} side="bottom">
        <button
          type="button"
          className="topbar__save"
          aria-label={t('关于')}
          onClick={() => setAboutOpen(true)}
        >
          <Info size={15} />
        </button>
      </Tip>
      <Tip label={t('检查更新')} side="bottom">
        <a
          className="topbar__save"
          aria-label={t('检查更新')}
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.74-1.55-2.57-.3-5.27-1.29-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.96 10.96 0 0 1 5.75 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.71 5.39-5.28 5.68.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
          </svg>
        </a>
      </Tip>
      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        {aboutOpen && (
          <DialogContent title={t('关于简辑')} width={400}>
            <p>{t('简辑')} · JianJi</p>
            <p className="ui-dialog__note">{t('当前版本：{version}', { version })}</p>
            <p className="ui-dialog__note">{t('轻松制作三维场景与产品演示视频。')}</p>
            <div className="app-info__actions">
              <a className="ui-btn ui-btn--outline" href={PROJECT_URL} target="_blank" rel="noopener noreferrer">
                {t('项目主页')}
              </a>
              <a className="ui-btn ui-btn--primary" href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
                {t('查看发布页')}
              </a>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
