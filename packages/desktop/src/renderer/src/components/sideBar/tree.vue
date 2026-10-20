<template>
  <div class="side-bar-files">
    <div
      v-if="root"
      class="sb-head"
      :title="root"
    >
      文件夹 · {{ root }}
    </div>
    <div class="file-tools">
      <input
        v-model="filter"
        type="search"
        placeholder="筛选已加载文件与文件夹"
        aria-label="筛选已加载文件与文件夹"
      >
      <button
        :title="t('workspace.refreshFiles')"
        :aria-label="t('workspace.refreshFiles')"
        @click="refresh"
      >
        ↻
      </button>
    </div>
    <div
      class="file-list"
      role="group"
      aria-label="文件与文件夹"
    >
      <template
        v-for="row in rows"
        :key="row.pathname"
      >
        <button
          class="sb-row"
          :class="{ sel: isCurrentFile(row.pathname) }"
          :style="{ paddingLeft: `${8 + row.depth * 18}px` }"
          :title="row.pathname"
          :data-path="row.pathname"
          :aria-expanded="row.kind === 'directory' ? expanded.has(row.pathname) : undefined"
          :disabled="row.kind === 'link'"
          @click="activate(row)"
          @keydown.right.prevent="row.kind === 'directory' && expand(row.pathname)"
          @keydown.left.prevent="collapse(row.pathname)"
        >
          <span
            class="tree-marker"
            aria-hidden="true"
          >{{ row.kind === 'directory' ? (expanded.has(row.pathname) ? '▾' : '▸') : row.kind === 'link' ? '↗' : '·' }}</span>
          <span class="fname">{{ row.name }}</span>
          <span
            v-if="row.kind === 'link'"
            class="cur"
          >链接（不展开）</span>
          <span
            v-if="isCurrentFile(row.pathname)"
            class="cur"
          >{{ t('sideBar.tree.currentFile') }}</span>
        </button>
        <div
          v-if="row.kind === 'directory' && expanded.has(row.pathname) && message(row.pathname)"
          class="tree-message"
          :style="{ paddingLeft: `${26 + row.depth * 18}px` }"
          role="status"
        >
          {{ message(row.pathname) }}
        </div>
      </template>
    </div>
    <div
      v-if="message(root) || !rows.length"
      class="sb-empty"
      role="status"
    >
      {{ message(root) || (filter ? t('workspace.noMatches') : t('sideBar.tree.noFilesInDirectory')) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '@/store/editor'
import { useProjectStore } from '@/store/project'
import { t } from '../../i18n'

interface Entry { name: string; pathname: string; kind: 'file' | 'directory' | 'link' }
interface Row extends Entry { depth: number }
interface Directory { entries: Entry[]; loading: boolean; error: boolean }
const editorStore = useEditorStore()
const { currentFile, tabs } = storeToRefs(editorStore)
const { projectTree } = storeToRefs(useProjectStore())
const root = ref('')
const filter = ref('')
const directories = ref(new Map<string, Directory>())
const expanded = ref(new Set<string>())
let generation = 0
const storageKey = 'workspace-file-tree-v1'
const contains = (dir: string, file: string) => !!dir && (dir === file || window.fileUtils.isChildOfDirectory(dir, file))
const persist = () => {
  try { localStorage.setItem(storageKey, JSON.stringify({ root: root.value, expanded: [...expanded.value].slice(0, 200) })) } catch { /* Storage may be unavailable. */ }
}
const saved: { root?: string; expanded?: string[] } = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{}')
    return value && typeof value.root === 'string' ? value as { root: string; expanded?: string[] } : {}
  } catch { return {} }
})()

