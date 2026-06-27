'use client';

import { useState, useEffect, useCallback } from 'react';
import { AuthGuard } from '@/app/components/AuthGuard';
import apiClient from '@/app/lib/api/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Send, User as UserIcon, MessageSquare, Lock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useMessageE2E } from '@/app/lib/hooks/useMessageE2E';
import { ENCRYPTED_PREVIEW } from '@/app/lib/crypto/messageE2E';

interface Thread {
  confessionId: string;
  senderId: string;
  authorAnonymousUserId: string | null;
  confessionMessage: string;
  lastMessage: string;
  lastMessageEncrypted?: boolean;
  lastMessageAt: string;
  hasUnread: boolean;
  isAuthor: boolean;
}

interface Message {
  id: number;
  content: string;
  isEncrypted?: boolean;
  createdAt: string;
  hasReply: boolean;
  replyContent: string | null;
  repliedAt: string | null;
}

interface DecryptedMessage extends Message {
  decryptedContent: string;
  decryptedReply: string | null;
}

export default function MessagesPage() {
  const {
    isReady: e2eReady,
    keyError,
    encryptForThread,
    decryptForThread,
    createKeyBackup,
    restoreFromBackup,
  } = useMessageE2E();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [recoveryPassphrase, setRecoveryPassphrase] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);

  const fetchThreads = useCallback(async () => {
    try {
      setIsLoadingThreads(true);
      setThreadsError(null);
      const response = await apiClient.get('/messages/threads');
      setThreads(response.data || []);
    } catch (error) {
      console.error('Failed to fetch threads:', error);
      setThreadsError('Unable to load conversations. Check your connection and try again.');
    } finally {
      setIsLoadingThreads(false);
    }
  }, []);

  const decryptMessages = useCallback(
    async (rawMessages: Message[], thread: Thread): Promise<DecryptedMessage[]> => {
      if (!thread.authorAnonymousUserId) {
        return rawMessages.map((m) => ({
          ...m,
          decryptedContent: m.content,
          decryptedReply: m.replyContent,
        }));
      }

      const threadCtx = {
        confessionId: thread.confessionId,
        senderAnonId: thread.senderId,
        authorAnonymousUserId: thread.authorAnonymousUserId,
        isAuthor: thread.isAuthor,
      };

      return Promise.all(
        rawMessages.map(async (m) => ({
          ...m,
          decryptedContent: await decryptForThread(m.content, threadCtx),
          decryptedReply: m.replyContent
            ? await decryptForThread(m.replyContent, threadCtx)
            : null,
        })),
      );
    },
    [decryptForThread],
  );

  const fetchMessages = useCallback(
    async (thread: Thread) => {
      try {
        setIsLoadingMessages(true);
        setMessagesError(null);
        const response = await apiClient.get(
          `/messages?confession_id=${thread.confessionId}&sender_id=${thread.senderId}`,
        );
        const raw: Message[] = response.data?.messages || [];
        const decrypted = e2eReady
          ? await decryptMessages(raw, thread)
          : raw.map((m) => ({
              ...m,
              decryptedContent: ENCRYPTED_PREVIEW,
              decryptedReply: m.replyContent ? ENCRYPTED_PREVIEW : null,
            }));
        setMessages(decrypted);
      } catch (error) {
        console.error('Failed to fetch messages:', error);
        setMessagesError('Unable to load messages for this conversation.');
      } finally {
        setIsLoadingMessages(false);
      }
    },
    [decryptMessages, e2eReady],
  );

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  useEffect(() => {
    if (selectedThread && e2eReady) {
      fetchMessages(selectedThread);
    }
  }, [selectedThread, e2eReady, fetchMessages]);

  const handleSendMessage = async () => {
    if (!selectedThread || !newMessage.trim() || !e2eReady) return;
    if (!selectedThread.authorAnonymousUserId) {
      setMessagesError('Cannot encrypt: missing author identity for this thread.');
      return;
    }

    try {
      setIsSending(true);
      const threadCtx = {
        confessionId: selectedThread.confessionId,
        senderAnonId: selectedThread.senderId,
        authorAnonymousUserId: selectedThread.authorAnonymousUserId,
        isAuthor: selectedThread.isAuthor,
      };

      const ciphertext = await encryptForThread(newMessage.trim(), threadCtx);

      if (selectedThread.isAuthor) {
        const unrepliedMessage = [...messages].reverse().find((m) => !m.hasReply);
        if (unrepliedMessage) {
          await apiClient.post('/messages/reply', {
            message_id: unrepliedMessage.id,
            reply: ciphertext,
          });
        } else {
          alert('Please wait for the sender to message you again.');
          return;
        }
      } else {
        await apiClient.post('/messages', {
          confession_id: selectedThread.confessionId,
          content: ciphertext,
        });
      }

      setNewMessage('');
      fetchMessages(selectedThread);
      fetchThreads();
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessagesError('Failed to send encrypted message. Ensure both participants have E2E keys.');
    } finally {
      setIsSending(false);
    }
  };

  const handleCreateBackup = async () => {
    if (recoveryPassphrase.length < 8) {
      alert('Use a recovery passphrase of at least 8 characters.');
      return;
    }
    try {
      await createKeyBackup(recoveryPassphrase);
      alert('Recovery backup saved. Store your passphrase safely — we cannot recover it.');
      setRecoveryPassphrase('');
      setShowRecovery(false);
    } catch (error) {
      console.error('Backup failed:', error);
      alert('Failed to create key backup.');
    }
  };

  const handleRestoreBackup = async () => {
    if (recoveryPassphrase.length < 8) return;
    try {
      await restoreFromBackup(recoveryPassphrase);
      setRecoveryPassphrase('');
      setShowRecovery(false);
      if (selectedThread) fetchMessages(selectedThread);
    } catch {
      alert('Recovery failed. Check your passphrase and try again.');
    }
  };

  return (
    <AuthGuard>
      <div className="flex h-[calc(100vh-4rem)] bg-gray-50 dark:bg-gray-900 overflow-hidden">
        <div className="w-1/3 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-col">
          <div className="p-4 border-b border-gray-200 dark:border-gray-800">
            <h1 className="text-xl font-bold flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              Messages
            </h1>
            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              End-to-end encrypted
            </p>
          </div>
          <ScrollArea className="flex-1">
            {threadsError ? (
              <div className="p-4 text-sm text-red-600">
                <div className="mb-2">{threadsError}</div>
                <Button variant="ghost" onClick={() => fetchThreads()}>Retry</Button>
              </div>
            ) : isLoadingThreads ? (
              <div className="p-4 space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="h-12 w-12 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : threads.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <p>No messages yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {threads.map((thread) => (
                  <button
                    key={`${thread.confessionId}-${thread.senderId}`}
                    onClick={() => setSelectedThread(thread)}
                    className={`w-full p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors flex flex-col gap-1 ${
                      selectedThread?.confessionId === thread.confessionId &&
                      selectedThread?.senderId === thread.senderId
                        ? 'bg-purple-50 dark:bg-purple-900/20'
                        : ''
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <span className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                        {thread.isAuthor ? 'Your Confession' : 'Sent Message'}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {formatDistanceToNow(new Date(thread.lastMessageAt), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-1">
                      {thread.confessionMessage}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                      {thread.lastMessageEncrypted ? ENCRYPTED_PREVIEW : thread.lastMessage}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="flex-1 flex flex-col">
          {keyError && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
              {keyError}
              <Button
                variant="link"
                className="ml-2 h-auto p-0 text-amber-900"
                onClick={() => setShowRecovery(true)}
              >
                Restore from backup
              </Button>
            </div>
          )}

          {showRecovery && (
            <div className="border-b border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-950 space-y-2">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Set or enter a recovery passphrase to backup or restore your encryption keys on this device.
              </p>
              <Input
                type="password"
                placeholder="Recovery passphrase (min 8 chars)"
                value={recoveryPassphrase}
                onChange={(e) => setRecoveryPassphrase(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleCreateBackup}>Save backup</Button>
                <Button size="sm" variant="outline" onClick={handleRestoreBackup}>
                  Restore keys
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowRecovery(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {selectedThread ? (
            <>
              <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
                <div className="flex items-center gap-3">
                  <div className="bg-purple-100 dark:bg-purple-900/40 p-2 rounded-full text-purple-600">
                    <UserIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 line-clamp-1">
                      {selectedThread.confessionMessage}
                    </h2>
                    <Badge variant="outline" className="text-[10px] py-0 h-4">
                      {selectedThread.isAuthor ? 'AUTHOR VIEW' : 'SENDER VIEW'} · E2E
                    </Badge>
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1 p-4 bg-gray-50 dark:bg-gray-900">
                {isLoadingMessages || !e2eReady ? (
                  <div className="space-y-4">
                    <Skeleton className="h-10 w-2/3" />
                    <Skeleton className="h-10 w-1/2 ml-auto" />
                    <Skeleton className="h-10 w-3/4" />
                  </div>
                ) : messagesError ? (
                  <div className="p-4 text-sm text-red-600">
                    <div className="mb-2">{messagesError}</div>
                    <Button
                      variant="ghost"
                      onClick={() => selectedThread && fetchMessages(selectedThread)}
                    >
                      Retry
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-6 pb-4">
                    {messages.map((msg) => (
                      <div key={msg.id} className="space-y-2">
                        <div className={`flex ${selectedThread.isAuthor ? 'justify-start' : 'justify-end'}`}>
                          <Card
                            className={`max-w-[80%] p-3 ${
                              selectedThread.isAuthor
                                ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                                : 'bg-purple-600 text-white border-none'
                            }`}
                          >
                            <p className="text-sm">{msg.decryptedContent}</p>
                            <div className="flex items-center gap-1 mt-1">
                              <p
                                className={`text-[10px] ${
                                  selectedThread.isAuthor ? 'text-gray-400' : 'text-purple-200'
                                }`}
                              >
                                {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                              </p>
                              {!selectedThread.isAuthor && msg.hasReply && (
                                <Badge
                                  variant="secondary"
                                  className="bg-purple-500/50 text-[8px] py-0 h-3 text-white border-none"
                                >
                                  Replied
                                </Badge>
                              )}
                            </div>
                          </Card>
                        </div>

                        {msg.hasReply && msg.decryptedReply && (
                          <div
                            className={`flex ${
                              selectedThread.isAuthor ? 'justify-end' : 'justify-start'
                            }`}
                          >
                            <Card
                              className={`max-w-[80%] p-3 ${
                                selectedThread.isAuthor
                                  ? 'bg-purple-600 text-white border-none'
                                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                              }`}
                            >
                              <p className="text-sm">{msg.decryptedReply}</p>
                              <p
                                className={`text-[10px] mt-1 ${
                                  selectedThread.isAuthor ? 'text-purple-200' : 'text-gray-400'
                                }`}
                              >
                                {msg.repliedAt &&
                                  formatDistanceToNow(new Date(msg.repliedAt), { addSuffix: true })}
                              </p>
                            </Card>
                          </div>
                        )}
                      </div>
                    ))}
                    {messages.length === 0 && (
                      <div className="text-center py-12 text-gray-400">
                        No messages in this thread yet.
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>

              <div className="p-4 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800">
                <div className="flex gap-2">
                  <Input
                    placeholder={
                      selectedThread.isAuthor ? 'Type an encrypted reply...' : 'Send encrypted message...'
                    }
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    disabled={isSending || !e2eReady}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={isSending || !newMessage.trim() || !e2eReady}
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
                {selectedThread.isAuthor && messages.every((m) => m.hasReply) && (
                  <p className="text-[10px] text-gray-400 mt-2 text-center">
                    You have replied to all messages. Wait for the sender to message you again.
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
              <div className="bg-gray-100 dark:bg-gray-800 p-6 rounded-full mb-4">
                <MessageSquare className="w-12 h-12" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-1">
                Select a conversation
              </h3>
              <p className="text-sm max-w-xs text-center">
                Choose a message thread from the list. Messages are encrypted on your device before
                they leave your browser.
              </p>
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
