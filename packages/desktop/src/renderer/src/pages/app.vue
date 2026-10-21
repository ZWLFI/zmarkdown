<template>
  <div
    class="editor-container"
    :style="focusReadingWidth ? { '--focus-reading-width': focusReadingWidth } : undefined"
    :class="{ 'distraction-free': focus, 'focus-right': focus && focusRight, 'wide-reading': editorLineWidth === '100%', 'compact-mac': platform === 'darwin' }"
  >
    <div class="editor-middle">
      <title-bar
        v-if="platform !== 'darwin'"
        :project="projectTree"
        :pathname="pathname"
        :filename="filename"
        :active="windowActive"
        :platform="platform"
        :is-saved="isSaved"
        :tab-count="titleTabCount"
      />

      <!-- 标签栏：win-body 之上的全宽行（PHASE2-SPEC §1：标题栏 40px /
           标签栏 40px）。面包屑行已按用户要求取消——路径信息只在顶栏显示。
           单文档态同样渲染该行（只保留两端侧栏开关、标签条隐藏）：
           左右开关单/多文档位置统一（用户拍板）。 -->
      <div
        v-if="init"
        class="editor-chrome"
      >
        <editor-tabs />
        <right-panel-header />
      </div>

      <!-- 主体三栏：侧栏 / 编辑区列 / 分隔线 / 右侧浏览器面板
           （PHASE2-SPEC §1/§3：win-body 行从面包屑行之下开始） -->
      <div
        class="win-body"
        :class="winBodyClasses"
      >
        <side-bar v-if="init" />

        <div class="editor-main-col">
          <div
            v-if="!init"
            class="editor-placeholder"
          />
          <recent v-if="!hasCurrentFile && init" />
          <editor-with-tabs
            v-if="hasCurrentFile && init"
            :markdown="markdown"
            :cursor="cursor"
            :muya-index-cursor="muyaIndexCursor"
            :source-code="sourceCode"
            :text-direction="textDirection"
            :platform="platform"
          />
        </div>

        <splitter v-if="showSplitter" />
        <split-drop-zone />
        <browser-panel />
      </div>

      <footer
        v-if="hasCurrentFile && showStatusBar"
        class="workspace-status"
      >
        <span
          class="save-state"
          :class="{ dirty: !titleStats.isSaved }"
        >
          {{ titleStats.isSaved ? t('statusBar.saved') : t('statusBar.unsaved') }}
        </span>
        <span>{{ titleStats.wordCount?.word ?? 0 }} {{ t('workspace.words') }}</span>
        <div class="status-actions">
          <button
            :aria-pressed="editorLineWidth !== '100%'"
            @click="toggleReadingWidth"
          >
            {{ editorLineWidth === '100%' ? t('workspace.comfortable') : t('workspace.wide') }}
          </button>
          <button
            :aria-pressed="focus"
            @click="toggleFocus"
          >
            {{ t('workspace.focus') }} · ⌃B
          </button>
        </div>
      </footer>
      <button
        v-if="focus"
        class="focus-exit"
        @mousedown.prevent
        @click="toggleFocus"
      >
        {{ t('workspace.exitFocus') }} · ⌃B
      </button>

      <command-palette />
      <export-setting-dialog />
      <rename />
      <import-modal />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
import { useMainStore } from '@/store'
import { storeToRefs } from 'pinia'
import { wordCount as wordCountFromMarkdown } from '@muyajs/core'
import type { FileWordCount } from '@shared/types/files'
import { addStyles, addThemeStyle, addCustomStyle, type AddStylesOptions } from '@/util/theme'
import Recent from '@/components/recent/index.vue'
import EditorWithTabs from '@/components/editorWithTabs/index.vue'
import EditorTabs from '@/components/editorWithTabs/tabs.vue'
import RightPanelHeader from '@/components/browserPanel/panelHeader.vue'
import TitleBar from '@/components/titleBar/index.vue'
import SideBar from '@/components/sideBar/index.vue'
import CommandPalette from '@/components/commandPalette/index.vue'
import ExportSettingDialog from '@/components/exportSettings/index.vue'
import Rename from '@/components/rename/index.vue'
import ImportModal from '@/components/import/index.vue'
import BrowserPanel from '@/components/browserPanel/index.vue'
import Splitter from '@/components/splitter.vue'
import SplitDropZone from '@/components/splitDropZone.vue'
import bus from '@/bus'
import { t } from '@/i18n'
import { DEFAULT_STYLE } from '@/config'
import { useLayoutStore } from '@/store/layout'
import { useListenForMainStore } from '@/store/listenForMain'
import { usePreferencesStore } from '@/store/preferences'

