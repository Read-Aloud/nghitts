<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import {
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  CopyIcon,
  CheckIcon,
} from 'lucide-vue-next';
import TextStatistics from '../components/TextStatistics.vue';
import SpeedControl from '../components/SpeedControl.vue';
import AudioChunk from '../components/AudioChunk.vue';
import ModelSelector from '../components/ModelSelector.vue';
import DemoTable from '../components/DemoTable.vue';
import { fetchAvailableModels } from '../utils/model-detector.js';
import { addEntry } from '../utils/history-store.js';
import { DEFAULT_MODEL, getVietnameseModelUrls } from '../config.js';
import { areUrlsCached, installUrls, removeUrls } from '../utils/model-cache.js';

// State variables
const text = ref(
    "Con đang quán chiếu con là một cây hoa bồ công anh. Mỗi ngày con phơi những cánh lá của con trong không gian và tiếp thu tất cả những mầu nhiệm của sự sống. Cũng như các loài sinh vật khác, con dự tính cho sự tiếp nối đẹp đẽ của mình. Mỗi mùa xuân con làm ra nhiều bông hoa màu vàng, mỗi ngày những bông hoa đó lớn lên, nở ra rực rỡ"
);
const lastGeneration = ref(null);
const isPlaying = ref(false);
const currentChunkIndex = ref(-1);
const speed = ref(1);
const copied = ref(false);
const status = ref("idle");
const error = ref(null);
const worker = ref(null);
const voices = ref(null);
const selectedVoice = ref(0);
const chunks = ref([]);
const result = ref(null);
const availableModels = ref([]);
const installedModels = ref([]);
const selectedModel = ref("None");
const modelsLoading = ref(false);
const loadingProgress = ref(0);
const installingModels = ref({});
const installProgress = ref({});
const installProgressDetails = ref({});
const voiceManagerMessage = ref("");

// Computed properties
const processed = computed(() => {
  return lastGeneration.value &&
      lastGeneration.value.text === text.value &&
      lastGeneration.value.speed === speed.value &&
      lastGeneration.value.voice === selectedVoice.value;
});

// Methods
const setSpeed = (newSpeed) => {
  speed.value = newSpeed;
};

const getModelUrls = (modelName) => {
  const { modelPath, configPath } = getVietnameseModelUrls(modelName);
  return [modelPath, configPath];
};

const isModelInstalled = (modelName) => installedModels.value.includes(modelName);

const isInstalling = (modelName) => Boolean(installingModels.value[modelName]);

const getInstallProgress = (modelName) => installProgress.value[modelName] || 0;

const getInstallProgressDetails = (modelName) => installProgressDetails.value[modelName] || null;

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const resetLoadedVoice = () => {
  if (worker.value) {
    worker.value.terminate();
    worker.value = null;
  }
  status.value = "idle";
  voices.value = null;
  chunks.value = [];
  result.value = null;
  lastGeneration.value = null;
  isPlaying.value = false;
  currentChunkIndex.value = -1;
};

const restartWorker = (modelName = null) => {
  if (worker.value) {
    worker.value.terminate();
  }

  // Reset all audio and UI state
  status.value = "loading";
  loadingProgress.value = 0;
  voices.value = null;
  chunks.value = [];
  result.value = null;
  lastGeneration.value = null;
  isPlaying.value = false;
  currentChunkIndex.value = -1;

  // Simulate progress animation
  const progressInterval = setInterval(() => {
    if (loadingProgress.value < 90) {
      loadingProgress.value += Math.random() * 5;
      if (loadingProgress.value > 90) loadingProgress.value = 90;
    }
  }, 200);

  worker.value = new Worker(new URL("../workers/tts-worker.js", import.meta.url), {
    type: "module",
  });

  worker.value.addEventListener("message", onMessageReceived);
  worker.value.addEventListener("error", onErrorReceived);

  const modelToLoad = modelName || selectedModel.value;
  worker.value.postMessage({ type: 'init', model: modelToLoad });

  worker.value._progressInterval = progressInterval;
};

const refreshInstalledModels = async (models = availableModels.value) => {
  const installed = [];

  for (const model of models) {
    if (await areUrlsCached(getModelUrls(model))) {
      installed.push(model);
    }
  }

  installedModels.value = installed;

  if (selectedModel.value !== "None" && !installed.includes(selectedModel.value)) {
    selectedModel.value = "None";
    resetLoadedVoice();
  }

  return installed;
};

