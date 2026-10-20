import { shell } from 'electron'
import { trustedHandle } from './guard'

// Unsigned derivative releases are downloaded manually; never replace an upstream app.
export const registerUpdaterHandlers = (): void => {
  trustedHandle('mt::update-check', async() => ({ hasUpdate: false, error: 'Manual updates only: https://github.com/ZWLFI/zmarkdown/releases' }))
  trustedHandle('mt::update-download', async() => { throw new Error('Automatic updates are disabled in zmarkdown') })
  trustedHandle('mt::update-install', async() => { throw new Error('Automatic installation is disabled in zmarkdown') })
  trustedHandle('mt::update-open-release', async() => {
    await shell.openExternal('https://github.com/ZWLFI/zmarkdown/releases')
    return { ok: true }
  })
}
