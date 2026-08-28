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
        <div className="min-h-[220px] flex flex-col items-center justify-center p-6 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 text-center border border-rose-200 dark:border-rose-900/60 my-4 max-w-md mx-auto shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-3">
            <AlertOctagon className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-bold mb-1">
            Có lỗi khi hiển thị module (Module Load Error)
          </h4>
          <p className="text-xs text-rose-600 dark:text-rose-400 mb-4 max-w-xs leading-relaxed">
            Hệ thống đã tự động ghi nhận nhật ký chẩn đoán lỗi. Vui lòng thử tải lại trang hoặc kiểm tra kết nối mạng.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="inline-flex items-center space-x-2 px-4 py-2 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Tải lại trang (Reload)</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
