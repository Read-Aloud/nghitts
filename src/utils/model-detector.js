import { VIETNAMESE_MODELS } from '../config.js';

/**
 * Returns Vietnamese TTS model metadata included in the app bundle.
 * @returns {Promise<Array<{id: string, name: string}>>} Array of models
 */
export async function fetchAvailableModels() {
  return VIETNAMESE_MODELS;
}