const installModel = async (modelName) => {
  if (isModelInstalled(modelName) || isInstalling(modelName)) return;

  error.value = null;
  voiceManagerMessage.value = "";
  installingModels.value = { ...installingModels.value, [modelName]: true };
  installProgress.value = { ...installProgress.value, [modelName]: 0 };
  installProgressDetails.value = { ...installProgressDetails.value, [modelName]: null };

  try {
    await installUrls(getModelUrls(modelName), ({ percent, received, total }) => {
      if (percent !== null) {
        installProgress.value = {
          ...installProgress.value,
          [modelName]: Math.round(percent),
        };
      }
      installProgressDetails.value = {
        ...installProgressDetails.value,
        [modelName]: total > 0
          ? `${formatBytes(received)} / ${formatBytes(total)}`
          : formatBytes(received),
      };
    });

    installProgress.value = { ...installProgress.value, [modelName]: 100 };
    await refreshInstalledModels();
    voiceManagerMessage.value = `${modelName} installed.`;

    if (selectedModel.value === "None") {
      selectedModel.value = modelName;
      restartWorker(modelName);
    }
  } catch (err) {
    console.error(`Failed to install model ${modelName}:`, err);
    error.value = `Failed to install ${modelName}: ${err.message}`;
  } finally {
    const { [modelName]: _installing, ...remainingInstalling } = installingModels.value;
    installingModels.value = remainingInstalling;
    const { [modelName]: _details, ...remainingDetails } = installProgressDetails.value;
    installProgressDetails.value = remainingDetails;
  }
};

const uninstallModel = async (modelName) => {
  if (!isModelInstalled(modelName) || isInstalling(modelName)) return;

  const confirmed = window.confirm(`Remove "${modelName}" from this browser? You can install it again later.`);
  if (!confirmed) return;

  error.value = null;
  voiceManagerMessage.value = "";

  try {
    await removeUrls(getModelUrls(modelName));
    const { [modelName]: _progress, ...remainingProgress } = installProgress.value;
    installProgress.value = remainingProgress;
    await refreshInstalledModels();
    voiceManagerMessage.value = `${modelName} removed. Install or select another voice to continue.`;
  } catch (err) {
    console.error(`Failed to uninstall model ${modelName}:`, err);
    error.value = `Failed to uninstall ${modelName}: ${err.message}`;
  }
};

const setCurrentChunkIndex = (index) => {
  currentChunkIndex.value = index;
};

const setIsPlaying = (playing) => {
  isPlaying.value = playing;
};

const handleChunkEnd = () => {
  if (status.value !== "generating" && currentChunkIndex.value === chunks.value.length - 1) {
    isPlaying.value = false;
    currentChunkIndex.value = -1;
  } else {
    currentChunkIndex.value = currentChunkIndex.value + 1;
  }
};

const handlePlayPause = () => {
  if (!isPlaying.value && status.value === "ready" && !processed.value) {
    status.value = "generating";
    chunks.value = [];
    currentChunkIndex.value = 0;
    const params = {
      text: text.value,
      voice: selectedVoice.value,
      speed: speed.value
    };
    lastGeneration.value = params;
    worker.value?.postMessage(params);
  }
  if (currentChunkIndex.value === -1) {
    currentChunkIndex.value = 0;
  }
  isPlaying.value = !isPlaying.value;
};

const downloadAudio = () => {
  if (!result.value) return;
  const url = URL.createObjectURL(result.value);
  const link = document.createElement("a");
  link.href = url;
  link.download = "audio.wav";
  link.click();
  URL.revokeObjectURL(url);
}

const handleCopy = async () => {
  await navigator.clipboard.writeText(text.value);
  copied.value = true;
  setTimeout(() => { copied.value = false }, 2000);
}

const handleDemoTextClick = (demoText) => {
  text.value = demoText;
}

