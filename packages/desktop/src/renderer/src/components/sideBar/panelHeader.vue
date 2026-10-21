<template>
  <div v-if="showSideBar" class="left-panel-header" :class="{ 'native-fullscreen': nativeFullscreen }" :style="{ width: `${effectiveSideBarWidth}px` }">
    <button class="tb-toggle sidebar-toggle on" :aria-pressed="showSideBar" :aria-label="t('sideBar.toggleTitle')" :title="t('sideBar.toggleTitle')" @click="layout.SET_LAYOUT({ showSideBar: false })"><mo-icon name="i-sidebar" /></button>
    <div class="sidebar-main-tabs" role="tablist" aria-label="左侧栏模式">
      <button role="tab" :aria-selected="rightColumn === 'toc'" @click="layout.SET_LAYOUT({ rightColumn: 'toc' })">{{ t('sideBar.tabs.outline') }}</button>
      <button role="tab" :aria-selected="rightColumn !== 'toc'" @click="layout.SET_LAYOUT({ rightColumn: 'files' })">{{ t('sideBar.tabs.files') }}</button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useLayoutStore } from '@/store/layout'
import MoIcon from '@/components/icons/MoIcon.vue'
import { t } from '@/i18n'
const layout = useLayoutStore()
const { showSideBar, effectiveSideBarWidth, rightColumn } = storeToRefs(layout)
const nativeFullscreen = ref(false)
const offEnter = window.electron.ipcRenderer.on('mt::window-enter-full-screen', () => { nativeFullscreen.value = true })
const offLeave = window.electron.ipcRenderer.on('mt::window-leave-full-screen', () => { nativeFullscreen.value = false })
onMounted(async () => { nativeFullscreen.value = await window.electron.windowControl.isFullScreen() })
onBeforeUnmount(() => { offEnter(); offLeave() })
</script>
