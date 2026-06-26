import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AnonymousConfession } from './entities/confession.entity';

@Injectable()
export class ConfessionSchedulerService {
  private readonly logger = new Logger(ConfessionSchedulerService.name);

  constructor(
    @InjectRepository(AnonymousConfession)
    private confessionRepository: Repository<AnonymousConfession>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async publishScheduledConfessions() {
    const now = new Date();

    const scheduledConfessions = await this.confessionRepository.find({
      where: {
        status: 'scheduled',
        publishAt: LessThanOrEqual(now),
      },
    });

    for (const confession of scheduledConfessions) {
      try {
        confession.status = 'published';
        confession.created_at = new Date();
        await this.confessionRepository.save(confession);

        this.logger.log(`Published scheduled confession ${confession.id}`);
      } catch (error) {
        this.logger.error(
          `Failed to publish scheduled confession ${confession.id}: ${error.message}`,
        );
      }
    }
  }

  async scheduleConfession(
    confessionId: string,
    publishAt: Date,
  ): Promise<AnonymousConfession> {
    const confession = await this.confessionRepository.findOne({
      where: { id: confessionId },
    });

    if (!confession) {
      throw new Error('Confession not found');
    }

    if (publishAt <= new Date()) {
      throw new Error('Publish date must be in the future');
    }

    confession.status = 'scheduled';
    confession.publishAt = publishAt;

    return this.confessionRepository.save(confession);
  }

  async cancelSchedule(confessionId: string): Promise<AnonymousConfession> {
    const confession = await this.confessionRepository.findOne({
      where: { id: confessionId },
    });

    if (!confession) {
      throw new Error('Confession not found');
    }

    confession.status = 'draft';
    confession.publishAt = null;

    return this.confessionRepository.save(confession);
  }

  async getScheduledConfessions(
    userId: string,
  ): Promise<AnonymousConfession[]> {
    return this.confessionRepository.find({
      where: {
        anonymousUserId: userId,
        status: 'scheduled',
      },
      order: {
        publishAt: 'ASC',
      },
    });
  }
}
