import { ref } from 'vue'
import type { ModelCatalogSnapshot } from '../../../../contracts/models/model-catalog-metadata'

// Safe metadata shared by book/default/test forms during this renderer session.
// Saving a book can remount its form; that must not erase still-current evidence.
// Keys and provider responses never enter this cache. Main validates independently.
export const sessionModelCatalogs = ref<Record<string, ModelCatalogSnapshot>>({})
