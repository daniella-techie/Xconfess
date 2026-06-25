'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi, ReportStats } from '@/app/lib/api/admin';
import { queryKeys } from '@/app/lib/api/queryKeys';
import { Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';

function formatAge(seconds: number | null): string {
  if (seconds === null) return 'N/A';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export default function ReportHealthCard() {
  const { data: stats, isLoading, isError } = useQuery<ReportStats>({
    queryKey: queryKeys.admin.reports.stats(),
    queryFn: () => adminApi.getReportStats(),
    refetchInterval: 60000,
  });

  if (isError) {
    return (
      <div className="bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg">
        <div className="p-5">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            Report Queue Health
          </h3>
          <p className="text-sm text-red-500">Failed to load report stats</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg">
      <div className="p-5">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
          Report Queue Health
        </h3>
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-24" />
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-32" />
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-20" />
          </div>
        ) : stats ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm">Pending</span>
              </div>
              <span className="font-semibold text-gray-900 dark:text-white text-lg">
                {stats.pendingCount}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                <Clock className="w-4 h-4" />
                <span className="text-sm">Oldest unresolved</span>
              </div>
              <span className="font-semibold text-gray-900 dark:text-white">
                {formatAge(stats.oldestUnresolvedAge)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-sm">Resolved today</span>
              </div>
              <span className="font-semibold text-gray-900 dark:text-white text-lg">
                {stats.resolvedTodayCount}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No report data available
          </p>
        )}
      </div>
    </div>
  );
}
