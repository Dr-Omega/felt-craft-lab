import { createApp } from 'vue'
import App from './App.vue'

// Public renderer-core entry; UI pages consume the adapter instead of Fabric directly.
export { FabricEditorAdapter, normalizeSceneAngle } from './editor'
export type {
  FabricEditorAdapterOptions,
  FabricEditorAssetResolver
} from './editor'

createApp(App).mount('#app')
