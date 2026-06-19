import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfessionService } from './confession.service';
import { AnonymousConfession } from './entities/confession.entity';
import { StellarService } from '../stellar/stellar.service';
import { AnchorConfessionDto } from '../stellar/dto/anchor-confession.dto';
import { AnonymousConfessionRepository } from './repository/confession.repository';

// Mock encryption
jest.mock('../utils/confession-encryption', () => ({
  decryptConfession: jest.fn((msg: string) => msg),
  encryptConfession: jest.fn((msg: string) => msg),
}));

// Mock the repository
const mockConfessionRepo = {
  findOne: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  manager: { getRepository: jest.fn() },
};

describe('ConfessionService - Idempotency', () => {
  let service: ConfessionService;
  let confessionRepo: jest.Mocked<AnonymousConfessionRepository>;
  let stellarService: jest.Mocked<StellarService>;

  const mockConfession = {
    id: 'test-confession-id',
    message: 'encrypted-test-message',
    stellarTxHash: null,
    stellarHash: null,
    isAnchored: false,
    anchoredAt: null,
    isDeleted: false,
  };

  const mockExistingConfession = {
    id: 'existing-confession-id',
    message: 'encrypted-existing-message',
    stellarTxHash: 'a'.repeat(64),
    stellarHash: 'hash123',
    isAnchored: true,
    anchoredAt: new Date(),
    isDeleted: false,
  };

  const mockAnchorDto: AnchorConfessionDto = {
    stellarTxHash: 'a'.repeat(64),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfessionService,
        {
          provide: AnonymousConfessionRepository,
          useValue: mockConfessionRepo,
        },
        {
          provide: StellarService,
          useValue: {
            isValidTxHash: jest.fn().mockReturnValue(true),
            processAnchorData: jest.fn().mockReturnValue({
              stellarTxHash: 'a'.repeat(64),
              stellarHash: 'hash123',
              anchoredAt: new Date(),
            }),
            getExplorerUrl: jest.fn().mockReturnValue('https://stellar.explorer/tx/hash'),
            verifyTransaction: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-aes-key-32-chars-long!!') },
        },
        {
          provide: 'AppLogger',
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
        {
          provide: 'EventEmitter2',
          useValue: { emit: jest.fn() },
        },
        {
          provide: 'AnonymousUserService',
          useValue: { create: jest.fn() },
        },
        {
          provide: 'ModerationRepositoryService',
          useValue: { createLog: jest.fn() },
        },
        {
          provide: 'AiModerationService',
          useValue: { moderateContent: jest.fn().mockResolvedValue({ score: 0, flags: [], status: 'approved', requiresReview: false, details: {} }) },
        },
        {
          provide: 'ConfessionViewCacheService',
          useValue: { invalidateCache: jest.fn() },
        },
        {
          provide: 'CacheService',
          useValue: { get: jest.fn(), set: jest.fn() },
        },
        {
          provide: 'TagService',
          useValue: { validateTags: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: 'EncryptionService',
          useValue: { encrypt: jest.fn(), decrypt: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ConfessionService>(ConfessionService);
    confessionRepo = module.get(AnonymousConfessionRepository);
    stellarService = module.get(StellarService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('anchorConfession - Idempotency', () => {
    it('✅ should allow first anchor request with new txHash', async () => {
      confessionRepo.findOne
        .mockResolvedValueOnce(mockConfession as any)
        .mockResolvedValueOnce({
          ...mockConfession,
          stellarTxHash: 'a'.repeat(64),
          stellarHash: 'hash123',
        } as any);
      
      confessionRepo.update = jest.fn().mockResolvedValue({ affected: 1 } as any);

      const result = await service.anchorConfession('test-confession-id', mockAnchorDto);

      expect(result).toHaveProperty('anchorPending', true);
      expect(result).toHaveProperty('stellarTxHash', 'a'.repeat(64));
    });

    it('✅ should return existing metadata on replay (idempotent)', async () => {
      confessionRepo.findOne
        .mockResolvedValueOnce(mockConfession as any)
        .mockResolvedValueOnce(mockExistingConfession as any);

      const result = await service.anchorConfession('test-confession-id', mockAnchorDto);

      expect(result).toHaveProperty('idempotent', true);
      expect(result).toHaveProperty('confessionId', 'existing-confession-id');
      expect(result).toHaveProperty('isAnchored', true);
      expect(result).toHaveProperty('stellarTxHash', 'a'.repeat(64));
    });

    it('✅ should prevent duplicate txHash with ConflictException', async () => {
      confessionRepo.findOne
        .mockResolvedValueOnce(mockConfession as any)
        .mockResolvedValueOnce(null);

      confessionRepo.update = jest.fn().mockRejectedValue({
        code: '23505',
      });

      await expect(service.anchorConfession('test-confession-id', mockAnchorDto))
        .rejects
        .toThrow(ConflictException);
    });

    it('✅ should reject invalid txHash format', async () => {
      stellarService.isValidTxHash.mockReturnValueOnce(false);
      confessionRepo.findOne.mockResolvedValueOnce(mockConfession as any);

      await expect(service.anchorConfession('test-confession-id', { stellarTxHash: 'invalid' }))
        .rejects
        .toThrow(BadRequestException);
    });

    it('✅ should log replay detection events', async () => {
      const loggerSpy = jest.spyOn(service['logger'], 'log');

      confessionRepo.findOne
        .mockResolvedValueOnce(mockConfession as any)
        .mockResolvedValueOnce(mockExistingConfession as any);

      await service.anchorConfession('test-confession-id', mockAnchorDto);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'anchor_replay',
          stellarTxHash: 'a'.repeat(64),
        })
      );
    });
  });
});
