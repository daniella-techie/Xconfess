import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeatureFlag } from './entities/feature-flag.entity';
import {
  CreateFeatureFlagDto,
  UpdateFeatureFlagDto,
} from './dto/create-feature-flag.dto';

@Injectable()
export class FeatureFlagsService {
  constructor(
    @InjectRepository(FeatureFlag)
    private featureFlagRepository: Repository<FeatureFlag>,
  ) {}

  async create(dto: CreateFeatureFlagDto): Promise<FeatureFlag> {
    const flag = this.featureFlagRepository.create(dto);
    return this.featureFlagRepository.save(flag);
  }

  async findAll(): Promise<FeatureFlag[]> {
    return this.featureFlagRepository.find();
  }

  async findOne(name: string): Promise<FeatureFlag | null> {
    return this.featureFlagRepository.findOne({ where: { name } });
  }

  async update(name: string, dto: UpdateFeatureFlagDto): Promise<FeatureFlag> {
    await this.featureFlagRepository.update({ name }, dto);
    return this.findOne(name);
  }

  async delete(name: string): Promise<void> {
    await this.featureFlagRepository.delete({ name });
  }

  async isEnabled(flagName: string, userId?: string): Promise<boolean> {
    const flag = await this.findOne(flagName);

    if (!flag || !flag.enabled) {
      return false;
    }

    // Check if user is in allowlist
    if (userId && flag.userIds && flag.userIds.length > 0) {
      return flag.userIds.includes(userId);
    }

    // Percentage-based rollout
    if (flag.percentage === 100) {
      return true;
    }

    if (flag.percentage === 0) {
      return false;
    }

    // Use userId hash for consistent assignment
    if (userId) {
      const hash = this.hashCode(userId + flagName);
      return Math.abs(hash) % 100 < flag.percentage;
    }

    // Random for anonymous users
    return Math.random() * 100 < flag.percentage;
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash;
  }
}
