import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message || 'Unexpected terminal error' };
  }

  componentDidCatch(error: Error) {
    console.error('Terminal ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      let parsedDetail: { error?: string; operationType?: string; path?: string } | null = null;
      try {
        parsedDetail = JSON.parse(this.state.errorMessage);
      } catch {
        parsedDetail = null;
      }

      return (
        <div className="min-h-screen bg-[#090B0E] text-[#E6EDF3] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#11141A] border border-red-500/30 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-lg font-semibold">My Trade — Session Recovery</h2>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              {parsedDetail?.error
                ? `Database operation (${parsedDetail.operationType} on ${parsedDetail.path || 'collection'}) returned: ${parsedDetail.error}`
                : this.state.errorMessage}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-4 h-4" />
              Reload Terminal
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
