import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  Get,
  UseGuards,
  Put,
  Patch,
  Req,
  Param,
  Query,
  NotFoundException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserService } from './user.service';
import { AuthService } from '../auth/auth.service';
import { User, UserRole } from './entities/user.entity';
import { RegisterDto } from '../auth/dto/register.dto';
import { LoginDto } from '../auth/dto/login.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { UpdateUserProfileDto } from './dto/updateProfile.dto';
import { CryptoUtil } from '../common/crypto.util';
import { UpdateNotificationPreferencesDto, NotificationPreferencesResponse } from './dto/update-notification-preferences.dto';
import {
  PrivacySettingsResponseDto,
} from './dto/update-privacy-settings.dto';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiQuery,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PaginatedUserActivityDto } from './dto/user-activity.dto';
import { ConfessionService } from '../confession/confession.service';
import { GetUserConfessionsDto } from '../confession/dto/get-user-confessions.dto';
import { UserResponse } from './dto/user-response.dto';
// Re-export so existing consumers that import UserResponse from this file keep working.
export { UserResponse } from './dto/user-response.dto';

export interface UserProfileResponse {
  id: number;
  username: string;
  isAnonymous: boolean;
}

@ApiTags('Auth')
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly confessionService: ConfessionService,
  ) {}

  /** Maps a User entity to the public response shape — no internal fields. */
  private formatUserResponse(user: User): UserResponse {
    const email = CryptoUtil.decrypt(
      user.emailEncrypted,
      user.emailIv,
      user.emailTag,
    );
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      is_active: user.is_active,
      email,
      notificationPreferences: user.notificationPreferences || {},
      privacy: {
        isDiscoverable: user.isDiscoverable(),
        canReceiveReplies: user.canReceiveReplies(),
        showReactions: user.shouldShowReactions(),
        dataProcessingConsent: user.hasDataProcessingConsent(),
      },
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({
    status: 201,
    description: 'Registration successful.',
    schema: {
      example: {
        user: {
          id: 1,
          username: 'alice_42',
          role: 'user',
          is_active: true,
          email: 'alice@example.com',
          createdAt: '2026-04-25T10:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 409, description: 'Email or username already in use.' })
  async register(
    @Body() registerDto: RegisterDto,
  ): Promise<{ user: UserResponse }> {
    try {
      if (!registerDto.email || !registerDto.email.includes('@')) {
        throw new BadRequestException('Invalid email format');
      }
      if (!registerDto.password || registerDto.password.length < 6) {
        throw new BadRequestException('Password must be at least 6 characters');
      }
      if (!registerDto.username) {
        throw new BadRequestException('Username is required');
      }

      const existingEmail = await this.userService.findByEmail(
        registerDto.email,
      );
      if (existingEmail) {
        throw new ConflictException('Email already in use');
      }

      const existingUsername = await this.userService.findByUsername(
        registerDto.username,
      );
      if (existingUsername) {
        throw new ConflictException('Username already in use');
      }

      const user = await this.userService.create(
        registerDto.email,
        registerDto.password,
        registerDto.username,
      );

      return { user: this.formatUserResponse(user) };
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException
      )
        throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException('Registration failed: ' + message);
    }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Log in (alternative endpoint for user login)' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful.',
    schema: {
      example: {
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        anonymousUserId: 'anon_7f3a2b1c',
        user: { id: 1, username: 'alice_42', role: 'user' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  async login(@Body() loginDto: LoginDto): Promise<{
    access_token: string;
    user: UserResponse;
    anonymousUserId: string;
  }> {
    try {
      const result = await this.authService.login(
        loginDto.email,
        loginDto.password,
      );
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException('Login failed: ' + message);
    }
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@GetUser('id') userId: number): Promise<UserResponse> {
    try {
      const user = await this.userService.findById(userId);
      if (!user || !user.is_active) {
        throw new UnauthorizedException('User not found');
      }
      return this.formatUserResponse(user);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException('Failed to get profile: ' + message);
    }
  }

  @Get('profile/summary')
  @UseGuards(JwtAuthGuard)
  async getProfileSummary(
    @GetUser('id') userId: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<any> {
    return this.userService.getProfileSummary(
      userId,
      parseInt(page || '1', 10),
      parseInt(limit || '10', 10),
    );
  }

  @Post('deactivate')
  @UseGuards(JwtAuthGuard)
  async deactivateAccount(
    @GetUser('id') userId: number,
  ): Promise<UserResponse> {
    const updatedUser = await this.userService.deactivateAccount(userId);
    return this.formatUserResponse(updatedUser);
  }

  @Post('reactivate')
  @UseGuards(JwtAuthGuard)
  async reactivateAccount(
    @GetUser('id') userId: number,
  ): Promise<UserResponse> {
    const updatedUser = await this.userService.reactivateAccount(userId);
    return this.formatUserResponse(updatedUser);
  }

  private readonly DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesResponse = {
    reactions: { inApp: true, email: true, push: true },
    comments: { inApp: true, email: true, push: true },
    mentions: { inApp: true, email: true, push: true },
    tips: { inApp: true, email: true, push: true },
    reports: { inApp: true, email: true, push: true },
    system: { inApp: true, email: true, push: true },
    enableQuietHours: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: null,
  };

  private getNotificationPreferencesResponse(prefs: Record<string, any>): NotificationPreferencesResponse {
    return {
      reactions: { inApp: true, email: true, push: true, ...prefs.reactions },
      comments: { inApp: true, email: true, push: true, ...prefs.comments },
      mentions: { inApp: true, email: true, push: true, ...prefs.mentions },
      tips: { inApp: true, email: true, push: true, ...prefs.tips },
      reports: { inApp: true, email: true, push: true, ...prefs.reports },
      system: { inApp: true, email: true, push: true, ...prefs.system },
      enableQuietHours: prefs.enableQuietHours ?? false,
      quietHoursStart: prefs.quietHoursStart ?? null,
      quietHoursEnd: prefs.quietHoursEnd ?? null,
      timezone: prefs.timezone ?? null,
    };
  }

  @Get('notification-preferences')
  @UseGuards(JwtAuthGuard)
  async getNotificationPreferences(@GetUser('id') userId: number) {
    const user = await this.userService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return this.getNotificationPreferencesResponse(user.notificationPreferences || {});
  }

  @Patch('notification-preferences')
  @UseGuards(JwtAuthGuard)
  async updateNotificationPreferences(
    @GetUser('id') userId: number,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    const user = await this.userService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const current = user.notificationPreferences || {};

    // Merge channel preferences
    if (dto.reactions) current.reactions = { ...current.reactions, ...dto.reactions };
    if (dto.comments) current.comments = { ...current.comments, ...dto.comments };
    if (dto.mentions) current.mentions = { ...current.mentions, ...dto.mentions };
    if (dto.tips) current.tips = { ...current.tips, ...dto.tips };
    if (dto.reports) current.reports = { ...current.reports, ...dto.reports };
    if (dto.system) current.system = { ...current.system, ...dto.system };

    // Merge legacy flat booleans
    if (dto.message !== undefined) current.message = dto.message;
    if (dto.reaction !== undefined) current.reaction = dto.reaction;
    if (dto.moderation !== undefined) current.moderation = dto.moderation;

    // Quiet hours
    if (dto.enableQuietHours !== undefined) current.enableQuietHours = dto.enableQuietHours;
    if (dto.quietHoursStart !== undefined) current.quietHoursStart = dto.quietHoursStart;
    if (dto.quietHoursEnd !== undefined) current.quietHoursEnd = dto.quietHoursEnd;
    if (dto.timezone !== undefined) current.timezone = dto.timezone;

    user.notificationPreferences = current;

    const savedUser = await this.userService.saveUser(user);
    return this.getNotificationPreferencesResponse(savedUser.notificationPreferences || {});
  }

  @UseGuards(JwtAuthGuard)
  @Put('profile')
  async updateProfile(
    @GetUser('id') userId: number,
    @Body() updateUserProfileDto: UpdateUserProfileDto,
  ): Promise<UserResponse> {
    const updatedUser = await this.userService.updateProfile(
      userId,
      updateUserProfileDto,
    );
    return this.formatUserResponse(updatedUser);
  }

  @Get('privacy-settings')
  @UseGuards(JwtAuthGuard)
  async getPrivacySettings(
    @GetUser('id') userId: number,
  ): Promise<PrivacySettingsResponseDto> {
    return this.userService.getPrivacySettings(userId);
  }

  @Patch('privacy-settings')
  @UseGuards(JwtAuthGuard)
  async updatePrivacySettings(
    @GetUser('id') userId: number,
    @Body() dto: UpdatePrivacySettingsDto,
  ): Promise<PrivacySettingsResponseDto> {
    return this.userService.updatePrivacySettings(userId, dto);
  }

  @Get(':id/public-profile')
  async getPublicProfile(
    @Param('id') id: string,
  ): Promise<UserProfileResponse> {
    try {
      const userId = parseInt(id, 10);

      if (isNaN(userId)) {
        return {
          id: parseInt(id),
          username: 'Anonymous',
          isAnonymous: true,
        };
      }

      const user = await this.userService.findById(userId);

      if (!user || !user.isDiscoverable()) {
        return {
          id: userId,
          username: 'Anonymous',
          isAnonymous: true,
        };
      }

      return {
        id: user.id,
        username: user.username,
        isAnonymous: false,
      };
    } catch {
      return {
        id: parseInt(id, 10),
        username: 'Anonymous',
        isAnonymous: true,
      };
    }
  }

  @Get(':id/confessions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get confessions belonging to a user (paginated)' })
  @ApiParam({ name: 'id', description: 'User ID (numeric)' })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated user confessions',
  })
  async getUserConfessions(
    @Param('id') id: string,
    @Query() dto: GetUserConfessionsDto,
    @GetUser() currentUser: User,
  ): Promise<any> {
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    // Permission check: User can only see their own confessions unless they are an admin
    if (currentUser.id !== userId && currentUser.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You can only view your own confessions');
    }

    return this.confessionService.getUserConfessions(userId, dto);
  }

  @Get(':id/activities')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get real-time user activity feed' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Aggregated user activity retrieved successfully',
    type: PaginatedUserActivityDto,
  })
  async getUserActivities(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<PaginatedUserActivityDto> {
    try {
      const userId = parseInt(id, 10);
      if (isNaN(userId)) {
        return {
          data: [],
          meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
        };
      }

      const user = await this.userService.findById(userId);
      if (!user || !user.isDiscoverable()) {
        return {
          data: [],
          meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
        };
      }

      const pageNum = parseInt(page || '1', 10);
      const limitNum = parseInt(limit || '10', 10);

      const activities = await this.userService.getUserActivitiesList(
        userId,
        pageNum,
        limitNum,
      );

      return activities;
    } catch {
      return {
        data: [],
        meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
      };
    }
  }
}
