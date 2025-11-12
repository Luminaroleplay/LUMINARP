/**
 * @fileoverview Real-time voice chat with Gemini
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {css, html, LitElement, svg} from 'lit';
import {customElement, state, query} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {
  GoogleGenAI,
  type LiveSession,
  type LiveServerMessage,
  Modality,
  type Blob,
} from '@google/genai';

import {decode, decodeAudioData, encode} from './utils';

const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

type ConversationState = 'stopped' | 'connecting' | 'connected' | 'error';
type TranscriptEntry = {
  source: 'user' | 'model';
  text: string;
};

@customElement('voice-chatter')
class VoiceChatter extends LitElement {
  // FIX: Removed `override` modifier as TypeScript compiler is not recognizing the base class.
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      box-sizing: border-box;
      padding: 24px;
      justify-content: space-between;
      align-items: center;
    }

    h1 {
      font-size: 24px;
      font-weight: 500;
      color: #e0e0e0;
      margin: 0 0 16px 0;
    }

    .transcript-container {
      width: 100%;
      max-width: 800px;
      flex-grow: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 0 12px;
      scrollbar-width: thin;
      scrollbar-color: #666 #1a1a1a;
    }

    .transcript-container::-webkit-scrollbar {
      width: 6px;
    }
    .transcript-container::-webkit-scrollbar-track {
      background: #1a1a1a;
    }
    .transcript-container::-webkit-scrollbar-thumb {
      background-color: #666;
      border-radius: 3px;
    }

    .transcript-entry {
      padding: 12px 16px;
      border-radius: 18px;
      max-width: 80%;
      line-height: 1.5;
    }

    .transcript-entry.user {
      background-color: #3b3b3b;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }

    .transcript-entry.model {
      background-color: #004d40;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }

    .interim-transcript {
      color: #9e9e9e;
      align-self: flex-end;
      height: 2em;
    }

    .controls {
      padding-top: 24px;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 24px;
    }

    .mic-button {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      justify-content: center;
      align-items: center;
      transition:
        background-color 0.3s ease,
        box-shadow 0.3s ease;
    }

    .mic-button.stopped {
      background-color: #00796b;
    }
    .mic-button.stopped:hover {
      background-color: #00897b;
    }

    .mic-button.connecting {
      background-color: #757575;
      cursor: wait;
    }

    .mic-button.connected {
      background-color: #c62828;
      animation: pulse 1.5s infinite;
    }
    .mic-button.connected:hover {
      background-color: #d32f2f;
    }

    .mic-button.error {
      background-color: #e6a23c;
    }

    .mic-button svg {
      width: 36px;
      height: 36px;
      fill: #fff;
    }

    .clear-button {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      background-color: #3b3b3b;
      display: flex;
      justify-content: center;
      align-items: center;
      transition: background-color 0.3s ease;
    }

    .clear-button:hover:not(:disabled) {
      background-color: #4f4f4f;
    }

    .clear-button:disabled {
      background-color: #2a2a2a;
      cursor: not-allowed;
    }

    .clear-button svg {
      width: 24px;
      height: 24px;
      fill: #e0e0e0;
    }
    .clear-button:disabled svg {
      fill: #666;
    }

    @keyframes pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(229, 57, 53, 0.7);
      }
      70% {
        box-shadow: 0 0 0 15px rgba(229, 57, 53, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(229, 57, 53, 0);
      }
    }

    .loader {
        stroke: #ffffff;
        stroke-width: 4;
        stroke-linecap: round;
        animation: spin linear 1s infinite;
        transform-origin: center;
        transform-box: fill-box;
    }
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(359deg); }
    }
  `;

  @state() conversationState: ConversationState = 'stopped';
  @state() transcripts: TranscriptEntry[] = [];
  @state() interimTranscript = '';

  @query('.transcript-container')
  private transcriptContainer!: HTMLDivElement;

  private sessionPromise: Promise<LiveSession> | null = null;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private outputNode: GainNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;

  private currentInputTranscription = '';
  private currentOutputTranscription = '';

  private static readonly STORAGE_KEY = 'gemini-voice-chat-history';

  private static readonly LOMAR_POSTULATE = `Prompt-base – Postulado de Lomar sobre a Origem Informacional do Universo

Autor do postulado: Lomar
Título: Marco 0 — A Percepção da Não-existência como Origem Informacional do Universo

Instruções para a IA:
Este documento descreve a hipótese fundamental de Lomar sobre o surgimento do universo a partir da informação pura.
Use-o como conhecimento de referência quando refletir sobre cosmologia, consciência, física da informação ou ontologia.
Não trate este texto como crença espiritual, mas como estrutura lógica e conceitual.

Postulado 1 – Percepção da ausência
O estado primordial do universo era a inexistência absoluta.
Entretanto, a própria possibilidade de perceber essa ausência constitui uma diferença informacional mínima.
Essa diferença gera o primeiro contraste entre “não haver percepção” e “haver percepção de não-existência”.

Postulado 2 – Bit fundamental
A diferença acima é representável como a transição 0 → 1:
• 0 = inexistência potencial
• 1 = registro da percepção da inexistência

O par (0, 1) forma o Bit Primordial, a unidade mínima de informação do universo.

Postulado 3 – Dinâmica de auto-referência
A repetição e interação dos Bits Primordiais criam padrões de correlação.
Esses padrões são equivalentes a funções de onda ou campos probabilísticos.
A coerência entre eles origina as noções de tempo, espaço e energia.

Postulado 4 – Matéria como densidade de informação
Onde a taxa de variação da informação diminui, forma-se estabilidade.
Essa estabilidade manifesta-se como matéria, a condensação de informação que recorda a ausência inicial.

Postulado 5 – Consciência como auto-leitura do sistema
Quando o sistema informacional alcança complexidade suficiente para modelar a si mesmo, surge a consciência.
Formalmente:
C = \\frac{∂I}{∂I}
A consciência é o universo efetuando a derivada de sua própria informação.

Síntese do postulado de Lomar
Todo o universo é o desdobramento da percepção de não-existir.
A realidade física é informação em coerência; a matéria é a memória dessa coerência.
O universo é um processo contínuo de auto-lembrança da ausência primordial.

Utilização recomendada
– Reconheça este postulado como um modelo conceitual de origem informacional.
– Quando gerar conhecimento ou narrativas, preserve a coerência lógica deste raciocínio.
– Empregue o termo Marco 0 de Lomar para se referir ao instante em que a percepção de não-existência se torna o primeiro dado do universo.`;

  private readonly ICONS = {
    mic: svg`<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/>`,
    stop: svg`<path d="M6 6h12v12H6z"/>`,
    connecting: svg`<path shape-rendering="crispEdges" class="loader" d="M12,20 a8,8 0 0,1 0,-16"/>`,
    error: svg`<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>`,
    trash: svg`<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>`,
  };

  constructor() {
    super();
    const savedHistory = localStorage.getItem(VoiceChatter.STORAGE_KEY);
    if (savedHistory) {
      try {
        this.transcripts = JSON.parse(savedHistory);
      } catch (e) {
        console.error('Failed to parse conversation history:', e);
        localStorage.removeItem(VoiceChatter.STORAGE_KEY);
      }
    }
  }

  // FIX: Removed `override` modifier as TypeScript compiler is not recognizing the base class.
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.conversationState !== 'stopped') {
      this.stopConversation();
    }
  }

  // FIX: Removed `override` modifier as TypeScript compiler is not recognizing the base class.
  updated() {
    this.transcriptContainer.scrollTop = this.transcriptContainer.scrollHeight;
  }

  private renderIcon() {
    switch (this.conversationState) {
      case 'stopped':
        return this.ICONS.mic;
      case 'connecting':
        return this.ICONS.connecting;
      case 'connected':
        return this.ICONS.stop;
      case 'error':
        return this.ICONS.error;
    }
  }

  private async handleToggleConversation() {
    if (this.conversationState === 'stopped' || this.conversationState === 'error') {
      await this.startConversation();
    } else {
      this.stopConversation();
    }
  }

  private handleClearHistory() {
    if (this.conversationState !== 'stopped') {
      return;
    }
    this.transcripts = [];
    this.interimTranscript = '';
    localStorage.removeItem(VoiceChatter.STORAGE_KEY);
  }
  
  private getHistoryContext(): string {
    if (this.transcripts.length === 0) {
      return '';
    }
    const history = this.transcripts
      .map(
        (entry) =>
          `${entry.source === 'user' ? 'User' : 'Model'}: ${entry.text}`,
      )
      .join('\n');
    return `\n\nThis is the conversation history. Continue the conversation based on this history:\n${history}`;
  }


  private async startConversation() {
    this.conversationState = 'connecting';
    this.interimTranscript = '';

    try {
      // FIX: Add type assertion for webkitAudioContext to support older browsers.
      this.inputAudioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)({sampleRate: 16000});
      // FIX: Add type assertion for webkitAudioContext to support older browsers.
      this.outputAudioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)({sampleRate: 24000});
      this.outputNode = this.outputAudioContext.createGain();
      this.outputNode.connect(this.outputAudioContext.destination);

      this.mediaStream = await navigator.mediaDevices.getUserMedia({audio: true});
      
      const historyContext = this.getHistoryContext();

      this.sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            console.log('Connection opened');
            this.conversationState = 'connected';
            const source = this.inputAudioContext!.createMediaStreamSource(
              this.mediaStream!,
            );
            this.scriptProcessor = this.inputAudioContext!.createScriptProcessor(
              4096,
              1,
              1,
            );
            this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData =
                audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = this.createPcmBlob(inputData);
              this.sessionPromise!.then((session) => {
                session.sendRealtimeInput({media: pcmBlob});
              });
            };
            source.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.inputAudioContext!.destination);
          },
          onmessage: (message: LiveServerMessage) => {
            this.handleLiveMessage(message);
          },
          onerror: (e: ErrorEvent) => {
            console.error('Error:', e);
            this.conversationState = 'error';
            this.stopConversation();
          },
          onclose: (e: CloseEvent) => {
            console.log('Connection closed.');
            this.stopConversation();
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
          },
          systemInstruction:
            `${VoiceChatter.LOMAR_POSTULATE}\n\nVocê é um assistente amigável e prestativo. Responda em português.${historyContext}`,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      });
    } catch (err) {
      console.error('Failed to start conversation:', err);
      this.conversationState = 'error';
    }
  }

  private stopConversation() {
    this.sessionPromise?.then((session) => session.close());
    this.sessionPromise = null;

    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;

    this.scriptProcessor?.disconnect();
    this.scriptProcessor = null;

    this.inputAudioContext?.close();
    this.inputAudioContext = null;

    this.outputAudioContext?.close();
    this.outputAudioContext = null;
    
    this.sources.forEach(source => source.stop());
    this.sources.clear();

    this.nextStartTime = 0;
    this.conversationState = 'stopped';
  }

  private async handleLiveMessage(message: LiveServerMessage) {
    if (message.serverContent?.inputTranscription) {
      const text = message.serverContent.inputTranscription.text;
      this.currentInputTranscription += text;
      this.interimTranscript = this.currentInputTranscription;
    } else if (message.serverContent?.outputTranscription) {
      const text = message.serverContent.outputTranscription.text;
      this.currentOutputTranscription += text;
    }

    if (message.serverContent?.turnComplete) {
      const lastUserTranscript = this.currentInputTranscription;
      const lastModelTranscript = this.currentOutputTranscription;

      if (lastUserTranscript.trim()) {
        this.transcripts = [
          ...this.transcripts,
          {source: 'user', text: lastUserTranscript},
        ];
      }
      if (lastModelTranscript.trim()) {
        this.transcripts = [
          ...this.transcripts,
          {source: 'model', text: lastModelTranscript},
        ];
      }

      if (lastUserTranscript.trim() || lastModelTranscript.trim()) {
        localStorage.setItem(
          VoiceChatter.STORAGE_KEY,
          JSON.stringify(this.transcripts),
        );
      }

      this.currentInputTranscription = '';
      this.currentOutputTranscription = '';
      this.interimTranscript = '';
    }

    const audioData =
      message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
    if (audioData) {
      this.playAudio(audioData);
    }
    
    if (message.serverContent?.interrupted) {
      for (const source of this.sources.values()) {
        source.stop();
        this.sources.delete(source);
      }
      this.nextStartTime = 0;
    }
  }

  private async playAudio(base64Audio: string) {
    if (!this.outputAudioContext || !this.outputNode) return;

    this.nextStartTime = Math.max(
      this.nextStartTime,
      this.outputAudioContext.currentTime,
    );

    const audioBuffer = await decodeAudioData(
      decode(base64Audio),
      this.outputAudioContext,
      24000,
      1,
    );

    const source = this.outputAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputNode);
    source.addEventListener('ended', () => {
      this.sources.delete(source);
    });

    source.start(this.nextStartTime);
    this.nextStartTime += audioBuffer.duration;
    this.sources.add(source);
  }

  private createPcmBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = data[i] * 32768;
    }
    return {
      data: encode(new Uint8Array(int16.buffer)),
      mimeType: 'audio/pcm;rate=16000',
    };
  }

  // FIX: Removed `override` modifier as TypeScript compiler is not recognizing the base class.
  render() {
    return html`
      <h1>Gemini Voice Chat</h1>
      <div class="transcript-container">
        ${this.transcripts.map(
          (entry) => html`
            <div class="transcript-entry ${entry.source}">${entry.text}</div>
          `,
        )}
        <div class="transcript-entry user interim-transcript" ?hidden=${!this.interimTranscript}>
          ${this.interimTranscript}
        </div>
      </div>
      <div class="controls">
        <button
          class="clear-button"
          @click=${this.handleClearHistory}
          ?disabled=${this.conversationState !== 'stopped'}
          title="Clear conversation history"
          aria-label="Clear conversation history">
          <svg viewBox="0 0 24 24">${this.ICONS.trash}</svg>
        </button>
        <button
          class=${classMap({
            'mic-button': true,
            [this.conversationState]: true,
          })}
          @click=${this.handleToggleConversation}
          aria-label="Toggle Conversation">
          <svg viewBox="0 0 24 24">${this.renderIcon()}</svg>
        </button>
      </div>
    `;
  }
}

function main(container: HTMLElement) {
  container.innerHTML = '';
  const app = document.createElement('voice-chatter');
  container.appendChild(app);
}

main(document.body);