// round9 滚动条极简 overlay：哪个容器在滚，就给哪个容器标上 data-scroll-engaged
// （window 捕获阶段统一接 scroll 事件），停止 650ms 后移除——它自己的滑块随之
// 淡入/淡出。
// 用属性、只标滚动容器自身，都是为了不触发整篇样式重算：全局样式里有
// Element Plus 的 `[class*=…]` 后代选择器，任何元素的 class 一变，Blink 都要把
// 它所有带 class 的后代作废重算——原先每次滚动开始/结束给 body 加减类名，2MB
// 文档每次约 0.8s（2026-10-15 实测 37.5 万元素），滚动时成串卡顿。data-* 属性
// 只命中 assets/styles/index.css 里那条滑块规则，失效范围只有滚动容器自己。
const scrollEngageTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>()
const engageScrollbars = (event: Event) => {
  const scroller = event.target instanceof Element ? event.target : document.scrollingElement
  if (!scroller) return
  if (!scroller.hasAttribute('data-scroll-engaged')) {
    scroller.setAttribute('data-scroll-engaged', '')
  }
  clearTimeout(scrollEngageTimers.get(scroller))
  scrollEngageTimers.set(
    scroller,
    setTimeout(() => scroller.removeAttribute('data-scroll-engaged'), 650)
  )
}
window.addEventListener('scroll', engageScrollbars, { capture: true, passive: true })
onBeforeUnmount(() => {
  window.removeEventListener('scroll', engageScrollbars, { capture: true })
})
import { useEditorStore } from '@/store/editor'
import { useCommandCenterStore } from '@/store/commandCenter'
import { useProjectStore } from '@/store/project'
import { useNotificationStore } from '@/store/notification'
import { useBrowserPanelStore } from '@/store/browserPanel'
import { useSplitStore } from '@/store/split'
import { useWorkspaceStore } from '@/store/workspace'

const mainStore = useMainStore()
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()
const layoutStore = useLayoutStore()
const projectStore = useProjectStore()
const listenForMainStore = useListenForMainStore()
const commandCenterStore = useCommandCenterStore()
const notificationStore = useNotificationStore()
const bpStore = useBrowserPanelStore()
const splitStore = useSplitStore()
const workspaceStore = useWorkspaceStore()

const timer = ref<ReturnType<typeof setTimeout> | null>(null)

const toggleFocus = () => bus.emit('view:toggle-view-entry', 'focus')
const toggleReadingWidth = () =>
  preferencesStore.SET_SINGLE_PREFERENCE({
    type: 'editorLineWidth',
    value: editorLineWidth.value === '100%' ? '720px' : '100%'
  })
const focusRight = ref(false)
const focusReadingWidth = ref('')
let focusScroll: Array<{ element: Element; top: number; left: number }> = []
watch(
  () => preferencesStore.focus,
  async (enabled) => {
    if (enabled) {
      focusRight.value = splitStore.active && splitStore.docFocused && bpStore.activeTab === 'doc'
      const readingArea = document.querySelector(
        focusRight.value ? '.bpanel .mu-container' : '.editor-main-col .mu-container'
      )
      focusReadingWidth.value = readingArea ? `${readingArea.getBoundingClientRect().width}px` : ''
      focusScroll = Array.from(document.querySelectorAll('.editor-component, .source-code')).map(
        (element) => ({
          element,
          top: element.scrollTop,
          left: element.scrollLeft
        })
      )
    } else {
      await nextTick()
      requestAnimationFrame(() => {
        for (const { element, top, left } of focusScroll) {
          if (element.isConnected) element.scrollTo(left, top)
        }
        focusScroll = []
      })
    }
  }
)

