import { PiperTTS, TextSplitterStream } from "../lib/piper-tts-i18n.js";
import { getModelBaseUrl } from "../config.js";

let tts = null;
let generation = null;
let inferenceQueue = Promise.resolve();
let latestGenerationId = null;

async function initializeModel(lang, modelName) {
  try {
    const base = getModelBaseUrl(lang);
    tts = await PiperTTS.from_pretrained(
      `${base}${modelName}.onnx`,
      `${base}${modelName}.onnx.json`,
    );
    self.postMessage({ status: "ready", voices: tts.getSpeakers() });
  } catch (error) {
    console.error("Error loading model:", error);
    self.postMessage({ status: "error", data: error.message });
  }
}

async function handlePreview(text, voice, speed) {
  const streamer = new TextSplitterStream();
  await streamer.push(text);
  streamer.close();

  const stream = tts.stream(streamer, {
    speakerId: typeof voice === 'number' ? voice : parseInt(voice) || 0,
    lengthScale: 1.0 / (speed || 1.0),
  });

  for await (const { audio } of stream) {
    self.postMessage({ status: "preview", audio: audio.toBlob() });
    break;
  }
}

async function prepareGeneration({ generationId, text, voice, speed }) {
  const streamer = new TextSplitterStream();
  await streamer.push(text);
  streamer.close();

  if (generationId !== latestGenerationId) return;

  generation = {
    id: generationId,
    chunks: streamer.chunks,
    speakerId: typeof voice === 'number' ? voice : parseInt(voice) || 0,
    lengthScale: 1.0 / (speed || 1.0),
  };

  self.postMessage({ status: "prepared", generationId, totalChunks: generation.chunks.length });
}

async function synthesizeChunk({ generationId, index }) {
  const activeGeneration = generation;
  if (!activeGeneration || activeGeneration.id !== generationId) return;
  if (!Number.isInteger(index) || index < 0 || index >= activeGeneration.chunks.length) return;

  const startedAt = performance.now();
  const stream = tts.stream([activeGeneration.chunks[index]], {
    speakerId: activeGeneration.speakerId,
    lengthScale: activeGeneration.lengthScale,
  });

  for await (const { text, audio } of stream) {
    const elapsedMs = performance.now() - startedAt;
    console.log(`[TTS] chunk ${index} synthesized in ${elapsedMs.toFixed(1)} ms: ${text}`);
    if (generation?.id !== generationId) return;
    self.postMessage({
      status: "stream",
      generationId,
      index,
      chunk: { audio: audio.toBlob(), text },
    });
    break;
  }
}

function enqueue(task, generationId = null) {
  inferenceQueue = inferenceQueue.then(task).catch((error) => {
    console.error("Error during synthesis:", error);
    if (generationId === null || generation?.id === generationId) {
      self.postMessage({ status: "error", generationId, data: error.message });
    }
  });
}

self.addEventListener("message", async (event) => {
  const { type, text, voice, speed, lang, model, generationId } = event.data;

  if (type === 'init') {
    await initializeModel(lang, model);
    return;
  }

  if (!tts) {
    self.postMessage({ status: "error", data: "Model not initialized" });
    return;
  }

  if (type === 'preview') {
    enqueue(() => handlePreview(text, voice, speed));
    return;
  }

  if (type === 'cancel') {
    if (generation?.id === generationId) generation = null;
    if (latestGenerationId === generationId) latestGenerationId = null;
    return;
  }

  if (type === 'start') {
    latestGenerationId = generationId;
    try {
      await prepareGeneration(event.data);
    } catch (error) {
      console.error("Error preparing generation:", error);
      self.postMessage({ status: "error", generationId, data: error.message });
    }
    return;
  }

  if (type === 'synthesize') {
    enqueue(() => synthesizeChunk(event.data), generationId);
  }
});