const fetchModels = async () => {
  modelsLoading.value = true;
  try {
    const models = await fetchAvailableModels();
    availableModels.value = models;
    const installed = await refreshInstalledModels(models);

    if (selectedModel.value && selectedModel.value !== "None" && !installed.includes(selectedModel.value)) {
      selectedModel.value = "None";
      resetLoadedVoice();
    }

    // Auto-load default model only when it has been explicitly installed.
    if (selectedModel.value === "None" && installed.length > 0) {
      const defaultModel = (DEFAULT_MODEL.vi && installed.includes(DEFAULT_MODEL.vi))
        ? DEFAULT_MODEL.vi
        : installed[0];
      selectedModel.value = defaultModel;
      restartWorker(defaultModel);
    }
  } catch (err) {
    console.error('Failed to fetch models:', err);
    error.value = `Failed to load models: ${err.message}`;
  } finally {
    modelsLoading.value = false;
  }
};

const handleModelChange = (modelName) => {
  if (modelName !== selectedModel.value) {
    selectedModel.value = modelName;

    if (modelName === "None") {
      resetLoadedVoice();
    } else {
      restartWorker(modelName);
    }
  }
};

// Worker message handlers
const onMessageReceived = ({ data }) => {
  switch (data.status) {
    case "ready":
      if (worker.value?._progressInterval) {
        clearInterval(worker.value._progressInterval);
      }
      loadingProgress.value = 100;
      setTimeout(() => {
        status.value = "ready";
        loadingProgress.value = 0;
      }, 300);
      voices.value = data.voices;
      break;
    case "error":
      if (worker.value?._progressInterval) {
        clearInterval(worker.value._progressInterval);
      }
      loadingProgress.value = 0;
      status.value = "error";
      error.value = data.data;
      break;
    case "stream":
      chunks.value = [...chunks.value, data.chunk];
      break;
    case "complete":
      status.value = "ready";
      result.value = data.audio;
      if (data.audio && lastGeneration.value && selectedModel.value) {
        addEntry({
          text: lastGeneration.value.text,
          voice: lastGeneration.value.voice,
          speed: lastGeneration.value.speed,
          model: selectedModel.value,
          lang: 'vi',
          audio: data.audio,
        }).catch((err) => console.error('History save failed:', err));
      }
      break;
    case "preview":
      if (data.audio) {
        const audioUrl = URL.createObjectURL(data.audio);
        const audio = new Audio(audioUrl);
        audio.play().then(() => {
          setTimeout(() => URL.revokeObjectURL(audioUrl), 1000);
        }).catch(err => console.error('Error playing preview:', err));
      }
      break;
  }
};

const onErrorReceived = (e) => {
  console.error("Worker error:", e);
  error.value = e.message;
};

onMounted(async () => {
  await fetchModels();
});

onUnmounted(() => {
  if (worker.value) {
    worker.value.terminate();
  }
});
</script>