const { windowActive, platform, init } = storeToRefs(mainStore)
const { sourceCode, theme, customCss, textDirection, zoom, focus, editorLineWidth, showStatusBar } =
  storeToRefs(preferencesStore)
const { projectTree } = storeToRefs(projectStore)
const { currentFile, tabs } = storeToRefs(editorStore)
const { open: bpanelOpen } = storeToRefs(bpStore)
const { active: splitActive, draggingSplit } = storeToRefs(splitStore)
const { scene } = storeToRefs(workspaceStore)

const pathname = computed(() => currentFile.value?.pathname)
const filename = computed(() => currentFile.value?.filename)
// 未命名文档从未保存过：展示层一律视为「未保存」（store 内 isSaved 仍为 true，
// 保证空白 untitled 关闭不弹保存框；一旦修改 json-change 会置 false 走弹窗路径）。
const isSaved = computed(() => {
  const f = currentFile.value
  if (!f) return undefined
  return !!f.pathname && f.isSaved
})

// round10：顶栏右上角字数/保存状态的数据源——光标落在右栏文档编辑器时
// 显示分屏文档的数据（split.docFocused），否则默认显示左侧当前文档。
const titleStats = computed<{ wordCount: FileWordCount | null; isSaved: boolean | undefined }>(
  () => {
    if (splitStore.active && splitStore.docFocused && splitStore.tabId) {
      const tab = tabs.value.find((t) => t.id === splitStore.tabId)
      if (tab) {
        const wc = tab.wordCount
        const md = tab.markdown
        const storedUsable =
          !!wc &&
          (wc.word !== undefined || wc.character !== undefined) &&
          (wc.word > 0 || wc.character > 0 || wc.paragraph > 0 || wc.all > 0)
        const tabWordCount: FileWordCount | null = storedUsable
          ? wc
          : typeof md === 'string' && md.length > 0
            ? wordCountFromMarkdown(md)
            : (wc ?? null)
        return { wordCount: tabWordCount, isSaved: !!tab.pathname && tab.isSaved }
      }
    }
    return { wordCount: wordCount.value, isSaved: isSaved.value }
  }
)
// 标题区（PHASE2-SPEC §1/§10）：仅 single 场景显示状态点+完整路径；
// multi / split-* 场景标题区留空 —— 用 tabCount>1 的既有判定表达。
const titleTabCount = computed(() => (scene.value === 'single' ? tabs.value.length : 2))
// `markdown` is read by `<editor-with-tabs>` whose prop is `required: true`.
// In template space we render that subtree only when `hasCurrentFile` is set,
// but vue-tsc can't see through the v-if guard — coalesce to '' so the prop
// type is `string`. The `<editor-with-tabs>` mount is still gated.
const markdown = computed<string>(() => currentFile.value?.markdown ?? '')
const cursor = computed(() => currentFile.value?.cursor)
const wordCount = computed(() => {
  const wc = currentFile.value?.wordCount
  const md = currentFile.value?.markdown
  const storedUsable =
    !!wc &&
    (wc.word !== undefined || wc.character !== undefined) &&
    (wc.word > 0 || wc.character > 0 || wc.paragraph > 0 || wc.all > 0)
  // 打开已有内容的文档时 stored 种子是全 0（setContent 不触发 json-change），
  // 全 0 视为「未激活」：有 markdown 就现算兜底；真实编辑后 json-change 写入
  // 非零值走 stored，空文档（md 为空）则如实显示 0。
  if (storedUsable) return wc
  if (typeof md !== 'string' || md.length === 0) return wc ?? null
  return wordCountFromMarkdown(md)
})
// `muyaIndexCursor` is loosely typed as `unknown` on the editor store; the
// downstream prop expects `Object | undefined`. Cast at the boundary.
const muyaIndexCursor = computed<Record<string, unknown> | undefined>(
  () => currentFile.value?.muyaIndexCursor as Record<string, unknown> | undefined
)

const hasCurrentFile = computed<boolean>(() => {
  return currentFile.value?.markdown !== undefined
})

