# TS FFT Spectrum Visualizer

Real-time audio visualization tool that captures live desktop or microphone audio and transforms it into visual spectrograms and frequency bars using FFT analysis.

## Tech Stack

- **TypeScript** - Typescript
- **Vite** - Fast build tool and dev server
- **Web Audio API** - AudioContext, AnalyserNode for FFT processing
- **Canvas API** - Real-time rendering of visualizations

## How It Works

The application captures audio from two sources:
- **Microphone**: Uses `getUserMedia()` API to stream microphone input
- **System/Tab Audio**: Uses `getDisplayMedia()` API to capture desktop or tab audio (requires browser permission)

Audio is processed through the Web Audio API's `AnalyserNode`, which performs FFT analysis to convert time-domain audio into frequency-domain data. The frequency spectrum is then visualized in real-time using HTML5 Canvas.

## Visualization Modes

The modular architecture supports multiple visualization modes:
- **Spectrogram**: Scrolling waterfall display showing frequency intensity over time with logarithmic frequency scaling
- **Bars**: Real-time frequency bars with logarithmic bucketing for musical representation

Each visualization mode is implemented as a separate, reusable function, making it easy to add new visualization types without modifying core audio capture logic.

## Usage

```bash
npx vite
```

Then open the application in your browser and select either microphone or system audio capture.  For system audio capture, ensure to toggle enable audio when selecting the tab or window you would like to capture from.
