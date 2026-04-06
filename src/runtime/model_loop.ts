export interface ModelLoopOptions {
  maxSteps: number;
  stopOnError: boolean;
}

export interface ModelStep {
  stepIndex: number;
  input: string;
  output: string;
}

const DEFAULT_OPTIONS: ModelLoopOptions = { maxSteps: 10, stopOnError: true };

export class ModelLoop {
  constructor(private readonly options: ModelLoopOptions = DEFAULT_OPTIONS) {}

  run(prompt: string, steps: Array<{ input: string; output: string }>): ModelStep[] {
    const results: ModelStep[] = [];
    const limit = Math.min(steps.length, this.options.maxSteps);

    for (let i = 0; i < limit; i++) {
      const step = steps[i];
      try {
        results.push({ stepIndex: i, input: step.input, output: step.output });
      } catch (err) {
        if (this.options.stopOnError) break;
      }
    }

    return results;
  }
}
