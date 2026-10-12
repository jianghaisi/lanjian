import type { ModelManifest } from '../../domain/local-models'
import { LOCAL_QWEN_LIMITS } from '../../../../../contracts/models/local-model-contracts'

// Fixed publisher manifests. Availability is established by detection on the user's machine.
export const localModelCatalog: readonly ModelManifest[] = [
  {
    ...LOCAL_QWEN_LIMITS,
    "id": "qwen3-1.7b-q8_0",
    "name": "Qwen3 · 1.7B",
    "family": "Qwen",
    "quantization": "Q8_0",
    "description": "已有文字、结构化与工具调用实测记录，适合体验本机写作流程。",
    "revision": "90862c4b9d2787eaed51d12237eafdfe7c5f6077",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/blob/90862c4b9d2787eaed51d12237eafdfe7c5f6077/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "qwen3",
    samplingDefaults: { temperature: 0.7, topP: 0.8, sourceUrl: 'https://huggingface.co/Qwen/Qwen3-1.7B', note: '本机模板关闭思考，采样采用 Qwen3 非思考建议；量化后的创作效果需另行验证。' },
    "publisher": "Qwen",
    "publisherKind": "official",
    "developmentStatus": "tested",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/Qwen3-1.7B-Q8_0.gguf",
        "bytes": 1834426016,
        "sha256": "061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a",
        "url": "https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/90862c4b9d2787eaed51d12237eafdfe7c5f6077/Qwen3-1.7B-Q8_0.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    "id": "qwen3-0.6b-q8_0",
    "name": "Qwen3 · 0.6B",
    "family": "Qwen",
    "quantization": "Q8_0",
    "description": "用于中文与通用文字任务；可按需要分配到构思、草稿和审校。",
    "revision": "23749fefcc72300e3a2ad315e1317431b06b590a",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/blob/23749fefcc72300e3a2ad315e1317431b06b590a/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "qwen3",
    samplingDefaults: { temperature: 0.7, topP: 0.8, sourceUrl: 'https://huggingface.co/Qwen/Qwen3-1.7B', note: '本机模板关闭思考，采样采用 Qwen3 非思考建议；量化后的创作效果需另行验证。' },
    "publisher": "Qwen",
    "publisherKind": "official",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/Qwen3-0.6B-Q8_0.gguf",
        "bytes": 639446688,
        "sha256": "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031",
        "url": "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/23749fefcc72300e3a2ad315e1317431b06b590a/Qwen3-0.6B-Q8_0.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    "id": "qwen3-4b-q4_k_m",
    "name": "Qwen3 · 4B",
    "family": "Qwen",
    "quantization": "Q4_K_M",
    "description": "用于中文与通用文字任务；可按需要分配到构思、草稿和审校。",
    "revision": "bc640142c66e1fdd12af0bd68f40445458f3869b",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/Qwen/Qwen3-4B-GGUF/blob/bc640142c66e1fdd12af0bd68f40445458f3869b/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "qwen3",
    samplingDefaults: { temperature: 0.7, topP: 0.8, sourceUrl: 'https://huggingface.co/Qwen/Qwen3-1.7B', note: '本机模板关闭思考，采样采用 Qwen3 非思考建议；量化后的创作效果需另行验证。' },
    "publisher": "Qwen",
    "publisherKind": "official",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/Qwen3-4B-Q4_K_M.gguf",
        "bytes": 2497280256,
        "sha256": "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
        "url": "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    "id": "qwen3-8b-q4_k_m",
    "name": "Qwen3 · 8B",
    "family": "Qwen",
    "quantization": "Q4_K_M",
    "description": "用于中文与通用文字任务；可按需要分配到构思、草稿和审校。",
    "revision": "7c41481f57cb95916b40956ab2f0b139b296d974",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/Qwen/Qwen3-8B-GGUF/blob/7c41481f57cb95916b40956ab2f0b139b296d974/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "qwen3",
    samplingDefaults: { temperature: 0.7, topP: 0.8, sourceUrl: 'https://huggingface.co/Qwen/Qwen3-1.7B', note: '本机模板关闭思考，采样采用 Qwen3 非思考建议；量化后的创作效果需另行验证。' },
    "publisher": "Qwen",
    "publisherKind": "official",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/Qwen3-8B-Q4_K_M.gguf",
        "bytes": 5027783488,
        "sha256": "d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785",
        "url": "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/7c41481f57cb95916b40956ab2f0b139b296d974/Qwen3-8B-Q4_K_M.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    "id": "qwen3-14b-q4_k_m",
    "name": "Qwen3 · 14B",
    "family": "Qwen",
    "quantization": "Q4_K_M",
    "description": "用于中文与通用文字任务；可按需要分配到构思、草稿和审校。 模型较大，CPU 运行可能较慢。",
    "revision": "530227a7d994db8eca5ab5ced2fb692b614357fd",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/Qwen/Qwen3-14B-GGUF/blob/530227a7d994db8eca5ab5ced2fb692b614357fd/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "qwen3",
    samplingDefaults: { temperature: 0.7, topP: 0.8, sourceUrl: 'https://huggingface.co/Qwen/Qwen3-1.7B', note: '本机模板关闭思考，采样采用 Qwen3 非思考建议；量化后的创作效果需另行验证。' },
    "publisher": "Qwen",
    "publisherKind": "official",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/Qwen3-14B-Q4_K_M.gguf",
        "bytes": 9001752960,
        "sha256": "500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0",
        "url": "https://huggingface.co/Qwen/Qwen3-14B-GGUF/resolve/530227a7d994db8eca5ab5ced2fb692b614357fd/Qwen3-14B-Q4_K_M.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    "id": "qwen3-32b-q4_k_m",
    "name": "Qwen3 · 32B",
    "family": "Qwen",
    "quantization": "Q4_K_M",
    "description": "用于中文与通用文字任务；可按需要分配到构思、草稿和审校。 模型较大，CPU 运行可能较慢。",
    "revision": "938a7432affaec9157f883a87164e2646ae17555",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/Qwen/Qwen3-32B-GGUF/blob/938a7432affaec9157f883a87164e2646ae17555/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "qwen3",
    samplingDefaults: { temperature: 0.7, topP: 0.8, sourceUrl: 'https://huggingface.co/Qwen/Qwen3-1.7B', note: '本机模板关闭思考，采样采用 Qwen3 非思考建议；量化后的创作效果需另行验证。' },
    "publisher": "Qwen",
    "publisherKind": "official",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/Qwen3-32B-Q4_K_M.gguf",
        "bytes": 19762149024,
        "sha256": "efd971561896866f0e910cce52761ca77b1b138090c7f15fe284676d57d1f689",
        "url": "https://huggingface.co/Qwen/Qwen3-32B-GGUF/resolve/938a7432affaec9157f883a87164e2646ae17555/Qwen3-32B-Q4_K_M.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    samplingDefaults: { temperature: 0.7, topP: 0.95, note: '应用兼容初值，尚未完成此量化型号的创作质量验收。' },
    "id": "qwen2.5-0.5b-instruct-q4_k_m",
    "name": "Qwen2.5-0.5B-Instruct",
    "family": "Qwen",
    "quantization": "Q4_K_M",
    "description": "用于中文与通用文字任务；可按需要分配到构思、草稿和审校。",
    "revision": "9217f5db79a29953eb74d5343926648285ec7e67",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/blob/9217f5db79a29953eb74d5343926648285ec7e67/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "chatml",
    "publisher": "Qwen",
    "publisherKind": "official",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/qwen2.5-0.5b-instruct-q4_k_m.gguf",
        "bytes": 491400032,
        "sha256": "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
        "url": "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/9217f5db79a29953eb74d5343926648285ec7e67/qwen2.5-0.5b-instruct-q4_k_m.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    samplingDefaults: { temperature: 0.7, topP: 0.95, note: '应用兼容初值，尚未完成此量化型号的创作质量验收。' },
    "id": "qwen2.5-1.5b-instruct-q4_k_m",
    "name": "Qwen2.5-1.5B-Instruct",
    "family": "Qwen",
    "quantization": "Q4_K_M",
    "description": "用于中文与通用文字任务；可按需要分配到构思、草稿和审校。",
    "revision": "91cad51170dc346986eccefdc2dd33a9da36ead9",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/blob/91cad51170dc346986eccefdc2dd33a9da36ead9/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "chatml",
    "publisher": "Qwen",
    "publisherKind": "official",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/qwen2.5-1.5b-instruct-q4_k_m.gguf",
        "bytes": 1117320736,
        "sha256": "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",
        "url": "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    samplingDefaults: { temperature: 0.7, topP: 0.95, note: '应用兼容初值，尚未完成此量化型号的创作质量验收。' },
    "id": "qwen2.5-7b-instruct-q4_k_m",
    "name": "Qwen2.5-7B-Instruct",
    "family": "Qwen",
    "quantization": "Q4_K_M",
    "description": "用于中文与通用文字任务；可按需要分配到构思、草稿和审校。",
    "revision": "8911e8a47f92bac19d6f5c64a2e2095bd2f7d031",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/blob/8911e8a47f92bac19d6f5c64a2e2095bd2f7d031/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "chatml",
    "publisher": "bartowski",
    "publisherKind": "community",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
        "bytes": 4683074240,
        "sha256": "65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423",
        "url": "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/8911e8a47f92bac19d6f5c64a2e2095bd2f7d031/Qwen2.5-7B-Instruct-Q4_K_M.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    samplingDefaults: { temperature: 0.7, topP: 0.95, note: '应用兼容初值，尚未完成此量化型号的创作质量验收。' },
    "id": "smollm2-1.7b-instruct-q4_k_m",
    "name": "SmolLM2-1.7B-Instruct",
    "family": "SmolLM",
    "quantization": "Q4_K_M",
    "description": "体积较小的通用对话模型，可尝试简短问答与草稿任务。",
    "revision": "2d4a76a30b4af41ecd395c35725ac11688d4cfe4",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF/blob/2d4a76a30b4af41ecd395c35725ac11688d4cfe4/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "chatml",
    "publisher": "HuggingFaceTB",
    "publisherKind": "official",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/smollm2-1.7b-instruct-q4_k_m.gguf",
        "bytes": 1055609536,
        "sha256": "decd2598bc2c8ed08c19adc3c8fdd461ee19ed5708679d1c54ef54a5a30d4f33",
        "url": "https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF/resolve/2d4a76a30b4af41ecd395c35725ac11688d4cfe4/smollm2-1.7b-instruct-q4_k_m.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    samplingDefaults: { temperature: 0.7, topP: 0.95, note: '应用兼容初值，尚未完成此量化型号的创作质量验收。' },
    "id": "phi-3.5-mini-instruct-q4_k_m",
    "name": "Phi-3.5-mini-instruct",
    "family": "Phi",
    "quantization": "Q4_K_M",
    "description": "Microsoft 的紧凑指令模型，可尝试问答、构思和文字整理。",
    "revision": "6d70da17e749a471ccb62ade694486011a75cda3",
    "license": "MIT",
    "licenseUrl": "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/blob/6d70da17e749a471ccb62ade694486011a75cda3/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "phi3",
    "publisher": "bartowski",
    "publisherKind": "community",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/Phi-3.5-mini-instruct-Q4_K_M.gguf",
        "bytes": 2393232672,
        "sha256": "e4165e3a71af97f1b4820da61079826d8752a2088e313af0c7d346796c38eff5",
        "url": "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/6d70da17e749a471ccb62ade694486011a75cda3/Phi-3.5-mini-instruct-Q4_K_M.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    samplingDefaults: { temperature: 0.7, topP: 0.95, note: '应用兼容初值，尚未完成此量化型号的创作质量验收。' },
    "id": "mistral-7b-instruct-v0.3-q4_k_m",
    "name": "Mistral-7B-Instruct-v0.3",
    "family": "Mistral",
    "quantization": "Q4_K_M",
    "description": "Mistral AI 的通用指令模型，可尝试构思、草稿和文字整理。",
    "revision": "61fd4167fff3ab01ee1cfe0da183fa27a944db48",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/blob/61fd4167fff3ab01ee1cfe0da183fa27a944db48/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "mistral-instruct",
    "publisher": "bartowski",
    "publisherKind": "community",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf",
        "bytes": 4372812000,
        "sha256": "1270d22c0fbb3d092fb725d4d96c457b7b687a5f5a715abe1e818da303e562b6",
        "url": "https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/61fd4167fff3ab01ee1cfe0da183fa27a944db48/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    samplingDefaults: { temperature: 0.7, topP: 0.95, note: '应用兼容初值，尚未完成此量化型号的创作质量验收。' },
    "id": "glm-4-9b-0414-q4_k_m",
    "name": "GLM-4 · 9B (0414)",
    "family": "GLM",
    "quantization": "Q4_K_M",
    "description": "Z.ai 的 GLM 系列对话模型，可用于文字问答与写作辅助。",
    "revision": "211924cd949e153b1017ed635e5b127d0b594e6f",
    "license": "MIT",
    "licenseUrl": "https://huggingface.co/zai-org/GLM-4-9B-0414/blob/645b8482494e31b6b752272bf7f7f273ef0f3caf/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "glm4",
    "publisher": "bartowski",
    "publisherKind": "community",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/THUDM_GLM-4-9B-0414-Q4_K_M.gguf",
        "bytes": 6166574464,
        "sha256": "2b95f0b88eca423bfb874c4f8e7b9574ec76acab2befd272076e8a8dce31216a",
        "url": "https://huggingface.co/bartowski/THUDM_GLM-4-9B-0414-GGUF/resolve/211924cd949e153b1017ed635e5b127d0b594e6f/THUDM_GLM-4-9B-0414-Q4_K_M.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    "id": "deepseek-r1-distill-qwen-1.5b-q4_k_m",
    "name": "DeepSeek R1 蒸馏 · 1.5B",
    "family": "DeepSeek",
    "quantization": "Q4_K_M",
    "description": "R1 蒸馏推理模型；思考与最终回答分开，思考也会占用输出预算。",
    "revision": "9cc28b17e86fa2415fcb070f8ee5ec27c965aa61",
    "license": "MIT",
    "licenseUrl": "https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B/blob/ad9f0ae0864d7fbcd1cd905e3c6c5b069cc8b562/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "deepseek-r1",
    samplingDefaults: { temperature: 0.6, topP: 0.95, sourceUrl: 'https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B', note: 'R1 蒸馏模型使用发布方建议温度；思考会占用本机输出预算。' },
    "publisher": "bartowski",
    "publisherKind": "community",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf",
        "bytes": 1117320800,
        "sha256": "1741e5b2d062b07acf048bf0d2c514dadf2a48f94e2b4aa0cfe069af3838ee2f",
        "url": "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/9cc28b17e86fa2415fcb070f8ee5ec27c965aa61/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    "id": "deepseek-r1-distill-qwen-7b-q4_k_m",
    "name": "DeepSeek R1 蒸馏 · 7B",
    "family": "DeepSeek",
    "quantization": "Q4_K_M",
    "description": "R1 蒸馏推理模型；思考与最终回答分开，思考也会占用输出预算。",
    "revision": "361004151d4f4f6b446dc5e6d46fbf4422a80d5f",
    "license": "MIT",
    "licenseUrl": "https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B/blob/916b56a44061fd5cd7d6a8fb632557ed4f724f60/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "deepseek-r1",
    samplingDefaults: { temperature: 0.6, topP: 0.95, sourceUrl: 'https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B', note: 'R1 蒸馏模型使用发布方建议温度；思考会占用本机输出预算。' },
    "publisher": "bartowski",
    "publisherKind": "community",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf",
        "bytes": 4683073504,
        "sha256": "731ece8d06dc7eda6f6572997feb9ee1258db0784827e642909d9b565641937b",
        "url": "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/361004151d4f4f6b446dc5e6d46fbf4422a80d5f/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf"
      }
    ]
  },
  {
    ...LOCAL_QWEN_LIMITS,
    "id": "deepseek-r1-distill-qwen-14b-q4_k_m",
    "name": "DeepSeek R1 蒸馏 · 14B",
    "family": "DeepSeek",
    "quantization": "Q4_K_M",
    "description": "R1 蒸馏推理模型；思考与最终回答分开，思考也会占用输出预算。 模型较大，CPU 运行可能较慢。",
    "revision": "9f5d77d401799416e0702290a691038b44012e0c",
    "license": "MIT",
    "licenseUrl": "https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-14B/blob/1df8507178afcc1bef68cd8c393f61a886323761/LICENSE",
    "runtimeId": "llama-cpp-python",
    "promptProfile": "deepseek-r1",
    samplingDefaults: { temperature: 0.6, topP: 0.95, sourceUrl: 'https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B', note: 'R1 蒸馏模型使用发布方建议温度；思考会占用本机输出预算。' },
    "publisher": "bartowski",
    "publisherKind": "community",
    "developmentStatus": "unverified",
    "capabilities": [
      "text",
      "stream",
      "structured",
      "tool-step"
    ],
    "files": [
      {
        "relativePath": "models/llm/DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf",
        "bytes": 8988110240,
        "sha256": "0b319bd0572f2730bfe11cc751defe82045fad5085b4e60591ac2cd2d9633181",
        "url": "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF/resolve/9f5d77d401799416e0702290a691038b44012e0c/DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf"
      }
    ]
  },
]