<template>
  <div>
    <!-- Main Card -->
    <div class="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 dark:border-gray-700/50 overflow-hidden">
      <div class="p-6 pb-0 space-y-6">
        <!-- Text Input Section -->
        <div class="space-y-4">
          <div class="relative">
            <textarea
              v-model="text"
              placeholder="Type or paste your text here..."
              class="w-full min-h-[180px] text-lg leading-relaxed resize-y p-4 pt-8 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:border-purple-500 dark:focus:border-purple-400 focus:ring-0 transition-colors"
              :class="voices ? '' : 'text-muted-foreground'"
            ></textarea>
            <button
              class="absolute top-1 right-3 h-10 w-10 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center transition-colors"
              @click="handleCopy"
              :title="copied ? 'Copied!' : 'Copy text'"
            >
              <CheckIcon v-if="copied" class="h-4 w-4 text-green-500" />
              <CopyIcon v-else class="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div class="flex justify-end">
            <TextStatistics :text="text" />
          </div>
        </div>

        <!-- Controls Section -->
        <div class="space-y-4">
          <div v-if="installedModels.length > 0" class="flex items-center">
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mr-2">
              Voice:
            </label>
            <ModelSelector
              :models="installedModels"
              :selected-model="selectedModel"
              @model-change="handleModelChange"
            />
          </div>

          <div v-if="modelsLoading" class="flex items-center gap-2 text-muted-foreground text-sm">
            <div class="animate-spin w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full"></div>
            <span>Loading available models...</span>
          </div>

          <div v-if="voices" class="flex items-center">
            <SpeedControl
              :speed="speed"
              @speed-change="setSpeed"
            />
          </div>

          <div v-else-if="error" class="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
            {{ error }}
          </div>
          <div v-else-if="selectedModel === 'None'" class="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg text-sm">
            Install a Vietnamese voice to start using TTS
          </div>
          <div v-else-if="!voices && status === 'loading'" class="w-full flex items-center gap-3">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Loading model</span>
            <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-6 overflow-hidden">
              <div
                class="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-300 ease-out flex items-center justify-end pr-2"
                :style="{ width: `${loadingProgress}%` }"
              >
                <span class="text-white text-xs font-semibold">{{ Math.round(loadingProgress) }}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex flex-col sm:flex-row gap-3">
          <button
            class="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-white transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:scale-100 disabled:opacity-50 disabled:cursor-not-allowed"
            :class="{
              'bg-gradient-to-r from-orange-500 to-orange-700 hover:from-orange-600 hover:to-orange-800 shadow-lg shadow-orange-500/25': isPlaying,
              'bg-blue-800 shadow-lg': !isPlaying
            }"
            @click="handlePlayPause"
            :disabled="(status === 'ready' && !isPlaying && !text) || (status !== 'ready' && chunks.length === 0)"
          >
            <PauseIcon v-if="isPlaying" class="w-5 h-5" />
            <PlayIcon v-else class="w-5 h-5" />
            <span v-if="isPlaying">Pause</span>
            <span v-else>{{ processed || status === 'generating' ? 'Play' : 'Generate' }}</span>
          </button>

          <button
            class="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:scale-100 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="downloadAudio"
            :disabled="!result || status !== 'ready'"
          >
            <DownloadIcon class="w-4 h-4" />
            Download Audio
          </button>
        </div>

        <!-- Hidden Audio Chunks -->
        <div class="w-0 h-0 hidden">
          <AudioChunk
            v-if="chunks.length > 0"
            v-for="(chunk, index) in chunks"
            :key="index"
            :audio="chunk.audio"
            :active="currentChunkIndex === index"
            :playing="isPlaying"
            class="hidden"
            @start="() => setCurrentChunkIndex(index)"
            @pause="() => { if (currentChunkIndex === index) setIsPlaying(false) }"
            @end="handleChunkEnd"
          />
        </div>
      </div>
    </div>

    <!-- Voice Install Card -->
    <div
      v-if="availableModels.length > 0"
      class="mt-6 bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 dark:border-gray-700/50 overflow-hidden"
    >
      <div class="p-6 space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Manage voices
          </h2>
          <span class="text-xs text-gray-500 dark:text-gray-400">
            {{ installedModels.length }} installed
          </span>
        </div>

        <div
          v-if="voiceManagerMessage"
          class="rounded-lg bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-sm text-blue-700 dark:text-blue-300"
        >
          {{ voiceManagerMessage }}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            v-for="model in availableModels"
            :key="model"
            class="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white/60 dark:bg-gray-800/60 space-y-2"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="font-medium text-gray-800 dark:text-gray-100 truncate">
                  {{ model }}
                </div>
                <div class="mt-1 flex items-center gap-2 text-xs">
                  <span
                    v-if="isModelInstalled(model)"
                    class="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300"
                  >
                    Installed
                  </span>
                  <span
                    v-else
                    class="text-gray-500 dark:text-gray-400"
                  >
                    Not installed
                  </span>
                </div>
              </div>

              <button
                class="shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                :class="isModelInstalled(model)
                  ? 'border border-red-300 bg-white text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-950/30'
                  : 'bg-blue-800 text-white hover:bg-blue-900'"
                :disabled="isInstalling(model)"
                @click="isModelInstalled(model) ? uninstallModel(model) : installModel(model)"
              >
                <span v-if="isModelInstalled(model)">Remove</span>
                <span v-else-if="isInstalling(model)">Installing {{ getInstallProgress(model) }}%</span>
                <span v-else>Install</span>
              </button>
            </div>

            <div v-if="isInstalling(model)" class="space-y-1">
              <div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  class="h-full bg-blue-700 transition-all duration-200"
                  :style="{ width: `${getInstallProgress(model)}%` }"
                ></div>
              </div>
              <div
                v-if="getInstallProgressDetails(model)"
                class="text-xs text-gray-500 dark:text-gray-400"
              >
                {{ getInstallProgressDetails(model) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Demo Table -->
    <DemoTable @text-click="handleDemoTextClick" />
  </div>
</template>