async function load (dir: string, request = generation): Promise<void> {
  if (!dir || directories.value.has(dir)) return
  directories.value.set(dir, { entries: [], loading: true, error: false })
  try {
    const entries = await window.fileUtils.readDirectory(dir)
    if (request !== generation) return
    directories.value.set(dir, {
      entries: entries.filter(e => e.kind !== 'file' || window.fileUtils.hasMarkdownExtension(e.name))
        .map(e => ({ ...e, pathname: window.path.join(dir, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      loading: false,
      error: false
    })
  } catch {
    if (request !== generation) return
    directories.value.set(dir, { entries: [], loading: false, error: true })
  }
  // Only traverse explicitly expanded, reachable real directories. Never follow links.
  for (const entry of directories.value.get(dir)?.entries || []) {
    if (request !== generation) return
    if (entry.kind === 'directory' && expanded.value.has(entry.pathname)) await load(entry.pathname, request)
  }
}
async function expand (dir: string) {
  expanded.value.add(dir)
  if (directories.value.get(dir)?.error) directories.value.delete(dir)
  persist()
  await load(dir)
}
function collapse (dir: string) { expanded.value.delete(dir); persist() }
async function refresh () {
  generation++
  directories.value = new Map()
  await load(root.value)
}
const message = (dir: string) => {
  const state = directories.value.get(dir)
  return state?.loading ? '正在加载…' : state?.error ? '无法读取目录，请检查权限后重试或刷新' : state && !state.entries.length ? '空目录（无 Markdown 文件或子目录）' : ''
}
const rows = computed(() => {
  const query = filter.value.trim().toLocaleLowerCase()
  const walk = (dir: string, depth: number): Row[] => {
    const result: Row[] = []
    for (const entry of directories.value.get(dir)?.entries || []) {
      const children = entry.kind === 'directory' && expanded.value.has(entry.pathname) ? walk(entry.pathname, depth + 1) : []
      if (!query || entry.name.toLocaleLowerCase().includes(query) || children.length) result.push({ ...entry, depth }, ...children)
    }
    return result
  }
  return walk(root.value, 0)
})
watch([() => currentFile.value?.pathname, () => projectTree.value?.pathname], ([pathname, project]) => {
  const next = (project && (!pathname || contains(project, pathname)) ? project : '') || (pathname ? (contains(root.value, pathname) ? root.value : contains(saved.root || '', pathname) ? saved.root! : window.path.dirname(pathname)) : root.value)
  if (next === root.value) return
  generation++
  root.value = next || ''
  directories.value = new Map()
  expanded.value = new Set((saved.root === next && Array.isArray(saved.expanded) ? saved.expanded : []).filter(p => typeof p === 'string' && contains(root.value, p)))
  persist()
  load(root.value).catch(() => {})
}, { immediate: true })
watch(() => tabs.value.map(tab => tab.pathname).join('\0'), () => { refresh().catch(() => {}) })
onMounted(() => window.addEventListener('focus', refresh))
onBeforeUnmount(() => { generation++; window.removeEventListener('focus', refresh) })
const isCurrentFile = (pathname: string) => !!currentFile.value?.pathname && window.fileUtils.isSamePathSync(currentFile.value.pathname, pathname)
function activate (entry: Entry) {
  if (entry.kind === 'directory') {
    if (expanded.value.has(entry.pathname)) collapse(entry.pathname)
    else expand(entry.pathname).catch(() => {})
    return
  }
  if (entry.kind !== 'file') return
  const opened = tabs.value.find(tab => window.fileUtils.isSamePathSync(tab.pathname, entry.pathname))
  if (opened) { if (!isCurrentFile(entry.pathname)) editorStore.UPDATE_CURRENT_FILE(opened) } else window.electron.ipcRenderer.send('mt::open-file', entry.pathname, {})
}
</script>

<style scoped>
.side-bar-files {
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.file-list {
  display: flex;
  flex-direction: column;
}

/* 原型 sb-head：「文件夹 · 路径」小标题 */
.sb-head {
  font-size: var(--f11);
  line-height: 1.45;
  color: var(--faint);
  padding: 6px 8px 7px;
  font-weight: 600;
  flex: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px;
  border-radius: 8px;
  color: var(--ink);
  font-size: var(--f12);
  line-height: 1.45;
  cursor: pointer;
  margin-bottom: 1px;
  transition: background 0.15s ease;
}

/* 原型：行首统一 i-file 图标 15px 墨灰 */
.sb-row svg {
  width: 15px;
  height: 15px;
  color: var(--muted);
  flex: none;
}

.sb-row:hover {
  background: var(--hover);
}
.sb-row.sel {
  background: var(--selected);
}

.sb-row .fname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

/* round13（用户拍板）：行尾只留「当前」墨蓝标记——「在访达中打开」移到
   顶栏文件名 hover 出现的小箭头按钮（titleBar），行尾不再拥挤。 */
.sb-row .cur-group {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  flex: none;
}

.sb-row .cur {
  font-size: 11px;
  color: var(--accent);
  font-weight: 600;
  flex: none;
}

.sb-empty {
  padding: 16px 8px;
  font-size: var(--f11);
  color: var(--faint);
}
</style>

<style scoped>
.file-tools {
  display: flex;
  gap: 6px;
  padding: 4px 6px 10px;
  flex: none;
}
.file-tools input {
  min-width: 0;
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--ink);
  background: var(--bg);
  font: inherit;
  font-size: 12px;
}
.file-tools button {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 18px;
}
.sb-row {
  flex: none;
  content-visibility: auto;
  contain-intrinsic-size: auto 32px;
}
</style>

<style scoped>
.sb-row { width: 100%; border: 0; background: transparent; text-align: left; }
.sb-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.sb-row:disabled { opacity: .6; cursor: default; }
.tree-marker { width: 12px; flex: none; }
.tree-message { padding: 6px 8px; color: var(--muted); font-size: 12px; }
</style>
