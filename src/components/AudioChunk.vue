<script setup>
import { onMounted, onUnmounted, watch } from 'vue';
import { WebAudioPlayer } from '../utils/web-audio-player.js';

const props = defineProps({
  audio: {
    type: Blob,
    required: true
  },
  active: {
    type: Boolean,
    required: true
  },
  playing: {
    type: Boolean,
    required: true
  },
  resetWhenInactive: {
    type: Boolean,
    default: false
  },
  onStart: {
    type: Function,
    default: () => {}
  },
  onEnd: {
    type: Function,
    default: () => {}
  },
  onPause: {
    type: Function,
    default: () => {}
  }
});

const player = new WebAudioPlayer(props.audio);

const handlePause = () => {
  if (player.ended) return;
  props.onPause();
}

// Watch for changes in active/playing state
watch([() => props.active, () => props.playing], ([newActive, newPlaying], [oldActive]) => {
  if (!newActive) {
    if (props.resetWhenInactive && oldActive) {
      player.stop({ reset: true });
    }
    return;
  }

  if (newPlaying) {
    player.play({
      restart: !oldActive || player.ended,
      onStart: props.onStart,
      onEnd: props.onEnd,
      onError: (err) => console.error('Error playing audio chunk:', err),
    });
  } else {
    player.pause({ onPause: handlePause });
  }
});

// Handle audio element lifecycle
onMounted(() => {
  if (!props.audio) return;

  if (props.active && props.playing) {
    player.play({
      onStart: props.onStart,
      onEnd: props.onEnd,
      onError: (err) => console.error('Error playing audio chunk:', err),
    });
  } else {
    player.stop({ reset: true });
  }
})

onUnmounted(() => {
  player.stop({ reset: true });
});
</script>

<template></template>
