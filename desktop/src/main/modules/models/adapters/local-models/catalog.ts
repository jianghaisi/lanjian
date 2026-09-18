import type { ModelManifest } from '../../domain/local-models'
import { LOCAL_QWEN_ID } from '../../../../../contracts/models/local-model-contracts'
export const localModelCatalog: readonly ModelManifest[] = [{
  id: LOCAL_QWEN_ID, name: 'Qwen3 · 1.7B', family: 'Qwen', quantization: 'Q8_0',
  description: '在本机运行的轻量中文模型。用于构思、草稿与审校，输出保留为可审阅的候选。',
  revision: '90862c4b9d2787eaed51d12237eafdfe7c5f6077',
  license: 'Apache-2.0', licenseUrl: 'https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/blob/90862c4b9d2787eaed51d12237eafdfe7c5f6077/LICENSE',
  runtimeId: 'llama-cpp-python', capabilities: ['text','stream','structured','tool-step'],
  contextTokens: 8192, systemReserveTokens: 512, maxOutputTokens: 4096, recommendedOutputTokens: 2048,
  files: [{ relativePath: 'models/llm/Qwen3-1.7B-Q8_0.gguf', bytes: 1834426016,
    sha256: '061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a',
    url: 'https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/90862c4b9d2787eaed51d12237eafdfe7c5f6077/Qwen3-1.7B-Q8_0.gguf' }]
}]

