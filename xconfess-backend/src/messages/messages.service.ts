import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';
import { Message } from './entities/message.entity';
import { CreateMessageDto, ReplyMessageDto } from './dto/message.dto';
import { User } from '../user/entities/user.entity';
import { AnonymousConfession } from '../confession/entities/confession.entity';
import { AnonymousUserService } from '../user/anonymous-user.service';
import { UserAnonymousUser } from '../user/entities/user-anonymous-link.entity';
import { AnonymousUser } from '../user/entities/anonymous-user.entity';
import { OutboxEvent, OutboxStatus } from '../common/entities/outbox-event.entity';
import {
  ENCRYPTED_PREVIEW,
  isEncryptedPayload,
} from './crypto/message-e2e.crypto';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(AnonymousConfession)
    private readonly confessionRepository: Repository<AnonymousConfession>,
    @InjectRepository(UserAnonymousUser)
    private readonly userAnonRepo: Repository<UserAnonymousUser>,
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    private readonly anonymousUserService: AnonymousUserService,
    private readonly dataSource: DataSource,
  ) { }

  async create(
    createMessageDto: CreateMessageDto,
    user: User,
  ): Promise<Message> {
    if (!isEncryptedPayload(createMessageDto.content)) {
      throw new BadRequestException(
        'Message content must be an E2E ciphertext envelope',
      );
    }

    const confession = await this.confessionRepository.findOne({
      where: { id: createMessageDto.confession_id },
      relations: ['anonymousUser', 'anonymousUser.userLinks', 'anonymousUser.userLinks.user'],
    });
    if (!confession) throw new NotFoundException('Confession not found');

    // Get or create anonymous identity for this session
    const sender = await this.anonymousUserService.getOrCreateForUserSession(
      user.id,
    );

    return this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(Message);
      const outboxRepo = manager.getRepository(OutboxEvent);

      const message = messageRepo.create({
        sender,
        confession,
        content: createMessageDto.content,
        isEncrypted: true,
      });

      const savedMessage = await messageRepo.save(message);

      // Create Outbox Event for notification to confession author
      const recipientEmail = this.getRecipientEmail(confession.anonymousUser);
      if (recipientEmail) {
        await outboxRepo.save(
          outboxRepo.create({
            type: 'message_notification',
            payload: {
              messageId: savedMessage.id,
              confessionId: confession.id,
              recipientEmail,
              senderId: sender.id,
              messagePreview: ENCRYPTED_PREVIEW,
            },
            idempotencyKey: `message:${savedMessage.id}`,
            status: OutboxStatus.PENDING,
          }),
        );
      }

      return savedMessage;
    });
  }

  async findForConfessionThread(
    confessionId: string,
    senderId: string,
    user: User,
  ): Promise<Message[]> {
    if (!confessionId || confessionId.trim() === '') {
      throw new BadRequestException('Invalid confession ID');
    }
    const confession = await this.confessionRepository.findOne({
      where: { id: confessionId },
      relations: ['anonymousUser'],
    });
    if (!confession) throw new NotFoundException('Confession not found');

    const userAnons = await this.userAnonRepo.find({
      where: { userId: user.id },
    });
    const anonIds = userAnons.map((ua) => ua.anonymousUserId);

    const isAuthor = confession.anonymousUser?.id && anonIds.includes(confession.anonymousUser.id);
    const isSender = anonIds.includes(senderId);

    if (!isAuthor && !isSender) {
      throw new ForbiddenException('You are not part of this conversation');
    }

    return this.messageRepository.find({
      where: {
        confession: { id: confessionId },
        sender: { id: senderId },
      },
      order: { createdAt: 'ASC' }, // Use ASC for chat-like order
    });
  }

  async findAllThreadsForUser(user: User): Promise<any[]> {
    const userAnons = await this.userAnonRepo.find({
      where: { userId: user.id },
    });
    const anonIds = userAnons.map((ua) => ua.anonymousUserId);

    if (anonIds.length === 0) return [];

    const messages = await this.messageRepository.find({
      where: [
        { sender: { id: In(anonIds) } },
        { confession: { anonymousUser: { id: In(anonIds) } } },
      ],
      relations: ['confession', 'sender', 'confession.anonymousUser'],
      order: { createdAt: 'DESC' },
    });

    const threadsMap = new Map();

    messages.forEach((m) => {
      const threadId = `${m.confession.id}_${m.sender.id}`;
      if (!threadsMap.has(threadId)) {
        threadsMap.set(threadId, {
          confessionId: m.confession.id,
          senderId: m.sender.id,
          authorAnonymousUserId: m.confession.anonymousUser?.id ?? null,
          confessionMessage:
            m.confession.message.substring(0, 50) +
            (m.confession.message.length > 50 ? '...' : ''),
          lastMessage: m.isEncrypted ? ENCRYPTED_PREVIEW : m.content,
          lastMessageEncrypted: m.isEncrypted,
          lastMessageAt: m.createdAt,
          hasUnread: false,
          isAuthor: anonIds.includes(m.confession.anonymousUser?.id),
        });
      }
    });

    return Array.from(threadsMap.values());
  }

  async reply(dto: ReplyMessageDto, user: User): Promise<Message> {
    // Validate reply content
    if (!dto.reply || dto.reply.trim() === '') {
      throw new BadRequestException('Reply content cannot be empty');
    }
    if (!isEncryptedPayload(dto.reply)) {
      throw new BadRequestException(
        'Reply content must be an E2E ciphertext envelope',
      );
    }
    const message = await this.messageRepository.findOne({
      where: { id: dto.message_id },
      relations: ['confession', 'confession.anonymousUser', 'sender', 'sender.userLinks', 'sender.userLinks.user'],
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.hasReply) throw new ForbiddenException('Already replied');

    // Verify user is author of the confession
    const userAnons = await this.userAnonRepo.find({
      where: { userId: user.id },
    });
    const anonIds = userAnons.map((ua) => ua.anonymousUserId);
    const confessionAuthorId = message.confession?.anonymousUser?.id;
    if (!confessionAuthorId || !anonIds.includes(confessionAuthorId)) {
      throw new ForbiddenException('You are not the author of this confession');
    }

    // Use a transaction to ensure atomicity
    return this.messageRepository.manager.transaction(async (manager) => {
      const messageRepo = manager.getRepository(Message);
      const outboxRepo = manager.getRepository(OutboxEvent);

      message.hasReply = true;
      message.replyContent = dto.reply.trim();
      message.isEncrypted = true;
      message.repliedAt = new Date();
      const savedReply = await messageRepo.save(message);

      // Create Outbox Event for notification to the original sender
      const recipientEmail = this.getRecipientEmail(message.sender);
      if (recipientEmail) {
        await outboxRepo.save(
          outboxRepo.create({
            type: 'reply_notification',
            payload: {
              messageId: savedReply.id,
              confessionId: message.confession.id,
              recipientEmail,
              replyPreview: ENCRYPTED_PREVIEW,
            },
            idempotencyKey: `reply:${savedReply.id}`,
            status: OutboxStatus.PENDING,
          }),
        );
      }

      return savedReply;
    });
  }

  private getRecipientEmail(anonymousUser: AnonymousUser): string | null {
    if (!anonymousUser) return null;
    const link = anonymousUser.userLinks?.[0];
    if (link?.user) {
      return link.user.getEmail();
    }
    return null;
  }
}
