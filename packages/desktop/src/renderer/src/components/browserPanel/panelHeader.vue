<template>
  <div v-if="open" class="right-panel-header" :style="{ width: `${panelWidthPx}px` }">
    <bp-modes :shown="true" />
    <button class="panel-collapse" type="button" title="收起右侧栏" aria-label="收起右侧栏" @click="bpStore.SET_OPEN(false)">
      <mo-icon name="i-partition" />
    </button>
  </div>
</template>
<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useBrowserPanelStore } from '@/store/browserPanel'
import { useWorkspaceStore } from '@/store/workspace'
import BpModes from './bpModes.vue'
import MoIcon from '@/components/icons/MoIcon.vue'
const bpStore = useBrowserPanelStore()
const { open } = storeToRefs(bpStore)
const { panelWidthPx } = storeToRefs(useWorkspaceStore())
</script>
