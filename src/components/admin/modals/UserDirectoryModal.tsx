import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';
import { Users, X, Loader2, ChevronDown, Search } from 'lucide-react';
import { Language } from '../../../types/dental';

export interface UniqueUserItem {
  userId: string;
  totalSessions: number;
  completedSessions: number;
  lastActive: string;
  lastTooth: string;
}

interface UserDirectoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  uniqueUsersList?: UniqueUserItem[];
  totalUsersCount?: number;
  getAuthHeader?: () => Record<string, string>;
}

export const UserDirectoryModal: React.FC<UserDirectoryModalProps> = ({
  isOpen,
  onClose,
  language,
  uniqueUsersList = [],
  totalUsersCount,
  getAuthHeader,
}) => {
  const { t } = useTranslation(['admin', 'common']);
  const [users, setUsers] = useState<UniqueUserItem[]>(uniqueUsersList);
  const [totalCount, setTotalCount] = useState<number>(totalUsersCount ?? uniqueUsersList.length);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const fetchUsers = useCallback(async (cursor: string | null = null, isAppend = false) => {
    try {
      if (!cursor) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const headers: Record<string, string> = getAuthHeader ? getAuthHeader() : {};
      const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const res = await fetch(`/api/admin/users?limit=50${cursorParam}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.users)) {
          if (isAppend) {
            setUsers((prev) => [...prev, ...data.users]);
          } else {
            setUsers(data.users);
          }
          setTotalCount(data.totalCount ?? data.users.length);
          setHasMore(Boolean(data.hasMore));
          setNextCursor(data.nextCursor ?? null);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch user directory:', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [getAuthHeader]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      if (uniqueUsersList && uniqueUsersList.length > 0) {
        setUsers(uniqueUsersList);
        setTotalCount(totalUsersCount ?? uniqueUsersList.length);
      } else {
        fetchUsers(null, false);
      }
    }
  }, [isOpen, uniqueUsersList, totalUsersCount, fetchUsers]);

  const handleLoadMore = () => {
    if (!loadingMore && hasMore && nextCursor) {
      fetchUsers(nextCursor, true);
    }
  };

  const filteredUsers = searchQuery.trim()
    ? users.filter((u) => u.userId.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : users;

  if (!isOpen) return null;

  const displayTotal = totalUsersCount ?? totalCount ?? users.length;

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-950 rounded-2xl max-w-3xl w-full border border-slate-200 dark:border-blue-900/60 shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-16px)] sm:max-h-[85vh] animate-in fade-in zoom-in-95 duration-200 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-slate-900 text-white p-3 sm:p-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-500/20 text-blue-300 rounded-xl border border-blue-500/30">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">
                {t('userDirectory', { defaultValue: language === 'EN' ? 'User & Device Directory' : 'Danh mục Người dùng & Thiết bị' })}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Meta bar */}
        <div className="p-3 sm:p-4 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-blue-900/60 flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={language === 'EN' ? 'Search user / device ID...' : 'Tìm ID người dùng / thiết bị...'}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="text-xs text-slate-500 dark:text-blue-300/70 flex items-center justify-between sm:justify-end gap-3 shrink-0">
            <span>
              {t('total')}{' '}
              <strong className="text-slate-900 dark:text-slate-100 font-bold">
                {displayTotal} {language === 'EN' ? (displayTotal > 1 ? 'users' : 'user') : 'người dùng'}
              </strong>
            </span>
          </div>
        </div>

        <div className="p-3 sm:p-4 overflow-y-auto space-y-3 flex-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-2 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <span className="text-xs">{language === 'EN' ? 'Loading user directory...' : 'Đang tải danh sách người dùng...'}</span>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-10 text-slate-400 dark:text-slate-500 text-xs">
              {searchQuery ? (language === 'EN' ? 'No matching users found.' : 'Không tìm thấy người dùng phù hợp.') : t('noUserSessionData')}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-blue-900/60 border border-slate-200 dark:border-blue-900/60 rounded-xl overflow-hidden">
              {filteredUsers.map((usr, idx) => (
                <div key={usr.userId} className="p-3.5 bg-white dark:bg-blue-950/40 hover:bg-slate-50/80 dark:hover:bg-blue-900/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center space-x-3">
                    <span className="w-7 h-7 rounded-full bg-slate-100 dark:bg-blue-900/80 text-slate-700 dark:text-blue-200 font-bold flex items-center justify-center text-xs shrink-0 border border-slate-200 dark:border-blue-700">
                      #{idx + 1}
                    </span>
                    <div>
                      <p className="font-bold text-slate-900 dark:text-slate-100 font-mono flex items-center gap-2 flex-wrap">
                        <span>{usr.userId}</span>
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-blue-300/70 mt-0.5">
                        {t('lastActive')}{' '}
                        <span className="font-medium text-slate-800 dark:text-slate-200">{usr.lastActive || 'N/A'}</span>
                        {usr.lastTooth && usr.lastTooth !== 'N/A' && (
                          <>
                            {' '}| {t('lastTooth')}{' '}
                            <span className="font-semibold text-blue-700 dark:text-blue-400">{usr.lastTooth}</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4 text-right shrink-0 self-end sm:self-center">
                    <div className="bg-slate-50 dark:bg-blue-900/60 px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-blue-700/60">
                      <p className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                        {usr.totalSessions} <span className="text-[11px] font-normal text-slate-500 dark:text-blue-300/70">{t('sessions6')}</span>
                      </p>
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                        {usr.completedSessions} {t('completed2')}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {hasMore && !loading && (
            <div className="pt-2 flex justify-center">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{language === 'EN' ? 'Loading more...' : 'Đang tải thêm...'}</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" />
                    <span>{language === 'EN' ? 'Load More Users' : 'Tải thêm người dùng'}</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        <div className="bg-slate-50 dark:bg-blue-950 p-3.5 border-t border-slate-200 dark:border-blue-900/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
};
