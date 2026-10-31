<template>
  <div class="rename">
    <el-dialog v-model="showRename" :show-close="false" :close-on-click-modal="!busy" :close-on-press-escape="!busy" width="410px">
      <template #title>{{ t('fileOperation.renameConfirm') }}</template>
      <form @submit.prevent="confirm">
        <input ref="search" v-model="tempName" class="rename-name" :disabled="busy"
          :aria-label="t('fileOperation.renameConfirm')" :aria-invalid="!!error" aria-describedby="rename-feedback"
          @keydown.enter="onEnter" />
        <p id="rename-feedback" role="alert" class="rename-feedback">{{ error || (busy ? t('fileOperation.renaming') : '') }}</p>
        <div class="rename-actions">
          <button type="button" :disabled="busy" @click="showRename = false">{{ t('fileOperation.cancel') }}</button>
          <button type="submit" :disabled="busy">{{ t('fileOperation.renameConfirm') }}</button>
        </div>
      </form>
    </el-dialog>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import bus from '../../bus'
import { useEditorStore } from '@/store/editor'
import { t } from '../../i18n'
const editorStore = useEditorStore()
const showRename = ref(false)
const tempName = ref('')
const search = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const error = ref('')
let targetId: string | undefined
const handleRename = () => {
  if (busy.value) return
  targetId = editorStore.currentFile?.id
  tempName.value = editorStore.currentFile?.filename ?? ''
  error.value = ''
  showRename.value = true
  nextTick(() => { search.value?.focus(); search.value?.select() })
}
const confirm = async () => {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await editorStore.RENAME(tempName.value, targetId)
    showRename.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
    if (showRename.value) nextTick(() => search.value?.focus())
  }
}
const onEnter = (event: KeyboardEvent) => {
  event.preventDefault()
  if (!event.isComposing && event.keyCode !== 229) void confirm()
}
onMounted(() => bus.on('rename', handleRename))
onBeforeUnmount(() => bus.off('rename', handleRename))
</script>
<style scoped>
.rename-name { box-sizing: border-box; width: 100%; padding: 8px; color: var(--sideBarColor); background: var(--inputBgColor); border: 1px solid var(--floatBorderColor); border-radius: 4px; }
.rename-feedback { min-height: 1.5em; overflow-wrap: anywhere; }
.rename-actions { display: flex; justify-content: flex-end; gap: 8px; }
button { padding: 5px 10px; cursor: pointer; }
input:focus-visible, button:focus-visible { outline: 2px solid var(--highlightThemeColor); outline-offset: 2px; }
</style>
