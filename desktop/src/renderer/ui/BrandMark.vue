<script setup lang="ts">
withDefaults(defineProps<{ drawing?: boolean }>(), { drawing: false })

// One folded segment, repeated around the equilateral triangle's centroid.
// The complete silhouette occupies (6.121, 12)–(93.879, 88), centered in the frame.
const foldPath = 'M29.061 48.268L50 12L70.939 48.268L58.815 55.268L50 40L41.185 55.268Z'
const folds = [0, 120, 240]
</script>

<template>
  <svg class="lanjian-mark" :class="{ drawing }" viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <g class="mark-calibration" stroke="currentColor" stroke-width=".5">
      <path d="M5 28V5H28M72 5H95V28M95 72V95H72M28 95H5V72"/>
      <path d="M46 3H54M46 97H54M3 46V54M97 46V54"/>
    </g>
    <g class="mark-artwork" transform="translate(5 5) scale(.9)">
      <g v-for="(angle, index) in folds" :key="angle" :transform="`rotate(${angle} 50 62.666666667)`">
        <g class="mark-fold" :style="{ '--delay': `${index * .1}s` }">
          <path class="mark-blade" :d="foldPath" fill="currentColor"/>
          <path class="mark-trace" :d="foldPath" pathLength="1" stroke="currentColor" stroke-width=".5"/>
        </g>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.lanjian-mark {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  overflow: visible;
  color: inherit;
}
.mark-calibration { opacity: .24; }
.mark-trace { opacity: 0; }
.drawing .mark-fold {
  animation: fold-lock .9s var(--delay) cubic-bezier(.16, .8, .16, 1) both;
}
.drawing .mark-blade {
  animation: fold-fill .7s var(--delay) ease-out both;
}
.drawing .mark-trace {
  stroke-dasharray: 1;
  animation: trace-lock .85s var(--delay) ease-out both;
}
.drawing .mark-calibration {
  transform-origin: 50% 50%;
  animation: registration-lock 1.1s cubic-bezier(.16, .8, .16, 1) both;
}
@keyframes fold-lock {
  from { opacity: 0; transform: translateY(-18px); }
  to { opacity: 1; transform: none; }
}
@keyframes fold-fill {
  0%, 18% { opacity: 0; }
  100% { opacity: 1; }
}
@keyframes trace-lock {
  0% { stroke-dashoffset: 1; opacity: .8; }
  65% { stroke-dashoffset: 0; opacity: .8; }
  100% { stroke-dashoffset: 0; opacity: 0; }
}
@keyframes registration-lock {
  from { opacity: 0; transform: scale(1.12); }
  to { opacity: .24; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .drawing * { animation: none !important; }
}
</style>
