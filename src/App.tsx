import type { Component } from 'solid-js';
import { createSignal } from 'solid-js';
import 'katex/dist/katex.min.css';
import DrawingPanel from './components/DrawingPanel';
import EquationPanel from './components/EquationPanel';
import { convertStrokesToInk } from './lib/ink';
import type { InkConversion, Stroke } from './lib/ink';
import './styles/global.css';
import './styles/app.css';

const App: Component = () => {
  const [conversion, setConversion] = createSignal<InkConversion | null>(null);

  const handleClear = (): void => {
    setConversion(null);
  };

  const handleConvert = (strokes: Stroke[]): void => {
    setConversion(convertStrokesToInk(strokes));
  };

  return (
    <main class="app">
      <div class="shell">
        <DrawingPanel onClear={handleClear} onConvert={handleConvert} />
        <EquationPanel conversion={conversion()} />
      </div>
    </main>
  );
};

export default App;