// win-body 状态类（PHASE2-SPEC §3/§5 / STATE-MACHINE）：
// .panel-open = 面板展开；.split = 分屏激活（左列 padding 收窄对齐）；
// .dragging-split = 分隔线拖动中（禁用面板宽度过渡 + 全局 col-resize）。
const winBodyClasses = computed(() => ({
  'panel-open': bpanelOpen.value,
  split: splitActive.value,
  'dragging-split': draggingSplit.value
}))

// 分隔线：面板展开即显示——文档分屏、网页模式、文档模式空态均可拖动调整宽度
// （用户反馈：文档 TAB 未打开文档时分栏宽度也要能调）。
const showSplitter = computed(() => bpanelOpen.value)

// Watchers
watch(theme, (value, oldValue) => {
  if (value !== oldValue) {
    addThemeStyle(value)
  }
})

watch(customCss, (value, oldValue) => {
  if (value !== oldValue) {
    addCustomStyle({
      customCss: value
    })
  }
})

watch(zoom, (zoomValue) => {
  bus.emit('mt::window-zoom', zoomValue)
})

const setupDragDropHandler = (): void => {
  window.addEventListener(
    'dragover',
    (e: DragEvent) => {
      if (!e.dataTransfer || !e.dataTransfer.types.length) return

      if (e.dataTransfer.types.indexOf('Files') >= 0) {
        if (
          e.dataTransfer.items.length === 1 &&
          e.dataTransfer.items[0]!.type.indexOf('image') > -1
        ) {
          // Do nothing
        } else {
          e.preventDefault()
          if (timer.value) {
            clearTimeout(timer.value)
          }
          timer.value = setTimeout(() => {
            bus.emit('importDialog', false)
          }, 300)
          bus.emit('importDialog', true)
        }
        e.dataTransfer.dropEffect = 'copy'
      } else if (e.dataTransfer.types.indexOf('text/uri-list') >= 0) {
        // A web-link / web-image drag (e.g. an <img> dragged from a browser).
        // The muya editor's own dragover/drop handlers accept these and insert
        // an image block, so leave the drop enabled — forcing dropEffect='none'
        // here would clobber the editor's 'copy' and suppress the drop event.
      } else if (window.__momarkReturnDrag) {
        // 分屏右侧文档标题拖回标签栏的内部拖放（PHASE2-SPEC §3.4）：
        // 放行，由 tabs.vue 的 dragover/drop 处理。
      } else {
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'none'
      }
    },
    false
  )
}
onMounted(async () => {
  if (window.marktext?.initialState) {
    preferencesStore.SET_USER_PREFERENCE(window.marktext.initialState)
  }

  mainStore.LISTEN_WIN_STATUS()
  await commandCenterStore.LISTEN_COMMAND_CENTER_BUS()
  layoutStore.LISTEN_FOR_LAYOUT()
  listenForMainStore.LISTEN_FOR_EDIT()
  preferencesStore.LISTEN_FOR_VIEW()
  listenForMainStore.LISTEN_FOR_SHOW_DIALOG()
  listenForMainStore.LISTEN_FOR_PARAGRAPH_INLINE_STYLE()
  projectStore.LISTEN_FOR_UPDATE_PROJECT()
  projectStore.LISTEN_FOR_LOAD_PROJECT()
  projectStore.LISTEN_FOR_SIDEBAR_CONTEXT_MENU()
  preferencesStore.ASK_FOR_USER_PREFERENCE()
  preferencesStore.LISTEN_TOGGLE_VIEW()
  editorStore.LISTEN_SCREEN_SHOT()
  editorStore.LISTEN_FOR_CLOSE()
  editorStore.LISTEN_FOR_SAVE_AS()
  editorStore.LISTEN_FOR_MOVE_TO()
  editorStore.LISTEN_FOR_SAVE()
  editorStore.LISTEN_FOR_SET_PATHNAME()
  editorStore.LISTEN_FOR_BOOTSTRAP_WINDOW()
  editorStore.LISTEN_FOR_SAVE_CLOSE()
  editorStore.LISTEN_FOR_RENAME()
  editorStore.LISTEN_FOR_SET_LINE_ENDING()
  editorStore.LISTEN_FOR_SET_ENCODING()
  editorStore.LISTEN_FOR_SET_FINAL_NEWLINE()
  editorStore.LISTEN_FOR_NEW_TAB()
  editorStore.LISTEN_FOR_CLOSE_TAB()
  editorStore.LISTEN_FOR_TAB_CYCLE()
  editorStore.LISTEN_FOR_SWITCH_TABS()
  editorStore.LISTEN_FOR_PRINT_SERVICE_CLEARUP()
  editorStore.LISTEN_FOR_EXPORT_SUCCESS()
  editorStore.LISTEN_FOR_FILE_CHANGE()
  editorStore.LISTEN_WINDOW_ZOOM()
  editorStore.LISTEN_FOR_RELOAD_IMAGES()
  editorStore.LISTEN_FOR_CONTEXT_MENU()
  editorStore.LISTEN_FOR_STATE_REPLACE()

  // module: notification
  notificationStore.listenForNotification()

  setupDragDropHandler()

  nextTick(() => {
    // `initialState` from bootstrap carries nullable URL params (string|null);
    // `addStyles` requires non-null `theme` / `codeFontFamily` strings.
    // Coalesce against DEFAULT_STYLE for every nullable field.
    const init = window.marktext?.initialState
    const style: AddStylesOptions = {
      theme: init?.theme ?? DEFAULT_STYLE.theme,
      codeFontFamily: init?.codeFontFamily ?? DEFAULT_STYLE.codeFontFamily,
      codeFontSize: init?.codeFontSize ?? DEFAULT_STYLE.codeFontSize,
      hideScrollbar: init?.hideScrollbar ?? DEFAULT_STYLE.hideScrollbar
    }
    addStyles(style)
  })
})
</script>

