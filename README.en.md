# zmarkdown

Markdown editor maintained by **ZWLFI (derivative maintainer)**, based on
[MoMark](https://github.com/lixiaoshuang79/momark) and [MarkText](https://github.com/marktext/marktext).

Version **1.6.0** introduces a compact macOS tab/title row, optional 24px status bar,
comfortable/wide reading preferences, and refined light/dark typography.
Control+B hides auxiliary UI while preserving prose width; Command+B remains bold.

## Downloads and source

[Releases](https://github.com/ZWLFI/zmarkdown/releases) ·
[Source](https://github.com/ZWLFI/zmarkdown) ·
[Issues](https://github.com/ZWLFI/zmarkdown/issues)

Only macOS Apple Silicon (arm64) is validated for this release. The app is unsigned
and not notarized. Intel, Windows and Linux binaries are not supplied as tested releases.
Physical window-button clicks, title-row dragging/double-click and a real IME candidate
window remain unverified; automated composition and window APIs were tested.

zmarkdown uses a separate application identity and data directory. It does not migrate,
overwrite or remove MoMark data. Automatic installation is disabled; releases are manual.

## Build from source

Use Node >=20.19, pnpm 10 and the macOS native build toolchain:

```sh
pnpm install --frozen-lockfile
pnpm --filter zmarkdown rebuild-native
pnpm minify-locales
pnpm --filter zmarkdown build:unpack
pnpm --filter zmarkdown exec electron-builder --mac --arm64 --dir --publish never
```

Run `pnpm typecheck` and `pnpm --filter zmarkdown test:e2e` for validation.
Source archives and release tags identify the corresponding source for each binary.
CI checks metadata only; no workflow automatically publishes other platforms.

## License and attribution

The combined project remains **AGPL-3.0-only**; see [LICENSE](LICENSE).
Original copyright notices and MarkText's [MIT license](LICENSE-MIT) are retained.
See [NOTICE](NOTICE.md) and bundled third-party license information.
ZWLFI is credited for maintaining this derivative, not as author of all upstream code.
Upstream documentation and workflow files are retained under `docs/` as historical references.
