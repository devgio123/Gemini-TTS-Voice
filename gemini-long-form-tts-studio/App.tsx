import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  AudioStatus, 
  Segment, 
  GenerationSettings, 
  VoiceOption, 
  VoiceName 
} from './types';
import { VOICES, EMOTIONS, LANGUAGES } from './constants.tsx';
import { splitTextIntoSegments, generateAudioForSegment } from './services/geminiService';
import { mergeAudioBlobs } from './utils/audioUtils';

// Standard declaration for external scripts
declare const JSZip: any;

const App: React.FC = () => {
  // Theme State
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const [script, setScript] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [settings, setSettings] = useState<GenerationSettings>({
    voice: 'Kore',
    speed: 1.0,
    pitch: 1.0,
    emotion: 'Neutral',
    language: 'en-US'
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState('v1');
  const [activeTab, setActiveTab] = useState<'input' | 'processing'>('input');
  
  // Audio Preview State
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [loadingVoiceId, setLoadingVoiceId] = useState<string | null>(null);
  const [voiceCache, setVoiceCache] = useState<Record<string, string>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Drag and Drop State
  const [dragActive, setDragActive] = useState(false);

  const processingRef = useRef<boolean>(false);

  // Theme Effect
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const handleSplitScript = () => {
    if (!script.trim()) return;
    const textSegments = splitTextIntoSegments(script);
    const newSegments: Segment[] = textSegments.map((text, index) => ({
      id: `seg-${Date.now()}-${index}`,
      name: `Segment ${index + 1}`,
      text,
      status: AudioStatus.IDLE,
      progress: 0
    }));
    setSegments(newSegments);
    setActiveTab('processing');
  };

  const processAllSegments = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    processingRef.current = true;

    // Process in batches of 3 to avoid rate limits while maintaining speed
    const batchSize = 3;
    const segmentsToProcess = [...segments];

    for (let i = 0; i < segmentsToProcess.length; i += batchSize) {
      if (!processingRef.current) break;

      const currentBatch = segmentsToProcess.slice(i, i + batchSize);
      
      await Promise.all(currentBatch.map(async (seg) => {
        if (seg.status === AudioStatus.COMPLETED) return;

        setSegments(prev => prev.map(s => 
          s.id === seg.id ? { ...s, status: AudioStatus.PROCESSING } : s
        ));

        try {
          const audioBlob = await generateAudioForSegment(seg.text, settings);
          setSegments(prev => prev.map(s => 
            s.id === seg.id ? { ...s, status: AudioStatus.COMPLETED, audioBlob } : s
          ));
        } catch (error: any) {
          console.error(`Error processing ${seg.name}:`, error);
          setSegments(prev => prev.map(s => 
            s.id === seg.id ? { ...s, status: AudioStatus.FAILED, error: error.message } : s
          ));
        }
      }));
    }

    setIsProcessing(false);
    processingRef.current = false;
  };

  const stopProcessing = () => {
    processingRef.current = false;
    setIsProcessing(false);
  };

  const handleDownloadZip = async () => {
    const zip = new JSZip();
    const completed = segments.filter(s => s.status === AudioStatus.COMPLETED && s.audioBlob);
    
    if (completed.length === 0) return;

    completed.forEach(s => {
      zip.file(`${s.name.replace(/\s+/g, '_').toLowerCase()}.wav`, s.audioBlob!);
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voice_generation_${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadMerged = async () => {
    const completed = segments.filter(s => s.status === AudioStatus.COMPLETED && s.audioBlob);
    if (completed.length === 0) return;

    try {
      const mergedBlob = await mergeAudioBlobs(completed.map(s => s.audioBlob!));
      const url = URL.createObjectURL(mergedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `full_narration_${Date.now()}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to merge audio segments. Try downloading as ZIP.");
    }
  };

  const handleVoiceChange = (voice: VoiceOption) => {
    setSelectedVoiceId(voice.id);
    setSettings(prev => ({ ...prev, voice: voice.baseVoice }));
  };

  const handlePlaySample = async (e: React.MouseEvent, voice: VoiceOption) => {
    e.stopPropagation();
    
    // Stop current playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    // If clicking same button to stop
    if (playingVoiceId === voice.id) {
      setPlayingVoiceId(null);
      return;
    }

    // If clicking a button that is currently loading, do nothing
    if (loadingVoiceId === voice.id) return;

    // Check cache first
    if (voiceCache[voice.id]) {
      setPlayingVoiceId(voice.id);
      const audio = new Audio(voiceCache[voice.id]);
      audioRef.current = audio;
      audio.onended = () => setPlayingVoiceId(null);
      audio.play().catch(e => {
        console.error("Playback error", e);
        setPlayingVoiceId(null);
      });
      return;
    }

    // Start loading
    setLoadingVoiceId(voice.id);

    try {
      const text = `Hello, I am ${voice.name}.`;
      const tempSettings: GenerationSettings = {
        ...settings,
        voice: voice.baseVoice,
        emotion: 'Neutral' 
      };
      
      const blob = await generateAudioForSegment(text, tempSettings);
      const audioUrl = URL.createObjectURL(blob);
      setVoiceCache(prev => ({ ...prev, [voice.id]: audioUrl }));

      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => setPlayingVoiceId(null);
      
      // Stop loading, start playing
      setLoadingVoiceId(null);
      setPlayingVoiceId(voice.id);
      
      audio.play();
    } catch (error) {
      console.error("Failed to play sample:", error);
      setLoadingVoiceId(null);
      setPlayingVoiceId(null);
      alert("Failed to generate preview. Please check your API key.");
    }
  };

  // Drag and Drop Handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      // Basic check for text types or extensions
      if (
        file.type === "text/plain" || 
        file.name.endsWith('.txt') || 
        file.name.endsWith('.md') || 
        file.name.endsWith('.srt')
      ) {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            setScript(prev => {
              const newContent = event.target!.result as string;
              return prev ? prev + '\n\n' + newContent : newContent;
            });
          }
        };
        reader.readAsText(file);
      } else {
        alert("Please drop a text file (.txt, .md, .srt)");
      }
    }
  };

  return (
    <div className="min-h-screen transition-colors duration-300 bg-background-primary text-content-primary">
      <div className="max-w-7xl mx-auto px-4 py-8 lg:py-12 relative">
        
        {/* Theme Toggle */}
        <button 
          onClick={toggleTheme}
          className="absolute top-8 right-4 lg:right-0 p-3 rounded-full bg-background-secondary shadow-md border border-border text-content-secondary hover:text-brand-primary transition-all z-50"
          aria-label="Toggle Theme"
        >
          {theme === 'dark' ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
          ) : (
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
          )}
        </button>

        {/* Header */}
        <header className="mb-12 flex flex-col items-center justify-center text-center">
          <div className="relative mb-4">
            <div className="absolute inset-0 bg-brand-primary blur-2xl opacity-20 rounded-full"></div>
            <div className="relative flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-primary to-brand-secondary shadow-xl shadow-brand-primary/20">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
            </div>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-content-primary mb-3">
            Gemini TTS Studio
          </h1>
          <p className="text-content-secondary text-lg max-w-xl">
            Professional long-form voice synthesis powered by Google AI. 
            Segment scripts, generate parallel audio, and export.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Settings Sidebar */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-background-secondary/80 backdrop-blur-xl border border-border rounded-3xl p-6 shadow-xl transition-all">
              <div className="flex items-center gap-2 mb-6 text-brand-primary">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                <h2 className="text-lg font-semibold tracking-wide uppercase text-xs">Configuration</h2>
              </div>

              <div className="space-y-6">
                {/* Voice Selection */}
                <div>
                  <label className="block text-sm font-medium text-content-secondary mb-2">Voice Model</label>
                  <div className="bg-background-secondary border border-border rounded-xl overflow-hidden h-72 flex flex-col">
                    <div className="overflow-y-auto p-2 space-y-1 custom-scrollbar">
                      {VOICES.map(v => (
                        <div 
                          key={v.id}
                          onClick={() => handleVoiceChange(v)}
                          className={`group p-3 rounded-lg flex items-center justify-between cursor-pointer transition-all border ${
                            selectedVoiceId === v.id 
                              ? 'bg-brand-primary/10 border-brand-primary/50 shadow-[0_0_15px_rgba(var(--brand-primary),0.15)]' 
                              : 'bg-transparent border-transparent hover:bg-background-tertiary hover:border-border'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                                selectedVoiceId === v.id ? 'bg-brand-primary text-white' : 'bg-background-tertiary text-content-secondary group-hover:bg-background-primary'
                              }`}>
                              {v.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <div className={`text-sm font-medium truncate ${selectedVoiceId === v.id ? 'text-brand-primary' : 'text-content-primary'}`}>{v.name}</div>
                              <div className="text-xs text-content-muted truncate">{v.gender}, {v.description}</div>
                            </div>
                          </div>
                          
                          <button
                            onClick={(e) => handlePlaySample(e, v)}
                            className={`p-2 rounded-full transition-all ${
                              playingVoiceId === v.id 
                                ? 'text-brand-primary bg-brand-primary/10' 
                                : 'text-content-muted hover:text-brand-primary hover:bg-background-tertiary'
                            }`}
                            title="Preview"
                          >
                            {loadingVoiceId === v.id ? (
                              <svg className="w-4 h-4 animate-spin text-brand-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            ) : playingVoiceId === v.id ? (
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                            ) : (
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Emotion */}
                <div>
                  <label className="block text-sm font-medium text-content-secondary mb-2">Expression</label>
                  <div className="relative">
                    <select 
                      value={settings.emotion}
                      onChange={(e) => setSettings(s => ({ ...s, emotion: e.target.value }))}
                      className="w-full bg-background-secondary border border-border text-content-primary rounded-xl px-4 py-3 appearance-none focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary transition-all"
                    >
                      {EMOTIONS.map(e => <option key={e} value={e}>{e}</option>)}
                    </select>
                    <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-content-muted">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                  </div>
                </div>

                {/* Speed */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-content-secondary">Speed</label>
                    <span className="text-xs font-mono bg-background-tertiary text-content-muted px-2 py-0.5 rounded-md">{settings.speed.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={settings.speed}
                    onChange={(e) => setSettings(s => ({ ...s, speed: parseFloat(e.target.value) }))}
                    className="w-full h-2 bg-background-tertiary rounded-lg appearance-none cursor-pointer accent-brand-primary"
                  />
                  <div className="flex justify-between text-[10px] text-content-muted mt-1 uppercase tracking-wider">
                    <span>Slow</span>
                    <span>Fast</span>
                  </div>
                </div>

                {/* Grid for Language */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-content-secondary mb-2">Language</label>
                    <div className="relative">
                      <select 
                        value={settings.language}
                        onChange={(e) => setSettings(s => ({ ...s, language: e.target.value }))}
                        className="w-full bg-background-secondary border border-border text-content-primary rounded-xl px-3 py-2 text-sm appearance-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary transition-all"
                      >
                        {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-content-secondary mb-2">Batch Size</label>
                    <input type="text" value="3" readOnly className="w-full bg-background-tertiary border border-border text-content-muted rounded-xl px-3 py-2 text-sm text-center cursor-not-allowed" />
                  </div>
                </div>
              </div>
            </div>

            {/* Stats Card */}
            <div className="bg-background-secondary/80 backdrop-blur-xl border border-border rounded-3xl p-6 shadow-xl transition-all">
               <div className="grid grid-cols-3 divide-x divide-border">
                  <div className="text-center px-2">
                    <div className="text-2xl font-bold text-content-primary">{segments.length}</div>
                    <div className="text-[10px] uppercase tracking-wider text-content-muted mt-1">Total</div>
                  </div>
                  <div className="text-center px-2">
                    <div className="text-2xl font-bold text-status-success">{segments.filter(s => s.status === AudioStatus.COMPLETED).length}</div>
                    <div className="text-[10px] uppercase tracking-wider text-content-muted mt-1">Ready</div>
                  </div>
                  <div className="text-center px-2">
                    <div className="text-2xl font-bold text-brand-primary">{segments.filter(s => s.status === AudioStatus.IDLE || s.status === AudioStatus.PROCESSING).length}</div>
                    <div className="text-[10px] uppercase tracking-wider text-content-muted mt-1">Pending</div>
                  </div>
               </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-8">
            <div className="bg-background-secondary/80 backdrop-blur-xl border border-border rounded-3xl shadow-2xl overflow-hidden min-h-[750px] flex flex-col transition-all">
              
              {/* Tabs */}
              <div className="border-b border-border p-2 flex gap-1">
                <button 
                  onClick={() => setActiveTab('input')}
                  className={`flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-all ${
                    activeTab === 'input' 
                      ? 'bg-background-secondary text-content-primary shadow-lg' 
                      : 'text-content-muted hover:text-content-primary hover:bg-background-tertiary'
                  }`}
                >
                  1. Script Editor
                </button>
                <button 
                  onClick={() => setActiveTab('processing')}
                  className={`flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-all ${
                    activeTab === 'processing' 
                      ? 'bg-background-secondary text-content-primary shadow-lg' 
                      : 'text-content-muted hover:text-content-primary hover:bg-background-tertiary'
                  }`}
                >
                  2. Generation & Export
                </button>
              </div>

              {/* Tab Content */}
              <div className="flex-1 flex flex-col relative">
                {activeTab === 'input' ? (
                  <div className="flex-1 flex flex-col p-6 animate-in fade-in zoom-in-95 duration-200">
                    <div 
                      className={`flex-1 relative group transition-all duration-200 ${dragActive ? 'scale-[1.01]' : ''}`}
                      onDragEnter={handleDrag}
                      onDragLeave={handleDrag}
                      onDragOver={handleDrag}
                      onDrop={handleDrop}
                    >
                      <textarea 
                        value={script}
                        onChange={(e) => setScript(e.target.value)}
                        placeholder="Paste your long-form script here. The system will automatically segment it for optimal TTS generation..."
                        className={`w-full h-full bg-background-tertiary/50 text-content-primary p-6 rounded-2xl border transition-all resize-none outline-none leading-relaxed font-light min-h-[650px]
                          ${dragActive 
                            ? 'border-brand-primary ring-2 ring-brand-primary/50 bg-background-tertiary' 
                            : 'border-border focus:border-brand-primary focus:ring-1 focus:ring-brand-primary placeholder:text-content-muted'
                          }`}
                        spellCheck={false}
                      />
                      
                      {dragActive && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background-secondary/80 backdrop-blur-sm rounded-2xl border-2 border-dashed border-brand-primary z-10 pointer-events-none">
                          <div className="text-center">
                            <svg className="w-12 h-12 text-brand-primary mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                            <p className="text-lg font-medium text-brand-primary">Drop text file here</p>
                          </div>
                        </div>
                      )}
                      
                      <div className="absolute bottom-4 right-4 text-xs text-content-muted bg-background-secondary/80 px-2 py-1 rounded-md backdrop-blur pointer-events-none">
                        {script.length} characters
                      </div>
                    </div>
                    <div className="mt-6">
                      <button 
                        onClick={handleSplitScript}
                        disabled={!script.trim()}
                        className="w-full py-4 bg-gradient-to-r from-brand-primary to-brand-secondary text-white rounded-xl font-bold shadow-lg shadow-brand-primary/20 hover:shadow-brand-primary/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100 transition-all flex items-center justify-center gap-2"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758L5 19m0-14l4.121 4.121"></path></svg>
                        Process Segments
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-right-4 duration-200">
                    {/* Toolbar */}
                    <div className="p-4 border-b border-border bg-background-tertiary/50 flex flex-wrap gap-4 justify-between items-center sticky top-0 z-10 backdrop-blur-md">
                      <div className="flex gap-3">
                        {!isProcessing ? (
                          <button 
                            onClick={processAllSegments}
                            disabled={segments.length === 0}
                            className="px-5 py-2.5 bg-brand-primary text-white rounded-xl font-medium hover:bg-brand-hover disabled:opacity-50 disabled:bg-background-tertiary transition-all shadow-lg shadow-brand-primary/20 flex items-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M4.5 3a.5.5 0 00-.5.5v13a.5.5 0 00.757.429l11-6.5a.5.5 0 000-.858l-11-6.5A.5.5 0 004.5 3z" /></svg>
                            Generate All
                          </button>
                        ) : (
                          <button 
                            onClick={stopProcessing}
                            className="px-5 py-2.5 bg-status-error/10 text-status-error border border-status-error/50 rounded-xl font-medium hover:bg-status-error/20 transition-all flex items-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H10a1 1 0 01-1-1v-4z"></path></svg>
                            Stop
                          </button>
                        )}
                      </div>
                      
                      <div className="flex gap-2">
                        <button 
                          onClick={handleDownloadMerged}
                          disabled={segments.filter(s => s.status === AudioStatus.COMPLETED).length === 0}
                          className="px-4 py-2 bg-background-tertiary text-content-primary rounded-xl font-medium hover:bg-background-secondary disabled:opacity-50 border border-border transition-all text-sm"
                        >
                          Merge & Download
                        </button>
                        <button 
                          onClick={handleDownloadZip}
                          disabled={segments.filter(s => s.status === AudioStatus.COMPLETED).length === 0}
                          className="px-4 py-2 bg-background-tertiary text-content-primary rounded-xl font-medium hover:bg-background-secondary disabled:opacity-50 border border-border transition-all flex items-center gap-2 text-sm"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                          ZIP
                        </button>
                      </div>
                    </div>

                    {/* Segments List */}
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                      {segments.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-content-muted space-y-4">
                          <div className="w-16 h-16 rounded-full bg-background-tertiary border border-border flex items-center justify-center">
                            <svg className="w-6 h-6 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                          </div>
                          <p>No segments yet.</p>
                        </div>
                      )}
                      
                      <div className="space-y-3">
                        {segments.map((seg, idx) => (
                          <div 
                            key={seg.id} 
                            className={`group p-4 rounded-2xl border transition-all duration-300 ${
                              seg.status === AudioStatus.COMPLETED 
                                ? 'bg-background-secondary border-border hover:border-content-muted' 
                                : seg.status === AudioStatus.PROCESSING 
                                  ? 'bg-brand-primary/10 border-brand-primary/30'
                                  : seg.status === AudioStatus.FAILED
                                    ? 'bg-status-error/10 border-status-error/30'
                                    : 'bg-background-tertiary/20 border-border/50'
                            }`}
                          >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                    seg.status === AudioStatus.COMPLETED ? 'bg-status-success/10 text-status-success' :
                                    seg.status === AudioStatus.PROCESSING ? 'bg-brand-primary/10 text-brand-primary' :
                                    seg.status === AudioStatus.FAILED ? 'bg-status-error/10 text-status-error' :
                                    'bg-background-tertiary text-content-muted'
                                  }`}>
                                    {seg.name}
                                  </span>
                                  {seg.status === AudioStatus.PROCESSING && (
                                    <span className="flex h-2 w-2 relative">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-primary opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-primary"></span>
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-content-secondary font-light truncate leading-relaxed">
                                  {seg.text}
                                </p>
                              </div>

                              <div className="flex items-center justify-end gap-4 min-w-[200px]">
                                {seg.status === AudioStatus.PROCESSING && (
                                  <span className="text-xs text-brand-primary font-medium animate-pulse">Generating audio...</span>
                                )}
                                
                                {seg.status === AudioStatus.COMPLETED && seg.audioBlob && (
                                  <div className="flex items-center gap-3 w-full justify-end">
                                     {/* Audio Element Styled */}
                                    <audio 
                                      src={URL.createObjectURL(seg.audioBlob)} 
                                      controls 
                                      className="h-8 w-48 opacity-80 hover:opacity-100 transition-opacity rounded-lg dark:invert-[.9] dark:hue-rotate-180 dark:brightness-75 dark:contrast-150" 
                                    />
                                    <button 
                                      className="text-content-muted hover:text-content-primary transition-colors"
                                      title="Download Segment"
                                      onClick={() => {
                                        const url = URL.createObjectURL(seg.audioBlob!);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = `${seg.name}.wav`;
                                        a.click();
                                        URL.revokeObjectURL(url);
                                      }}
                                    >
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                    </button>
                                  </div>
                                )}
                                
                                {seg.status === AudioStatus.FAILED && (
                                  <div className="flex flex-col items-end">
                                    <span className="text-xs text-status-error font-medium bg-status-error/10 px-2 py-1 rounded">Failed</span>
                                    {seg.error && (
                                      <div className="relative group/tooltip">
                                        <span className="text-[10px] text-status-error/80 max-w-[150px] truncate block mt-1 cursor-help border-b border-dotted border-status-error/50">
                                          {seg.error}
                                        </span>
                                        <div className="absolute bottom-full right-0 mb-2 w-64 p-2 bg-background-secondary border border-status-error/30 rounded-lg shadow-xl text-xs text-status-error hidden group-hover/tooltip:block z-50">
                                          {seg.error}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {seg.status === AudioStatus.IDLE && (
                                  <span className="text-xs text-content-muted font-mono">WAITING</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <footer className="mt-16 border-t border-border pt-8 text-center">
           <div className="flex justify-center items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-status-success"></span>
              <p className="text-content-secondary text-sm">System Operational</p>
           </div>
           <p className="text-content-muted text-xs">Gemini 2.5 Flash Preview • High Fidelity Audio • Real-time Processing</p>
        </footer>
      </div>
    </div>
  );
};

export default App;