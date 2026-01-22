
import { GoogleGenAI, Modality } from "@google/genai";
import { GenerationSettings } from "../types";
import { decodeBase64, pcmToWav } from "../utils/audioUtils";

export async function generateAudioForSegment(
  text: string, 
  settings: GenerationSettings
): Promise<Blob> {
  const apiKey = (process as any).env.API_KEY;
  if (!apiKey) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey });
  
  // Format prompt with emotion/style
  const styledPrompt = `${settings.emotion !== 'Neutral' ? `Say ${settings.emotion}: ` : ''}${text}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: styledPrompt }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: settings.voice },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  
  if (!base64Audio) {
    throw new Error("No audio data returned from Gemini.");
  }

  const pcmBytes = decodeBase64(base64Audio);
  return await pcmToWav(pcmBytes);
}

export function splitTextIntoSegments(text: string, wordsPerSegment: number = 750): string[] {
  const words = text.trim().split(/\s+/);
  const segments: string[] = [];
  
  for (let i = 0; i < words.length; i += wordsPerSegment) {
    segments.push(words.slice(i, i + wordsPerSegment).join(" "));
  }
  
  return segments;
}
