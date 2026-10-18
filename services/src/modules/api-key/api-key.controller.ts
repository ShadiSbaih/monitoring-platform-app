import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../guards/auth.guard';
import { ApiKeyService } from './api-key.service';

interface AuthenticatedRequest extends Request {
  user: { id: string };
}

@Controller('api-keys')
@UseGuards(AuthGuard)
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Post()
  createApiKey(@Req() request: AuthenticatedRequest) {
    return this.apiKeyService.createApiKey(request.user.id);
  }

  @Get()
  listApiKeys(@Req() request: AuthenticatedRequest) {
    return this.apiKeyService.listApiKeys(request.user.id);
  }

  @Get(':id')
  getApiKeyLastUsed(@Req() request: AuthenticatedRequest, @Param('id') keyId: string) {
    return this.apiKeyService.getApiKeyLastUsed(request.user.id, keyId);
  }

  @Delete(':id')
  deleteApiKey(@Req() request: AuthenticatedRequest, @Param('id') keyId: string) {
    return this.apiKeyService.deleteApiKey(request.user.id, keyId);
  }

  @Post(':id/regenerate')
  regenerateApiKey(@Req() request: AuthenticatedRequest, @Param('id') keyId: string) {
    return this.apiKeyService.regenerateApiKey(request.user.id, keyId);
  }
}
