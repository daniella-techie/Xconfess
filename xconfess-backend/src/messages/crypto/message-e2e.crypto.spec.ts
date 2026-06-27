import {
  buildThreadId,
  decryptMessage,
  encryptMessage,
  generateMessageKeyPair,
  isEncryptedPayload,
  parseEnvelope,
  unwrapPrivateKeyWithPassphrase,
  wrapPrivateKeyWithPassphrase,
} from './message-e2e.crypto';

describe('Message E2E crypto', () => {
  const confessionId = '11111111-1111-4111-8111-111111111111';
  const senderAnonId = '22222222-2222-4222-8222-222222222222';
  const threadId = buildThreadId(confessionId, senderAnonId);

  it('generates X25519 key pairs', async () => {
    const alice = await generateMessageKeyPair();
    const bob = await generateMessageKeyPair();

    expect(alice.publicKey).toBeTruthy();
    expect(alice.privateKey).toBeTruthy();
    expect(alice.publicKey).not.toEqual(bob.publicKey);
  });

  it('encrypts and decrypts bidirectionally with ECDH thread keys', async () => {
    const sender = await generateMessageKeyPair();
    const author = await generateMessageKeyPair();

    const ciphertext = await encryptMessage(
      'Hello, anonymous author!',
      sender.privateKey,
      author.publicKey,
      threadId,
    );

    expect(isEncryptedPayload(ciphertext)).toBe(true);

    const plaintext = await decryptMessage(
      ciphertext,
      author.privateKey,
      sender.publicKey,
      threadId,
    );

    expect(plaintext).toBe('Hello, anonymous author!');

    const replyCipher = await encryptMessage(
      'Thanks for reaching out.',
      author.privateKey,
      sender.publicKey,
      threadId,
    );

    const replyPlain = await decryptMessage(
      replyCipher,
      sender.privateKey,
      author.publicKey,
      threadId,
    );

    expect(replyPlain).toBe('Thanks for reaching out.');
  });

  it('rejects tampered ciphertext', async () => {
    const sender = await generateMessageKeyPair();
    const author = await generateMessageKeyPair();

    const ciphertext = await encryptMessage(
      'Secret',
      sender.privateKey,
      author.publicKey,
      threadId,
    );

    const envelope = parseEnvelope(ciphertext)!;
    envelope.ct = envelope.ct.slice(0, -2) + 'xx';
    const tampered = JSON.stringify(envelope);

    await expect(
      decryptMessage(tampered, author.privateKey, sender.publicKey, threadId),
    ).rejects.toThrow();
  });

  it('cannot decrypt with wrong thread id', async () => {
    const sender = await generateMessageKeyPair();
    const author = await generateMessageKeyPair();

    const ciphertext = await encryptMessage(
      'Bound to thread',
      sender.privateKey,
      author.publicKey,
      threadId,
    );

    await expect(
      decryptMessage(
        ciphertext,
        author.privateKey,
        sender.publicKey,
        buildThreadId(confessionId, '33333333-3333-4333-8333-333333333333'),
      ),
    ).rejects.toThrow();
  });

  describe('key backup (new device / recovery)', () => {
    it('wraps and unwraps private keys with passphrase', async () => {
      const keys = await generateMessageKeyPair();
      const wrapped = await wrapPrivateKeyWithPassphrase(
        keys.privateKey,
        'correct horse battery staple',
      );

      const restored = await unwrapPrivateKeyWithPassphrase(
        wrapped,
        'correct horse battery staple',
      );

      expect(restored).toBe(keys.privateKey);
    });

    it('fails unwrap with wrong passphrase', async () => {
      const keys = await generateMessageKeyPair();
      const wrapped = await wrapPrivateKeyWithPassphrase(
        keys.privateKey,
        'correct horse battery staple',
      );

      await expect(
        unwrapPrivateKeyWithPassphrase(wrapped, 'wrong passphrase'),
      ).rejects.toThrow();
    });

    it('simulates lost local key: new device cannot read old messages without backup', async () => {
      const sender = await generateMessageKeyPair();
      const author = await generateMessageKeyPair();

      const ciphertext = await encryptMessage(
        'Before device loss',
        sender.privateKey,
        author.publicKey,
        threadId,
      );

      const newDeviceSender = await generateMessageKeyPair();

      await expect(
        decryptMessage(
          ciphertext,
          newDeviceSender.privateKey,
          author.publicKey,
          threadId,
        ),
      ).rejects.toThrow();

      const wrapped = await wrapPrivateKeyWithPassphrase(
        sender.privateKey,
        'recovery-passphrase',
      );
      const restoredSenderPrivate = await unwrapPrivateKeyWithPassphrase(
        wrapped,
        'recovery-passphrase',
      );

      const recovered = await decryptMessage(
        ciphertext,
        restoredSenderPrivate,
        author.publicKey,
        threadId,
      );

      expect(recovered).toBe('Before device loss');
    });
  });
});
