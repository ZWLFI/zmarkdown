<template>
  <div
    class="pref-tabs"
    role="tablist"
    aria-label="Settings"
  >
    <button
      v-for="c of getCategory()"
      :key="c.label"
      type="button"
      class="pref-tab"
      :class="{ on: c.label === currentCategory }"
      role="tab"
      :aria-selected="c.label === currentCategory"
      @click="handleCategoryItemClick(c)"
      @keydown="handleTabKey($event, c)"
    >
      <span>{{ c.name }}</span>
    </button>
  </div>
</template>
<script setup lang="ts">
import { getCategory } from './config'
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'

interface CategoryItem {
  name: string
  label: string
  path: string
}

const router = useRouter()
const route = useRoute()

const currentCategory = ref<string>('general')

watch(
  () => route.name,
  (newRouteName) => {
    if (newRouteName) {
      currentCategory.value = String(newRouteName)
    }
  }
)

const handleCategoryItemClick = (item: CategoryItem): void => {
  if (item.label !== currentCategory.value) {
    router.push({
      path: item.path
    })
  }
}

const handleTabKey = (event: KeyboardEvent, item: CategoryItem): void => {
  const categories = getCategory()
  const index = categories.findIndex(c => c.label === item.label)
  const next = event.key === 'ArrowRight'
    ? (index + 1) % categories.length
    : event.key === 'ArrowLeft'
      ? (index + categories.length - 1) % categories.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : -1
  if (next < 0) return
  event.preventDefault()
  const target = (event.currentTarget as HTMLElement).parentElement?.children[next] as HTMLElement
  target?.focus()
  handleCategoryItemClick(categories[next])
}

const onIpcCategoryChange = (_event: unknown, category: unknown): void => {
  const categoryName = typeof category === 'string' ? category : ''
  const validRoute =
    categoryName && router.getRoutes().findIndex((r) => r.path.endsWith(`/${categoryName}`)) !== -1
  if (validRoute) {
    router.push({
      path: `/preference/${categoryName}`
    })
  }
}

onMounted(() => {
  if (route.name) {
    currentCategory.value = String(route.name)
  }
  window.electron.ipcRenderer.on('settings::change-tab', onIpcCategoryChange)
})

onUnmounted(() => {
  window.electron.ipcRenderer.removeAllListeners('settings::change-tab')
})
</script>

<style>
.pref-tabs {
  display: flex;
  gap: 2px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  flex: none;
  overflow-x: auto;
  background: var(--surface-0);
  -webkit-app-region: no-drag;
}

.pref-tab {
  border: none;
  background: none;
  color: var(--muted);
  font-size: 14px;
  padding: 11px 13px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
  transition: color 0.15s ease;
  user-select: none;
}

.pref-tab:hover {
  color: var(--ink);
}

.pref-tab.on {
  color: var(--ink);
  font-weight: 600;
  border-bottom-color: var(--accent);
}
</style>
