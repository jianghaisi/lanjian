// Official sherpa-onnx tts-models release asset, reviewed 2026-09-11.
// Archive digest from GitHub release API; original weights: hexgrad/Kokoro-82M-v1.1-zh.
export const kokoroModel = {
  key: 'kokoro-package', license: 'Apache-2.0 model; bundled eSpeak data needs separate distribution review',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2',
  files: [['kokoro-int8-multi-lang-v1_1.tar.bz2', 147031220, 'sha256', 'a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6']],
}
// Same model/voices, precision comparison only; not an automatic runtime fallback.
export const kokoroFloatModel = {
  key: 'kokoro-fp32', repo: 'csukuangfj/kokoro-multi-lang-v1_1',
  revision: '914313412b607d95400bcd12446233fbd1248801', license: 'Apache-2.0',
  files: [['model.onnx', 325631784, 'sha256', 'acc4adc175b9d9986106cd20060329673ad5a2e12ef3c557d2d3745b694f8b38']],
}
