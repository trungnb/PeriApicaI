import React, { ErrorInfo, ReactNode } from 'react';
import { logDiagnosticError } from '../utils/errorBoundary';
import { AlertOctagon, RotateCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logDiagnosticError(error, { componentStack: errorInfo.componentStack }, { component: 'ReactErrorBoundary' });
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[320px] flex flex-col items-center justify-center p-8 rounded-2xl bg-rose-50/80 dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-center border border-rose-200 dark:border-rose-900/60 my-6 max-w-lg mx-auto shadow-lg">
          <div className="w-14 h-14 rounded-2xl bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-4 shadow-xs">
            <AlertOctagon className="w-7 h-7" />
          </div>
          <h3 className="text-base sm:text-lg font-bold mb-1.5 text-slate-900 dark:text-white">
            Đã xảy ra sự cố hiển thị / Application Notice
          </h3>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mb-5 max-w-sm leading-relaxed">
            Hệ thống phát hiện lỗi không mong muốn trong quá trình kết xuất giao diện. Nhật ký chẩn đoán đã được ghi lại an toàn.
            <br />
            <span className="text-slate-500 dark:text-slate-400 text-xs mt-1 block">
              An unexpected render issue occurred. Please reload the page to restore state.
            </span>
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-rose-600 dark:hover:bg-rose-700 shadow-md transition-all active:scale-95 cursor-pointer"
          >
            <RotateCw className="w-4 h-4" />
            <span>Tải lại ứng dụng / Reload App</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
