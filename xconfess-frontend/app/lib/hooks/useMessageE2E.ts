'use client';

import { useCallback, useEffect, useState } from 'react';
import apiClient from '@/app/lib/api/client';
import {
  buildThreadId,
  decryptMessage,
  encryptMessage,
  generateMessageKeyPair,
  isEncryptedPayload,
  unwrapPrivateKeyWithPassphrase,
  wrapPrivateKeyWithPassphrase,
} from '@/app/lib/crypto/messageE2E';
import { loadLocalKeyPair, saveLocalKeyPair } from '@/app/lib/crypto/messageKeyStore';

interface SessionKeyStatus {
  anonymousUserId: string;
  publicKey: string | null;
  keyVersion: number;
  hasBackup: boolean;
}

interface ThreadContext {
  confessionId: string;
  senderAnonId: string;
  authorAnonymousUserId: string;
  isAuthor: boolean;
}

export function useMessageE2E() {
  const [session, setSession] = useState<SessionKeyStatus | null>(null);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const ensureSessionKeys = useCallback(async () => {
    setKeyError(null);
    const statusRes = await apiClient.get<SessionKeyStatus>('/messages/keys/me');
    const status = statusRes.data;
    setSession(status);

    const local = await loadLocalKeyPair(status.anonymousUserId);
    if (local?.privateKey) {
      setPrivateKey(local.privateKey);
      if (local.publicKey !== status.publicKey && status.publicKey) {
        setKeyError(
          'This device has different encryption keys than your server session. Restore from backup or messages from other devices may be unreadable.',
        );
      }
      setIsReady(true);
      return { ...status, privateKey: local.privateKey, publicKey: local.publicKey };
    }

    const generated = await generateMessageKeyPair();
    await saveLocalKeyPair(status.anonymousUserId, generated, status.keyVersion);
    await apiClient.put('/messages/keys', { publicKey: generated.publicKey });

    setPrivateKey(generated.privateKey);
    setSession({ ...status, publicKey: generated.publicKey });
    setIsReady(true);
    return { ...status, privateKey: generated.privateKey, publicKey: generated.publicKey };
  }, []);

  useEffect(() => {
    ensureSessionKeys().catch((err) => {
      console.error('Failed to initialize E2E keys:', err);
      setKeyError('Unable to initialize end-to-end encryption on this device.');
    });
  }, [ensureSessionKeys]);

  const fetchPeerPublicKey = useCallback(async (anonymousUserId: string) => {
    const res = await apiClient.get<{ publicKey: string }>(
      `/messages/keys/${anonymousUserId}`,
    );
    return res.data.publicKey;
  }, []);

  const getPeerAnonymousUserId = useCallback((thread: ThreadContext) => {
    return thread.isAuthor ? thread.senderAnonId : thread.authorAnonymousUserId;
  }, []);

  const encryptForThread = useCallback(
    async (plaintext: string, thread: ThreadContext) => {
      if (!privateKey) {
        throw new Error('E2E keys not ready');
      }

      const peerId = getPeerAnonymousUserId(thread);
      const peerPublicKey = await fetchPeerPublicKey(peerId);
      const threadId = buildThreadId(thread.confessionId, thread.senderAnonId);

      return encryptMessage(plaintext, privateKey, peerPublicKey, threadId);
    },
    [privateKey, fetchPeerPublicKey, getPeerAnonymousUserId],
  );

  const decryptForThread = useCallback(
    async (payload: string, thread: ThreadContext) => {
      if (!privateKey) {
        throw new Error('E2E keys not ready');
      }

      if (!isEncryptedPayload(payload)) {
        return payload;
      }

      const peerId = getPeerAnonymousUserId(thread);
      const peerPublicKey = await fetchPeerPublicKey(peerId);
      const threadId = buildThreadId(thread.confessionId, thread.senderAnonId);

      try {
        return await decryptMessage(payload, privateKey, peerPublicKey, threadId);
      } catch {
        return '[Unable to decrypt — wrong device or missing recovery key]';
      }
    },
    [privateKey, fetchPeerPublicKey, getPeerAnonymousUserId],
  );

  const createKeyBackup = useCallback(
    async (passphrase: string) => {
      if (!privateKey || !session) {
        throw new Error('E2E keys not ready');
      }

      const encryptedKeyBackup = await wrapPrivateKeyWithPassphrase(
        privateKey,
        passphrase,
      );
      await apiClient.put('/messages/keys', {
        publicKey: session.publicKey,
        encryptedKeyBackup,
      });
      setSession({ ...session, hasBackup: true });
    },
    [privateKey, session],
  );

  const restoreFromBackup = useCallback(
    async (passphrase: string) => {
      if (!session) {
        throw new Error('Session not ready');
      }

      const backupRes = await apiClient.get<{
        encryptedKeyBackup: string;
        keyVersion: number;
      }>('/messages/keys/backup');

      const restoredPrivate = await unwrapPrivateKeyWithPassphrase(
        backupRes.data.encryptedKeyBackup,
        passphrase,
      );

      await saveLocalKeyPair(session.anonymousUserId, {
        publicKey: session.publicKey ?? '',
        privateKey: restoredPrivate,
      }, backupRes.data.keyVersion);

      setPrivateKey(restoredPrivate);
      setKeyError(null);
    },
    [session],
  );

  return {
    isReady,
    keyError,
    session,
    ensureSessionKeys,
    encryptForThread,
    decryptForThread,
    createKeyBackup,
    restoreFromBackup,
  };
}
