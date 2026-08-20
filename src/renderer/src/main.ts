import { createApp } from 'vue'
import '@fontsource/zcool-kuaile/400.css'
import App from './App.vue'
import { applyUiLayoutOverrides } from './ui/apply-ui-layout-overrides'

applyUiLayoutOverrides()
createApp(App).mount('#app')