<style scoped>
.editor-placeholder,
.editor-container {
  display: flex;
  flex-direction: row;
  position: absolute;
  width: 100vw;
  height: 100vh;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
.editor-container .hide {
  z-index: -1;
  opacity: 0;
  position: absolute;
  left: -10000px;
}
.editor-placeholder {
  background: var(--editorBgColor);
}
.editor-middle {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 100vh;
  position: relative;
  min-width: 0;
  & > .editor {
    flex: 1;
  }
}
/* 标签栏 + 面包屑全宽行（win-body 之上） */
.editor-chrome {
  flex: none;
  display: flex;
  flex-direction: row;
}
/* 主体三栏行：编辑区列 / 分隔线 / 右栏 */
.editor-main-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
</style>

<style>
.workspace-status {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: none;
  min-height: 24px;
  padding: 0 12px;
  box-sizing: border-box;
  border-top: 1px solid var(--line);
  color: var(--muted);
  background: var(--bg);
  font-size: 12px;
}
.editor-container.wide-reading {
  --editor-pad: 20px 16px 140px;
}
.workspace-status .dirty {
  color: var(--accent);
}
.status-actions {
  margin-left: auto;
  display: flex;
  gap: 12px;
}
.workspace-status button,
.focus-exit {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
}
.workspace-status button:hover,
.focus-exit:hover {
  color: var(--accent);
}
.focus-exit {
  position: absolute;
  right: 16px;
  top: 10px;
  z-index: 100;
  -webkit-app-region: no-drag;
  font-size: 12px;
}
.distraction-free .editor-chrome,
.distraction-free .side-bar,
.distraction-free:not(.focus-right) .bpanel,
.distraction-free.focus-right .editor-main-col,
.distraction-free .bp-doc-actions,
.distraction-free .splitter,
.distraction-free .split-drop-zone,
.distraction-free .workspace-status {
  display: none !important;
}
.distraction-free .editor-with-tabs {
  max-width: 100% !important;
}
.distraction-free .win-body .editor-component {
  margin-right: 0;
}
.editor-container.distraction-free .win-body .editor-component .mu-container {
  max-width: var(--focus-reading-width, var(--editor-area-width));
  margin-inline: auto;
  padding: var(--editor-pad);
}
.distraction-free.focus-right .bpanel {
  width: 100% !important;
  transition: none;
}
.distraction-free.focus-right .bp-inner {
  margin: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.distraction-free .title-bar .title {
  visibility: hidden;
}
</style>
